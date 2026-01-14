const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const Stripe = require('stripe');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static files from project root (but not index.html)
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
  index: false // Disable automatic serving of index.html
}));

// Serve invoice.html for root (modular version)
app.get('/', (req, res) => {
  console.log('🚀 Serving modular invoice.html at:', new Date().toISOString());
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'invoice.html'));
});

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try {
    stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  } catch (e) {
    console.error('Failed to initialize Stripe:', e && e.message ? e.message : e);
    stripe = null;
  }
}
const TEST_MODE = (process.env.TEST_MODE === 'true');

// Helpers: auth
function getAuthUser(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.split(' ')[1];
  return findUserByToken(token);
}

function applySubscriptionAccrual(u, now = new Date()) {
  try {
    if (!u || !u.subscription) return false;

    const monthly = Number(u.subscription.monthlyGenerations ?? u.subscription.generations ?? 0);
    if (!Number.isFinite(monthly) || monthly <= 0) return false;
    // unlimited plans use -1
    if (monthly === -1) return false;

    const start = u.subscription.startDate ? new Date(u.subscription.startDate) : null;
    if (!start || isNaN(start.getTime())) return false;

    const monthsGranted = Number(u.subscription.monthsGranted || 0);
    const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;
    const elapsedMs = now.getTime() - start.getTime();
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return false;

    const monthsElapsed = Math.max(0, Math.floor(elapsedMs / MS_PER_MONTH) + 1);
    const monthsToGrant = monthsElapsed - monthsGranted;
    if (monthsToGrant <= 0) return false;

    u.normalGenerations = (u.normalGenerations || 0) + (monthly * monthsToGrant);
    u.subscription.monthsGranted = monthsGranted + monthsToGrant;
    return true;
  } catch (e) {
    console.error('applySubscriptionAccrual failed', e && e.message ? e.message : e);
    return false;
  }
}

// Authoritative subscription status (source of truth)
app.get('/api/subscription/status', (req, res) => {
  try {
    const user = getAuthUser(req);
    if (!user) {
      return res.json({ is_subscribed: false, subscription: null, generations: { normal: 0, watermark_free: 0 } });
    }

    const arr = readUsers();
    const u = arr.find(x => x.id === user.id);
    if (!u) {
      return res.json({ is_subscribed: false, subscription: null, generations: { normal: 0, watermark_free: 0 } });
    }

    if (u.subscription) {
      const changed = applySubscriptionAccrual(u);
      if (changed) writeUsers(arr);
    }

    const sub = u.subscription || null;
    const isSubscribed = !!sub;
    return res.json({
      is_subscribed: isSubscribed,
      subscription: sub,
      generations: { normal: u.normalGenerations || 0, watermark_free: u.watermarkFreeGenerations || 0 }
    });
  } catch (e) {
    console.error('subscription/status error', e && e.message ? e.message : e);
    return res.status(500).json({ is_subscribed: false, subscription: null });
  }
});

// Verify subscription after Stripe success (or test mode)
app.post('/api/subscription/verify', express.json(), async (req, res) => {
  try {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'missing token' });

    const { session_id } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    // In TEST_MODE (or if stripe not configured), accept and set a basic subscription
    if (TEST_MODE || !stripe) {
      const arr = readUsers();
      const u = arr.find(x => x.id === user.id);
      if (!u) return res.status(404).json({ error: 'user not found' });

      const now = new Date();
      if (!u.subscription) {
        u.subscription = { planType: 'basic', name: 'Basic Plan', price: 9.99, generations: 300, monthlyGenerations: 300, startDate: now.toISOString(), monthsGranted: 0 };
      }

      // Apply monthly accrual (idempotent). This grants the current month if not granted yet.
      u.subscription.startDate = u.subscription.startDate || now.toISOString();
      if (!Number.isFinite(Number(u.subscription.monthsGranted))) u.subscription.monthsGranted = 0;
      applySubscriptionAccrual(u, now);

      writeUsers(arr);

      return res.json({
        is_subscribed: true,
        subscription: u.subscription,
        generations: { normal: u.normalGenerations || 0, watermark_free: u.watermarkFreeGenerations || 0 }
      });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (!session || session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'payment_not_completed' });
    }

    const planType = session.metadata?.planType || 'basic';
    const planGenerations = parseInt(session.metadata?.generations || '100', 10);
    const name = planType === 'enterprise' ? 'Enterprise Plan' : (planType === 'professional' ? 'Professional Plan' : 'Basic Plan');
    const price = planType === 'enterprise' ? 39.99 : (planType === 'professional' ? 29.99 : 9.99);

    const arr = readUsers();
    const u = arr.find(x => x.id === user.id);
    if (!u) return res.status(404).json({ error: 'user not found' });

    const now = new Date();

    // Idempotency: if this session was already verified for this user, do not grant again.
    if (u.subscription && u.subscription.stripeSessionId && u.subscription.stripeSessionId === session.id) {
      if (!Number.isFinite(Number(u.subscription.monthsGranted))) u.subscription.monthsGranted = 0;
      applySubscriptionAccrual(u, now);
      writeUsers(arr);
      return res.json({
        is_subscribed: true,
        subscription: u.subscription,
        generations: { normal: u.normalGenerations || 0, watermark_free: u.watermarkFreeGenerations || 0 }
      });
    }

    u.subscription = {
      planType,
      name,
      price,
      generations: Number.isFinite(planGenerations) ? planGenerations : 100,
      monthlyGenerations: Number.isFinite(planGenerations) ? planGenerations : 100,
      startDate: now.toISOString(),
      monthsGranted: 0,
      stripeSessionId: session.id,
      stripeSubscriptionId: session.subscription || null
    };

    // Subscription grants monthly generations (accumulates).
    applySubscriptionAccrual(u, now);

    writeUsers(arr);

    return res.json({
      is_subscribed: true,
      subscription: u.subscription,
      generations: { normal: u.normalGenerations || 0, watermark_free: u.watermarkFreeGenerations || 0 }
    });
  } catch (e) {
    console.error('subscription/verify error', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'verification_failed' });
  }
});

// Cancel subscription immediately and remove premium features
app.post('/api/subscription/cancel', express.json(), async (req, res) => {
  try {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'missing token' });

    const arr = readUsers();
    const u = arr.find(x => x.id === user.id);
    if (!u) return res.status(404).json({ error: 'user not found' });

    const testMode = (TEST_MODE || !stripe);
    let stripeCancelled = false;

    // Before cancelling, apply any accrued monthly generations so the user keeps what they earned.
    if (u.subscription) {
      applySubscriptionAccrual(u);
    }

    // If stripe is configured and we're not in test mode, we must cancel billing in Stripe.
    if (!testMode) {
      let stripeSubId = u.subscription?.stripeSubscriptionId;

      // Fallback: derive subscription id from the stored checkout session id.
      if (!stripeSubId && u.subscription?.stripeSessionId) {
        try {
          const session = await stripe.checkout.sessions.retrieve(u.subscription.stripeSessionId);
          if (session && session.subscription) {
            stripeSubId = session.subscription;
            // Persist for future operations
            u.subscription.stripeSubscriptionId = stripeSubId;
          }
        } catch (e) {
          console.error('stripe session retrieve failed', e && e.message ? e.message : e);
        }
      }

      if (!stripeSubId) {
        return res.status(400).json({ error: 'missing_stripe_subscription_id' });
      }

      try {
        await stripe.subscriptions.cancel(stripeSubId);
        stripeCancelled = true;
      } catch (stripeErr) {
        console.error('stripe cancel failed', stripeErr && stripeErr.message ? stripeErr.message : stripeErr);
        return res.status(502).json({ error: 'stripe_cancel_failed' });
      }
    }

    // Remove premium features immediately
    u.subscription = null;
    u.watermarkFreeGenerations = 0;
    writeUsers(arr);

    return res.json({ ok: true, cancelled: true, stripe_cancelled: stripeCancelled, test_mode: testMode });
  } catch (e) {
    console.error('subscription/cancel error', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'cancel_failed' });
  }
});

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const PURCHASES_FILE = path.join(DATA_DIR, 'purchases.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
const VERSIONS_FILE = path.join(DATA_DIR, 'versions.json');
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));
const savePurchase = async (purchase) => {
  try {
    let arr = [];
    if (fs.existsSync(PURCHASES_FILE)) {
      arr = JSON.parse(fs.readFileSync(PURCHASES_FILE));
      if (!Array.isArray(arr)) arr = [];
    }
    arr.push(purchase);
    fs.writeFileSync(PURCHASES_FILE, JSON.stringify(arr, null, 2));
  } catch (err) {
    console.error('Failed to save purchase locally', err.message);
  }
};

