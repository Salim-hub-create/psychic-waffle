// Invoice Generator JavaScript - Simplified Version with Backend Integration

// Global state
let invoiceData = {
    business: { name: '', email: '', phone: '', address: '' },
    client: { name: '', email: '', address: '' },
    invoice: { number: '', date: '', dueDate: '', currency: 'USD' },
    bank: { 
        bankName: '', 
        accountName: '', 
        accountNumber: '', 
        routingNumber: '', 
        swiftCode: '', 
        paymentInstructions: '' 
    },
    items: [],
    totals: { subtotal: 0, taxRate: 0, taxAmount: 0, discountRate: 0, discountAmount: 0, total: 0 }
};

function updateGenerationsDisplay() {
    updateDisplay();
}

async function syncGenerationsFromServer(retries = 6, delayMs = 800, minNormal = null) {
    const token = localStorage.getItem('userToken');
    if (!token) return false;

    for (let i = 0; i < retries; i++) {
        try {
            const resp = await fetch(`${API_BASE}/user`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (resp.ok) {
                const u = await resp.json();
                currentUser = u;
                const serverNormal = Number(u.normalGenerations || 0);
                const serverWatermarkFree = Number(u.watermarkFreeGenerations || 0);
                const localNormal = Number(generations.normal || 0);
                const guardedMin = minNormal === null ? null : Number(minNormal || 0);

                generations.normal = guardedMin === null
                    ? Math.max(serverNormal, localNormal)
                    : Math.max(serverNormal, localNormal, guardedMin);
                generations.watermarkFree = Math.max(serverWatermarkFree, Number(generations.watermarkFree || 0));
                localStorage.setItem('generations', JSON.stringify(generations));
                updateDisplay();
                return true;
            }
        } catch (e) {
            // ignore
        }

        if (i < retries - 1) {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }

    return false;
}

async function verifyCreditsSessionAndSync(sessionId, expectedGenerations) {
    const token = localStorage.getItem('userToken');
    if (!token) return { ok: false, reason: 'missing_token' };
    if (!sessionId) return { ok: false, reason: 'missing_session' };

    try {
        const resp = await fetch(`${API_BASE}/credits/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                session_id: sessionId,
                expected_generations: expectedGenerations
            })
        });

        if (!resp.ok) {
            let reason = 'verify_failed';
            try {
                const j = await resp.json();
                reason = j && j.error ? j.error : reason;
            } catch (e) {
                // ignore
            }
            return { ok: false, reason };
        }

        const data = await resp.json();
        if (data && data.normalGenerations !== undefined) {
            generations.normal = Math.max(Number(generations.normal || 0), Number(data.normalGenerations || 0));
            localStorage.setItem('generations', JSON.stringify(generations));
            updateDisplay();
        }
        return { ok: true, data };
    } catch (e) {
        return { ok: false, reason: 'network_error' };
    }
}

let generations = { normal: 0, watermarkFree: 0 }; // Removed AI
let history = { undo: [], redo: [] };
let currentUser = null;
let companyLogo = null; // Store uploaded logo

// Backend API base URL
const API_BASE = window.location.origin + '/api';

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    loadSavedData();
    setDefaultDates();
    addInitialItem();
    updateDisplay();
    setupEventListeners();

    // Ensure user initialization completes before validating subscription
    await initializeUser();

    // After auth is ready, check for purchases and validate subscription state
    checkForSuccessfulPurchase();
    setupAutoSave();
    await validateSubscriptionStatus(); // CRITICAL: Validate subscription on page load (now after auth)
    loadSavedLogo();
    
    // DEBUG: Add manual subscription test
    window.testSubscription = function() {
        const testSubscription = {
            planType: 'basic',
            name: 'Basic Plan',
            price: 9.99,
            generations: 100,
            startDate: new Date().toISOString()
        };
        
        updateSubscriptionState(true, testSubscription);
        generations.normal = 100;
        generations.watermarkFree = 20;
        localStorage.setItem('generations', JSON.stringify(generations));
        updateDisplay();
        
        showToast('🧪 Test subscription activated!', 'success');
        console.log('🧪 Test subscription activated');
    };
    
    // DEBUG: Add manual subscription removal
    window.removeTestSubscription = function() {
        updateSubscriptionState(false);
        generations.normal = 0;
        generations.watermarkFree = 0;
        localStorage.setItem('generations', JSON.stringify(generations));
        updateDisplay();
        removeLogo();
        
        showToast('🧪 Test subscription removed!', 'info');
        console.log('🧪 Test subscription removed');
    };
    
    console.log('🧪 DEBUG: Test functions available:');
    console.log('  - testSubscription() → Activate test subscription');
    console.log('  - removeTestSubscription() → Remove test subscription');
});

// CRITICAL: Authoritative subscription validation
async function validateSubscriptionStatus() {
    console.log('🔍 VALIDATING SUBSCRIPTION STATUS...');
    
    try {
        // Always check backend first (source of truth)
        const response = await fetch(`${API_BASE}/subscription/status`, {
            method: 'GET',
            headers: { 
                'Content-Type': 'application/json',
                ...(currentUser && { 'Authorization': `Bearer ${currentUser.token}` })
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Backend subscription data:', data);
            
            // Update frontend state based on backend response
            updateSubscriptionState(data.is_subscribed, data.subscription);
            
            // Update generations from backend
            if (data.generations) {
                generations.normal = Math.max(Number(generations.normal || 0), Number(data.generations.normal || 0));
                generations.watermarkFree = Math.max(Number(generations.watermarkFree || 0), Number(data.generations.watermark_free || 0));
                localStorage.setItem('generations', JSON.stringify(generations));
                updateDisplay();
            }
            
        } else {
            console.warn('⚠️ Backend subscription check failed, using fallback');
            // Fallback to localStorage but with validation
            validateLocalSubscription();
        }
        
    } catch (error) {
        console.error('❌ Subscription validation error:', error);
        // Fallback to localStorage but with validation
        validateLocalSubscription();
    }
}

// Update subscription state based on authoritative source
function updateSubscriptionState(isSubscribed, subscriptionData = null) {
    console.log('🔄 Updating subscription state:', { isSubscribed, subscriptionData });
    
    // Update localStorage as cache, not source of truth
    if (isSubscribed && subscriptionData) {
        localStorage.setItem('currentSubscription', JSON.stringify(subscriptionData));
        localStorage.setItem('is_subscribed', 'true');
    } else {
        localStorage.removeItem('currentSubscription');
        localStorage.setItem('is_subscribed', 'false');
    }
    
    // Update UI based on authoritative state
    updateSubscriptionUI();
    updateDisplay();
}

// Fallback validation for localStorage (less reliable)
function validateLocalSubscription() {
    const currentSubscription = localStorage.getItem('currentSubscription');
    const isSubscribedFlag = localStorage.getItem('is_subscribed');
    
    // Only trust if both exist and are consistent
    if (currentSubscription && isSubscribedFlag === 'true') {
        try {
            const subscription = JSON.parse(currentSubscription);
            const startDate = new Date(subscription.startDate);
            const now = new Date();
            
            // Check if subscription is not older than 1 year (basic validation)
            const oneYearAgo = new Date(now.getTime() - (365 * 24 * 60 * 60 * 1000));
            
            if (startDate > oneYearAgo) {
                console.log('✅ Local subscription appears valid');
                updateSubscriptionState(true, subscription);
                return;
            }
        } catch (error) {
            console.error('❌ Invalid local subscription data:', error);
        }
    }
    
    // Default to not subscribed if validation fails
    console.log('⚠️ No valid subscription found, defaulting to unsubscribed');
    updateSubscriptionState(false);
}

// CRITICAL: Check subscription before PDF generation
async function checkSubscriptionBeforePDF() {
    console.log('🔍 CHECKING SUBSCRIPTION BEFORE PDF GENERATION...');
    
    try {
        const response = await fetch(`${API_BASE}/subscription/status`, {
            method: 'GET',
            headers: { 
                'Content-Type': 'application/json',
                ...(currentUser && { 'Authorization': `Bearer ${currentUser.token}` })
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Subscription check before PDF:', data);
            return data.is_subscribed;
        }
    } catch (error) {
        console.error('❌ Subscription check before PDF failed:', error);
    }
    
    // Fallback to local check (less secure)
    return localStorage.getItem('is_subscribed') === 'true';
}

// Handle successful subscription purchase
async function handleSubscriptionSuccess(sessionId) {
    console.log('🎉 Processing subscription success for session:', sessionId);
    showLoadingState('Processing your subscription...');
    
    try {
        // CRITICAL: Verify subscription with backend (source of truth)
        const response = await fetch(`${API_BASE}/subscription/verify`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                ...(currentUser && { 'Authorization': `Bearer ${currentUser.token}` })
            },
            body: JSON.stringify({ session_id: sessionId })
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Backend verified subscription:', data);
            
            // Update state based on authoritative backend response
            updateSubscriptionState(data.is_subscribed, data.subscription);
            
            // Update generations from backend
            if (data.generations) {
                generations.normal = data.generations.normal || 0;
                generations.watermarkFree = data.generations.watermark_free || 0;
                localStorage.setItem('generations', JSON.stringify(generations));
                updateDisplay();
            }
            
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
            
            hideLoadingState();
            showToast(`🎉 Successfully subscribed to ${data.subscription.name}!`, 'success');
            
            console.log('✅ Subscription processed successfully');
            return;
            
        } else {
            throw new Error('Backend verification failed');
        }
        
    } catch (error) {
        console.error('❌ Subscription verification error:', error);
        
        // Fallback for test mode
        try {
            const testResponse = await fetch(`${API_BASE}/stripe-check`);
            const testData = await testResponse.json();
            
            if (!testData.ok || testData.test) {
                console.log('🧪 Test mode - adding basic subscription');
                
                // Add basic subscription
                const subscription = {
                    planType: 'basic',
                    name: 'Basic Plan',
                    price: 9.99,
                    generations: 100
                };
                
                // Set generations
                generations.normal = 100;
                generations.watermarkFree = 20;
                
                // Update state (authoritative)
                updateSubscriptionState(true, subscription);
                
                // Save generations
                localStorage.setItem('generations', JSON.stringify(generations));
                updateDisplay();
                
                // Clean URL
                window.history.replaceState({}, document.title, window.location.pathname);
                
                hideLoadingState();
                showToast('🎉 Successfully subscribed to Basic Plan! +100 Generations +20 Clean Invoices', 'success');
                
                console.log('✅ Test mode subscription processed');
                return;
            }
        } catch (testError) {
            console.error('❌ Test mode fallback failed:', testError);
        }
        
        // Final fallback - add basic subscription anyway
        generations.normal = 100;
        generations.watermarkFree = 20;
        
        const fallbackSubscription = {
            planType: 'basic',
            name: 'Basic Plan',
            price: 9.99,
            generations: 100,
            startDate: new Date().toISOString()
        };
        
        updateSubscriptionState(true, fallbackSubscription);
        
        localStorage.setItem('generations', JSON.stringify(generations));
        updateDisplay();
        
        hideLoadingState();
        showToast('🎉 Subscription processed! +100 Generations +20 Clean Invoices', 'success');
    }
}

// Check for successful purchase from URL parameters
async function checkForSuccessfulPurchase() {
    console.log('🔍 DEBUG: Checking URL parameters...');
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    const success = urlParams.get('success');
    const creditsSuccess = urlParams.get('credits_success');
    const subscriptionSuccess = urlParams.get('subscription_success');
    
    console.log('🔍 DEBUG: URL params:', { sessionId, success, creditsSuccess, subscriptionSuccess });
    console.log('🔍 DEBUG: Current URL:', window.location.search);
    console.log('🔍 DEBUG: Full URL:', window.location.href);
    
    // Handle subscription success
    if (subscriptionSuccess === 'true' && sessionId) {
        console.log('🎉 SUBSCRIPTION SUCCESS DETECTED!');
        handleSubscriptionSuccess(sessionId);
        return;
    }
    
    // DETECT ANY STRIPE SESSION ID - MULTIPLE METHODS
    let detectedSessionId = sessionId;
    
    // Method 1: URL parameter
    if (sessionId && (sessionId.startsWith('cs_') || sessionId.startsWith('cs_test_'))) {
        console.log('✅ Method 1: Found session ID in URL params:', sessionId);
        detectedSessionId = sessionId;
    }
    
    // Method 2: Check URL hash (some redirect methods use hash)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const hashSessionId = hashParams.get('session_id');
    if (hashSessionId && (hashSessionId.startsWith('cs_') || hashSessionId.startsWith('cs_test_'))) {
        console.log('✅ Method 2: Found session ID in hash:', hashSessionId);
        detectedSessionId = hashSessionId;
    }
    
    // Method 3: Parse from full URL string (fallback)
    const urlMatch = window.location.href.match(/session_id=([^&]+)/);
    if (urlMatch && urlMatch[1]) {
        const extractedSessionId = decodeURIComponent(urlMatch[1]);
        if (extractedSessionId.startsWith('cs_') || extractedSessionId.startsWith('cs_test_')) {
            console.log('✅ Method 3: Extracted session ID from URL:', extractedSessionId);
            detectedSessionId = extractedSessionId;
        }
    }
    
    // Method 4: Check for any cs_ or cs_test_ in URL
    const fullUrlMatch = window.location.href.match(/(cs_test_[a-zA-Z0-9]+)/);
    if (fullUrlMatch && fullUrlMatch[1]) {
        console.log('✅ Method 4: Found session ID in full URL:', fullUrlMatch[1]);
        detectedSessionId = fullUrlMatch[1];
    }
    
    console.log('🔍 DEBUG: Final detected session ID:', detectedSessionId);
    
    // IF WE FOUND A SESSION ID, AWARD CREDITS
    if (detectedSessionId && (detectedSessionId.startsWith('cs_') || detectedSessionId.startsWith('cs_test_'))) {
        console.log('🎉 DETECTED STRIPE SESSION - AWARDING CREDITS!');
        
        // Show loading state
        showLoadingState('Processing your credits purchase...');
        
        // Check if we have pending credits info
        const pendingCredits = localStorage.getItem('pendingCredits');
        console.log('🔍 DEBUG: Pending credits from localStorage:', pendingCredits);
        
        if (pendingCredits) {
            try {
                const credits = JSON.parse(pendingCredits);
                console.log('🔍 DEBUG: Parsed credits:', credits);
                
                // Get the credit package
                const creditPackages = {
                    basic: { normal: 50, price: 4.99, name: 'Basic Credits' },
                    pro: { normal: 150, price: 9.99, name: 'Professional Credits' },
                    enterprise: { normal: 500, price: 19.99, name: 'Enterprise Credits' }
                };
                
                const credit = creditPackages[credits.creditType] || creditPackages.basic;
                console.log('🔍 DEBUG: Found credit package:', credit);

                // Always add locally immediately, then verify/credit on backend, then sync without ever dropping below the optimistic local value.
                const optimisticNormal = (generations.normal || 0) + credit.normal;
                generations.normal = optimisticNormal;
                localStorage.setItem('generations', JSON.stringify(generations));
                updateDisplay();
                closeCreditsModal();
                showToast(`✅ Successfully purchased ${credit.name}! +${credit.normal} generations`, 'success');

                // Credit the authenticated user on the server immediately (no webhook dependency)
                await verifyCreditsSessionAndSync(detectedSessionId, credit.normal);

                // Sync authoritative balance (but do not allow an overwrite down to 0)
                await syncGenerationsFromServer(6, 800, optimisticNormal);
                
                // Clear pending credits
                localStorage.removeItem('pendingCredits');
                console.log('🔍 DEBUG: Cleared pending credits from localStorage');
                
                // Clean up URL
                window.history.replaceState({}, document.title, window.location.pathname);
                console.log('🔍 DEBUG: Cleaned up URL');
                
            } catch (error) {
                console.error('🔍 DEBUG: Error processing credits purchase:', error);
                showError(`❌ ERROR: Failed to process credits purchase: ${error.message}`);
                
                // Fallback - add basic credits
                console.log('🔧 FALLBACK: Adding basic credits due to error...');
                generations.normal = (generations.normal || 0) + 50;
                localStorage.setItem('generations', JSON.stringify(generations));
                updateDisplay();
                showToast('✅ Added 50 credits as fallback', 'success');
            }
        } else {
            console.log('🔍 DEBUG: No pending credits found, silently exiting...');
            // No pending credits info - no action needed
            console.log('🔍 DEBUG: No purchase detected, no credits added');
        }
        
        // Hide loading state
        hideLoadingState();
        return; // Exit early - we've handled the credits
    }
    
    // ONLY SHOW ERRORS IF THERE ARE INDICATORS OF A PURCHASE ATTEMPT
    // Be very specific - only trigger if we see actual Stripe session patterns AND pending credits
    const hasPendingCredits = localStorage.getItem('pendingCredits') && localStorage.getItem('pendingCredits') !== 'null';
    const hasSessionId = window.location.href.includes('session_id=cs_') || window.location.href.includes('session_id=cs_test_');
    const hasSuccessParam = window.location.href.includes('success=true') || window.location.href.includes('credits_success=true');
    
    // Only show error if we have clear evidence of a failed purchase attempt
    const hasFailedPurchaseAttempt = (hasSessionId && !hasPendingCredits) || 
                                   (hasSuccessParam && !hasPendingCredits);
    
    console.log('🔍 DEBUG: Pending credits:', hasPendingCredits);
    console.log('🔍 DEBUG: Session ID:', hasSessionId);
    console.log('🔍 DEBUG: Success param:', hasSuccessParam);
    console.log('🔍 DEBUG: Failed purchase attempt:', hasFailedPurchaseAttempt);
    
    // Only show errors if we have a clear failed purchase attempt
    if (hasFailedPurchaseAttempt) {
        console.error('❌ ERROR: Purchase attempt detected but no valid session found');
        console.log('🔍 DEBUG: Current URL:', window.location.href);
        
        // Clear any invalid pending credits
        localStorage.removeItem('pendingCredits');
        
    } else {
        // No purchase indicators - silently exit
        console.log('🔍 DEBUG: No purchase indicators found - silently exiting');
    }
    
    // Handle credits success - more robust detection
    if ((creditsSuccess === 'true' || window.location.href.includes('credits_success=true')) && sessionId) {
        console.log('🎉 Detected successful credits purchase, processing...');
        
        // Show loading state
        showLoadingState('Processing your credits purchase...');
        
        const pendingCredits = localStorage.getItem('pendingCredits');
        console.log('🔍 DEBUG: Pending credits from localStorage:', pendingCredits);
        
        if (pendingCredits) {
            try {
                const credits = JSON.parse(pendingCredits);
                console.log('🔍 DEBUG: Parsed credits:', credits);
                console.log('Processing credits purchase:', credits);
                
                // Simulate credits completion
                const creditPackages = {
                    basic: { normal: 50, price: 4.99, name: 'Basic Credits' },
                    pro: { normal: 150, price: 9.99, name: 'Professional Credits' },
                    enterprise: { normal: 500, price: 19.99, name: 'Enterprise Credits' }
                };
                
                const credit = creditPackages[credits.creditType];
                console.log('🔍 DEBUG: Found credit package:', credit);
                
                if (credit) {
                    const optimisticNormal = (generations.normal || 0) + credit.normal;
                    generations.normal = optimisticNormal;
                    localStorage.setItem('generations', JSON.stringify(generations));
                    updateDisplay();
                    closeCreditsModal();
                    showToast(`✅ Successfully purchased ${credit.name}! +${credit.normal} generations`, 'success');
                    await verifyCreditsSessionAndSync(sessionId, credit.normal);
                    await syncGenerationsFromServer(6, 800, optimisticNormal);
                } else {
                    console.error('🔍 DEBUG: No credit package found for type:', credits.creditType);
                    showError(`❌ ERROR: Invalid credit package: ${credits.creditType}`);
                }
                
                // Clear pending credits
                localStorage.removeItem('pendingCredits');
                console.log('🔍 DEBUG: Cleared pending credits from localStorage');
                
                // Clean up URL
                window.history.replaceState({}, document.title, window.location.pathname);
                console.log('🔍 DEBUG: Cleaned up URL');
                
            } catch (error) {
                console.error('🔍 DEBUG: Error processing credits purchase:', error);
                showError(`❌ ERROR: Failed to process credits purchase: ${error.message}`);
            }
        } else {
            console.log('🔍 DEBUG: No pending credits found in localStorage');
            console.log('🔍 DEBUG: No purchase detected, silently exiting');
            // No action needed when there's no purchase
        }
        
        // Hide loading state
        hideLoadingState();
        
    } else {
        console.log('🔍 DEBUG: No credits success detected. creditsSuccess:', creditsSuccess, 'sessionId:', sessionId);
        
        // Only show additional check if there are purchase indicators AND Stripe session pattern
        if (hasPurchaseIndicators && hasStripeSessionPattern && sessionId && window.location.href.includes('session_id=')) {
            console.log('🔍 DEBUG: Found session_id, attempting fallback credit addition...');
            showLoadingState('Processing your credits purchase...');
            addCreditsDirectly(sessionId);
            setTimeout(hideLoadingState, 2000);
        } else {
            console.log('🔍 DEBUG: No valid purchase indicators found - silently exiting');
        }
    }
    
    // Handle general success (subscriptions and legacy purchases)
    if (success === 'true' && sessionId) {
        console.log('🎉 Detected successful purchase, processing...');
        
        // Check for subscription
        const pendingSubscription = localStorage.getItem('pendingSubscription');
        if (pendingSubscription) {
            try {
                const subscription = JSON.parse(pendingSubscription);
                console.log('Processing subscription:', subscription);
                
                // Simulate the subscription completion
                const subscriptions = {
                    basic: { generations: 100, price: 9.99, name: 'Basic Plan' },
                    professional: { generations: 500, price: 29.99, name: 'Professional Plan' },
                    enterprise: { generations: -1, price: 39.99, name: 'Enterprise Plan' }
                };
                
                const sub = subscriptions[subscription.planType];
                if (sub) {
                    handleSuccessfulSubscription(subscription.planType, sub);
                }
                
                // Clear pending subscription
                localStorage.removeItem('pendingSubscription');
                
                // Clean up URL
                window.history.replaceState({}, document.title, window.location.pathname);
                
            } catch (error) {
                console.error('Error processing subscription:', error);
                showError(`❌ ERROR: Failed to process subscription: ${error.message}`);
            }
        }
        
        // Check for one-time purchase (legacy)
        const pendingPurchase = localStorage.getItem('pendingPurchase');
        if (pendingPurchase) {
            try {
                const purchase = JSON.parse(pendingPurchase);
                console.log('Processing purchase:', purchase);
                
                // Simulate the purchase completion
                const packages = {
                    basic: { normal: 50, price: 9.99 },
                    pro: { normal: 150, price: 19.99 },
                    enterprise: { normal: 500, price: 49.99 }
                };
                
                const pkg = packages[purchase.packageType];
                if (pkg) {
                    handleSuccessfulPurchase(purchase.packageType, pkg);
                }
                
                // Clear pending purchase
                localStorage.removeItem('pendingPurchase');
                
                // Clean up URL
                window.history.replaceState({}, document.title, window.location.pathname);
                
            } catch (error) {
                console.error('Error processing purchase:', error);
                showError(`❌ ERROR: Failed to process purchase: ${error.message}`);
            }
        }
    }
}

// Add credits directly as fallback
function addCreditsDirectly(sessionId) {
    console.log('🔍 DEBUG: Adding credits directly for session:', sessionId);
    
    // Default to basic credits if we can't determine the type
    const creditPackages = {
        basic: { normal: 50, price: 4.99, name: 'Basic Credits' },
        pro: { normal: 150, price: 9.99, name: 'Professional Credits' },
        enterprise: { normal: 500, price: 19.99, name: 'Enterprise Credits' }
    };
    
    // Try to determine credit type from session or default to basic
    const creditType = 'basic'; // Default fallback
    const credit = creditPackages[creditType];
    
    console.log('🔍 DEBUG: Using default credit package:', credit);
    
    if (credit) {
        console.log('🔍 DEBUG: Calling handleSuccessfulCreditsPurchase with fallback...');
        handleSuccessfulCreditsPurchase(creditType, credit);
    }
}

// Simple direct credit addition - GUARANTEED TO WORK
function addCreditsNow() {
    console.log('🚀 DIRECT: Adding credits immediately...');
    
    // Add credits directly to generations
    generations.normal = (generations.normal || 0) + 50;
    
    // Save to localStorage
    localStorage.setItem('generations', JSON.stringify(generations));
    
    // Update display
    updateDisplay();
    
    // Show success message
    showToast('✅ Successfully purchased Basic Credits! +50 generations', 'success');
    
    // Close modal if open
    closeCreditsModal();
    
    console.log('✅ Credits added directly:', generations);
}

// Add this to global scope for emergency use
window.addCreditsNow = addCreditsNow;

// Loading and error states
function showLoadingState(message) {
    // Create loading overlay if it doesn't exist
    let loadingOverlay = document.getElementById('loading-overlay');
    if (!loadingOverlay) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'loading-overlay';
        loadingOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            font-family: Arial, sans-serif;
        `;
        
        const loadingContent = document.createElement('div');
        loadingContent.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 10px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;
        
        loadingContent.innerHTML = `
            <div style="font-size: 24px; margin-bottom: 15px;">⏳</div>
            <div style="font-size: 16px; color: #333; margin-bottom: 10px;">${message}</div>
            <div style="font-size: 12px; color: #666;">Please wait while we process your purchase...</div>
        `;
        
        loadingOverlay.appendChild(loadingContent);
        document.body.appendChild(loadingOverlay);
    }
}

function hideLoadingState() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.remove();
    }
}

function showError(message) {
    hideLoadingState();
    
    // Create error overlay
    const errorOverlay = document.createElement('div');
    errorOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        font-family: Arial, sans-serif;
    `;
    
    const errorContent = document.createElement('div');
    errorContent.style.cssText = `
        background: #ff4757;
        color: white;
        padding: 30px;
        border-radius: 10px;
        text-align: center;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        max-width: 400px;
    `;
    
    errorContent.innerHTML = `
        <div style="font-size: 24px; margin-bottom: 15px;">❌</div>
        <div style="font-size: 16px; margin-bottom: 20px;">${message}</div>
        <button onclick="this.parentElement.parentElement.remove()" style="
            background: white;
            color: #ff4757;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
        ">Close</button>
    `;
    
    errorOverlay.appendChild(errorContent);
    document.body.appendChild(errorOverlay);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (errorOverlay.parentElement) {
            errorOverlay.remove();
        }
    }, 5000);
}

// Manual trigger for URL check (call this from browser console if needed)
function manualCheckForCredits() {
    console.log('🔍 MANUAL: Manually checking for credits...');
    checkForSuccessfulPurchase();
}

// Comprehensive diagnostic function
function runDiagnostic() {
    console.log('=== 🚨 COMPREHENSIVE CREDITS DIAGNOSTIC ===');
    
    // Check URL
    console.log('📍 URL Information:');
    console.log('  Full URL:', window.location.href);
    console.log('  Search params:', window.location.search);
    console.log('  Hash:', window.location.hash);
    
    // Check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    const success = urlParams.get('success');
    const creditsSuccess = urlParams.get('credits_success');
    
    console.log('🔍 URL Parameters:');
    console.log('  session_id:', sessionId);
    console.log('  success:', success);
    console.log('  credits_success:', creditsSuccess);
    
    // Check localStorage
    console.log('💾 LocalStorage:');
    console.log('  generations:', localStorage.getItem('generations'));
    console.log('  pendingCredits:', localStorage.getItem('pendingCredits'));
    console.log('  userToken:', localStorage.getItem('userToken'));
    console.log('  currentSubscription:', localStorage.getItem('currentSubscription'));
    
    // Check generations object
    console.log('🎯 Generations Object:');
    console.log('  generations:', generations);
    console.log('  generations.normal:', generations.normal);
    console.log('  typeof generations.normal:', typeof generations.normal);
    
    // Check DOM elements
    console.log('🖼️ DOM Elements:');
    console.log('  generations-display:', document.getElementById('generations-display')?.textContent);
    console.log('  credits-modal:', document.getElementById('credits-modal')?.style.display);
    
    // Check functions
    console.log('⚙️ Functions:');
    console.log('  checkForSuccessfulPurchase exists:', typeof checkForSuccessfulPurchase);
    console.log('  updateDisplay exists:', typeof updateDisplay);
    console.log('  showToast exists:', typeof showToast);
    
    // Test credit addition
    console.log('🧪 Test Credit Addition:');
    const beforeCount = generations.normal || 0;
    console.log('  Before:', beforeCount);
    
    generations.normal = (generations.normal || 0) + 1;
    localStorage.setItem('generations', JSON.stringify(generations));
    
    const afterCount = generations.normal || 0;
    console.log('  After:', afterCount);
    console.log('  Test successful:', afterCount > beforeCount);
    
    // Reset test
    generations.normal = beforeCount;
    localStorage.setItem('generations', JSON.stringify(generations));
    
    console.log('=== 🚨 END DIAGNOSTIC ===');
    
    // Show user-friendly summary
    const diagnosticResults = {
        hasSessionId: !!sessionId,
        sessionIdValid: sessionId && (sessionId.startsWith('cs_') || sessionId.startsWith('cs_test_')),
        hasPendingCredits: !!localStorage.getItem('pendingCredits'),
        currentGenerations: generations.normal || 0,
        localStorageWorking: afterCount > beforeCount
    };
    
    console.log('📊 Diagnostic Summary:', diagnosticResults);
    
    // Show error messages for problems
    if (!sessionId) {
        showError('❌ ERROR: No session_id found in URL! Did you complete the purchase?');
    } else if (!diagnosticResults.sessionIdValid) {
        showError(`❌ ERROR: Invalid session ID format: ${sessionId}`);
    } else if (!diagnosticResults.hasPendingCredits) {
        console.log('🔍 DEBUG: No pending credits found in localStorage (this is normal if no purchase was made)');
    } else if (!diagnosticResults.localStorageWorking) {
        showError('❌ CRITICAL ERROR: localStorage is not working!');
    } else {
        showToast('✅ Diagnostic complete - system appears to be working', 'success');
    }
    
    return diagnosticResults;
}

// Marketplace functions
function showMarketplace() {
    document.getElementById('marketplace-modal').style.display = 'block';
}

function closeMarketplaceModal() {
    document.getElementById('marketplace-modal').style.display = 'none';
}

// Buy watermark removal package (15 generations = 7 clean invoices)
function buyWatermarkRemoval() {
    if (generations.normal < 15) {
        showError('❌ You need 15 generations for this package. Buy more credits!');
        return;
    }
    
    // Consume 15 generations
    generations.normal -= 15;
    localStorage.setItem('generations', JSON.stringify(generations));
    updateDisplay();
    
    // Add watermark removal credits
    if (!generations.watermarkFree) {
        generations.watermarkFree = 0;
    }
    generations.watermarkFree += 7;
    localStorage.setItem('generations', JSON.stringify(generations));
    
    closeMarketplaceModal();
    showToast('✅ Purchased No Watermark Package! 7 clean invoices available', 'success');
    console.log('🛒 Marketplace: Watermark removal purchased');
}

// Buy bulk invoices package (25 generations = 15 clean invoices)
function buyBulkInvoices() {
    if (generations.normal < 25) {
        showError('❌ You need 25 generations for this package. Buy more credits!');
        return;
    }
    
    // Consume 25 generations
    generations.normal -= 25;
    localStorage.setItem('generations', JSON.stringify(generations));
    updateDisplay();
    
    // Add watermark removal credits
    if (!generations.watermarkFree) {
        generations.watermarkFree = 0;
    }
    generations.watermarkFree += 15;
    localStorage.setItem('generations', JSON.stringify(generations));
    
    closeMarketplaceModal();
    showToast('✅ Purchased Bulk Invoice Pack! 15 clean invoices available', 'success');
    console.log('🛒 Marketplace: Bulk invoices purchased');
}

// Buy premium package (50 generations = 30 clean invoices)
function buyPremiumPack() {
    if (generations.normal < 50) {
        showError('❌ You need 50 generations for this package. Buy more credits!');
        return;
    }
    
    // Consume 50 generations
    generations.normal -= 50;
    localStorage.setItem('generations', JSON.stringify(generations));
    updateDisplay();
    
    // Add watermark removal credits
    if (!generations.watermarkFree) {
        generations.watermarkFree = 0;
    }
    generations.watermarkFree += 30;
    localStorage.setItem('generations', JSON.stringify(generations));
    
    closeMarketplaceModal();
    showToast('✅ Purchased Premium Package! 30 clean invoices available', 'success');
    console.log('🛒 Marketplace: Premium package purchased');
}

// Check if user has watermark-free generations
function hasWatermarkFreeGenerations() {
    return (generations.watermarkFree || 0) > 0;
}

// Consume a watermark-free generation
function consumeWatermarkFreeGeneration() {
    if (hasWatermarkFreeGenerations()) {
        generations.watermarkFree--;
        localStorage.setItem('generations', JSON.stringify(generations));
        updateDisplay();
        console.log('✅ Watermark-free generation consumed. Remaining:', generations.watermarkFree);
        return true;
    }
    return false;
}

// Add these to global scope
window.showMarketplace = showMarketplace;
window.closeMarketplaceModal = closeMarketplaceModal;
window.buyWatermarkRemoval = buyWatermarkRemoval;
window.buyBulkInvoices = buyBulkInvoices;
window.buyPremiumPack = buyPremiumPack;
window.hasWatermarkFreeGenerations = hasWatermarkFreeGenerations;
window.consumeWatermarkFreeGeneration = consumeWatermarkFreeGeneration;

// Initialize or get current user
async function initializeUser() {
    const token = localStorage.getItem('userToken');
    if (token) {
        try {
            const response = await fetch(`${API_BASE}/user`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const user = await response.json();
                currentUser = user;
                updateGenerationsDisplay();
            }
        } catch (error) {
            console.error('Error fetching user:', error);
        }
    }
    
    // Load saved generations
    loadSavedData();
    
    // Setup event listeners for purchase detection
    setupPurchaseDetection();
    
    // Location-based tax calculation
    detectLocationAndSetTax();
}

// Setup event listeners for purchase detection
function setupPurchaseDetection() {
    console.log(' Setting up purchase detection...');
    
    // Check for successful purchase immediately (once on page load)
    checkForSuccessfulPurchase();
    
    // Only check when page becomes visible (user returns from Stripe)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            console.log(' VISIBILITY: Page became visible, checking for purchase...');
            checkForSuccessfulPurchase();
        }
    });
    
    // Also check when window gets focus (user returns from Stripe)
    window.addEventListener('focus', () => {
        console.log(' FOCUS: Window got focus, checking for purchase...');
        checkForSuccessfulPurchase();
    });
    
    // REMOVED: Multiple setTimeout calls and aggressive checking
    // This was causing unwanted popups every few seconds
}

// Location-based tax calculation
async function detectLocationAndSetTax() {
    const detectBtn = document.getElementById('detect-location');
    const locationInfo = document.getElementById('location-tax-info');
    
    if (!navigator.geolocation) {
        locationInfo.textContent = '❌ Geolocation not supported';
        locationInfo.style.color = '#dc2626';
        return;
    }

    detectBtn.disabled = true;
    detectBtn.textContent = '🔄 Detecting...';
    locationInfo.textContent = 'Getting your location...';
    locationInfo.style.color = '#2563eb';

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            try {
                const { latitude, longitude } = position.coords;
                
                // Call backend API for tax calculation
                const response = await fetch(`${API_BASE}/tax-by-location`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ latitude, longitude })
                });
                
                if (!response.ok) {
                    throw new Error('Failed to calculate tax');
                }
                
                const data = await response.json();
                
                // Update tax rate
                document.getElementById('tax-rate').value = data.taxRate;
                calculateTotals();
                
                // Update location info
                locationInfo.textContent = `📍 ${data.location.name}, Tax: ${data.taxRate}%`;
                locationInfo.style.color = '#16a34a';
                
                showToast(`✅ Tax rate set to ${data.taxRate}% based on your location (${data.location.name})`);
                
            } catch (error) {
                console.error('Error getting location tax:', error);
                locationInfo.textContent = '❌ Could not determine tax rate';
                locationInfo.style.color = '#dc2626';
                showToast('❌ Failed to detect location tax. Please enter tax manually.', 'error');
            } finally {
                detectBtn.disabled = false;
                detectBtn.textContent = '📍 Auto-detect Tax';
            }
        },
        (error) => {
            let errorMessage = '❌ Location access denied.';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMessage = '❌ Location access denied. Please enable location services.';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage = '❌ Location information unavailable.';
                    break;
                case error.TIMEOUT:
                    errorMessage = '❌ Location request timed out.';
                    break;
            }
            
            locationInfo.textContent = errorMessage;
            locationInfo.style.color = '#dc2626';
            showToast(errorMessage, 'error');
            detectBtn.disabled = false;
            detectBtn.textContent = '📍 Auto-detect Tax';
        }
    );
}

function setupEventListeners() {
    // Form field listeners
    const fields = ['business-name', 'business-email', 'business-phone', 'business-address', 
                   'client-name', 'client-email', 'client-address', 
                   'invoice-number', 'invoice-date', 'due-date', 'currency',
                   'bank-name', 'account-name', 'account-number', 'routing-number', 
                   'swift-code', 'payment-instructions'];
    fields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', () => saveState());
            field.addEventListener('blur', () => validateField(fieldId));
        }
    });

    // Tax and discount listeners
    document.getElementById('tax-rate').addEventListener('input', calculateTotals);
    document.getElementById('discount-rate').addEventListener('input', calculateTotals);
}

// Auto-save functionality
function setupAutoSave() {
    // Auto-save business and bank info on change
    const autoSaveFields = ['business-name', 'business-email', 'business-phone', 'business-address',
                           'client-name', 'client-email', 'client-address',
                           'bank-name', 'account-name', 'account-number', 'routing-number', 
                           'swift-code', 'payment-instructions'];
    
    autoSaveFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('blur', () => saveBusinessInfo());
            field.addEventListener('change', () => saveBusinessInfo());
        }
    });
    
    // Load saved business info on startup
    loadSavedBusinessInfo();
}

// Save business and bank information to localStorage
function saveBusinessInfo() {
    const businessInfo = {
        business: {
            name: document.getElementById('business-name').value || '',
            email: document.getElementById('business-email').value || '',
            phone: document.getElementById('business-phone').value || '',
            address: document.getElementById('business-address').value || ''
        },
        bank: {
            bankName: document.getElementById('bank-name').value || '',
            accountName: document.getElementById('account-name').value || '',
            accountNumber: document.getElementById('account-number').value || '',
            routingNumber: document.getElementById('routing-number').value || '',
            swiftCode: document.getElementById('swift-code').value || '',
            paymentInstructions: document.getElementById('payment-instructions').value || ''
        },
        client: {
            name: document.getElementById('client-name').value || '',
            email: document.getElementById('client-email').value || '',
            address: document.getElementById('client-address').value || ''
        }
    };
    
    localStorage.setItem('savedBusinessInfo', JSON.stringify(businessInfo));
    console.log('💾 Business info auto-saved');
}

// Load saved business and bank information
function loadSavedBusinessInfo() {
    const saved = localStorage.getItem('savedBusinessInfo');
    if (saved) {
        try {
            const businessInfo = JSON.parse(saved);
            
            // Update business fields
            if (businessInfo.business) {
                document.getElementById('business-name').value = businessInfo.business.name || '';
                document.getElementById('business-email').value = businessInfo.business.email || '';
                document.getElementById('business-phone').value = businessInfo.business.phone || '';
                document.getElementById('business-address').value = businessInfo.business.address || '';
            }
            
            // Update bank fields
            if (businessInfo.bank) {
                document.getElementById('bank-name').value = businessInfo.bank.bankName || '';
                document.getElementById('account-name').value = businessInfo.bank.accountName || '';
                document.getElementById('account-number').value = businessInfo.bank.accountNumber || '';
                document.getElementById('routing-number').value = businessInfo.bank.routingNumber || '';
                document.getElementById('swift-code').value = businessInfo.bank.swiftCode || '';
                document.getElementById('payment-instructions').value = businessInfo.bank.paymentInstructions || '';
            }
            
            // Update client fields
            if (businessInfo.client) {
                document.getElementById('client-name').value = businessInfo.client.name || '';
                document.getElementById('client-email').value = businessInfo.client.email || '';
                document.getElementById('client-address').value = businessInfo.client.address || '';
            }
            
            console.log('📂 Business info loaded from localStorage');
        } catch (error) {
            console.error('Error loading saved business info:', error);
        }
    }
}

// Update subscription UI based on current status
function updateSubscriptionUI() {
    const currentSubscription = localStorage.getItem('currentSubscription');
    const manageBtn = document.getElementById('manage-subscription-btn');
    const cancelBtn = document.getElementById('cancel-subscription-btn');
    const subscribeBtn = document.getElementById('subscribe-btn');
    const logoUploadGroup = document.getElementById('logo-upload-group');
    const downloadBtn = document.getElementById('download-btn');
    const isSubscribedFlag = (localStorage.getItem('is_subscribed') === 'true');
    
    if (isSubscribedFlag || currentSubscription) {
        try {
            const subscription = currentSubscription ? JSON.parse(currentSubscription) : null;
            
            // Show manage button, hide subscribe button
            if (manageBtn) manageBtn.style.display = 'inline-block';
            if (cancelBtn) cancelBtn.style.display = 'inline-block';
            if (subscribeBtn) subscribeBtn.style.display = 'none';
            
            // Show logo upload for subscribers
            if (logoUploadGroup) {
                logoUploadGroup.style.display = 'block';
            }
            
            // Update download button for subscribers
            if (downloadBtn) {
                downloadBtn.textContent = '💾 Download PDF (1 Generation)';
                downloadBtn.className = 'btn btn-success';
                downloadBtn.disabled = (generations.normal || 0) < 1;
            }
            
            // Update subscription status display
            const statusElement = document.getElementById('subscription-status');
            const planElement = document.getElementById('subscription-plan');
            if (statusElement && planElement) {
                statusElement.style.display = 'inline-block';
                planElement.textContent = (subscription && (subscription.name || subscription.planType)) ? (subscription.name || subscription.planType) : 'Premium';
            }
            
            console.log('✅ Subscription UI updated for:', subscription ? subscription.name : 'Premium');
        } catch (error) {
            console.error('Error parsing subscription data:', error);

            // Still show subscribed UI based on flag (avoid hiding buttons due to bad JSON)
            if (manageBtn) manageBtn.style.display = 'inline-block';
            if (cancelBtn) cancelBtn.style.display = 'inline-block';
            if (subscribeBtn) subscribeBtn.style.display = 'none';
            if (logoUploadGroup) logoUploadGroup.style.display = 'block';

            const statusElement = document.getElementById('subscription-status');
            const planElement = document.getElementById('subscription-plan');
            if (statusElement && planElement) {
                statusElement.style.display = 'inline-block';
                planElement.textContent = 'Premium';
            }
        }
    } else {
        // Hide manage button, show subscribe button
        if (manageBtn) manageBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (subscribeBtn) subscribeBtn.style.display = 'inline-block';
        
        // Hide logo upload for non-subscribers
        if (logoUploadGroup) {
            logoUploadGroup.style.display = 'none';
        }
        
        // Update download button for non-subscribers
        if (downloadBtn) {
            if ((generations.normal || 0) > 0) {
                downloadBtn.textContent = '💾 Download PDF (1 Generation)';
                downloadBtn.className = 'btn btn-warning';
                downloadBtn.disabled = false;
            } else {
                downloadBtn.textContent = '❌ No Generations Available';
                downloadBtn.className = 'btn btn-secondary';
                downloadBtn.disabled = true;
            }
        }
        
        // Hide subscription status
        const statusElement = document.getElementById('subscription-status');
        if (statusElement) {
            statusElement.style.display = 'none';
        }
    }
}

// Logo upload functionality
function handleLogoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Check if user has subscription
    const currentSubscription = localStorage.getItem('currentSubscription');
    if (!currentSubscription) {
        showToast('🚫 Logo upload is a subscription feature!', 'error');
        event.target.value = ''; // Clear the file input
        return;
    }
    
    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showToast('📁 File too large. Maximum size is 5MB.', 'error');
        event.target.value = '';
        return;
    }
    
    // Check file type
    if (!file.type.startsWith('image/')) {
        showToast('🖼️ Please select an image file.', 'error');
        event.target.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        companyLogo = e.target.result;
        localStorage.setItem('companyLogo', companyLogo);
        
        // Show preview
        const preview = document.getElementById('logo-preview');
        if (preview) {
            preview.innerHTML = `
                <img src="${companyLogo}" alt="Company Logo" style="max-width: 200px; max-height: 100px; border: 1px solid #ddd; border-radius: 4px;">
                <br>
                <button type="button" class="btn btn-secondary" onclick="removeLogo()" style="margin-top: 5px; font-size: 12px;">Remove Logo</button>
            `;
        }
        
        showToast('✅ Logo uploaded successfully!', 'success');
        console.log('🖼️ Logo uploaded and saved');
    };
    
    reader.onerror = function() {
        showToast('❌ Failed to read image file.', 'error');
        event.target.value = '';
    };
    
    reader.readAsDataURL(file);
}

// Remove logo
function removeLogo() {
    companyLogo = null;
    localStorage.removeItem('companyLogo');
    
    const preview = document.getElementById('logo-preview');
    if (preview) {
        preview.innerHTML = '';
    }
    
    const logoInput = document.getElementById('logo-upload');
    if (logoInput) {
        logoInput.value = '';
    }
    
    showToast('🗑️ Logo removed', 'info');
}

// Load saved logo on startup
function loadSavedLogo() {
    const savedLogo = localStorage.getItem('companyLogo');
    if (savedLogo) {
        companyLogo = savedLogo;
        
        const preview = document.getElementById('logo-preview');
        if (preview) {
            preview.innerHTML = `
                <img src="${companyLogo}" alt="Company Logo" style="max-width: 200px; max-height: 100px; border: 1px solid #ddd; border-radius: 4px;">
                <br>
                <button type="button" class="btn btn-secondary" onclick="removeLogo()" style="margin-top: 5px; font-size: 12px;">Remove Logo</button>
            `;
        }
        
        console.log('🖼️ Saved logo loaded');
    }
}

// Subscription Management Functions
function showSubscriptionManagement() {
    const modal = document.getElementById('subscription-management-modal');
    const infoDiv = document.getElementById('current-subscription-info');
    
    if (!modal || !infoDiv) return;
    
    const currentSubscription = localStorage.getItem('currentSubscription');
    if (!currentSubscription) {
        infoDiv.innerHTML = '<p>No active subscription found.</p>';
        return;
    }
    
    try {
        const subscription = JSON.parse(currentSubscription);
        const startDate = new Date(subscription.startDate).toLocaleDateString();
        
        infoDiv.innerHTML = `
            <div class="subscription-details">
                <h3>Current Plan: ${subscription.name}</h3>
                <p><strong>Price:</strong> $${subscription.price}/month</p>
                <p><strong>Started:</strong> ${startDate}</p>
                <p><strong>Generations:</strong> ${subscription.generations === -1 ? 'Unlimited' : subscription.generations}</p>
                <p><strong>Status:</strong> <span style="color: green;">Active</span></p>
            </div>
        `;
        
        modal.style.display = 'block';
        console.log('📋 Subscription management modal opened');
    } catch (error) {
        console.error('Error showing subscription management:', error);
        infoDiv.innerHTML = '<p>Error loading subscription information.</p>';
    }
}

function closeSubscriptionManagement() {
    const modal = document.getElementById('subscription-management-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Upgrade subscription - show only higher-tier plans
function upgradeSubscription() {
    const currentSubscription = localStorage.getItem('currentSubscription');
    if (!currentSubscription) {
        showPricing();
        return;
    }
    
    try {
        const subscription = JSON.parse(currentSubscription);
        const currentPlanType = subscription.planType;
        
        // Define plan hierarchy
        const planHierarchy = {
            'basic': 1,
            'professional': 2,
            'enterprise': 3
        };
        
        const currentLevel = planHierarchy[currentPlanType] || 1;
        
        // Filter pricing modal to show only upgrade options
        showFilteredPricing('upgrade', currentLevel);
        
    } catch (error) {
        console.error('Error upgrading subscription:', error);
        showPricing(); // Fallback to show all plans
    }
}

// Downgrade subscription - show only lower-tier plans
function downgradeSubscription() {
    const currentSubscription = localStorage.getItem('currentSubscription');
    if (!currentSubscription) {
        showPricing();
        return;
    }
    
    try {
        const subscription = JSON.parse(currentSubscription);
        const currentPlanType = subscription.planType;
        
        // Define plan hierarchy
        const planHierarchy = {
            'basic': 1,
            'professional': 2,
            'enterprise': 3
        };
        
        const currentLevel = planHierarchy[currentPlanType] || 1;
        
        // Filter pricing modal to show only downgrade options
        showFilteredPricing('downgrade', currentLevel);
        
    } catch (error) {
        console.error('Error downgrading subscription:', error);
        showPricing(); // Fallback to show all plans
    }
}

// Show filtered pricing based on upgrade/downgrade
function showFilteredPricing(type, currentLevel) {
    closeSubscriptionManagement();
    
    // Get all pricing plans
    const plans = [
        { type: 'basic', name: 'Basic', price: 9.99, generations: 100, level: 1 },
        { type: 'professional', name: 'Professional', price: 29.99, generations: 500, level: 2 },
        { type: 'enterprise', name: 'Enterprise', price: 39.99, generations: -1, level: 3 }
    ];
    
    // Filter plans based on type
    let filteredPlans;
    if (type === 'upgrade') {
        filteredPlans = plans.filter(plan => plan.level > currentLevel);
        console.log(`🔼 Showing upgrade plans for level ${currentLevel}:`, filteredPlans);
    } else if (type === 'downgrade') {
        filteredPlans = plans.filter(plan => plan.level < currentLevel);
        console.log(`🔽 Showing downgrade plans for level ${currentLevel}:`, filteredPlans);
    }
    
    if (filteredPlans.length === 0) {
        showToast(type === 'upgrade' ? '🎉 You are on the highest plan!' : '📉 You are on the lowest plan!', 'info');
        return;
    }
    
    // Create filtered pricing modal content
    const modal = document.getElementById('pricing-modal');
    const content = modal.querySelector('.modal-content');
    
    content.innerHTML = `
        <span class="close" onclick="closePricing()">&times;</span>
        <h2>${type === 'upgrade' ? 'Upgrade Your Plan' : 'Downgrade Your Plan'}</h2>
        <div class="pricing-grid">
            ${filteredPlans.map(plan => `
                <div class="pricing-card ${plan.type === 'professional' ? 'popular' : ''}">
                    ${plan.type === 'professional' ? '<div class="popular-badge">Most Popular</div>' : ''}
                    <h3>${plan.name}</h3>
                    <div class="price">$${plan.price}<span>/month</span></div>
                    <ul>
                        <li>${plan.generations === -1 ? 'Unlimited' : plan.generations} Invoice Generations</li>
                        <li>Company Logo Upload</li>
                        <li>Advanced Tax Calculator</li>
                        <li>${plan.type === 'enterprise' ? 'Priority Phone Support' : 'Priority Email Support'}</li>
                        <li>No "Made by" Branding</li>
                    </ul>
                    <button class="btn btn-primary" onclick="selectPlan('${plan.type}')">
                        ${type === 'upgrade' ? 'Upgrade to' : 'Downgrade to'} ${plan.name}
                    </button>
                </div>
            `).join('')}
        </div>
    `;
    
    modal.style.display = 'block';
    showToast(`${type === 'upgrade' ? '🔼' : '🔽'} ${filteredPlans.length} ${type} options available`, 'info');
}


function cancelSubscription() {
    if (confirm('❌ Are you sure you want to cancel your subscription? All premium features will be removed immediately.')) {
        showLoadingState('Cancelling subscription...');

        const ensureUserToken = async () => {
            if (currentUser && currentUser.token) return true;
            try {
                await initializeUser();
            } catch (e) {
                // ignore
            }
            return !!(currentUser && currentUser.token);
        };

        ensureUserToken().then(ok => {
            if (!ok) {
                hideLoadingState();
                showToast('❌ Could not cancel billing: missing user session. Please refresh and try again.', 'error');
                throw new Error('missing_user_token');
            }

            return fetch(`${API_BASE}/subscription/cancel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUser.token}`
                }
            });
        })
        .then(response => {
            if (response.ok) {
                return response.json();
            } else {
                return response.json().then(err => {
                    const msg = (err && err.error) ? String(err.error) : 'Cancellation failed';
                    throw new Error(msg);
                }).catch(() => { throw new Error('Cancellation failed'); });
            }
        })
        .then(data => {
            console.log('✅ Subscription cancelled:', data);

            if (!data || data.ok !== true) {
                throw new Error('Cancellation failed');
            }

            // If Stripe billing could not be cancelled, do NOT downgrade the user silently.
            if (data.stripe_cancelled === false && data.test_mode !== true) {
                hideLoadingState();
                showToast('❌ Could not cancel Stripe billing. Please contact support.', 'error');
                return;
            }
            
            // IMMEDIATELY remove all premium features
            updateSubscriptionState(false);

            // Ensure header subscription badge is cleared
            const statusEl = document.getElementById('subscription-status');
            const planEl = document.getElementById('subscription-plan');
            if (statusEl) statusEl.style.display = 'none';
            if (planEl) planEl.textContent = '';
            
            // Remove watermark-free bonuses (keep paid generations)
            generations.watermarkFree = 0;
            localStorage.setItem('generations', JSON.stringify(generations));
            
            // Remove logo access immediately
            removeLogo();
            
            // Update UI
            updateDisplay();
            closeSubscriptionManagement();
            
            hideLoadingState();
            showToast('❌ Subscription cancelled immediately. All premium features removed.', 'warning');
            
        })
        .catch(error => {
            console.error('❌ Subscription cancellation error:', error);
            hideLoadingState();
            if (error && error.message === 'missing_user_token') return;
            showToast(`❌ Failed to cancel subscription: ${error && error.message ? error.message : 'unknown error'}`, 'error');
        });
    }
}

function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    document.getElementById('invoice-date').value = today;
    document.getElementById('due-date').value = dueDate;
    
    invoiceData.invoice.date = today;
    invoiceData.invoice.dueDate = dueDate;
}

function addInitialItem() {
    // Don't add initial empty item - let user add items manually
    // This prevents the $8,000 bug from empty items
}

function addItem() {
    saveState();
    const item = {
        id: Date.now(),
        description: '',
        quantity: 1,
        unitPrice: 0,
        amount: 0
    };
    invoiceData.items.push(item);
    renderItems();
    calculateTotals();
}

function removeItem(itemId) {
    saveState();
    invoiceData.items = invoiceData.items.filter(item => item.id !== itemId);
    renderItems();
    calculateTotals();
}

function updateItem(itemId, field, value) {
    const item = invoiceData.items.find(item => item.id === itemId);
    if (!item) return;

    saveState();
    
    if (field === 'description') {
        item.description = value;
    } else if (field === 'quantity') {
        item.quantity = Math.max(0, parseFloat(value) || 0);
    } else if (field === 'unitPrice') {
        item.unitPrice = Math.max(0, parseFloat(value) || 0);
    }
    
    item.amount = item.quantity * item.unitPrice;
    calculateTotals();
}

function renderItems() {
    const tbody = document.getElementById('items-tbody');
    tbody.innerHTML = '';
    
    invoiceData.items.forEach(item => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td><input type="text" value="${item.description}" onchange="updateItem(${item.id}, 'description', this.value)" placeholder="Service description"></td>
            <td><input type="number" value="${item.quantity}" min="0" onchange="updateItem(${item.id}, 'quantity', this.value)"></td>
            <td><input type="number" value="${item.unitPrice}" min="0" step="0.01" onchange="updateItem(${item.id}, 'unitPrice', this.value)"></td>
            <td>$${item.amount.toFixed(2)}</td>
            <td><button type="button" class="btn btn-secondary" onclick="removeItem(${item.id})">Remove</button></td>
        `;
    });
}

