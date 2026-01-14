// Backend API Endpoints for Subscription Management
// This file contains the server-side logic that should be implemented

// ========================================
// 1. SUBSCRIPTION STATUS ENDPOINT
// ========================================
// GET /api/subscription/status
// Returns authoritative subscription status from database
app.get('/api/subscription/status', async (req, res) => {
    try {
        const userId = req.user?.id || req.session?.userId;
        
        if (!userId) {
            return res.json({ 
                is_subscribed: false, 
                subscription: null,
                error: 'User not authenticated' 
            });
        }
        
        // CRITICAL: Check database for active subscription
        const subscription = await db.query(`
            SELECT s.*, sp.name as plan_name, sp.price, sp.generations
            FROM subscriptions s
            JOIN subscription_plans sp ON s.plan_id = sp.id
            WHERE s.user_id = ? 
            AND s.status = 'active'
            AND s.end_date > NOW()
            ORDER BY s.created_at DESC
            LIMIT 1
        `, [userId]);
        
        if (subscription && subscription.length > 0) {
            const sub = subscription[0];
            
            // Check if user has credits
            const generations = await db.query(`
                SELECT normal, watermark_free 
                FROM user_generations 
                WHERE user_id = ?
            `, [userId]);
            
            return res.json({
                is_subscribed: true,
                subscription: {
                    id: sub.id,
                    planType: sub.plan_type,
                    name: sub.plan_name,
                    price: sub.price,
                    generations: sub.generations,
                    startDate: sub.start_date,
                    endDate: sub.end_date,
                    status: sub.status
                },
                generations: generations[0] || { normal: 0, watermark_free: 0 }
            });
        }
        
        // No active subscription found
        return res.json({ 
            is_subscribed: false, 
            subscription: null,
            generations: { normal: 0, watermark_free: 0 }
        });
        
    } catch (error) {
        console.error('Subscription status check failed:', error);
        return res.status(500).json({ 
            is_subscribed: false, 
            subscription: null,
            error: 'Internal server error' 
        });
    }
});

// ========================================
// 2. SUBSCRIPTION VERIFICATION ENDPOINT
// ========================================
// POST /api/subscription/verify
// Verifies Stripe session and activates subscription
app.post('/api/subscription/verify', async (req, res) => {
    try {
        const { session_id } = req.body;
        const userId = req.user?.id || req.session?.userId;
        
        if (!session_id || !userId) {
            return res.status(400).json({ error: 'Missing session_id or user_id' });
        }
        
        // Verify Stripe session
        const session = await stripe.checkout.sessions.retrieve(session_id);
        
        if (session.payment_status !== 'paid') {
            return res.status(400).json({ error: 'Payment not completed' });
        }
        
        // Get subscription from Stripe
        const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
        
        // Create/update subscription in database
        const subscriptionData = {
            user_id: userId,
            stripe_subscription_id: stripeSubscription.id,
            plan_id: session.metadata.plan_id,
            plan_type: session.metadata.plan_type,
            status: 'active',
            start_date: new Date(stripeSubscription.current_period_start * 1000),
            end_date: new Date(stripeSubscription.current_period_end * 1000),
            created_at: new Date()
        };
        
        // Insert or update subscription
        await db.query(`
            INSERT INTO subscriptions 
            (user_id, stripe_subscription_id, plan_id, plan_type, status, start_date, end_date, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            status = VALUES(status),
            end_date = VALUES(end_date),
            updated_at = NOW()
        `, [
            subscriptionData.user_id,
            subscriptionData.stripe_subscription_id,
            subscriptionData.plan_id,
            subscriptionData.plan_type,
            subscriptionData.status,
            subscriptionData.start_date,
            subscriptionData.end_date,
            subscriptionData.created_at
        ]);
        
        // Add generations based on plan
        const planGenerations = {
            basic: { normal: 100, watermark_free: 20 },
            professional: { normal: 500, watermark_free: 150 },
            enterprise: { normal: 999999, watermark_free: 299999 }
        };
        
        const generations = planGenerations[subscriptionData.plan_type] || planGenerations.basic;
        
        // Update user generations
        await db.query(`
            INSERT INTO user_generations (user_id, normal, watermark_free)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
            normal = normal + VALUES(normal),
            watermark_free = watermark_free + VALUES(watermark_free)
        `, [userId, generations.normal, generations.watermark_free]);
        
        // Return updated subscription status
        const updatedSubscription = await db.query(`
            SELECT s.*, sp.name as plan_name, sp.price, sp.generations
            FROM subscriptions s
            JOIN subscription_plans sp ON s.plan_id = sp.id
            WHERE s.user_id = ? AND s.stripe_subscription_id = ?
        `, [userId, stripeSubscription.id]);
        
        return res.json({
            is_subscribed: true,
            subscription: {
                id: updatedSubscription[0].id,
                planType: updatedSubscription[0].plan_type,
                name: updatedSubscription[0].plan_name,
                price: updatedSubscription[0].price,
                generations: updatedSubscription[0].generations,
                startDate: updatedSubscription[0].start_date,
                endDate: updatedSubscription[0].end_date,
                status: updatedSubscription[0].status
            },
            generations: generations
        });
        
    } catch (error) {
        console.error('Subscription verification failed:', error);
        return res.status(500).json({ error: 'Verification failed' });
    }
});