const appendToFile = (filePath, obj) => {
  try {
    let arr = [];
    if (fs.existsSync(filePath)) {
      arr = JSON.parse(fs.readFileSync(filePath));
      if (!Array.isArray(arr)) arr = [];
    }
    arr.push(obj);
    fs.writeFileSync(filePath, JSON.stringify(arr, null, 2));
    return true;
  } catch (e) { console.error('appendToFile failed', filePath, e && e.message?e.message:e); return false; }
};

// Credits system removed per user request

// Users helpers (simple token-based auth for demo)
function readUsers(){ try { return JSON.parse(fs.readFileSync(USERS_FILE)); } catch(e){ return []; } }
function writeUsers(arr){ fs.writeFileSync(USERS_FILE, JSON.stringify(arr, null, 2)); }
function createUser(email){ const arr = readUsers(); const id = 'user_' + Math.random().toString(36).slice(2,10); const token = 'tok_' + Math.random().toString(36).slice(2,16); const u = { id, email, token, created_at: new Date().toISOString() }; arr.push(u); writeUsers(arr); return u; }
function findUserByToken(token){ if(!token) return null; const arr = readUsers(); return arr.find(u=>u.token===token) || null; }
// Generations helpers
function getUserById(id){ const arr = readUsers(); return arr.find(u=>u.id===id) || null; }
function addGenerationsToUser(userId, n, type = 'normal'){ const arr = readUsers(); const u = arr.find(x=>x.id===userId); if(!u) return null; if(type === 'ai'){ u.aiGenerations = (u.aiGenerations||0) + Number(n||0); writeUsers(arr); return u.aiGenerations; } else { u.normalGenerations = (u.normalGenerations||0) + Number(n||0); writeUsers(arr); return u.normalGenerations; } }
function consumeGenerationFromUser(userId, type = 'normal'){ const arr = readUsers(); const u = arr.find(x=>x.id===userId); if(!u) return false; if(type === 'ai'){ u.aiGenerations = (u.aiGenerations||0) - 1; if(u.aiGenerations < 0) return false; writeUsers(arr); return true; } else { u.normalGenerations = (u.normalGenerations||0) - 1; if(u.normalGenerations < 0) return false; writeUsers(arr); return true; } }

// Subscription endpoints
app.post('/api/create-subscription-session', async (req, res) => {
  try {
    console.log('🚀 Creating subscription session with body:', req.body);
    
    if (TEST_MODE) {
      const sid = `test_sub_${Date.now()}_${Math.floor(Math.random()*10000)}`;
      const origin = req.headers.origin || `http://localhost:${process.env.PORT||3000}`;
      console.log('✅ Test mode subscription session created:', sid);
      return res.json({ sessionId: sid, url: `${origin}/?session_id=${sid}` });
    }

    if (!stripe) {
      console.log('❌ Stripe not configured');
      return res.status(500).json({ error: 'Stripe not configured on server. Set STRIPE_SECRET_KEY in .env' });
    }
    
    const origin = req.headers.origin || `http://localhost:${process.env.PORT||3000}`;
    const body = req.body || {};
    const planType = body.planType;
    
    if (!planType) {
      return res.status(400).json({ error: 'planType is required' });
    }

    // Subscription pricing
    const plans = {
      basic: { name: 'Basic Plan', price: 999, generations: 100 },
      professional: { name: 'Professional Plan', price: 2999, generations: 500 },
      enterprise: { name: 'Enterprise Plan', price: 3999, generations: -1 }
    };

    const plan = plans[planType];
    if (!plan) {
      return res.status(400).json({ error: 'Invalid planType' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          recurring: { interval: 'month' },
          product_data: {
            name: plan.name,
            description: `${plan.generations === -1 ? 'Unlimited' : plan.generations} invoice generations per month`,
          },
          unit_amount: plan.price,
        },
        quantity: 1,
      }],
      success_url: `${origin}/?subscription_success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=true`,
      metadata: {
        planType,
        generations: plan.generations.toString()
      }
    });

    console.log('✅ Subscription session created successfully');
    res.json({ 
      sessionId: session.id, 
      url: session.url
    });
  } catch (error) {
    console.error('❌ Subscription session creation failed:', error);
    res.status(500).json({ error: `Failed to create subscription session: ${error.message}` });
  }
});

app.post('/api/create-credits-session', async (req, res) => {
  try {
    console.log('💳 Creating credits session with body:', req.body);
    
    // Get user token from authorization header (optional for local mode)
    const auth = req.headers.authorization;
    let user = null;
    
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.split(' ')[1];
      user = findUserByToken(token);
      console.log('👤 Found user for credits session:', user?.id);
    }
    
    if (TEST_MODE) {
      const sid = `test_credits_${Date.now()}_${Math.floor(Math.random()*10000)}`;
      const origin = req.headers.origin || `http://localhost:${process.env.PORT||3000}`;
      console.log('✅ Test mode credits session created:', sid);
      return res.json({ sessionId: sid, url: `${origin}/?session_id=${sid}` });
    }

    if (!stripe) {
      console.log('❌ Stripe not configured');
      return res.status(500).json({ error: 'Stripe not configured on server. Set STRIPE_SECRET_KEY in .env' });
    }
    
    const origin = req.headers.origin || `http://localhost:${process.env.PORT||3000}`;
    const body = req.body || {};
    const creditType = body.creditType;
    
    if (!creditType) {
      return res.status(400).json({ error: 'creditType is required' });
    }

    // Credits pricing
    const credits = {
      basic: { name: 'Basic Credits', price: 499, generations: 50 },
      pro: { name: 'Professional Credits', price: 999, generations: 150 },
      enterprise: { name: 'Enterprise Credits', price: 1999, generations: 500 }
    };

    const credit = credits[creditType];
    if (!credit) {
      return res.status(400).json({ error: 'Invalid creditType' });
    }

    // Create session without requiring user authentication for local mode
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: credit.name,
            description: `${credit.generations} invoice generations`,
          },
          unit_amount: credit.price,
        },
        quantity: 1,
      }],
      success_url: `${origin}/?credits_success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=true`,
      metadata: {
        creditType,
        generations: credit.generations.toString(),
        // Only add user info if authenticated, otherwise use local mode
        ...(user && { clientId: user.id, packageType: 'credits', userEmail: user.email })
      }
    });

    console.log(`✅ Credits session created successfully:`, session.id);
    res.json({ 
      sessionId: session.id, 
      url: session.url
    });
  } catch (error) {
    console.error('❌ Credits session creation failed:', error);
    res.status(500).json({ error: `Failed to create credits session: ${error.message}` });
  }
});