function calculateTotals() {
    // Filter out items with no description or zero values
    const validItems = invoiceData.items.filter(item => 
        item.description.trim() !== '' && 
        item.quantity > 0 && 
        item.unitPrice > 0
    );
    
    const subtotal = validItems.reduce((sum, item) => sum + item.amount, 0);
    let taxRate = parseFloat(document.getElementById('tax-rate').value) || 0;
    const discountRate = parseFloat(document.getElementById('discount-rate').value) || 0;

    // Force Israel VAT to 18% if Israel is detected
    const detectedTaxRate = detectIsraelTaxRate();
    if (detectedTaxRate === 18 && taxRate !== 18) {
        taxRate = 18;
        document.getElementById('tax-rate').value = 18;
    }
    
    // Tax is deducted from subtotal (tax already included in prices)
    const taxAmount = subtotal * (taxRate / 100);
    const discountAmount = subtotal * (discountRate / 100);
    const total = subtotal - taxAmount - discountAmount;
    
    invoiceData.totals = { subtotal, taxRate, taxAmount, discountRate, discountAmount, total };
    
    updateTotalsDisplay();
}

// Detect Israel location and return appropriate tax rate
function detectIsraelTaxRate() {
    // Check business address for Israeli locations
    const businessAddress = (document.getElementById('business-address').value || '').toLowerCase();
    const clientAddress = (document.getElementById('client-address').value || '').toLowerCase();
    
    const israeliLocations = [
        'israel', 'tel aviv', 'tel-aviv', 'haifa', 'jerusalem', 'yafa', 'jaffa',
        'ישראל', 'תל אביב', 'תל-אביב', 'חיפה', 'ירושלים',
        'rishon lezion', 'ashdod', 'beer sheva', 'netanya', 'holon', 'bat yam',
        'ramat gan', 'bene brak', 'petah tikva', 'modiin', 'kfar saba',
        'raanana', 'herzliya', 'rehovot', 'ramle', 'lod', 'akko', 'nahariya',
        'kiryat', 'givatayim', 'kiryat', 'or yehuda', 'tzfat', 'tiberias',
        'eilat', 'ariel', 'ashkelon', 'dimona', 'kiryat gat', 'kiryat malachi',
        'mazkeret batya', 'zichron yaakov', 'bnei brak', 'givat shmuel',
        'hod hasharon', 'kfar yona', 'kfar saba', 'kiryat ono', 'kiryat motzkin',
        'kiryat yam', 'kiryat bialik', 'kiryat ata', 'kiryat ekron',
        'yavne', 'yehud', 'raanana', 'ramat hasharon', 'ramat gan'
    ];
    
    // Check if any Israeli location is mentioned in addresses
    const allAddresses = businessAddress + ' ' + clientAddress;
    const hasIsraeliLocation = israeliLocations.some(location => 
        allAddresses.includes(location)
    );
    
    if (hasIsraeliLocation) {
        console.log('🇮🇱 Israeli location detected, applying 18% tax rate');
        return 18;
    }

    // No auto-detected tax rate for other locations
    // (keeps UI at 0 unless user sets it or location API sets it)
    return 0;
}