// ========================================
// 3. CANCEL SUBSCRIPTION ENDPOINT
// ========================================
// POST /api/subscription/cancel
app.post('/api/subscription/cancel', async (req, res) => {
    try {
        const userId = req.user?.id || req.session?.userId;
        
        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }
        
        // Get active subscription
        const subscription = await db.query(`
            SELECT stripe_subscription_id FROM subscriptions
            WHERE user_id = ? AND status = 'active'
            LIMIT 1
        `, [userId]);
        
        if (!subscription || subscription.length === 0) {
            return res.status(404).json({ error: 'No active subscription found' });
        }
        
        // Cancel in Stripe
        await stripe.subscriptions.update(subscription[0].stripe_subscription_id, {
            cancel_at_period_end: true
        });
        
        // Update database
        await db.query(`
            UPDATE subscriptions 
            SET status = 'cancelled', updated_at = NOW()
            WHERE user_id = ? AND stripe_subscription_id = ?
        `, [userId, subscription[0].stripe_subscription_id]);
        
        // Reset generations to 0
        await db.query(`
            UPDATE user_generations 
            SET normal = 0, watermark_free = 0
            WHERE user_id = ?
        `, [userId]);
        
        return res.json({ 
            success: true, 
            message: 'Subscription cancelled successfully' 
        });
        
    } catch (error) {
        console.error('Subscription cancellation failed:', error);
        return res.status(500).json({ error: 'Cancellation failed' });
    }
});

// ========================================
// 4. STRIPE WEBHOOK HANDLER
// ========================================
// POST /api/stripe/webhook
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.log(`Webhook signature verification failed.`, err.message);
        return res.sendStatus(400);
    }
    
    // Handle the event
    switch (event.type) {
        case 'invoice.payment_succeeded':
            const invoice = event.data.object;
            console.log('Payment succeeded for subscription:', invoice.subscription);
            
            // Update subscription status to active
            await db.query(`
                UPDATE subscriptions 
                SET status = 'active', updated_at = NOW()
                WHERE stripe_subscription_id = ?
            `, [invoice.subscription]);
            
            break;
            
        case 'customer.subscription.deleted':
            const deletedSubscription = event.data.object;
            console.log('Subscription deleted:', deletedSubscription.id);
            
            // Update subscription status in database
            await db.query(`
                UPDATE subscriptions 
                SET status = 'cancelled', end_date = NOW(), updated_at = NOW()
                WHERE stripe_subscription_id = ?
            `, [deletedSubscription.id]);
            
            // Reset user generations
            await db.query(`
                UPDATE user_generations 
                SET normal = 0, watermark_free = 0
                WHERE user_id = (SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ?)
            `, [deletedSubscription.id]);
            
            break;
            
        case 'customer.subscription.updated':
            const updatedSubscription = event.data.object;
            console.log('Subscription updated:', updatedSubscription.id);
            
            // Update subscription in database
            await db.query(`
                UPDATE subscriptions 
                SET status = ?, end_date = ?, updated_at = NOW()
                WHERE stripe_subscription_id = ?
            `, [
                updatedSubscription.status,
                new Date(updatedSubscription.current_period_end * 1000),
                updatedSubscription.id
            ]);
            
            break;
    }
    
    res.json({ received: true });
});

// ========================================
// DATABASE SCHEMA
// ========================================
/*
CREATE TABLE subscriptions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    stripe_subscription_id VARCHAR(255) UNIQUE NOT NULL,
    plan_id INT NOT NULL,
    plan_type VARCHAR(50) NOT NULL,
    status ENUM('active', 'cancelled', 'past_due') DEFAULT 'active',
    start_date DATETIME NOT NULL,
    end_date DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
);

CREATE TABLE subscription_plans (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    plan_type VARCHAR(50) UNIQUE NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    generations INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_generations (
    user_id INT PRIMARY KEY,
    normal INT DEFAULT 0,
    watermark_free INT DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
*/