app.post('/api/credits/verify', express.json(), async (req, res) => {
  try {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'missing token' });

    const { session_id, expected_generations } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    const arr = readUsers();
    const u = arr.find(x => x.id === user.id);
    if (!u) return res.status(404).json({ error: 'user not found' });

    u.creditedSessions = Array.isArray(u.creditedSessions) ? u.creditedSessions : [];
    if (u.creditedSessions.includes(session_id)) {
      return res.json({ ok: true, normalGenerations: u.normalGenerations || 0 });
    }

    let gens = 0;
    if (TEST_MODE || !stripe) {
      gens = Math.max(0, parseInt(expected_generations || '0', 10) || 0);
      if (!gens) return res.status(400).json({ error: 'expected_generations required in TEST_MODE' });
    } else {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (!session || session.payment_status !== 'paid') {
        return res.status(400).json({ error: 'payment_not_completed' });
      }

      const metaClientId = session?.metadata?.clientId;
      if (metaClientId && String(metaClientId) !== String(u.id)) {
        return res.status(403).json({ error: 'session_not_owned_by_user' });
      }

      gens = Math.max(0, parseInt(session?.metadata?.generations || '0', 10) || 0);
      if (!gens) return res.status(400).json({ error: 'no_generations_in_session' });
    }

    u.normalGenerations = (u.normalGenerations || 0) + gens;
    u.creditedSessions.push(session_id);
    writeUsers(arr);

    return res.json({ ok: true, normalGenerations: u.normalGenerations || 0 });
  } catch (e) {
    console.error('credits/verify error', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'verify_failed' });
  }
});

// User management for subscriptions and credits
app.post('/api/user/create', express.json(), (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  
  const user = createUser(email);
  res.json({ 
    id: user.id, 
    email: user.email, 
    token: user.token,
    normalGenerations: user.normalGenerations || 0
  });
});

app.post('/api/user/add-subscription', express.json(), (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
  
  const token = auth.split(' ')[1];
  const user = findUserByToken(token);
  if (!user) return res.status(401).json({ error: 'invalid token' });
  
  const { planType, generations } = req.body;
  
  const arr = readUsers();
  const u = arr.find(x => x.id === user.id);
  if (!u) return res.status(404).json({ error: 'user not found' });
  
  // Add subscription info
  u.subscription = { planType, generations, monthlyGenerations: generations, startDate: new Date().toISOString(), monthsGranted: 0 };

  // Grant current month once (idempotent accrual)
  applySubscriptionAccrual(u, new Date());
  
  writeUsers(arr);
  res.json({ 
    ok: true, 
    normalGenerations: u.normalGenerations,
    subscription: u.subscription
  });
});

app.post('/api/user/add-credits', express.json(), (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
  
  const token = auth.split(' ')[1];
  const user = findUserByToken(token);
  if (!user) return res.status(401).json({ error: 'invalid token' });
  
  const { normal } = req.body;
  
  const newGenerations = addGenerationsToUser(user.id, normal, 'normal');
  res.json({ 
    ok: true, 
    normalGenerations: newGenerations
  });
});

app.post('/api/user/consume-generation', express.json(), (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
  
  const token = auth.split(' ')[1];
  const user = findUserByToken(token);
  if (!user) return res.status(401).json({ error: 'invalid token' });
  
  const { type } = req.body;
  const genType = type || 'normal';

  // Only normal generations are supported for downloads
  if (genType !== 'normal') return res.status(400).json({ error: 'unsupported_type' });

  const arr = readUsers();
  const u = arr.find(x => x.id === user.id);
  if (!u) return res.status(404).json({ error: 'user not found' });

  // Apply subscription accrual before consuming
  if (u.subscription) {
    applySubscriptionAccrual(u);
  }

  if ((u.normalGenerations || 0) < 1) return res.status(402).json({ error: 'insufficient_generations' });
  u.normalGenerations = (u.normalGenerations || 0) - 1;
  writeUsers(arr);

  res.json({ ok: true, normalGenerations: u.normalGenerations || 0 });
});

// Credits API

// When webhook receives checkout.session.completed for top-up, credit the clientId
// (existing webhook handler above already saves purchases; add credit handling there)

// nodemailer removed: send-email endpoint only saves outgoing PDFs locally.

app.post('/api/create-checkout-session', async (req, res) => {
  try {
    console.log('🛒 Creating checkout session with body:', req.body);
    
    if (TEST_MODE) {
      // return a fake session for local testing
      const sid = `test_sess_${Date.now()}_${Math.floor(Math.random()*10000)}`;
      const origin = req.headers.origin || `http://localhost:${process.env.PORT||3000}`;
      console.log('✅ Test mode session created:', sid);
      return res.json({ sessionId: sid, url: `${origin}/?session_id=${sid}` });
    }

    if (!stripe) {
      console.log('❌ Stripe not configured');
      return res.status(500).json({ error: 'Stripe not configured on server. Set STRIPE_SECRET_KEY in .env' });
    }
    
    const origin = req.headers.origin || `http://localhost:${process.env.PORT||3000}`;
    const body = req.body || {};

    // For package purchases, use predefined amounts
    let amount = null; // integer (cents for USD)
    if (body.amount !== undefined && body.amount !== null) {
      amount = Number(body.amount);
    } else if (body.packageType) {
      // Use predefined package prices
      const packages = {
        basic: 999, // $9.99 in cents
        pro: 1999,  // $19.99 in cents
        enterprise: 4999 // $49.99 in cents
      };
      amount = packages[body.packageType];
      console.log(`📦 Using package ${body.packageType} with amount ${amount} cents`);
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      console.log('❌ Invalid amount:', amount);
      return res.status(400).json({ error: 'Invalid or missing amount' });
    }

    // Minimum amount check
    const currency = String((body.currency || 'usd')).toLowerCase();
    const MIN_BY_CURRENCY = { usd: 50, eur: 50, gbp: 50, aud: 50, cad: 50 };
    const min = MIN_BY_CURRENCY[currency] || 50;
    let bumped = false;
    if (amount < min) { amount = min; bumped = true; }

    const description = `${body.packageType || 'custom'} package purchase`;

    let session;
    try {
      console.log('🔄 Creating Stripe session...');
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: currency,
            product_data: {
              name: description,
              description: `${body.packageType || 'Custom'} package - ${amount/100} ${currency.toUpperCase()}`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        }],
        success_url: `${origin}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?canceled=true`,
        metadata: {
          packageType: body.packageType || 'custom',
          userId: body.userId || 'anonymous'
        }
      });
      console.log('✅ Stripe session created successfully');
    } catch (stripeError) {
      console.error('❌ Stripe session creation failed:', stripeError);
      return res.status(500).json({ error: `Stripe error: ${stripeError.message}` });
    }

    res.json({ 
      sessionId: session.id, 
      url: session.url,
      bumped: bumped,
      note: bumped ? `Amount below minimum for ${currency}; adjusted to ${min}.` : null
    });
  } catch (error) {
    console.error('❌ Checkout session creation failed:', error);
    res.status(500).json({ error: `Failed to create checkout session: ${error.message}` });
  }
});