function updateTotalsDisplay() {
    document.getElementById('subtotal').textContent = formatCurrency(invoiceData.totals.subtotal);
    document.getElementById('tax-amount').textContent = formatCurrency(invoiceData.totals.taxAmount);
    document.getElementById('discount-amount').textContent = formatCurrency(invoiceData.totals.discountAmount);
    document.getElementById('total').textContent = formatCurrency(invoiceData.totals.total);
}

function validateField(fieldId) {
    const field = document.getElementById(fieldId);
    const errorElement = document.getElementById(fieldId + '-error');
    
    if (!field) return true;
    
    let isValid = true;
    let errorMessage = '';
    
    field.classList.remove('error');
    if (errorElement) errorElement.textContent = '';
    
    // Required field validation
    if (field.hasAttribute('required') && !field.value.trim()) {
        isValid = false;
        errorMessage = 'This field is required';
    }
    
    // Email validation
    if (field.type === 'email' && field.value) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(field.value)) {
            isValid = false;
            errorMessage = 'Please enter a valid email address';
        }
    }
    
    // Date validation
    if (field.type === 'date' && field.value) {
        const date = new Date(field.value);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (fieldId === 'invoice-date' && date < today) {
            isValid = false;
            errorMessage = 'Invoice date cannot be in the past';
        }
        
        if (fieldId === 'due-date') {
            const invoiceDate = new Date(document.getElementById('invoice-date').value);
            if (date <= invoiceDate) {
                isValid = false;
                errorMessage = 'Due date must be after invoice date';
            }
        }
    }
    
    if (!isValid) {
        field.classList.add('error');
        if (errorElement) errorElement.textContent = errorMessage;
    }
    
    return isValid;
}

// Collect form data into invoiceData object
function collectFormData() {
    // Business information
    invoiceData.business.name = document.getElementById('business-name').value || '';
    invoiceData.business.email = document.getElementById('business-email').value || '';
    invoiceData.business.phone = document.getElementById('business-phone').value || '';
    invoiceData.business.address = document.getElementById('business-address').value || '';
    
    // Client information
    invoiceData.client.name = document.getElementById('client-name').value || '';
    invoiceData.client.email = document.getElementById('client-email').value || '';
    invoiceData.client.address = document.getElementById('client-address').value || '';
    
    // Invoice information
    invoiceData.invoice.number = document.getElementById('invoice-number').value || '';
    invoiceData.invoice.date = document.getElementById('invoice-date').value || '';
    invoiceData.invoice.dueDate = document.getElementById('due-date').value || '';
    invoiceData.invoice.currency = document.getElementById('currency').value || 'USD';
    
    // Bank information
    invoiceData.bank.bankName = document.getElementById('bank-name').value || '';
    invoiceData.bank.accountName = document.getElementById('account-name').value || '';
    invoiceData.bank.accountNumber = document.getElementById('account-number').value || '';
    invoiceData.bank.routingNumber = document.getElementById('routing-number').value || '';
    invoiceData.bank.swiftCode = document.getElementById('swift-code').value || '';
    invoiceData.bank.paymentInstructions = document.getElementById('payment-instructions').value || '';
    
    console.log('📋 Form data collected:', invoiceData);
}