// Create a Checkout session for a download fee (displayed as 1¢ and charged as 1¢)
app.post('/api/create-download-session', async (req, res) => {
  try {
    if (TEST_MODE) {
      const sid = `test_sess_dl_${Date.now()}_${Math.floor(Math.random()*10000)}`;
      const origin = req.headers.origin || `http://localhost:${process.env.PORT||3000}`;
      return res.json({ sessionId: sid, url: `${origin}/?session_id=${sid}` });
    }
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured on server. Set STRIPE_SECRET_KEY in .env' });
    const origin = req.headers.origin || `http://localhost:${process.env.PORT||3000}`;
    const body = req.body || {};
    // displayAmount is in cents (we'll default to 1 cent display)
    const displayCents = Number(typeof body.display_cents !== 'undefined' ? body.display_cents : (body.amount_cents !== undefined ? body.amount_cents : 1));
    if (!Number.isFinite(displayCents) || displayCents <= 0) return res.status(400).json({ error: 'Invalid display_cents' });
    const currency = String((body.currency || 'usd')).toLowerCase();
    // Ensure charged amount meets Stripe minimums per currency
    const MIN_BY_CURRENCY = { usd: 50, eur: 50, gbp: 50, aud: 50, cad: 50 };
    const min = MIN_BY_CURRENCY[currency] || 50;
    const chargedCents = Math.max(min, Math.ceil(displayCents)); // Stripe requires integer cents and a minimum
    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{ price_data: { currency, product_data: { name: `Download fee` }, unit_amount: chargedCents }, quantity: 1 }],
        metadata: { purpose: 'download', clientId: body.clientId || null },
        success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/`
      });
    } catch (stripeErr) {
      console.error('Stripe session creation failed (download)', stripeErr && stripeErr.message ? stripeErr.message : stripeErr);
      const message = stripeErr && stripeErr.raw && stripeErr.raw.message ? stripeErr.raw.message : (stripeErr.message || 'Stripe session creation failed');
      return res.status(502).json({ error: 'Stripe session creation failed', details: message });
    }
    res.json({ sessionId: session.id, url: session.url, display_cents: displayCents, charged_cents: chargedCents, note: displayCents < chargedCents ? `Displayed amount rounded up to ${chargedCents} cents for payment.` : null });
  } catch (err) {
    console.error('create-download-session error', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Simple user registration for demo: returns token
app.post('/api/users/register', express.json(), (req,res)=>{
  const { email } = req.body; if (!email) return res.status(400).json({ error: 'email required' });
  const user = createUser(email);
  res.json({ id: user.id, email: user.email, token: user.token });
});

app.get('/api/users/me', (req,res)=>{
  const auth = req.headers.authorization; if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error:'missing token' });
  const token = auth.split(' ')[1]; const u = findUserByToken(token); if (!u) return res.status(401).json({ error:'invalid token' });
  res.json({ id: u.id, email: u.email, generations: u.generations || 0 });
});

// Check Stripe connectivity / key validity
app.get('/api/stripe-check', async (req, res) => {
  if (TEST_MODE) return res.json({ ok: true, test: true });
  if (!stripe) return res.json({ ok: false, message: 'Stripe not configured (STRIPE_SECRET_KEY missing or invalid)' });
  try {
    // Use a lightweight call that works with standard secret keys: retrieve balance
    const bal = await stripe.balance.retrieve();
    res.json({ ok: true, balance: { pending: bal.pending, available: bal.available } });
  } catch (err) {
    console.error('Stripe check failed', err && err.message ? err.message : err);
    res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
});

// Purchase generations: create a Checkout session that grants `gens` to the user on success.
app.post('/api/purchase-generations', express.json(), async (req,res)=>{
  try{
    const body = req.body || {};
    // determine clientId from Authorization or body
    let clientId = body.clientId;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')){
      const token = auth.split(' ')[1]; const user = findUserByToken(token); if (user) clientId = user.id;
    }
    const packageType = String(body.packageType || 'normal'); // 'normal' | 'ai-pack' | 'ai-single'

    // pricing rules:
    // - normal: only pack purchase allowed: 5 gens for $1.50 (150 cents)
    // - ai-pack: 5 gens for $5.00 (500 cents)
    // - ai-single: 1 gen for $1.00 (100 cents)
    let gens = 0; let amount = 0;
    if (packageType === 'normal') { gens = 5; amount = 150; }
    else if (packageType === 'ai-pack') { gens = 5; amount = 500; }
    else if (packageType === 'ai-single') { gens = 1; amount = 100; }
    else return res.status(400).json({ error: 'invalid packageType' });

    if (TEST_MODE) {
      if (!clientId) return res.status(400).json({ error: 'clientId required in TEST_MODE' });
      const genType = (packageType === 'ai-pack' || packageType === 'ai-single') ? 'ai' : 'normal';
      const newv = addGenerationsToUser(clientId, gens, genType);
      await savePurchase({ session_id: `test_gens_${Date.now()}`, customer_email: null, invoices: 0, amount_total: amount, created_at: new Date().toISOString() });
      return res.json({ ok:true, [`${genType}Generations`]: newv, gens_added: gens, type: genType });
    }

    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    const origin = req.headers.origin || `http://localhost:${process.env.PORT||3000}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'usd', product_data: { name: `Buy ${gens} generations (${packageType})` }, unit_amount: amount }, quantity: 1 }],
      metadata: { clientId, gens: String(gens), packageType, purpose: 'gens' },
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`
    });
    res.json({ sessionId: session.id, url: session.url });
  }catch(e){ console.error('purchase-generations failed', e); res.status(500).json({ error: e && e.message?e.message:String(e) }); }
});

// Consume N generations for authenticated user
app.post('/api/consume-generations', express.json(), (req, res) => {
  const auth = req.headers.authorization; if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
  const token = auth.split(' ')[1]; const user = findUserByToken(token); if (!user) return res.status(401).json({ error: 'invalid token' });
  const count = Math.max(1, parseInt(req.body.count || req.query.count || '1', 10));
  const type = req.body.type || 'normal';
  
  if (type === 'ai') {
    if ((user.aiGenerations || 0) < count) return res.status(402).json({ error: 'insufficient_generations', message: 'Not enough AI generations' });
    const success = consumeGenerationFromUser(user.id, 'ai');
    if (!success) return res.status(402).json({ error: 'insufficient_generations', message: 'Not enough AI generations' });
    const updatedUser = getUserById(user.id);
    appendToFile(ANALYTICS_FILE, { type: 'consume_ai_generations', userId: user.id, count, ts: new Date().toISOString() });
    return res.json({ ok:true, aiGenerations: updatedUser.aiGenerations });
  } else {
    if ((user.normalGenerations || 0) < count) return res.status(402).json({ error: 'insufficient_generations', message: 'Not enough normal generations' });
    const success = consumeGenerationFromUser(user.id, 'normal');
    if (!success) return res.status(402).json({ error: 'insufficient_generations', message: 'Not enough normal generations' });
    const updatedUser = getUserById(user.id);
    appendToFile(ANALYTICS_FILE, { type: 'consume_normal_generations', userId: user.id, count, ts: new Date().toISOString() });
    return res.json({ ok:true, normalGenerations: updatedUser.normalGenerations });
  }
});

// Buy an in-app marketplace item using generations (no Stripe)
app.post('/api/buy-item', express.json(), (req, res) => {
  const auth = req.headers.authorization; if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
  const token = auth.split(' ')[1]; const user = findUserByToken(token); if (!user) return res.status(401).json({ error: 'invalid token' });
  const body = req.body || {};
  const itemId = String(body.itemId || ''); const cost = Math.max(0, parseInt(body.cost || 0, 10));
  if (!itemId) return res.status(400).json({ error: 'itemId required' });
  if ((user.generations || 0) < cost) return res.status(402).json({ error: 'insufficient_generations', message: 'Purchase requires more generations' });
  // deduct
  const arr = readUsers(); const u = arr.find(x=>x.id===user.id);
  u.generations = (u.generations||0) - cost; writeUsers(arr);
  // record purchase
  const rec = { type: 'item', itemId, cost, userId: u.id, created_at: new Date().toISOString() };
  appendToFile(PURCHASES_FILE, rec);
  appendToFile(ANALYTICS_FILE, { type: 'buy_item', userId: u.id, itemId, cost, ts: new Date().toISOString() });
  res.json({ ok:true, generations: u.generations, purchase: rec });
});

// Save template (authenticated)
app.post('/api/templates', express.json(), (req,res)=>{
  const auth = req.headers.authorization; if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
  const token = auth.split(' ')[1]; const user = findUserByToken(token); if (!user) return res.status(401).json({ error: 'invalid token' });
  const tpl = req.body || {};
  tpl.id = 'tpl_' + Math.random().toString(36).slice(2,9);
  tpl.owner = user.id; tpl.created_at = new Date().toISOString();
  appendToFile(TEMPLATES_FILE, tpl);
  appendToFile(ANALYTICS_FILE, { type: 'save_template', userId: user.id, tplId: tpl.id, ts: new Date().toISOString() });
  res.json({ ok:true, template: tpl });
});

app.get('/api/templates', (req,res)=>{
  try{ if (!fs.existsSync(TEMPLATES_FILE)) return res.json([]); const arr = JSON.parse(fs.readFileSync(TEMPLATES_FILE)); res.json(arr||[]); } catch(e){ res.status(500).json({ error: e && e.message?e.message:String(e) }); }
});

// Versions for invoices
app.post('/api/versions', express.json(), (req,res)=>{
  const v = req.body || {}; if (!v.invoiceNumber) return res.status(400).json({ error: 'invoiceNumber required' });
  v.id = 'ver_' + Date.now(); v.created_at = new Date().toISOString(); appendToFile(VERSIONS_FILE, v); res.json({ ok:true, version: v });
});

app.get('/api/versions', (req,res)=>{ try{ if(!fs.existsSync(VERSIONS_FILE)) return res.json([]); const arr = JSON.parse(fs.readFileSync(VERSIONS_FILE)); res.json(arr||[]); }catch(e){ res.status(500).json({ error: e && e.message?e.message:String(e) }); } });

// Branding per user
app.post('/api/branding', express.json(), (req,res)=>{ const auth = req.headers.authorization; if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' }); const token = auth.split(' ')[1]; const user = findUserByToken(token); if (!user) return res.status(401).json({ error: 'invalid token' }); const body = req.body || {}; const arr = readUsers(); const u = arr.find(x=>x.id===user.id); u.branding = body; writeUsers(arr); appendToFile(ANALYTICS_FILE, { type:'branding_update', userId: u.id, ts: new Date().toISOString() }); res.json({ ok:true, branding: u.branding }); });

app.get('/api/branding', (req,res)=>{ const auth = req.headers.authorization; if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' }); const token = auth.split(' ')[1]; const user = findUserByToken(token); if (!user) return res.status(401).json({ error: 'invalid token' }); const u = getUserById(user.id); res.json({ branding: u.branding || {} }); });

// Simple teams: create and list
app.post('/api/teams', express.json(), (req,res)=>{ const body = req.body || {}; if (!body.name) return res.status(400).json({ error: 'name required' }); const t = { id: 'team_' + Math.random().toString(36).slice(2,8), name: body.name, members: body.members||[], created_at: new Date().toISOString() }; appendToFile(TEAMS_FILE, t); appendToFile(ANALYTICS_FILE, { type:'create_team', teamId: t.id, ts: new Date().toISOString() }); res.json({ ok:true, team: t }); });

app.get('/api/teams', (req,res)=>{ try{ if(!fs.existsSync(TEAMS_FILE)) return res.json([]); const arr = JSON.parse(fs.readFileSync(TEAMS_FILE)); res.json(arr||[]); }catch(e){ res.status(500).json({ error: e && e.message?e.message:String(e) }); } });

// Simple analytics event logger
app.post('/api/analytics/log', express.json(), (req,res)=>{ const ev = req.body || {}; ev.ts = new Date().toISOString(); appendToFile(ANALYTICS_FILE, ev); res.json({ ok:true }); });

// Purchase / invoice history endpoint (combines purchases and saved invoices)
app.get('/api/history', (req,res)=>{
  try{
    const purchases = fs.existsSync(PURCHASES_FILE) ? JSON.parse(fs.readFileSync(PURCHASES_FILE)) : [];
    const invoices = fs.existsSync(path.join(DATA_DIR,'invoices.json')) ? JSON.parse(fs.readFileSync(path.join(DATA_DIR,'invoices.json'))) : [];
    res.json({ purchases, invoices });
  }catch(e){ res.status(500).json({ error: e && e.message?e.message:String(e) }); }
});

// Confirm checkout session (called from success_url redirect)
app.get('/api/confirm-checkout', async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: 'session_id is required' });

    if (TEST_MODE) {
      // in test mode, treat any test session as paid
      const paid = sessionId && sessionId.startsWith('test_sess_');
      if (paid) {
        try { await savePurchase({ session_id: sessionId, customer_email: null, invoices: 1, amount_total: 0, created_at: new Date().toISOString() }); } catch(e){}
        return res.json({ paid: !!paid, invoices: 1 });
      }
      return res.json({ paid: false });
    }

    if (!stripe) return res.status(500).json({ error: 'Stripe not configured on server.' });
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const paid = session.payment_status === 'paid' || session.status === 'complete';

    if (paid) {
      // Save purchase locally
      try {
        await savePurchase({
          session_id: session.id,
          customer_email: session.customer_details?.email || null,
          invoices: parseInt(session.metadata?.invoices) || 1,
          amount_total: session.amount_total,
          created_at: new Date().toISOString()
        });
      } catch (err) {
        console.error('Failed to save local purchase', err.message);
      }
      return res.json({ paid: true, invoices: parseInt(session.metadata?.invoices) || 1 });
    }

    return res.json({ paid: false });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/save-invoice', async (req, res) => {
  try {
    const invoice = req.body;
    // Save invoice locally to data/invoices.json
    try {
      const INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');
      let arr = [];
      if (fs.existsSync(INVOICES_FILE)) {
        arr = JSON.parse(fs.readFileSync(INVOICES_FILE));
        if (!Array.isArray(arr)) arr = [];
      }
      // If invoice.number exists, replace existing entry (edit existing file)
      if (invoice && invoice.number) {
        const existingIndex = arr.findIndex(i => i && i.number === invoice.number);
        if (existingIndex >= 0) {
          arr[existingIndex] = invoice;
        } else {
          arr.push(invoice);
        }
      } else {
        arr.push(invoice);
      }
      fs.writeFileSync(INVOICES_FILE, JSON.stringify(arr, null, 2));
      res.json({ success: true });
    } catch (err) {
      console.error('Failed to save invoice locally', err.message);
      res.status(500).json({ error: err.message });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Return saved invoices for editor to load
app.get('/api/invoices', async (req, res) => {
  try {
    const INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');
    if (!fs.existsSync(INVOICES_FILE)) return res.json([]);
    const arr = JSON.parse(fs.readFileSync(INVOICES_FILE));
    if (!Array.isArray(arr)) return res.json([]);
    res.json(arr);
  } catch (err) {
    console.error('Failed to read invoices', err && err.message ? err.message : err);
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Multi-currency exchange rates
const EXCHANGE_RATES_FILE = path.join(DATA_DIR, 'exchange-rates.json');
let exchangeRates = {};

// Load exchange rates from file or fetch from API
async function loadExchangeRates() {
  try {
    if (fs.existsSync(EXCHANGE_RATES_FILE)) {
      const data = fs.readFileSync(EXCHANGE_RATES_FILE);
      const rates = JSON.parse(data);
      // Check if rates are recent (less than 24 hours old)
      if (rates.timestamp && Date.now() - rates.timestamp < 24 * 60 * 60 * 1000) {
        exchangeRates = rates.rates;
        return;
      }
    }
    
    // Fetch fresh rates from free API
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await response.json();
    
    if (data.rates) {
      exchangeRates = data.rates;
      // Save to file with timestamp
      fs.writeFileSync(EXCHANGE_RATES_FILE, JSON.stringify({
        timestamp: Date.now(),
        rates: exchangeRates
      }));
    }
  } catch (error) {
    console.error('Failed to load exchange rates:', error);
    // Fallback to basic rates
    exchangeRates = {
      USD: 1,
      EUR: 0.85,
      GBP: 0.73,
      JPY: 110.0,
      AUD: 1.35,
      CAD: 1.25,
      CHF: 0.92
    };
  }
}

// Initialize exchange rates on startup
loadExchangeRates();
// Refresh rates every 24 hours
setInterval(loadExchangeRates, 24 * 60 * 60 * 1000);

// Exchange rates API endpoint
app.get('/api/exchange-rates', (req, res) => {
  res.json({
    base: 'USD',
    rates: exchangeRates,
    timestamp: Date.now()
  });
});

// Currency conversion endpoint
app.post('/api/convert-currency', (req, res) => {
  try {
    const { amount, from, to } = req.body;
    
    if (!amount || !from || !to) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Convert to USD first, then to target currency
    const usdAmount = from === 'USD' ? parseFloat(amount) : parseFloat(amount) / exchangeRates[from];
    const convertedAmount = to === 'USD' ? usdAmount : usdAmount * exchangeRates[to];
    
    res.json({
      from,
      to,
      originalAmount: parseFloat(amount),
      convertedAmount: Math.round(convertedAmount * 100) / 100,
      rate: exchangeRates[to]
    });
  } catch (error) {
    console.error('Currency conversion error:', error);
    res.status(500).json({ error: 'Conversion failed' });
  }
});

app.post('/api/ai-suggestions', async (req, res) => {
  try {
    const invoice = req.body;
    
    // Generate AI suggestions based on invoice data
    const suggestions = {
      items: [],
      legal: [],
      professional: []
    };
    
    // Revenue optimization suggestions
    if (invoice.total > 1000) {
      suggestions.items.push({
        text: "Consider offering a 2% early payment discount for invoices paid within 10 days",
        action: "add_early_discount"
      });
    }
    
    if (!invoice.tax || invoice.tax < 5) {
      suggestions.items.push({
        text: "Add a late fee of 2% per month for overdue payments to encourage timely payment",
        action: "add_late_fee"
      });
    }
    
    // Legal compliance suggestions
    if (!invoice.businessAddress) {
      suggestions.legal.push({
        text: "Add your business address for legal compliance and professionalism",
        action: "add_business_address"
      });
    }
    
    if (!invoice.tax || invoice.tax === 0) {
      suggestions.legal.push({
        text: "Include tax identification number (VAT/TIN) for international transactions",
        action: "add_tax_id"
      });
    }
    
    // Professional improvements
    if (!invoice.items || invoice.items.length < 2) {
      suggestions.professional.push({
        text: "Break down services into detailed line items for better transparency",
        action: "detailed_items"
      });
    }
    
    if (invoice.total > 5000 && !invoice.paymentTerms) {
      suggestions.professional.push({
        text: "For large invoices, consider milestone payments or 50% upfront",
        action: "milestone_payments"
      });
    }
    
    suggestions.professional.push({
      text: "Add a personalized thank you note to improve client relationships",
      action: "add_thank_you"
    });
    
    suggestions.professional.push({
      text: "Include clear payment terms and accepted payment methods",
      action: "add_payment_terms"
    });
    
    // Industry-specific suggestions
    if (invoice.businessName && invoice.businessName.toLowerCase().includes('consulting')) {
      suggestions.items.push({
        text: "Consider adding a retainer agreement option for ongoing consulting work",
        action: "add_retainer"
      });
    }
    
    res.json(suggestions);
  } catch (err) {
    console.error('AI suggestions error:', err);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

app.post('/api/openrouter', async (req, res) => {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OpenRouter API key not configured' });

    const model = process.env.OPENROUTER_MODEL || 'gpt-3o-mini';
    const body = Object.assign({}, req.body, { model });

    const response = await fetch('https://api.openrouter.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Generate invoice line items via OpenRouter (AI). Expects invoice skeleton in body.
app.post('/api/generate-ai', async (req, res) => {
  try {
    // Require auth token to consume/gift generations
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
    const token = auth.split(' ')[1]; const user = findUserByToken(token); if (!user) return res.status(401).json({ error: 'invalid token' });
    // Check user generations
    if ((user.generations || 0) <= 0) return res.status(402).json({ error: 'insufficient_generations', message: 'You have no AI generations left. Purchase a pack to continue.' });

    if (TEST_MODE) {
      const invoice = req.body || {};
      // cheap deterministic mock: return a single item with business/client names
      const items = [{ description: `${invoice.businessName || 'Service'} — consulting`, qty: 1, unit: 100 }];
      // consume one generation
      consumeGenerationFromUser(user.id);
      return res.json({ items, raw: 'TEST_MODE: mock items', generations: (user.generations||0)-1 });
    }
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OpenRouter API key not configured' });

    const invoice = req.body;
    // Construct a prompt instructing the model to return JSON array of items
    const prompt = `You are an invoice assistant. Given the following invoice details, generate a JSON array named items where each item has description, qty (integer), and unit (number). Return ONLY valid JSON. Invoice details: ${JSON.stringify({ businessName: invoice.businessName, clientName: invoice.clientName, notes: invoice.notes || '' })}`;

    const model = process.env.OPENROUTER_MODEL || 'gpt-3o-mini';
    const body = {
      model,
      messages: [
        { role: 'system', content: 'You generate invoice line items as JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.0,
      max_tokens: 300
    };

    const response = await fetch('https://api.openrouter.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    // Try to extract JSON from response
    const raw = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || JSON.stringify(data);
    let items = [];
    try {
      // Attempt direct parse
      const parsed = JSON.parse(raw);
      // If parsed is object with items field, use it
      if (Array.isArray(parsed)) items = parsed;
      else if (parsed.items && Array.isArray(parsed.items)) items = parsed.items;
    } catch (e) {
      // Fallback: try to find JSON substring
      const m = raw.match(/\{?[\[\{].*[\]\}]?/s);
      if (m) {
        try { const parsed = JSON.parse(m[0]); if (Array.isArray(parsed)) items = parsed; else if (parsed.items) items = parsed.items; } catch (e2) { }
      }
    }

    if (!Array.isArray(items)) items = [];
    // Normalize items to have description, qty, unit
    items = items.map(it => ({ description: String(it.description || it.desc || ''), qty: parseInt(it.qty || it.quantity || 1, 10) || 1, unit: parseFloat(it.unit || it.price || it.unit_price || it.amount) || 0 }));

    res.json({ items, raw });
  } catch (err) {
    console.error('AI generation failed', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event = null;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = req.body;
    }
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('💰 Payment completed:', session.id, 'for:', session.customer_details?.email);
    
    try {
      // Save purchase locally
      await savePurchase({
        session_id: session.id,
        customer_email: session.customer_details?.email || null,
        invoices: session.metadata?.invoices || 6,
        amount_total: session.amount_total,
        created_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('Failed to save purchase locally', err.message);
    }
    
    // Handle credits purchase
    try {
      const clientId = session?.metadata?.clientId;
      const generations = parseInt(session?.metadata?.generations || '0', 10) || 0;
      const packageType = session?.metadata?.packageType || 'normal';
      const creditType = session?.metadata?.creditType;
      
      console.log(`🔍 Webhook metadata: clientId=${clientId}, generations=${generations}, packageType=${packageType}, creditType=${creditType}`);
      
      // Check if this is a credits purchase
      if (packageType === 'credits' && generations > 0) {
        console.log(`💳 Processing credits purchase: +${generations} generations`);
        
        if (clientId) {
          // Production mode with user authentication
          const arr = readUsers();
          const user = arr.find(u => u.id === clientId);
          if (!user) {
            console.error(`❌ User not found: ${clientId}`);
            return res.json({ received: true, error: 'User not found' });
          }
          
          const oldBalance = user.normalGenerations || 0;
          const newBalance = addGenerationsToUser(clientId, generations, 'normal');
          console.log(`✅ Credits added successfully: User ${clientId}, Old: ${oldBalance}, New: ${newBalance}, Added: ${generations}`);
        } else {
          // Local mode - no user authentication, just log the purchase
          console.log(`🏠 Local mode: Credits purchased but no user ID. Generations: ${generations}, CreditType: ${creditType}`);
          console.log(`💰 Payment details: Session=${session.id}, Amount=$${session.amount_total/100}, Email=${session.customer_details?.email}`);
          console.log(`ℹ️ In local mode, credits will be added when user returns to the app`);
        }
        
        // Log detailed payment info
        console.log(`💰 Payment details: Session=${session.id}, Amount=$${session.amount_total/100}, Email=${session.customer_details?.email}, CreditType=${creditType}`);
        
      } else if (clientId && generations > 0) {
        // Handle legacy generation purchases
        const genType = (packageType === 'ai-pack' || packageType === 'ai-single') ? 'ai' : 'normal';
        console.log(`🔄 Processing legacy generation purchase: ${generations} ${genType} generations to ${clientId}`);
        addGenerationsToUser(clientId, generations, genType);
        console.log(`✅ Legacy generations credited: ${generations} ${genType} generations to ${clientId}`);
      } else {
        console.log(`ℹ️ No credits to grant: clientId=${clientId}, generations=${generations}, packageType=${packageType}`);
      }
    } catch (e) { 
      console.error('❌ Failed to apply generation credits:', e && e.message ? e.message : e);
    }
  }

  // Also, if you want to auto-generate invoices or forward to other services, do it here.

  res.json({ received: true });
});

// Debug: in TEST_MODE allow direct credit add for testing
// Debug credit endpoints removed

// Local test runner endpoint (only when TEST_MODE=true). Runs N simulated cycles and returns summary.
app.post('/api/run-local-tests', express.json(), async (req, res) => {
  if (!TEST_MODE) return res.status(403).json({ ok: false, error: 'TEST_MODE not enabled' });
  const iterations = parseInt(req.body.iterations || req.query.iterations || '100', 10);
  const results = { iterations, sessionsCreated: 0, confirmed: 0, aiGenerated: 0, savedInvoices: 0, errors: [] };
  for (let i=0;i<iterations;i++){
    try {
      // simulate checkout
      const sid = `test_sess_${Date.now()}_${i}`;
      results.sessionsCreated++;
      // simulate confirm
      await savePurchase({ session_id: sid, customer_email: null, invoices: 1, amount_total: 0, created_at: new Date().toISOString() });
      results.confirmed++;
      // simulate AI generation
      results.aiGenerated++;
      // simulate saving invoice file
      const OUT = path.join(DATA_DIR, 'outgoing'); if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
      const fname = `test-invoice-${i}.pdf`; fs.writeFileSync(path.join(OUT, fname), Buffer.from('TEST'));
      results.savedInvoices++;
    } catch (e){ results.errors.push(String(e.message||e)); }
  }
  res.json(results);
});

// Send-invoice endpoint removed. Outgoing PDFs are saved by other flows; emailing removed per project request.

// Exportable start function for tests
// User management endpoints
app.post('/api/user/create', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }
    
    const user = createUser(email);
    res.json(user);
  } catch (error) {
    console.error('User creation error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.get('/api/user', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const token = authHeader.substring(7);
    const user = findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('User validation error:', error);
    res.status(500).json({ error: 'Failed to validate user' });
  }
});

app.get('/api/user/generations', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const token = authHeader.substring(7);
    const user = findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    res.json({
      normal: user.normalGenerations || 0,
      ai: user.aiGenerations || 0
    });
  } catch (error) {
    console.error('Generations fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch generations' });
  }
});

app.post('/api/user/add-generations', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const token = authHeader.substring(7);
    const user = findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const { normal, ai } = req.body;
    
    if (normal > 0) {
      addGenerationsToUser(user.id, normal, 'normal');
    }
    
    if (ai > 0) {
      addGenerationsToUser(user.id, ai, 'ai');
    }
    
    const updatedUser = getUserById(user.id);
    res.json({
      normal: updatedUser.normalGenerations || 0,
      ai: updatedUser.aiGenerations || 0
    });
  } catch (error) {
    console.error('Add generations error:', error);
    res.status(500).json({ error: 'Failed to add generations' });
  }
});

app.post('/api/user/consume-generation', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const token = authHeader.substring(7);
    const user = findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const { type = 'normal' } = req.body;
    const success = consumeGenerationFromUser(user.id, type);
    
    if (!success) {
      return res.status(400).json({ error: 'Insufficient generations' });
    }
    
    const updatedUser = getUserById(user.id);
    res.json({
      normal: updatedUser.normalGenerations || 0,
      ai: updatedUser.aiGenerations || 0
    });
  } catch (error) {
    console.error('Consume generation error:', error);
    res.status(500).json({ error: 'Failed to consume generation' });
  }
});

// Location-based tax calculation endpoint
app.post('/api/tax-by-location', async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude required' });
    }

    // Reverse geocoding using Nominatim (OpenStreetMap)
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
    const data = await response.json();
    
    if (!data || !data.address) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Tax rates by country/state (comprehensive database)
    const taxRates = {
      // Europe
      'FR': 20.0, // France - VAT 20%
      'ES': 21.0, // Spain - VAT 21%
      'IT': 22.0, // Italy - VAT 22%
      'DE': 19.0, // Germany - VAT 19%
      'GR': 24.0, // Greece - VAT 24%
      'AT': 20.0, // Austria - VAT 20%
      'GB': 20.0, // United Kingdom - VAT 20%
      'PL': 23.0, // Poland - VAT 23%
      'NL': 21.0, // Netherlands - VAT 21%
      'BE': 21.0, // Belgium - VAT 21%
      'SE': 25.0, // Sweden - VAT 25%
      'DK': 25.0, // Denmark - VAT 25%
      'NO': 25.0, // Norway - VAT 25%
      'FI': 24.0, // Finland - VAT 24%
      'CZ': 21.0, // Czech Republic - VAT 21%
      'HU': 27.0, // Hungary - VAT 27%
      'RO': 19.0, // Romania - VAT 19%
      'BG': 20.0, // Bulgaria - VAT 20%
      'HR': 25.0, // Croatia - VAT 25%
      'SI': 22.0, // Slovenia - VAT 22%
      'SK': 20.0, // Slovakia - VAT 20%
      'EE': 20.0, // Estonia - VAT 20%
      'LV': 21.0, // Latvia - VAT 21%
      'LT': 21.0, // Lithuania - VAT 21%
      'PT': 23.0, // Portugal - VAT 23%
      'IE': 23.0, // Ireland - VAT 23%
      'UA': 20.0, // Ukraine - VAT 20%
      'RU': 20.0, // Russia - VAT 20%
      
      // Americas
      'US': {
        'AL': 4.0, 'AK': 0.0, 'AZ': 5.6, 'AR': 6.5, 'CA': 7.25, 'CO': 2.9, 'CT': 6.35, 'DE': 0.0,
        'FL': 6.0, 'GA': 4.0, 'HI': 4.0, 'ID': 6.0, 'IL': 6.25, 'IN': 7.0, 'IA': 6.0, 'KS': 6.5,
        'KY': 6.0, 'LA': 4.45, 'ME': 5.5, 'MD': 6.0, 'MA': 6.25, 'MI': 6.0, 'MN': 6.875, 'MS': 7.0,
        'MO': 4.225, 'MT': 0.0, 'NE': 5.5, 'NV': 6.85, 'NH': 0.0, 'NJ': 6.625, 'NM': 5.125, 'NY': 4.0,
        'NC': 4.75, 'ND': 5.0, 'OH': 5.75, 'OK': 4.5, 'OR': 0.0, 'PA': 6.0, 'RI': 7.0, 'SC': 6.0,
        'SD': 4.5, 'TN': 7.0, 'TX': 6.25, 'UT': 4.85, 'VT': 6.0, 'VA': 4.3, 'WA': 6.5, 'WV': 6.0,
        'WI': 5.0, 'WY': 4.0
      },
      'CA': {
        'AB': 5.0, 'BC': 7.0, 'MB': 7.0, 'NB': 13.0, 'NL': 13.0, 'NT': 5.0, 'NS': 15.0,
        'NU': 5.0, 'ON': 13.0, 'PE': 14.0, 'QC': 9.975, 'SK': 6.0, 'YT': 5.0
      },
      'MX': 16.0, // Mexico - VAT 16%
      'BR': 17.0, // Brazil - ~17-20% (using 17% as base)
      'AR': 21.0, // Argentina - VAT 21%
      'CL': 19.0, // Chile - VAT 19%
      'CO': 19.0, // Colombia - VAT 19%
      'PE': 18.0, // Peru - VAT 18%
      'DO': 18.0, // Dominican Republic - VAT/ITBIS 18%
      'EG': 14.0, // Egypt - VAT ~14%
      'ZA': 15.0, // South Africa - VAT 15%
      'MA': 20.0, // Morocco - VAT 20%
      'TN': 19.0, // Tunisia - VAT 19%
      'KE': 16.0, // Kenya - VAT 16%
      'TZ': 18.0, // Tanzania - VAT 18%
      'CD': 16.0, // DR Congo - VAT 16%
      'UG': 18.0, // Uganda - VAT 18%
      'DZ': 19.0, // Algeria - VAT 19%
      'SD': 17.0, // Sudan - VAT ~17%
      'IR': 9.0, // Iran - VAT ~9%
      'TR': 20.0, // Türkiye (Turkey) - VAT 20%
      'AF': 5.0, // Afghanistan - business receipt tax
      'IQ': 5.0, // Iraq - low sales taxes
      'MM': 5.0, // Myanmar - commercial tax/VAT equivalent
      'ET': 15.0, // Ethiopia - VAT 15%
      
      // Asia Pacific
      'CN': 13.0, // China - VAT ~13%
      'TH': 7.0, // Thailand - VAT 7%
      'JP': 10.0, // Japan - consumption tax 10%
      'KR': 10.0, // South Korea - VAT 10%
      'VN': 10.0, // Vietnam - VAT 10%
      'ID': 11.0, // Indonesia - VAT ~11%
      'MY': 7.0, // Malaysia - sales/service tax ~6-8%
      'SG': 9.0, // Singapore - GST 9% (2025)
      'IN': 18.0, // India - GST standard slab 18%
      'BD': 15.0, // Bangladesh - VAT ~15%
      'PK': 18.0, // Pakistan - VAT/GST ~18%
      'PH': 12.0, // Philippines - VAT 12%
      'LK': 8.0, // Sri Lanka - VAT 8%
      'KH': 10.0, // Cambodia - VAT 10%
      'LA': 10.0, // Laos - VAT 10%
      'NP': 13.0, // Nepal - VAT 13%
      'BT': 7.0, // Bhutan - VAT 7%
      'MV': 6.0, // Maldives - VAT 6%
      
      // Middle East
      'AE': 5.0, // UAE - VAT 5%
      'SA': 15.0, // Saudi Arabia - VAT 15%
      'IL': 18.0, // Israel - VAT 18% from 2025
      
      // Oceania
      'AU': {
        'NSW': 10.0, 'VIC': 10.0, 'QLD': 10.0, 'WA': 10.0, 'SA': 10.0, 'TAS': 10.0, 'ACT': 10.0, 'NT': 10.0
      },
      'NZ': 15.0, // New Zealand - GST 15%
      
      'default': 10.0 // Default tax rate
    };

    // Determine tax rate based on location
    let taxRate = taxRates.default;
    const countryCode = data.address.country_code;
    const stateCode = data.address.state_code || data.address.state;

    if (countryCode && taxRates[countryCode]) {
      if (typeof taxRates[countryCode] === 'object') {
        // Country has state/province level taxes
        if (stateCode && taxRates[countryCode][stateCode]) {
          taxRate = taxRates[countryCode][stateCode];
        } else {
          taxRate = Object.values(taxRates[countryCode])[0] || taxRates.default;
        }
      } else {
        // Country has single tax rate
        taxRate = taxRates[countryCode];
      }
    }

    const locationName = data.address.city || data.address.state || data.address.country || 'Unknown';
    
    res.json({
      taxRate,
      location: {
        name: locationName,
        country: data.address.country,
        countryCode,
        state: data.address.state,
        stateCode,
        city: data.address.city
      }
    });
  } catch (error) {
    console.error('Tax calculation error:', error);
    res.status(500).json({ error: 'Failed to calculate tax rate' });
  }
});

function startServer(port){
  return new Promise((resolve, reject)=>{
    const basePort = (typeof port !== 'undefined' && port !== null) ? Number(port) : (process.env.PORT ? Number(process.env.PORT) : 3000);
    const maxAttempts = 5;
    let attempt = 0;
    const tryListen = (p) => {
      attempt++;
      const server = app.listen(p, ()=>{ console.log(`Server listening on port ${p}`); resolve(server); });
      server.on('error', (err)=>{
        if (err && err.code === 'EADDRINUSE') {
          console.error(`Port ${p} is already in use.`);
          if (attempt < maxAttempts) {
            const next = p + 1;
            console.log(`Trying port ${next}...`);
            // give a short delay before next attempt
            setTimeout(()=> tryListen(next), 200);
            return;
          }
          // fallback to ephemeral port 0
          console.log('Falling back to an ephemeral port (0).');
          const s2 = app.listen(0, ()=>{ const actual = s2.address().port; console.log(`Server started on ephemeral port ${actual}`); resolve(s2); });
          s2.on('error', (e)=>{ console.error('Failed to bind ephemeral port', e); reject(e); });
          return;
        }
        console.error('Server error:', err && err.message?err.message:err);
        reject(err);
      });
    };
    tryListen(basePort);
  });
}

if (require.main === module) {
  (async ()=>{ try { await startServer(); } catch(e){ process.exit(1);} })();
}

module.exports = { app, startServer };