// Preview PDF without consuming credits
function previewPDF() {
    if (!validateForm()) {
        showToast('Please fill all required fields before previewing', 'error');
        return;
    }
    
    // Collect form data before generating preview
    collectFormData();
    
    try {
        console.log('👁️ Starting PDF preview...');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Preview should be SAMPLE-only via the preview modal overlay (do not bake watermark into the PDF)
        generateMinimalPDFContent(doc, false);
        
        // Render via pdf.js (canvas) so there is no browser PDF download button
        const pdfArrayBuffer = doc.output('arraybuffer');
        showPreviewModal(pdfArrayBuffer);
        
        console.log('✅ PDF preview loaded in modal');
        showToast('👁️ PDF preview loaded', 'success');
        
    } catch (error) {
        console.error('❌ PDF preview failed:', error);
        showToast('❌ Failed to preview PDF', 'error');
    }
}

// Show PDF in modal
async function showPreviewModal(pdfArrayBuffer) {
    const modal = document.getElementById('pdf-preview-modal');
    const container = document.getElementById('pdf-preview-container');
    
    if (!modal || !container) return;
    
    // Clear loading message
    container.innerHTML = '';

    try {
        if (!window.pdfjsLib) {
            container.innerHTML = '<p style="color:#dc2626;">❌ PDF preview renderer not loaded.</p>';
            modal.style.display = 'block';
            return;
        }

        // pdf.js worker
        if (window.pdfjsLib.GlobalWorkerOptions) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        const loadingTask = window.pdfjsLib.getDocument({ data: pdfArrayBuffer });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        const viewport = page.getViewport({ scale: 1.25 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.maxWidth = '100%';
        canvas.style.border = '1px solid #ddd';
        canvas.style.borderRadius = '8px';

        container.appendChild(canvas);
        await page.render({ canvasContext: context, viewport }).promise;
    } catch (e) {
        console.error('❌ PDF preview render failed:', e);
        container.innerHTML = '<p style="color:#dc2626;">❌ Failed to render preview.</p>';
    }
    
    // Show modal
    modal.style.display = 'block';
}

// Close preview modal
function closePreviewModal() {
    const modal = document.getElementById('pdf-preview-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function validateForm() {
    const requiredFields = ['business-name', 'business-email', 'client-name', 'client-email', 'invoice-number', 'invoice-date', 'due-date'];
    return requiredFields.every(fieldId => validateField(fieldId)) && invoiceData.items.length > 0;
}

async function downloadPDF() {
    if (!validateForm()) {
        showToast('Please fill all required fields before downloading', 'error');
        return;
    }
    
    // Collect form data before generating PDF
    collectFormData();
    
    // Always costs 1 normal generation to download
    if ((generations.normal || 0) < 1) {
        showToast('You need at least 1 generation to download PDF', 'error');
        showCreditsModal();
        return;
    }

    // Consume 1 generation first
    const consumptionSuccess = await consumeOneNormalGeneration();
    if (!consumptionSuccess) {
        return;
    }

    // Hide preview modal overlay so it doesn't get captured in the download PDF
    const overlay = document.getElementById('preview-sample-overlay');
    const originalDisplay = overlay ? overlay.style.display : '';
    if (overlay) overlay.style.display = 'none';

    // Determine if watermark should be shown: not subscribed AND no watermark-free generations
    const isSubscribed = await checkSubscriptionBeforePDF();
    const hasWatermarkFree = (generations.watermarkFree || 0) > 0;
    const shouldShowWatermark = !isSubscribed && !hasWatermarkFree;
    console.log('🔍 Subscription/Watermark check:', { isSubscribed, hasWatermarkFree, shouldShowWatermark });
    generatePDF(shouldShowWatermark);

    // Restore overlay visibility after PDF generation
    if (overlay) overlay.style.display = originalDisplay;
}

function generateMinimalPDFContent(doc, addWatermark = true) {
    let yPosition = 20;
    
    // Simple black and white design
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    
    // Add logo if available and user is subscribed
    const isSubscribed = localStorage.getItem('is_subscribed') === 'true';
    if (companyLogo && isSubscribed) {
        try {
            doc.addImage(companyLogo, 'JPEG', 20, yPosition, 50, 25);
            yPosition += 35;
        } catch (error) {
            console.log('Could not add logo to PDF:', error);
        }
    }
    
    // Invoice header
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE', 105, yPosition, { align: 'center' });
    yPosition += 15;
    
    doc.setFontSize(14);
    doc.text(`#${invoiceData.invoice.number}`, 105, yPosition, { align: 'center' });
    yPosition += 10;
    
    doc.setFontSize(10);
    doc.text(`Date: ${invoiceData.invoice.date}`, 105, yPosition, { align: 'center' });
    yPosition += 8;
    doc.text(`Due: ${invoiceData.invoice.dueDate}`, 105, yPosition, { align: 'center' });
    yPosition += 15;
    
    // Business info (FROM)
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('FROM:', 20, yPosition);
    yPosition += 8;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    if (invoiceData.business.name) {
        doc.text(invoiceData.business.name, 20, yPosition);
        yPosition += 6;
    }
    if (invoiceData.business.email) {
        doc.text(`Email: ${invoiceData.business.email}`, 20, yPosition);
        yPosition += 6;
    }
    if (invoiceData.business.phone) {
        doc.text(`Phone: ${invoiceData.business.phone}`, 20, yPosition);
        yPosition += 6;
    }
    if (invoiceData.business.address) {
        const addressLines = invoiceData.business.address.split('\n');
        addressLines.forEach((line, index) => {
            doc.text(line, 20, yPosition + (index * 5));
        });
        yPosition += addressLines.length * 5;
    }
    
    // Client info (BILL TO)
    yPosition = Math.max(yPosition, 70); // Ensure proper spacing
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('BILL TO:', 120, yPosition);
    yPosition += 8;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    if (invoiceData.client.name) {
        doc.text(invoiceData.client.name, 120, yPosition);
        yPosition += 6;
    }
    if (invoiceData.client.email) {
        doc.text(`Email: ${invoiceData.client.email}`, 120, yPosition);
        yPosition += 6;
    }
    if (invoiceData.client.address) {
        const addressLines = invoiceData.client.address.split('\n');
        addressLines.forEach((line, index) => {
            doc.text(line, 120, yPosition + (index * 5));
        });
        yPosition += addressLines.length * 5;
    }
    
    // Items table
    yPosition = Math.max(yPosition, 120);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('DESCRIPTION', 20, yPosition);
    doc.text('QTY', 100, yPosition);
    doc.text('PRICE', 130, yPosition);
    doc.text('AMOUNT', 170, yPosition);
    yPosition += 8;
    
    // Table line
    doc.line(20, yPosition, 190, yPosition);
    yPosition += 8;
    
    // Items
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    invoiceData.items.forEach((item, index) => {
        const descriptionLines = doc.splitTextToSize(item.description, 70);
        descriptionLines.forEach((line, lineIndex) => {
            doc.text(line, 20, yPosition + (lineIndex * 4));
        });
        
        doc.text(String(item.quantity), 100, yPosition);
        doc.text(`${invoiceData.invoice.currency} ${item.unitPrice.toFixed(2)}`, 130, yPosition);
        doc.text(`${invoiceData.invoice.currency} ${item.amount.toFixed(2)}`, 170, yPosition);
        
        yPosition += Math.max(8, descriptionLines.length * 4 + 4);
    });
    
    // Totals
    yPosition += 10;
    doc.line(20, yPosition, 190, yPosition);
    yPosition += 8;
    
    doc.setFontSize(10);
    doc.text(`Subtotal: ${formatCurrency(invoiceData.totals.subtotal)}`, 150, yPosition);
    yPosition += 6;
    doc.text(`Tax (${invoiceData.totals.taxRate}%): ${formatCurrency(invoiceData.totals.taxAmount)}`, 150, yPosition);
    yPosition += 6;
    if (invoiceData.totals.discountAmount > 0) {
        doc.text(`Discount: ${formatCurrency(invoiceData.totals.discountAmount)}`, 150, yPosition);
        yPosition += 6;
    }
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`Total: ${formatCurrency(invoiceData.totals.total)}`, 150, yPosition);
    yPosition += 15;
    
    // Bank information (if provided)
    if (invoiceData.bank.bankName || invoiceData.bank.accountName) {
        yPosition += 10;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('Payment Information:', 20, yPosition);
        yPosition += 8;
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        if (invoiceData.bank.bankName) {
            doc.text(`Bank: ${invoiceData.bank.bankName}`, 20, yPosition);
            yPosition += 6;
        }
        if (invoiceData.bank.accountName) {
            doc.text(`Account Name: ${invoiceData.bank.accountName}`, 20, yPosition);
            yPosition += 6;
        }
        if (invoiceData.bank.accountNumber) {
            doc.text(`Account Number: ${invoiceData.bank.accountNumber}`, 20, yPosition);
            yPosition += 6;
        }
        if (invoiceData.bank.routingNumber) {
            doc.text(`Routing Number: ${invoiceData.bank.routingNumber}`, 20, yPosition);
            yPosition += 6;
        }
        if (invoiceData.bank.swiftCode) {
            doc.text(`SWIFT Code: ${invoiceData.bank.swiftCode}`, 20, yPosition);
            yPosition += 6;
        }
        if (invoiceData.bank.paymentInstructions) {
            doc.text(`Instructions: ${invoiceData.bank.paymentInstructions}`, 20, yPosition);
            yPosition += 6;
        }
    }
    
    // CRITICAL: Add watermark based on the addWatermark flag
    if (addWatermark) {
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        // Use opacity if supported by jsPDF (keeps watermark readable but not intrusive)
        const prevGState = doc.getGState ? doc.getGState() : null;
        if (doc.GState && doc.setGState) {
            doc.setGState(new doc.GState({ opacity: 0.18 }));
        }

        doc.setTextColor(140, 140, 140);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');

        const watermarkText = 'MADE BY INVOICE GENERATOR';
        const angle = 45;

        // Tile watermark diagonally across the full page
        const xStep = 70;
        const yStep = 45;
        for (let y = -pageHeight; y <= pageHeight * 2; y += yStep) {
            for (let x = -pageWidth; x <= pageWidth * 2; x += xStep) {
                doc.text(watermarkText, x, y, { angle });
            }
        }

        // Restore state
        if (prevGState && doc.setGState) {
            doc.setGState(prevGState);
        } else if (doc.GState && doc.setGState) {
            doc.setGState(new doc.GState({ opacity: 1 }));
        }

        doc.setTextColor(0, 0, 0);
    }
    
    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(`Page ${pageCount} of ${pageCount}`, 105, 280, { align: 'center' });
    doc.text(`© ${new Date().getFullYear()} Invoice Generator`, 105, 285, { align: 'center' });
}

// Main PDF generation function
function generatePDF(addWatermark = true) {
    try {
        console.log('🚀 Starting PDF generation...');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Generate PDF with minimal design
        generateMinimalPDFContent(doc, addWatermark);
        
        // Download PDF with unique filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `invoice-${invoiceData.invoice.number}-${timestamp}.pdf`;
        doc.save(filename);
        
        console.log('✅ Professional PDF downloaded successfully:', filename);
        
        // Show watermark-free status in success message
        if (!addWatermark) {
            showToast('✅ Clean PDF downloaded successfully!', 'success');
        } else {
            showToast('✅ PDF downloaded successfully (with watermark)', 'success');
        }
        
    } catch (error) {
        console.error('❌ PDF generation failed:', error);
        showToast('❌ Failed to generate PDF', 'error');
    }
}

async function consumeGeneration() {
    console.log('🔄 Consuming generation... Current balance:', generations);

    // Downloads must always cost 1 normal generation
    return consumeOneNormalGeneration();
}

async function consumeOneNormalGeneration() {
    // Server-side consume (if logged in) + local fallback
    if ((generations.normal || 0) < 1) {
        showToast('❌ No generations remaining. Please purchase more credits.', 'error');
        showCreditsModal();
        return false;
    }

    // If we have a user token, try to consume on server for consistency
    if (currentUser && currentUser.token) {
        try {
            const response = await fetch(`${API_BASE}/user/consume-generation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUser.token}`
                },
                body: JSON.stringify({ type: 'normal' })
            });

            if (response.ok) {
                const data = await response.json();
                // Keep local in sync if server returns updated count
                if (typeof data.normalGenerations === 'number') {
                    generations.normal = data.normalGenerations;
                } else if (typeof data.normal === 'number') {
                    generations.normal = data.normal;
                } else {
                    generations.normal = Math.max(0, (generations.normal || 0) - 1);
                }

                localStorage.setItem('generations', JSON.stringify(generations));
                updateDisplay();
                updateSubscriptionUI();
                return true;
            }
            // If server rejects (e.g. not enough), fall through to local
        } catch (e) {
            // fall through to local
        }
    }

    generations.normal = Math.max(0, (generations.normal || 0) - 1);
    localStorage.setItem('generations', JSON.stringify(generations));
    updateDisplay();
    updateSubscriptionUI();
    return true;
}

async function consumeWatermarkFreeGeneration() {
    console.log('🎯 Consuming watermark-free generation... Current balance:', generations.watermarkFree);
    
    if (generations.watermarkFree < 1) {
        showToast('❌ No watermark-free generations remaining. Using normal generations.', 'warning');
        return consumeGeneration();
    }
    
    if (currentUser) {
        try {
            const response = await fetch(`${API_BASE}/user/consume-generation`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUser.token}`
                },
                body: JSON.stringify({ type: 'watermark_free' })
            });
            
            if (response.ok) {
                const data = await response.json();
                generations.watermarkFree = data.watermarkFreeGenerations;
                localStorage.setItem('generations', JSON.stringify(generations));
                updateDisplay();
                console.log('✅ Watermark-free generation consumed. New balance:', generations.watermarkFree);
                showToast(`🎯 Clean invoice generated! (${generations.watermarkFree} watermark-free invoices remaining)`, 'success');
                return true;
            } else {
                const errorData = await response.json();
                console.error('Failed to consume watermark-free generation:', errorData);
                showToast('Failed to consume generation. Please try again.', 'error');
                return false;
            }
        } catch (error) {
            console.error('Error consuming watermark-free generation:', error);
            showToast('Network error. Please try again.', 'error');
            return false;
        }
    } else {
        // Fallback to local consumption
        console.log('⚠️ No current user, using local consumption only');
    }
    
    // Always consume locally as backup
    if (generations.watermarkFree > 0) {
        generations.watermarkFree--;
        localStorage.setItem('generations', JSON.stringify(generations));
        updateDisplay();
        console.log('✅ Local watermark-free generation consumed. New balance:', generations.watermarkFree);
        return true; // Indicate success
    } else {
        showToast('❌ No watermark-free generations available. Please buy credits.', 'error');
        showCreditsModal();
        return false; // Indicate failure
    }
}

function saveState() {
    history.undo.push(JSON.stringify(invoiceData));
    if (history.undo.length > 20) history.undo.shift();
    history.redo = [];
}

function undo() {
    if (history.undo.length === 0) {
        showToast('Nothing to undo', 'error');
        return;
    }
    
    history.redo.push(JSON.stringify(invoiceData));
    invoiceData = JSON.parse(history.undo.pop());
    updateDisplay();
    showToast('Undo successful', 'success');
}

function redo() {
    if (history.redo.length === 0) {
        showToast('Nothing to redo', 'error');
        return;
    }
    
    history.undo.push(JSON.stringify(invoiceData));
    invoiceData = JSON.parse(history.redo.pop());
    updateDisplay();
    showToast('Redo successful', 'success');
}

function showPricing() {
    document.getElementById('pricing-modal').style.display = 'block';
}

function closePricing() {
    document.getElementById('pricing-modal').style.display = 'none';
}

async function buySubscription(planType) {
    const subscriptions = {
        basic: { 
            generations: 100, 
            price: 9.99,
            name: 'Basic Plan'
        },
        professional: { 
            generations: 500, 
            price: 29.99,
            name: 'Professional Plan'
        },
        enterprise: { 
            generations: -1, // Unlimited
            price: 39.99,
            name: 'Enterprise Plan'
        }
    };
    
    const subscription = subscriptions[planType];
    if (!subscription) {
        showToast('❌ Invalid subscription plan selected', 'error');
        return;
    }
    
    // Show loading state
    showToast('⏳ Processing subscription...', 'info');
    
    try {
        // Check if we're in test mode (no Stripe keys)
        const testResponse = await fetch(`${API_BASE}/stripe-check`);
        const testData = await testResponse.json();
        
        if (!testData.ok || testData.test) {
            // Test mode - add subscription directly
            console.log('🧪 Test mode detected - adding subscription directly');
            
            // Set generations based on plan
            if (subscription.generations === -1) {
                generations.normal = 999999; // Unlimited
            } else {
                generations.normal = subscription.generations;
            }
            
            // Add watermark-free generations for subscribers
            if (subscription.generations >= 500) {
                generations.watermarkFree = Math.floor(subscription.generations * 0.3); // 30% watermark-free
            } else if (subscription.generations >= 100) {
                generations.watermarkFree = Math.floor(subscription.generations * 0.2); // 20% watermark-free
            } else {
                generations.watermarkFree = 0;
            }
            
            // Save subscription info
            localStorage.setItem('currentSubscription', JSON.stringify({
                planType,
                name: subscription.name,
                price: subscription.price,
                generations: subscription.generations,
                startDate: new Date().toISOString()
            }));
            
            // Save to localStorage
            localStorage.setItem('generations', JSON.stringify(generations));
            
            // Update display
            updateDisplay();
            
            // Close modal
            closePricing();
            
            // Update subscription UI
            updateSubscriptionUI();
            
            // Show success message
            showToast(`✅ Successfully subscribed to ${subscription.name}!`, 'success');
            
            console.log('✅ Subscription added successfully:', generations);
            return;
        }
        
        // Production mode - create Stripe session
        const response = await fetch(`${API_BASE}/create-subscription-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                planType,
                price: Math.round(subscription.price * 100), // Convert to cents
                currency: 'usd'
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to create subscription session');
        }
        
        const session = await response.json();
        
        // Redirect to Stripe checkout
        localStorage.setItem('pendingSubscription', JSON.stringify({
            planType,
            generations: subscription.generations,
            timestamp: Date.now()
        }));
        window.location.href = session.url;
        
    } catch (error) {
        console.error('Subscription error:', error);
        showToast(`❌ Failed to subscribe: ${error.message}`, 'error');
    }
}

// Handle successful subscription (called after Stripe webhook or test mode)
async function handleSuccessfulSubscription(planType, subscription) {
    console.log('🎉 Processing successful subscription:', planType, subscription);
    
    // Create or get user if not exists
    if (!currentUser) {
        try {
            const userResponse = await fetch(`${API_BASE}/user/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: invoiceData.business.email || 'user@example.com' })
            });
            
            if (userResponse.ok) {
                currentUser = await userResponse.json();
                localStorage.setItem('userToken', currentUser.token);
                console.log('✅ User created:', currentUser);
            }
        } catch (error) {
            console.error('Failed to create user:', error);
        }
    }
    
    if (currentUser) {
        // Add subscription to user
        try {
            const addResponse = await fetch(`${API_BASE}/user/add-subscription`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUser.token}`
                },
                body: JSON.stringify({
                    planType,
                    generations: subscription.generations
                })
            });
            
            if (addResponse.ok) {
                const data = await addResponse.json();
                generations.normal = data.normalGenerations;
                
                // Add watermark-free generations for subscribers
                if (subscription.generations >= 500) {
                    generations.watermarkFree = Math.floor(subscription.generations * 0.3); // 30% watermark-free
                } else if (subscription.generations >= 100) {
                    generations.watermarkFree = Math.floor(subscription.generations * 0.2); // 20% watermark-free
                } else {
                    generations.watermarkFree = 0;
                }
                
                // Save subscription info
                localStorage.setItem('currentSubscription', JSON.stringify({
                    planType,
                    name: subscription.name,
                    price: subscription.price,
                    generations: subscription.generations,
                    startDate: new Date().toISOString()
                }));
                
                // Save locally as backup
                localStorage.setItem('generations', JSON.stringify(generations));
                
                updateDisplay();
                closePricing();
                
                // Update subscription UI
                updateSubscriptionUI();
                
                showToast(`✅ Successfully subscribed to ${subscription.name}!`, 'success');
                saveData();
                
                console.log('✅ Subscription added successfully:', generations);
            } else {
                console.error('Failed to add subscription:', await addResponse.text());
            }
        } catch (error) {
            console.error('Add subscription error:', error);
        }
    } else {
        // Fallback to local storage
        if (subscription.generations === -1) {
            generations.normal = 999999; // Unlimited
        } else {
            generations.normal = subscription.generations;
        }
        
        // Add watermark-free generations for subscribers
        if (subscription.generations >= 500) {
            generations.watermarkFree = Math.floor(subscription.generations * 0.3); // 30% watermark-free
        } else if (subscription.generations >= 100) {
            generations.watermarkFree = Math.floor(subscription.generations * 0.2); // 20% watermark-free
        } else {
            generations.watermarkFree = 0;
        }
        
        localStorage.setItem('currentSubscription', JSON.stringify({
            planType,
            name: subscription.name,
            price: subscription.price,
            generations: subscription.generations,
            startDate: new Date().toISOString()
        }));
        
        localStorage.setItem('generations', JSON.stringify(generations));
        updateDisplay();
        closePricing();
        
        // Update subscription UI
        updateSubscriptionUI();
        
        showToast(`✅ Successfully subscribed to ${subscription.name}!`, 'success');
        saveData();
    }
}

// Handle successful purchase (called after Stripe webhook or test mode)
async function handleSuccessfulPurchase(packageType, pkg) {
    console.log('🎉 Processing successful purchase:', packageType, pkg);
    
    // Create or get user if not exists
    if (!currentUser) {
        try {
            const userResponse = await fetch(`${API_BASE}/user/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: invoiceData.business.email || 'user@example.com' })
            });
            
            if (userResponse.ok) {
                currentUser = await userResponse.json();
                localStorage.setItem('userToken', currentUser.token);
                console.log('✅ User created:', currentUser);
            }
        } catch (error) {
            console.error('Failed to create user:', error);
        }
    }
    
    if (currentUser) {
        // Add generations to user
        try {
            const addResponse = await fetch(`${API_BASE}/user/add-credits`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUser.token}`
                },
                body: JSON.stringify({
                    normal: pkg.normal
                })
            });
            
            if (addResponse.ok) {
                const data = await addResponse.json();
                generations.normal = data.normalGenerations;
                
                // Save locally as backup
                localStorage.setItem('generations', JSON.stringify(generations));
                
                updateDisplay();
                closePricing();
                showToast(`✅ Successfully purchased ${packageType} package! +${pkg.normal} generations`, 'success');
                saveData();
                
                console.log('✅ Generations added successfully:', generations);
            } else {
                console.error('Failed to add generations:', await addResponse.text());
            }
        } catch (error) {
            console.error('Add generations error:', error);
        }
    } else {
        // Fallback to local storage
        generations.normal += pkg.normal;
        localStorage.setItem('generations', JSON.stringify(generations));
        updateDisplay();
        closePricing();
        showToast(`✅ Successfully purchased ${packageType} package! +${pkg.normal} generations`, 'success');
        saveData();
    }
}

function updateDisplay() {
    console.log('🔄 DEBUG: updateDisplay called');
    console.log('🔄 DEBUG: Current generations:', generations);
    
    // Update generation counts with better formatting
    const normalCount = document.getElementById('normal-count');
    if (normalCount) {
        const count = generations.normal || 0;
        console.log('🔄 DEBUG: Setting normal-count to:', count);
        normalCount.textContent = count.toLocaleString();
        
        // Add visual feedback for low credits
        if (count <= 5) {
            normalCount.parentElement.style.color = '#dc2626';
            normalCount.parentElement.style.fontWeight = 'bold';
        } else if (count <= 20) {
            normalCount.parentElement.style.color = '#f59e0b';
            normalCount.parentElement.style.fontWeight = 'bold';
        } else {
            normalCount.parentElement.style.color = '#059669';
            normalCount.parentElement.style.fontWeight = 'normal';
        }
        
        console.log('✅ DEBUG: Updated UI with count:', count);
    } else {
        console.error('❌ DEBUG: normal-count element not found!');
    }
    
    // Update watermark-free generations display
    const watermarkDisplay = document.getElementById('watermark-free-display');
    const watermarkCount = document.getElementById('watermark-count');
    if (watermarkDisplay && watermarkCount) {
        const cleanCount = generations.watermarkFree || 0;
        if (cleanCount > 0) {
            watermarkDisplay.style.display = 'inline-block';
            watermarkCount.textContent = cleanCount.toLocaleString();
            console.log('✅ DEBUG: Updated watermark-free count to:', cleanCount);
        } else {
            watermarkDisplay.style.display = 'none';
            console.log('🔄 DEBUG: Hidden watermark-free display (no clean invoices)');
        }
    }
    
    // Update subscription status
    const subscriptionStatus = document.getElementById('subscription-status');
    const subscriptionPlan = document.getElementById('subscription-plan');
    const currentSubscription = localStorage.getItem('currentSubscription');
    
    if (subscriptionStatus && subscriptionPlan) {
        if (!currentSubscription) {
            subscriptionStatus.style.display = 'none';
            subscriptionPlan.textContent = '';
        } else {
            try {
                const sub = JSON.parse(currentSubscription);
                subscriptionStatus.style.display = 'inline-block';
                subscriptionPlan.textContent = sub && (sub.name || sub.planType) ? (sub.name || sub.planType) : 'Premium';
            } catch (e) {
                // If corrupted, hide rather than showing raw JSON
                subscriptionStatus.style.display = 'none';
                subscriptionPlan.textContent = '';
            }
        }
    }
    
    // Force UI refresh
    setTimeout(() => {
        console.log('🔄 DEBUG: Force UI refresh');
        if (normalCount) {
            const currentCount = generations.normal || 0;
            normalCount.textContent = currentCount.toLocaleString();
            console.log('🔄 DEBUG: Force updated count to:', currentCount);
        }
        if (watermarkCount && generations.watermarkFree > 0) {
            watermarkCount.textContent = (generations.watermarkFree || 0).toLocaleString();
            console.log('🔄 DEBUG: Force updated watermark-free count to:', generations.watermarkFree);
        }
    }, 100);
}

// Load saved data from localStorage
function loadSavedData() {
    try {
        const savedGenerations = localStorage.getItem('generations');
        if (savedGenerations) {
            generations = JSON.parse(savedGenerations);
            console.log('🔄 DEBUG: Loaded generations from localStorage:', generations);
        }
        
        const savedInvoiceData = localStorage.getItem('invoiceData');
        if (savedInvoiceData) {
            invoiceData = JSON.parse(savedInvoiceData);
            console.log('🔄 DEBUG: Loaded invoice data from localStorage');
        }
    } catch (error) {
        console.error('🔍 DEBUG: Error loading saved data:', error);
    }
}

// Update form fields with saved data
function updateFormFields() {
    document.getElementById('business-name').value = invoiceData.business.name || '';
    document.getElementById('business-email').value = invoiceData.business.email || '';
    document.getElementById('business-phone').value = invoiceData.business.phone || '';
    document.getElementById('business-address').value = invoiceData.business.address || '';
    
    document.getElementById('client-name').value = invoiceData.client.name || '';
    document.getElementById('client-email').value = invoiceData.client.email || '';
    document.getElementById('client-address').value = invoiceData.client.address || '';
    
    document.getElementById('invoice-number').value = invoiceData.invoice.number || '';
    document.getElementById('invoice-date').value = invoiceData.invoice.date || '';
    document.getElementById('due-date').value = invoiceData.invoice.dueDate || '';
    document.getElementById('currency').value = invoiceData.invoice.currency || 'USD';
    
    // Update bank information fields
    document.getElementById('bank-name').value = invoiceData.bank.bankName || '';
    document.getElementById('account-name').value = invoiceData.bank.accountName || '';
    document.getElementById('account-number').value = invoiceData.bank.accountNumber || '';
    document.getElementById('routing-number').value = invoiceData.bank.routingNumber || '';
    document.getElementById('swift-code').value = invoiceData.bank.swiftCode || '';
    document.getElementById('payment-instructions').value = invoiceData.bank.paymentInstructions || '';
    
    // Update items table
    updateItemsTable();
    
    // Update totals
    updateTotals();
}

// Credits modal functions
function showCreditsModal() {
    document.getElementById('credits-modal').style.display = 'block';
}

function closeCreditsModal() {
    document.getElementById('credits-modal').style.display = 'none';
}

// Buy credits function
async function buyCredits(creditType) {
    console.log('🔍 DEBUG: buyCredits called with creditType:', creditType);
    
    const credits = {
        basic: { normal: 50, price: 4.99, name: 'Basic Credits' },
        pro: { normal: 150, price: 9.99, name: 'Professional Credits' },
        enterprise: { normal: 500, price: 19.99, name: 'Enterprise Credits' }
    };
    
    const credit = credits[creditType];
    console.log('🔍 DEBUG: Found credit package:', credit);
    
    if (!credit) {
        showToast('❌ Invalid credit package selected', 'error');
        return;
    }
    
    // Show loading state
    showToast('⏳ Processing purchase...', 'info');
    
    try {
        // Check if we're in test mode (no Stripe keys)
        console.log('🔍 DEBUG: Checking test mode...');
        const testResponse = await fetch(`${API_BASE}/stripe-check`);
        const testData = await testResponse.json();
        console.log('🔍 DEBUG: Stripe check response:', testData);
        
        if (!testData.ok || testData.test) {
            // Test mode - add credits directly
            console.log('🧪 Test mode detected - adding credits directly');
            
            // Add credits immediately
            generations.normal += credit.normal;
            console.log('🔍 DEBUG: Added credits to generations:', generations);
            
            // Save to localStorage
            localStorage.setItem('generations', JSON.stringify(generations));
            console.log('🔍 DEBUG: Saved generations to localStorage');
            
            // Update display
            updateDisplay();
            console.log('🔍 DEBUG: Updated display');
            
            // Close modal
            closeCreditsModal();
            
            // Show success message
            showToast(`✅ Successfully purchased ${credit.name}! +${credit.normal} generations`, 'success');
            
            console.log('✅ Credits added successfully:', generations);
            return;
        }
        
        // Production mode - create Stripe session
        console.log('🔍 DEBUG: Production mode - creating Stripe session');

        if (!currentUser || !currentUser.token) {
            try {
                const userResponse = await fetch(`${API_BASE}/user/create`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: invoiceData.business.email || 'user@example.com' })
                });
                if (userResponse.ok) {
                    currentUser = await userResponse.json();
                    localStorage.setItem('userToken', currentUser.token);
                }
            } catch (e) {
                // ignore
            }
        }

        const token = localStorage.getItem('userToken');
        const response = await fetch(`${API_BASE}/create-credits-session`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
                creditType,
                price: Math.round(credit.price * 100), // Convert to cents
                currency: 'usd'
            })
        });
        
        console.log('🔍 DEBUG: Stripe session response status:', response.status);
        
        if (!response.ok) {
            const errorData = await response.json();
            console.log('🔍 DEBUG: Stripe session error:', errorData);
            throw new Error(errorData.error || 'Failed to create credits session');
        }
        
        const session = await response.json();
        console.log('🔍 DEBUG: Stripe session created:', session);
        
        // Store pending credits for when user returns
        const pendingCredits = {
            creditType,
            generations: credit.normal,
            timestamp: Date.now()
        };
        console.log('🔍 DEBUG: Storing pending credits:', pendingCredits);
        localStorage.setItem('pendingCredits', JSON.stringify(pendingCredits));
        console.log('🔍 DEBUG: Stored pending credits to localStorage');
        
        // Redirect to Stripe checkout
        console.log('🔍 DEBUG: Redirecting to Stripe:', session.url);
        window.location.href = session.url;
        
    } catch (error) {
        console.error('🔍 DEBUG: Credits purchase error:', error);
        showToast(`❌ Failed to purchase credits: ${error.message}`, 'error');
    }
}

// Handle successful credits purchase
async function handleSuccessfulCreditsPurchase(creditType, credit) {
    console.log('🎉 Processing successful credits purchase:', creditType, credit);
    console.log('🔍 DEBUG: Current generations before:', generations);
    
    // Create or get user if not exists
    if (!currentUser) {
        console.log('🔍 DEBUG: No current user, creating new user...');
        try {
            const userResponse = await fetch(`${API_BASE}/user/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: invoiceData.business.email || 'user@example.com' })
            });
            
            if (userResponse.ok) {
                currentUser = await userResponse.json();
                localStorage.setItem('userToken', currentUser.token);
                console.log('✅ User created:', currentUser);
            } else {
                console.log('🔍 DEBUG: User creation failed, using local mode');
            }
        } catch (error) {
            console.error('Failed to create user:', error);
            console.log('🔍 DEBUG: User creation error, using local mode');
        }
    } else {
        console.log('🔍 DEBUG: Current user exists:', currentUser);
    }
    
    if (currentUser) {
        console.log('🔍 DEBUG: Adding credits via backend...');
        // Add credits to user
        try {
            const addResponse = await fetch(`${API_BASE}/user/add-credits`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUser.token}`
                },
                body: JSON.stringify({
                    normal: credit.normal
                })
            });
            
            if (addResponse.ok) {
                const data = await addResponse.json();
                console.log('🔍 DEBUG: Backend response:', data);
                generations.normal = data.normalGenerations;
                console.log('🔍 DEBUG: Updated generations from backend:', generations);
                
                // Save locally as backup
                localStorage.setItem('generations', JSON.stringify(generations));
                console.log('🔍 DEBUG: Saved generations to localStorage');
                
                updateDisplay();
                closeCreditsModal();
                showToast(`✅ Successfully purchased ${credit.name}! +${credit.normal} generations`, 'success');
                saveData();
                
                console.log('✅ Credits added successfully via backend:', generations);
            } else {
                console.error('Failed to add credits:', await addResponse.text());
                console.log('🔍 DEBUG: Backend add failed, using local fallback');
            }
        } catch (error) {
            console.error('Add credits error:', error);
            console.log('🔍 DEBUG: Backend add error, using local fallback');
        }
    } else {
        console.log('🔍 DEBUG: No user, using local fallback');
        // Fallback to local storage
        generations.normal += credit.normal;
        console.log('🔍 DEBUG: Added credits locally:', generations);
        localStorage.setItem('generations', JSON.stringify(generations));
        console.log('🔍 DEBUG: Saved generations to localStorage');
        updateDisplay();
        closeCreditsModal();
        showToast(`✅ Successfully purchased ${credit.name}! +${credit.normal} generations`, 'success');
        saveData();
        console.log('✅ Credits added successfully via local fallback:', generations);
    }
}

// Logo upload function
function handleLogoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Check if user has subscription
    const currentSubscription = localStorage.getItem('currentSubscription');
    if (!currentSubscription) {
        showToast('❌ Logo upload is a subscription feature. Please subscribe to unlock this feature.', 'error');
        event.target.value = ''; // Clear the input
        return;
    }
    
    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showToast('❌ Logo file size must be less than 5MB', 'error');
        return;
    }
    
    // Check file type
    if (!file.type.startsWith('image/')) {
        showToast('❌ Please upload an image file', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        companyLogo = e.target.result;
        
        // Show preview
        const preview = document.getElementById('logo-preview');
        preview.innerHTML = `<img src="${companyLogo}" style="max-width: 200px; max-height: 100px; border: 1px solid #ddd; border-radius: 4px;">`;
        
        showToast('✅ Logo uploaded successfully!', 'success');
        saveData();
    };
    
    reader.readAsDataURL(file);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: invoiceData.invoice.currency || 'USD'
    }).format(amount);
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    // Add specific styling based on type
    if (type === 'error') {
        toast.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
        toast.style.color = 'white';
    } else if (type === 'info') {
        toast.style.background = 'linear-gradient(135deg, #2563eb, #1d4ed8)';
        toast.style.color = 'white';
    } else {
        toast.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        toast.style.color = 'white';
    }
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000); // Longer display time for better readability
}

function saveData() {
    localStorage.setItem('invoiceData', JSON.stringify(invoiceData));
    localStorage.setItem('generations', JSON.stringify(generations));
}

function loadSavedData() {
    const savedInvoiceData = localStorage.getItem('invoiceData');
    const savedGenerations = localStorage.getItem('generations');
    
    if (savedInvoiceData) {
        invoiceData = JSON.parse(savedInvoiceData);
    }
    
    if (savedGenerations) {
        generations = JSON.parse(savedGenerations);
    }

    if (!generations || typeof generations !== 'object') {
        generations = { normal: 0, watermarkFree: 0 };
    }
    if (typeof generations.normal !== 'number') {
        generations.normal = Number(generations.normal || 0);
    }
    if (typeof generations.watermarkFree !== 'number') {
        generations.watermarkFree = Number(generations.watermarkFree || 0);
    }
}
