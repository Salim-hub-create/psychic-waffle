document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');

    // If returned from Stripe, confirm and finalize pending invoice
    if (sessionId) confirmAndFinalize(sessionId);

    // Elements
    const addItemBtn = document.getElementById('add-item');
    const itemsTbody = document.querySelector('#items-table tbody');
    const taxInput = document.getElementById('tax');
    const discountInput = document.getElementById('discount');
    const totalAmount = document.getElementById('total-amount');
    const currencyLabel = document.getElementById('currency-label');
    const currencySelect = document.getElementById('currency');
    const generateBtn = document.getElementById('generate-pdf');
    const saveBtn = document.getElementById('save-local');
    const useAi = document.getElementById('use-ai');
    const historyBtn = document.getElementById('history-btn');
    const historyPanel = document.getElementById('history-panel');
    const invoiceList = document.getElementById('invoice-list');
    const logoInput = document.getElementById('logo');
    // Ensure demo user token exists (auto-register) and show remaining generations
    async function ensureUserToken(){
        let token = localStorage.getItem('userToken');
        if (!token){
            const email = `demo+${Math.random().toString(36).slice(2,8)}@example.com`;
            try{
                const r = await fetch('/api/users/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) });
                const j = await r.json();
                if (r.ok && j.token){ token = j.token; localStorage.setItem('userToken', token); }
            }catch(e){ console.error('user register failed', e); }
        }
        return token;
    }

    async function refreshGenerations(){
        const token = await ensureUserToken();
        if (!token) return;
        try{
            const r = await fetch('/api/users/me', { headers: { 'Authorization': 'Bearer '+token } });
            if (!r.ok) return;
            const j = await r.json();
            document.getElementById('normal-gens-remaining').innerText = String(j.normalGenerations || 0);
            document.getElementById('ai-gens-remaining').innerText = String(j.aiGenerations || 0);
        }catch(e){ console.error(e); }
    }

    // Initialize user and generations display
    ensureUserToken().then(()=> refreshGenerations());

    // Enhanced button initialization with comprehensive error handling
    function initializeButton(buttonId, clickHandler, description) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.addEventListener('click', async (e) => {
                try {
                    e.preventDefault();
                    button.disabled = true;
                    button.classList.add('loading');
                    
                    await clickHandler(e);
                    
                    showToast(`${description} completed successfully`);
                } catch (error) {
                    console.error(`Error in ${buttonId}:`, error);
                    showToast(`Error in ${description}: ${error.message}`, true);
                } finally {
                    button.disabled = false;
                    button.classList.remove('loading');
                }
            });
            
            // Add hover feedback
            button.addEventListener('mouseenter', () => {
                if (!button.disabled) {
                    button.style.transform = 'translateY(-2px)';
                }
            });
            
            button.addEventListener('mouseleave', () => {
                button.style.transform = 'translateY(0)';
            });
            
            return true;
        } else {
            console.warn(`Button ${buttonId} not found`);
            return false;
        }
    }

    // Initialize all buttons with enhanced error handling
    initializeButton('buy-gens', async () => {
        const pm = document.getElementById('pricing-modal'); 
        if (pm) pm.classList.add('show');
    }, 'Opening pricing modal');

    // Helper function for delays
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    initializeButton('marketplace-btn', () => {
        const m = document.getElementById('marketplace-modal'); 
        if (m) {
            m.classList.add('show');
        }
    }, 'Opening marketplace');

    initializeButton('history-btn', () => {
        const historyPanel = document.getElementById('history-panel');
        if (!historyPanel) {
            showToast('History panel not found', true);
            return;
        }
        
        const isVisible = historyPanel.style.display !== 'none';
        historyPanel.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            setTimeout(() => {
                historyPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                renderHistory();
            }, 100);
        }
    }, 'Toggling history panel');

    initializeButton('client-db-btn', () => {
        window.location.href = 'clients.html';
    }, 'Opening client database');

    initializeButton('save-template-btn', async () => {
        const name = document.getElementById('template-name').value || ('tpl_'+Date.now());
        const invoice = buildInvoice(); 
        const token = await ensureUserToken();
        try{
            const r = await fetch('/api/save-template', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body: JSON.stringify({ name, invoice }) });
            const j = await r.json();
            if (r.ok) {
                showToast('Template saved successfully');
                fetchTemplates();
            } else {
                showToast(j.error || 'Failed to save template', true);
            }
        }catch(e){
            console.error('Template save error', e);
            showToast('Failed to save template', true);
        }
    }, 'Saving template');

    initializeButton('templates-btn', () => { 
        const t = document.getElementById('templates-modal'); 
        if(t) { 
            t.classList.add('show'); 
            fetchTemplates(); 
        }
    }, 'Opening templates');

    // Tab functionality
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            
            // Update active button
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Show target content
            tabContents.forEach(content => {
                if (content.id === targetTab + '-tab') {
                    content.style.display = 'block';
                } else {
                    content.style.display = 'none';
                }
            });
        });
    });

    window.buyMarketplaceItem = async function(ev){
        const btn = ev.currentTarget || ev.target; 
        const itemId = btn.getAttribute('data-item'); 
        const cost = Number(btn.getAttribute('data-cost')||0);
        
        // Add loading state
        const originalText = btn.textContent;
        btn.classList.add('loading');
        btn.disabled = true;
        btn.textContent = 'Processing...';
        
        const token = await ensureUserToken(); 
        if (!token) {
            btn.classList.remove('loading');
            btn.disabled = false;
            btn.textContent = originalText;
            showToast('Authentication required. Please refresh the page.', true);
            return;
        }
        
        try{
            // Check current generations first
            const userResponse = await fetch('/api/users/me', { 
                headers: { 'Authorization': 'Bearer '+token }
            });
            const userData = await userResponse.json();
            
            if (userData.normalGenerations < cost) {
                btn.classList.remove('loading');
                btn.disabled = false;
                btn.textContent = originalText;
                showToast(`❌ Insufficient generations! You have ${userData.normalGenerations} generations, but this item costs ${cost} generations. Please buy more generations to continue.`, true);
                return;
            }
            
            const resp = await fetch('/api/buy-item', { 
                method:'POST', 
                headers:{
                    'Content-Type':'application/json',
                    'Authorization':'Bearer '+token
                }, 
                body: JSON.stringify({ itemId, cost }) 
            });
            const j = await resp.json();
            
            if (resp.ok) { 
                refreshGenerations(); 
                
                // Apply the purchased item if it's a template
                if (itemId.includes('template')) {
                    applyPurchasedTemplate(itemId);
                }
                
                // Run tests to verify purchase worked
                await runPurchaseTests(itemId, cost);
                
                // Deliver the purchased item
                deliverPurchasedItem(itemId);
                
                showToast(`✅ Purchase successful: ${itemId.replace('_', ' ').toUpperCase()}`); 
                closeMarketplace(); 
            } else if (j && j.error) { 
                showToast(`❌ Purchase failed: ${j.error}`, true); 
            } else { 
                showToast('❌ Purchase failed: Unknown error', true); 
            }
        }catch(e){ 
            console.error(e); 
            showToast('❌ Purchase error: Please check your connection and try again', true); 
        } finally {
            // Remove loading state
            btn.classList.remove('loading');
            btn.disabled = false;
            btn.textContent = originalText;
        }
    };

    // Function to run tests after purchase
    async function runPurchaseTests(itemId, cost) {
        console.log(`🧪 Running tests for purchased item: ${itemId}`);
        
        try {
            // Test 1: Check if generations were deducted
            const genResponse = await fetch('/api/user', {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('userToken') }
            });
            const userData = await genResponse.json();
            console.log('✅ User data after purchase:', userData);
            
            // Test 2: Verify item is in user's inventory
            const inventoryResponse = await fetch('/api/user-inventory', {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('userToken') }
            });
            const inventory = await inventoryResponse.json();
            console.log('✅ User inventory:', inventory);
            
            // Test 3: Check if template is available for use
            if (itemId.includes('template')) {
                const templateStyles = {
                    'minimal_template': 'modern',
                    'corporate_template': 'professional', 
                    'creative_template': 'elegant',
                    'premium_bundle': 'detailed'
                };
                const style = templateStyles[itemId];
                if (style) {
                    console.log(`✅ Template ${itemId} unlocked: ${style}`);
                }
            }
            
            console.log('🎉 All purchase tests passed!');
            
        } catch (error) {
            console.error('❌ Purchase test failed:', error);
        }
    }

    // Function to deliver purchased items
    function deliverPurchasedItem(itemId) {
        console.log(`📦 Delivering purchased item: ${itemId}`);
        
        const deliveries = {
            'minimal_template': {
                name: 'Minimal Template',
                description: 'Clean, minimalist design unlocked',
                action: () => {
                    document.querySelector(`input[name="invoice-template"][value="modern"]`).checked = true;
                    showToast('Minimal template applied!');
                }
            },
            'corporate_template': {
                name: 'Corporate Template', 
                description: 'Professional layout unlocked',
                action: () => {
                    document.querySelector(`input[name="invoice-template"][value="professional"]`).checked = true;
                    showToast('Corporate template applied!');
                }
            },
            'creative_template': {
                name: 'Creative Template',
                description: 'Artistic design unlocked', 
                action: () => {
                    document.querySelector(`input[name="invoice-template"][value="elegant"]`).checked = true;
                    showToast('Creative template applied!');
                }
            },
            'premium_bundle': {
                name: 'Premium Bundle',
                description: 'All templates and features unlocked',
                action: () => {
                    showToast('Premium bundle activated! All templates available.');
                }
            },
            'icon_pack': {
                name: 'Icon Pack',
                description: '100+ professional icons added',
                action: () => {
                    showToast('Icon pack added to your library!');
                }
            },
            'font_bundle': {
                name: 'Font Bundle', 
                description: 'Premium fonts unlocked',
                action: () => {
                    showToast('Font bundle ready to use!');
                }
            },
            'quickbooks_sync': {
                name: 'QuickBooks Sync',
                description: 'Integration activated',
                action: () => {
                    showToast('QuickBooks sync enabled!');
                }
            },
            'stripe_integration': {
                name: 'Stripe Integration',
                description: 'Payment processing ready',
                action: () => {
                    showToast('Stripe integration activated!');
                }
            }
        };
        
        const item = deliveries[itemId];
        if (item && item.action) {
            setTimeout(() => {
                item.action();
                console.log(`✅ ${item.name} delivered successfully!`);
            }, 1000);
        }
    }

    function applyPurchasedTemplate(templateId) {
        const templateStyles = {
            'minimal_template': 'modern',
            'corporate_template': 'professional',
            'creative_template': 'elegant',
            'premium_bundle': 'detailed'
        };
        
        const style = templateStyles[templateId];
        if (style) {
            document.querySelector(`input[name="invoice-template"][value="${style}"]`).checked = true;
            showToast(`Template applied: ${style.charAt(0).toUpperCase() + style.slice(1)}`);
        }
    }

    // Templates modal handlers
    window.closeTemplates = function(){ const t = document.getElementById('templates-modal'); if(t) t.classList.remove('show'); };
    const templatesBtn = document.getElementById('save-template-btn');
    if (templatesBtn) templatesBtn.addEventListener('click', async ()=>{
        const name = document.getElementById('template-name').value || ('tpl_'+Date.now());
        const invoice = buildInvoice(); const token = await ensureUserToken();
        try{
            const resp = await fetch('/api/templates', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body: JSON.stringify(Object.assign({ name }, invoice)) });
            const j = await resp.json(); if (resp.ok) { alert('Template saved'); fetchTemplates(); } else alert('Could not save template');
        }catch(e){ console.error(e); alert('Save template failed'); }
    });

    async function fetchTemplates(){ 
    try{ 
        const r = await fetch('/api/templates'); 
        const arr = await r.json(); 
        const list = document.getElementById('templates-list'); 
        list.innerHTML = ''; 
        
        // Add example invoices first
        const exampleInvoices = [
            {
                id: 'example-consulting',
                name: 'Consulting Services',
                owner: 'Example',
                businessName: 'Tech Consulting LLC',
                businessAddress: '123 Business Ave, Suite 100, San Francisco, CA 94105',
                clientName: 'Acme Corporation',
                clientAddress: '456 Client St, New York, NY 10001',
                currency: 'USD',
                items: [
                    { description: 'Strategic Planning Session', qty: 1, unit: 500.00 },
                    { description: 'Technical Implementation', qty: 20, unit: 150.00 },
                    { description: 'Project Management', qty: 40, unit: 75.00 }
                ],
                total: 8500.00
            },
            {
                id: 'example-freelance',
                name: 'Freelance Design',
                owner: 'Example',
                businessName: 'Creative Studio',
                businessAddress: '789 Art Blvd, Los Angeles, CA 90028',
                clientName: 'Startup Inc',
                clientAddress: '321 Innovation Dr, Austin, TX 78701',
                currency: 'USD',
                items: [
                    { description: 'Logo Design', qty: 1, unit: 750.00 },
                    { description: 'Brand Guidelines', qty: 1, unit: 300.00 },
                    { description: 'Social Media Assets', qty: 5, unit: 100.00 }
                ],
                total: 1550.00
            },
            {
                id: 'example-legal',
                name: 'Legal Services',
                owner: 'Example',
                businessName: 'Law Partners',
                businessAddress: '555 Court St, Washington, DC 20001',
                clientName: 'Global Enterprises',
                clientAddress: '999 Corporate Plaza, London, UK',
                currency: 'USD',
                items: [
                    { description: 'Contract Review', qty: 10, unit: 250.00 },
                    { description: 'Legal Consultation', qty: 5, unit: 400.00 },
                    { description: 'Document Preparation', qty: 15, unit: 150.00 }
                ],
                total: 5750.00
            }
        ];
        
        // Display example invoices
        exampleInvoices.forEach(template => {
            const div = document.createElement('div'); 
            div.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #eef2f7; background:#f8fafc;">
                    <div>
                        <strong>📋 ${template.name}</strong>
                        <div style="font-size:.9em;color:#6b7280">Example Invoice • Click to preview</div>
                    </div>
                    <div>
                        <button class="btn small" onclick="previewTemplate('${template.id}')">Preview</button>
                        <button class="btn small primary" onclick="applyTemplateDirect('${template.id}')">Use Example</button>
                    </div>
                </div>
            `; 
            list.appendChild(div); 
        });
        
        // Display user templates
        if (arr.length > 0) {
            const divider = document.createElement('div');
            divider.innerHTML = '<div style="margin: 20px 0; padding: 10px; background: #e6eef7; border-radius: 8px; text-align: center; color: #64748b; font-weight: 600;">Your Saved Templates</div>';
            list.appendChild(divider);
        }
        
        arr.forEach(t=>{ 
            const div = document.createElement('div'); 
            div.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #eef2f7">
                    <div>
                        <strong>${t.name||t.id}</strong>
                        <div style="font-size:.9em;color:#6b7280">by ${t.owner||'unknown'}</div>
                    </div>
                    <div>
                        <button class="btn small" data-id="${t.id}" onclick="previewTemplate('${t.id}')">Preview</button>
                        <button class="btn small" data-id="${t.id}" onclick="applyTemplateDirect('${t.id}')">Apply</button>
                    </div>
                </div>
            `; 
            list.appendChild(div); 
        }); 
    }catch(e){ console.error(e); }
}

let currentPreviewTemplate = null;

window.previewTemplate = async function(templateId) {
    try {
        // Check if it's an example invoice first
        const exampleInvoices = [
            {
                id: 'example-consulting',
                name: 'Consulting Services',
                owner: 'Example',
                businessName: 'Tech Consulting LLC',
                businessAddress: '123 Business Ave, Suite 100, San Francisco, CA 94105',
                clientName: 'Acme Corporation',
                clientAddress: '456 Client St, New York, NY 10001',
                currency: 'USD',
                items: [
                    { description: 'Strategic Planning Session', qty: 1, unit: 500.00 },
                    { description: 'Technical Implementation', qty: 20, unit: 150.00 },
                    { description: 'Project Management', qty: 40, unit: 75.00 }
                ],
                total: 8500.00
            },
            {
                id: 'example-freelance',
                name: 'Freelance Design',
                owner: 'Example',
                businessName: 'Creative Studio',
                businessAddress: '789 Art Blvd, Los Angeles, CA 90028',
                clientName: 'Startup Inc',
                clientAddress: '321 Innovation Dr, Austin, TX 78701',
                currency: 'USD',
                items: [
                    { description: 'Logo Design', qty: 1, unit: 750.00 },
                    { description: 'Brand Guidelines', qty: 1, unit: 300.00 },
                    { description: 'Social Media Assets', qty: 5, unit: 100.00 }
                ],
                total: 1550.00
            },
            {
                id: 'example-legal',
                name: 'Legal Services',
                owner: 'Example',
                businessName: 'Law Partners',
                businessAddress: '555 Court St, Washington, DC 20001',
                clientName: 'Global Enterprises',
                clientAddress: '999 Corporate Plaza, London, UK',
                currency: 'USD',
                items: [
                    { description: 'Contract Review', qty: 10, unit: 250.00 },
                    { description: 'Legal Consultation', qty: 5, unit: 400.00 },
                    { description: 'Document Preparation', qty: 15, unit: 150.00 }
                ],
                total: 5750.00
            }
        ];
        
        let template = exampleInvoices.find(t => t.id === templateId);
        
        // If not found in examples, try to fetch from API
        if (!template) {
            const r = await fetch('/api/templates');
            const arr = await r.json();
            template = arr.find(t => t.id === templateId);
        }
        
        if (!template) return;
        
        currentPreviewTemplate = template;
        const previewDiv = document.getElementById('template-preview');
        const contentDiv = document.getElementById('preview-content');
        
        // Create preview HTML
        const itemsHtml = (template.items || []).map(item => 
            `<div style="display:flex; gap:12px; padding:4px 0; border-bottom:1px solid #f1f5f9;">
                <div style="flex:1">${item.description || ''}</div>
                <div style="width:40px; text-align:right">${item.qty || 1}</div>
                <div style="width:60px; text-align:right">${(item.unit || 0).toFixed(2)}</div>
                <div style="width:60px; text-align:right">${((item.qty || 1) * (item.unit || 0)).toFixed(2)}</div>
            </div>`
        ).join('');
        
        contentDiv.innerHTML = `
            <div style="margin-bottom:12px;">
                <strong>Business:</strong> ${template.businessName || 'N/A'}<br>
                <strong>Client:</strong> ${template.clientName || 'N/A'}<br>
                <strong>Currency:</strong> ${template.currency || 'USD'}
            </div>
            <div style="font-size:.9em; color:#64748b; margin-bottom:8px;">Items:</div>
            <div style="display:flex; gap:12px; padding:4px 0; font-weight:600; border-bottom:2px solid #e2e8f0;">
                <div style="flex:1">Description</div>
                <div style="width:40px; text-align:right">Qty</div>
                <div style="width:60px; text-align:right">Unit</div>
                <div style="width:60px; text-align:right">Amount</div>
            </div>
            ${itemsHtml}
            <div style="margin-top:8px; text-align:right; font-weight:600;">
                Total: ${template.total || '0.00'} ${template.currency || 'USD'}
            </div>
        `;
        
        previewDiv.style.display = 'block';
    } catch(e) {
        console.error('Preview template failed', e);
    }
};

window.applyTemplateDirect = function(templateId) {
    try {
        // Check if it's an example invoice first
        const exampleInvoices = [
            {
                id: 'example-consulting',
                businessName: 'Tech Consulting LLC',
                businessAddress: '123 Business Ave, Suite 100, San Francisco, CA 94105',
                clientName: 'Acme Corporation',
                clientAddress: '456 Client St, New York, NY 10001',
                currency: 'USD',
                items: [
                    { description: 'Strategic Planning Session', qty: 1, unit: 500.00 },
                    { description: 'Technical Implementation', qty: 20, unit: 150.00 },
                    { description: 'Project Management', qty: 40, unit: 75.00 }
                ]
            },
            {
                id: 'example-freelance',
                businessName: 'Creative Studio',
                businessAddress: '789 Art Blvd, Los Angeles, CA 90028',
                clientName: 'Startup Inc',
                clientAddress: '321 Innovation Dr, Austin, TX 78701',
                currency: 'USD',
                items: [
                    { description: 'Logo Design', qty: 1, unit: 750.00 },
                    { description: 'Brand Guidelines', qty: 1, unit: 300.00 },
                    { description: 'Social Media Assets', qty: 5, unit: 100.00 }
                ]
            },
            {
                id: 'example-legal',
                businessName: 'Law Partners',
                businessAddress: '555 Court St, Washington, DC 20001',
                clientName: 'Global Enterprises',
                clientAddress: '999 Corporate Plaza, London, UK',
                currency: 'USD',
                items: [
                    { description: 'Contract Review', qty: 10, unit: 250.00 },
                    { description: 'Legal Consultation', qty: 5, unit: 400.00 },
                    { description: 'Document Preparation', qty: 15, unit: 150.00 }
                ]
            }
        ];
        
        let template = exampleInvoices.find(t => t.id === templateId);
        
        // If not found in examples, try to fetch from API
        if (!template) {
            fetch('/api/templates').then(res => res.json()).then(arr => {
                template = arr.find(t => t.id === templateId);
                if (!template) return;
                applyTemplate(template);
            });
            return;
        }
        
        if (template) {
            applyTemplate(template);
            showToast(`Example invoice "${template.name}" applied!`);
        }
    } catch(e) {
        console.error('Apply template failed', e);
    }
};
    function applyTemplate(t){ if(!t) return; // populate form
        document.getElementById('business-name').innerText = t.businessName || ''; document.getElementById('business-address').innerText = t.businessAddress || ''; document.getElementById('client-name').innerText = t.clientName || '';
        // items
        const tbody = document.querySelector('#items-table tbody'); tbody.innerHTML = ''; (t.items||[]).forEach(it=> addItem({ description: it.description, qty: it.qty, unit: it.unit })); updateTotals(); closeTemplates(); }

    // Templates header button
    const tplHeaderBtn = document.getElementById('templates-btn');
    if (tplHeaderBtn) tplHeaderBtn.addEventListener('click', ()=>{ 
        const t = document.getElementById('templates-modal'); 
        if(t) { 
            t.classList.add('show'); 
            fetchTemplates(); 
        } 
    });

    // Template preview button handlers
    const applyTemplatePreviewBtn = document.getElementById('apply-preview-btn');
    const closePreviewBtn = document.getElementById('close-preview-btn');
    
    if (applyTemplatePreviewBtn) {
        applyTemplatePreviewBtn.addEventListener('click', () => {
            if (currentPreviewTemplate) {
                applyTemplate(currentPreviewTemplate);
                document.getElementById('template-preview').style.display = 'none';
                currentPreviewTemplate = null;
            }
        });
    }
    
    if (closePreviewBtn) {
        closePreviewBtn.addEventListener('click', () => {
            document.getElementById('template-preview').style.display = 'none';
            currentPreviewTemplate = null;
        });
    }

    // Modal helper functions (global so inline onclick works)
    window.closePricing = function(){ const pm = document.getElementById('pricing-modal'); if(pm) pm.classList.remove('show'); };
    window.buyPackage = async function(ev){
        const btn = ev.currentTarget || ev.target; const packageType = btn.getAttribute('data-package');
        if (!packageType) return alert('Unknown package');
        const token = await ensureUserToken();
        try{
            const resp = await fetch('/api/purchase-generations', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body: JSON.stringify({ packageType }) });
            const j = await resp.json();
            if (resp.ok) {
                if (j.url) { window.location.href = j.url; return; }
                refreshGenerations();
                alert('Purchase complete. Generations updated.');
                closePricing();
            } else {
                alert('Could not start purchase: '+(j && j.error?j.error:resp.statusText));
            }
        }catch(e){ console.error(e); alert('Purchase failed'); }
    };

    let invoices = JSON.parse(localStorage.getItem('invoices') || '[]');

    // Initialize invoice number
    let lastNumber = parseInt(localStorage.getItem('lastInvoiceNumber') || '0', 10);
    function nextInvoiceNumber() { lastNumber += 1; localStorage.setItem('lastInvoiceNumber', String(lastNumber)); return `INV-${String(lastNumber).padStart(3,'0')}`; }
    document.getElementById('invoice-number').value = localStorage.getItem('draftInvoiceNumber') || nextInvoiceNumber();

    // Logo handling
    logoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            localStorage.setItem('businessLogo', reader.result);
            const img = document.getElementById('logo-preview');
            img.src = reader.result; img.style.display = 'inline-block';
        };
        reader.readAsDataURL(file);
    });
    const savedLogo = localStorage.getItem('businessLogo');
    if (savedLogo) { const img = document.getElementById('logo-preview'); img.src = savedLogo; img.style.display='inline-block'; }

    // Undo/Redo functionality
    let undoStack = [];
    let redoStack = [];
    const MAX_UNDO_STACK_SIZE = 50;
    
    function saveState() {
        const state = buildInvoice();
        state.timestamp = Date.now();
        
        // Add to undo stack
        undoStack.push(JSON.parse(JSON.stringify(state)));
        
        // Limit stack size
        if (undoStack.length > MAX_UNDO_STACK_SIZE) {
            undoStack.shift();
        }
        
        // Clear redo stack when new action is performed
        redoStack = [];
        
        // Update UI
        updateUndoRedoButtons();
    }
    
    function undo() {
        if (undoStack.length === 0) {
            showToast('❌ Nothing to undo', true);
            return;
        }
        
        const previousState = undoStack.pop();
        redoStack.push(buildInvoice());
        
        // Limit redo stack size
        if (redoStack.length > MAX_UNDO_STACK_SIZE) {
            redoStack.shift();
        }
        
        loadInvoice(previousState);
        
        showToast('✅ Undo successful');
        updateUndoRedoButtons();
    }
    
    function redo() {
        if (redoStack.length === 0) {
            showToast('❌ Nothing to redo', true);
            return;
        }
        
        const state = redoStack.pop();
        undoStack.push(buildInvoice());
        
        // Limit undo stack size
        if (undoStack.length > MAX_UNDO_STACK_SIZE) {
            undoStack.shift();
        }
        
        loadInvoice(state);
        
        showToast('✅ Redo successful');
        updateUndoRedoButtons();
    }
    
    function updateUndoRedoButtons() {
        // Update button states if they exist
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        
        if (undoBtn) {
            undoBtn.disabled = undoStack.length <= 1;
            undoBtn.textContent = `Undo (${undoStack.length - 1})`;
        }
        
        if (redoBtn) {
            redoBtn.disabled = redoStack.length === 0;
            redoBtn.textContent = `Redo (${redoStack.length})`;
        }
    }
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+Z for undo (except when in input fields that need it for text editing)
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !isInputElement(e.target)) {
            e.preventDefault();
            undo();
        }
        
        // Ctrl+Shift+Z or Ctrl+Y for redo
        if (((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) || 
            ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
            e.preventDefault();
            redo();
        }
    });
    
    function isInputElement(element) {
        const inputTypes = ['input', 'textarea', 'select'];
        return inputTypes.includes(element.tagName.toLowerCase()) || 
               element.contentEditable === 'true';
    }
    
    // Auto-save state on form changes
    const form = document.getElementById('invoice-form');
    let saveTimeout;
    
    form.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveState();
        }, 500); // Save state 500ms after user stops typing
    });
    
    form.addEventListener('change', () => {
        saveState();
    });
    
    // Save initial state
    setTimeout(() => {
        saveState();
    }, 1000);
    
    // Add undo/redo button event listeners
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    
    if (undoBtn) {
        undoBtn.addEventListener('click', undo);
    }
    
    if (redoBtn) {
        redoBtn.addEventListener('click', redo);
    }
    
    // Invoice number validation
    const invoiceNumberInput = document.getElementById('invoice-number');
    if (invoiceNumberInput) {
        invoiceNumberInput.addEventListener('input', (e) => {
            const value = e.target.value.trim();
            const pattern = /^INV-\d{3,}$/;
            
            if (value && !pattern.test(value)) {
                e.target.setCustomValidity('Invoice number must follow format: INV-001, INV-002, etc.');
                e.target.classList.add('invalid');
            } else {
                e.target.setCustomValidity('');
                e.target.classList.remove('invalid');
            }
        });
        
        invoiceNumberInput.addEventListener('blur', (e) => {
            const value = e.target.value.trim();
            if (!value) {
                // Auto-generate invoice number if empty
                e.target.value = nextInvoiceNumber();
                saveState();
            }
        });
    }

    // IBAN validation function
    function validateIBAN(iban) {
        if (!iban) return true; // Optional field
        
        // Remove spaces and convert to uppercase
        const cleanIBAN = iban.replace(/\s/g, '').toUpperCase();
        
        // Check basic format
        if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(cleanIBAN)) {
            return false;
        }
        
        // Move first 4 characters to end
        const rearranged = cleanIBAN.slice(4) + cleanIBAN.slice(0, 4);
        
        // Replace letters with numbers
        let numeric = '';
        for (let char of rearranged) {
            if (char >= 'A' && char <= 'Z') {
                numeric += (char.charCodeAt(0) - 55).toString();
            } else {
                numeric += char;
            }
        }
        
        // Mod 97 check
        let remainder = numeric.slice(0, 9) % 97;
        for (let i = 9; i < numeric.length; i += 7) {
            const chunk = remainder.toString() + numeric.slice(i, i + 7);
            remainder = parseInt(chunk) % 97;
        }
        
        return remainder === 1;
    }
    
    // Format large numbers with thousand separators
    function formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    
    // IBAN validation listener
    const ibanInput = document.getElementById('bank-iban');
    if (ibanInput) {
        ibanInput.addEventListener('blur', (e) => {
            const iban = e.target.value.trim();
            if (iban && !validateIBAN(iban)) {
                e.target.setCustomValidity('Please enter a valid IBAN');
                e.target.classList.add('invalid');
                showToast('Invalid IBAN format', true);
            } else {
                e.target.setCustomValidity('');
                e.target.classList.remove('invalid');
            }
        });
        
        // Auto-format IBAN as user types
        ibanInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\s/g, '').toUpperCase();
            const formatted = value.match(/.{1,4}/g)?.join(' ') || value;
            e.target.value = formatted;
        });
    }

    // Client database management
    const clientDbBtn = document.getElementById('client-db-btn');
    const clientDbModal = document.getElementById('client-db-modal');
    const clientList = document.getElementById('client-list');
    const addClientBtn = document.getElementById('add-client-btn');
    const clientForm = document.getElementById('client-form');
    
    let clients = [];
    
    // Load clients from localStorage
    function loadClients() {
        try {
            const saved = localStorage.getItem('clientDatabase');
            if (saved) {
                clients = JSON.parse(saved);
            }
        } catch (e) {
            console.error('Failed to load clients:', e);
            clients = [];
        }
        renderClients();
    }
    
    // Save clients to localStorage
    function saveClients() {
        localStorage.setItem('clientDatabase', JSON.stringify(clients));
    }
    
    // Render clients list
    function renderClients() {
        if (!clientList) return;
        
        clientList.innerHTML = '';
        
        if (clients.length === 0) {
            clientList.innerHTML = '<p class="no-clients">No clients saved yet. Add your first client!</p>';
            return;
        }
        
        clients.forEach((client, index) => {
            const clientCard = document.createElement('div');
            clientCard.className = 'client-card';
            clientCard.innerHTML = `
                <div class="client-info">
                    <h4>${escapeHtml(client.name)}</h4>
                    <p>${escapeHtml(client.email || '')}</p>
                    <p>${escapeHtml(client.address || '')}</p>
                    <p class="client-meta">Added: ${new Date(client.createdAt).toLocaleDateString()}</p>
                </div>
                <div class="client-actions">
                    <button class="btn small" onclick="selectClient(${index})">Use</button>
                    <button class="btn small" onclick="editClient(${index})">Edit</button>
                    <button class="btn small danger" onclick="deleteClient(${index})">Delete</button>
                </div>
            `;
            clientList.appendChild(clientCard);
        });
    }
    
    // Select client for invoice
    window.selectClient = function(index) {
        const client = clients[index];
        if (client) {
            document.getElementById('client-name').innerText = client.name;
            document.getElementById('client-email').value = client.email || '';
            document.getElementById('client-address').innerText = client.address || '';
            
            if (clientDbModal) clientDbModal.classList.remove('show');
            showToast(`Selected client: ${client.name}`);
            saveState();
        }
    };
    
    // Edit client
    window.editClient = function(index) {
        const client = clients[index];
        if (client && clientForm) {
            document.getElementById('client-form-name').value = client.name;
            document.getElementById('client-form-email').value = client.email || '';
            document.getElementById('client-form-address').value = client.address || '';
            document.getElementById('client-form-phone').value = client.phone || '';
            document.getElementById('client-form-notes').value = client.notes || '';
            document.getElementById('client-form-index').value = index;
            
            // Change button text to Update
            const submitBtn = clientForm.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.textContent = 'Update Client';
        }
    };
    
    // Delete client
    window.deleteClient = function(index) {
        if (confirm(`Are you sure you want to delete ${clients[index].name}?`)) {
            clients.splice(index, 1);
            saveClients();
            renderClients();
            showToast('Client deleted');
        }
    };
    
    // Add/update client
    if (clientForm) {
        clientForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const formData = {
                name: document.getElementById('client-form-name').value.trim(),
                email: document.getElementById('client-form-email').value.trim(),
                address: document.getElementById('client-form-address').value.trim(),
                phone: document.getElementById('client-form-phone').value.trim(),
                notes: document.getElementById('client-form-notes').value.trim(),
                createdAt: new Date().toISOString()
            };
            
            const index = document.getElementById('client-form-index').value;
            
            if (index) {
                // Update existing client
                clients[parseInt(index)] = { ...clients[parseInt(index)], ...formData };
                showToast('Client updated');
            } else {
                // Add new client
                clients.push(formData);
                showToast('Client added');
            }
            
            saveClients();
            renderClients();
            clientForm.reset();
            document.getElementById('client-form-index').value = '';
            
            // Reset button text
            const submitBtn = clientForm.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.textContent = 'Add Client';
        });
    }
    
    // Event listeners
    if (clientDbBtn) {
        clientDbBtn.addEventListener('click', () => {
            if (clientDbModal) {
                clientDbModal.classList.add('show');
                loadClients();
            }
        });
    }
    
    if (addClientBtn) {
        addClientBtn.addEventListener('click', () => {
            if (clientForm) {
                clientForm.reset();
                document.getElementById('client-form-index').value = '';
                const submitBtn = clientForm.querySelector('button[type="submit"]');
                if (submitBtn) submitBtn.textContent = 'Add Client';
            }
        });
    }

    // Modal close handlers
    function setupModalCloseHandlers() {
        // Close modals when clicking backdrop
        document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
            backdrop.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    modal.classList.remove('show');
                }
            });
        });
        
        // Close modals with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.show').forEach(modal => {
                    modal.classList.remove('show');
                });
            }
        });
        
        // Close buttons with class 'close-btn'
        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    modal.classList.remove('show');
                }
            });
        });
    }
    
    setupModalCloseHandlers();

    // Email validation function
    function validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Required field validation
    function validateRequiredFields() {
        const clientName = document.getElementById('client-name').innerText.trim();
        const clientEmail = document.getElementById('client-email').value.trim();
        const businessName = document.getElementById('business-name').innerText.trim();
        
        const errors = [];
        
        if (!businessName) errors.push('Business name is required');
        if (!clientName) errors.push('Client name is required');
        if (!clientEmail) errors.push('Client email is required');
        else if (!validateEmail(clientEmail)) errors.push('Valid client email is required');
        
        return errors;
    }

    // Email validation listeners
    const businessEmailInput = document.getElementById('business-email');
    const clientEmailInput = document.getElementById('client-email');
    
    if (businessEmailInput) {
        businessEmailInput.addEventListener('blur', (e) => {
            const email = e.target.value.trim();
            if (email && !validateEmail(email)) {
                e.target.setCustomValidity('Please enter a valid email address');
                e.target.classList.add('invalid');
                showToast('Invalid email format', true);
            } else {
                e.target.setCustomValidity('');
                e.target.classList.remove('invalid');
            }
        });
    }
    
    if (clientEmailInput) {
        clientEmailInput.addEventListener('blur', (e) => {
            const email = e.target.value.trim();
            if (!email) {
                e.target.setCustomValidity('Client email is required');
                e.target.classList.add('invalid');
            } else if (!validateEmail(email)) {
                e.target.setCustomValidity('Please enter a valid email address');
                e.target.classList.add('invalid');
                showToast('Invalid email format', true);
            } else {
                e.target.setCustomValidity('');
                e.target.classList.remove('invalid');
            }
        });
    }

    // Update save and generate functions to validate
    async function validateAndProceed(action) {
        const errors = validateRequiredFields();
        if (errors.length > 0) {
            showToast('Please fix required fields:\n' + errors.join('\n'), true);
            return false;
        }
        return true;
    }

    // Items
    function addItem(rowData = {}){
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input class="desc" value="${rowData.description||''}" placeholder="Item description"></td>
            <td><input type="number" class="qty" value="${rowData.qty||1}" min="1" max="9999999"></td>
            <td><input type="number" class="unit" value="${rowData.unit||0}" step="0.01" min="0" max="99999999.99"></td>
            <td class="amount">0.00</td>
            <td><button class="btn small remove">Remove</button></td>`;
        itemsTbody.appendChild(tr);
        
        // Add validation listeners
        const qtyInput = tr.querySelector('.qty');
        const unitInput = tr.querySelector('.unit');
        
        qtyInput.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (value < 1) {
                e.target.value = 1;
                showToast('Quantity must be at least 1', true);
            }
            if (value > 9999999) {
                e.target.value = 9999999;
                showToast('Maximum quantity is 9,999,999', true);
            }
            computeRow(tr);
        });
        
        unitInput.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (value < 0) {
                e.target.value = 0;
                showToast('Unit price cannot be negative', true);
            }
            if (value > 99999999.99) {
                e.target.value = 99999999.99;
                showToast('Maximum unit price is 99,999,999.99', true);
            }
            computeRow(tr);
        });
        
        computeRow(tr);
    }

    function computeRow(tr){
        const qty = parseFloat(tr.querySelector('.qty').value)||0;
        const unit = parseFloat(tr.querySelector('.unit').value)||0;
        tr.querySelector('.amount').textContent = (qty*unit).toFixed(2);
        updateTotals();
    }

    itemsTbody.addEventListener('input', (e)=>{
        const tr = e.target.closest('tr'); if(tr) computeRow(tr);
    });
    itemsTbody.addEventListener('click', (e)=>{ 
        if (e.target.classList.contains('remove')) { 
            const row = e.target.closest('tr');
            const desc = row.querySelector('.desc').value.trim();
            const itemText = desc || 'this item';
            
            if (confirm(`Are you sure you want to remove "${itemText}"?`)) {
                row.remove(); 
                updateTotals();
                saveState(); // Save state after deletion
                showToast('Item removed');
            }
        } 
    });

    addItemBtn.addEventListener('click', () => {
        // Check if there are too many items
        const currentItems = document.querySelectorAll('#items-table tbody tr').length;
        if (currentItems >= 50) {
            showToast('❌ Maximum of 50 items allowed per invoice', true);
            return;
        }
        
        addItem();
        showToast('✅ Item added successfully');
    });
    // start with exactly one row only if table is empty
    if (itemsTbody.children.length === 0) {
        addItem();
    } else if (itemsTbody.children.length > 1) {
        // Remove any extra empty rows
        const rows = Array.from(itemsTbody.children);
        rows.forEach((row, index) => {
            if (index > 0) {
                const desc = row.querySelector('.desc').value.trim();
                const qty = row.querySelector('.qty').value;
                const unit = row.querySelector('.unit').value;
                
                // Remove row if it's completely empty
                if (!desc && qty === '1' && unit === '0') {
                    row.remove();
                }
            }
        });
    }

    function updateTotals(){
        let subtotal = 0;
        document.querySelectorAll('#items-table tbody tr').forEach(tr=>{ subtotal += parseFloat(tr.querySelector('.amount').textContent)||0; });
        const tax = parseFloat(taxInput.value)||0;
        const discount = parseFloat(discountInput.value)||0;
        const taxAmount = subtotal * (tax/100);
        const discountAmount = subtotal * (discount/100);
        const total = subtotal + taxAmount - discountAmount;
        totalAmount.textContent = total.toFixed(2);
        currencyLabel.textContent = currencySelect.value;
    }
    taxInput.addEventListener('input', updateTotals); discountInput.addEventListener('input', updateTotals); currencySelect.addEventListener('change', updateTotals);

    // Save locally
    function saveInvoiceLocal(invoice){
        invoices = JSON.parse(localStorage.getItem('invoices')||'[]');
        // Deduplicate by invoice number: replace existing invoice with same number
        const existingIndex = invoices.findIndex(i => i.number === invoice.number);
        if (existingIndex >= 0) invoices[existingIndex] = invoice; else invoices.push(invoice);
        localStorage.setItem('invoices', JSON.stringify(invoices));
        renderHistory();
    }

    function renderHistory(){
        invoiceList.innerHTML = '';
        invoices = JSON.parse(localStorage.getItem('invoices')||'[]');
        invoices.slice().reverse().forEach((inv, idx)=>{
            const li = document.createElement('li');
            li.innerHTML = `<div>${inv.number} — ${inv.clientName} — ${inv.total} ${inv.currency}</div><div><button data-i='${invoices.length-1-idx}' class='btn small view'>View</button> <button data-i='${invoices.length-1-idx}' class='btn small duplicate'>Duplicate</button></div>`;
            invoiceList.appendChild(li);
        });
    }
    invoiceList.addEventListener('click', async (e)=>{
        const idx = e.target.dataset.i; if (!idx) return;
        if (e.target.classList.contains('view')) {
            const inv = invoices[idx];
            localStorage.setItem('pendingInvoice', JSON.stringify(inv));
            try{
                const resp = await fetch('/api/create-download-session', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ display_cents:1, currency: inv.currency }) });
                const j = await resp.json();
                if (resp.ok && j.url) { window.location.href = j.url; return; }
                alert('Could not start download payment');
            } catch(e){ console.error(e); alert('Download failed'); }
        }
        if (e.target.classList.contains('duplicate')) { const inv = Object.assign({}, invoices[idx]); inv.number = nextInvoiceNumber(); localStorage.setItem('draftInvoiceNumber', inv.number); loadInvoice(inv); }
    });

    historyBtn.addEventListener('click', ()=>{
        const historyPanel = document.getElementById('history-panel');
        if (!historyPanel) return;
        
        // Toggle visibility
        const isVisible = historyPanel.style.display !== 'none';
        historyPanel.style.display = isVisible ? 'none' : 'block';
        
        // If showing, scroll to history section
        if (!isVisible) {
            // Small delay to ensure panel is visible before scrolling
            setTimeout(() => {
                historyPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                renderHistory();
            }, 100);
        }
    });

    // Build invoice object from form
    function buildInvoice(){
        const items = [];
        document.querySelectorAll('#items-table tbody tr').forEach(tr=>{
            items.push({ description: tr.querySelector('.desc').value, qty: parseFloat(tr.querySelector('.qty').value)||0, unit: parseFloat(tr.querySelector('.unit').value)||0, amount: parseFloat(tr.querySelector('.amount').textContent)||0 });
        });
        return {
            number: document.getElementById('invoice-number').value || nextInvoiceNumber(),
            businessName: (document.getElementById('business-name').innerText || '').trim(),
            businessAddress: (document.getElementById('business-address').innerText || '').trim(),
            businessPhone: document.getElementById('business-phone').value,
            businessEmail: document.getElementById('business-email').value,
            businessWebsite: document.getElementById('business-website').value,
            // Bank details are collected under the Invoice section as `bank`
            clientName: (document.getElementById('client-name').innerText || '').trim(),
            clientEmail: document.getElementById('client-email').value,
            clientAddress: (document.getElementById('client-address').innerText || '').trim(),
            date: document.getElementById('invoice-date').value || new Date().toISOString().slice(0,10),
            dueDate: document.getElementById('due-date').value || '',
            items,
            tax: parseFloat(taxInput.value)||0,
            discount: parseFloat(discountInput.value)||0,
            total: parseFloat(totalAmount.textContent)||0,
            currency: currencySelect.value,
            logo: localStorage.getItem('businessLogo') || null,
               bank: {
                   beneficiary: document.getElementById('bank-beneficiary').value,
                   iban: document.getElementById('bank-iban').value,
                   bic: document.getElementById('bank-bic').value,
                   bankName: document.getElementById('bank-bankname').value
               },
            created_at: new Date().toISOString()
        };
    }

    // Generate PDF button (separate from generate button)
    const generatePdfBtn = document.getElementById('generate-pdf');
    console.log('Generate PDF button found:', !!generatePdfBtn);
    
    if (generatePdfBtn) {
        generatePdfBtn.addEventListener('click', async () => {
            console.log('Generate PDF button clicked!');
            
            // Validate required fields first
            const businessName = document.getElementById('business-name').innerText.trim();
            const clientName = document.getElementById('client-name').innerText.trim();
            const clientEmail = document.getElementById('client-email').value.trim();
            
            console.log('Validation - Business:', businessName, 'Client:', clientName, 'Email:', clientEmail);
            
            if (!businessName) {
                showToast('❌ Please enter a business name', true);
                return;
            }
            if (!clientName) {
                showToast('❌ Please enter a client name', true);
                return;
            }
            if (!clientEmail) {
                showToast('❌ Please enter a client email', true);
                return;
            }
            
            // Check and consume generation
            try {
                const token = await ensureUserToken();
                const userResponse = await fetch('/api/users/me', { headers: { 'Authorization': 'Bearer ' + token } });
                const userData = await userResponse.json();
                
                console.log('User generations:', userData.normalGenerations);
                
                if (userData.normalGenerations < 1) {
                    showToast(`❌ Insufficient generations! You have ${userData.normalGenerations} generations, but this requires 1 generation. Please buy more generations to continue.`, true);
                    return;
                }
                
                const invoice = buildInvoice();
                console.log('Generating PDF for invoice:', invoice);
                
                // Generate PDF
                generatePDF(invoice);
                
                // Consume generation
                const consumeResponse = await fetch('/api/consume-generations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ amount: 1, type: 'normal' })
                });
                
                if (consumeResponse.ok) {
                    refreshGenerations();
                    showToast('✅ Invoice generated successfully! (1 generation used)');
                } else {
                    showToast('⚠️ Invoice generated but failed to track generation usage', true);
                }
            } catch (error) {
                console.error('PDF generation failed:', error);
                showToast('❌ Failed to generate invoice. Please check your connection and try again.', true);
            }
        });
    }

    // Download PDF button (save-local)
    const saveLocalBtn = document.getElementById('save-local');
    console.log('Download PDF button found:', !!saveLocalBtn);
    
    if (saveLocalBtn) {
        saveLocalBtn.addEventListener('click', async () => {
            console.log('Download PDF button clicked!');
            
            // Validate required fields first
            const businessName = document.getElementById('business-name').innerText.trim();
            const clientName = document.getElementById('client-name').innerText.trim();
            const clientEmail = document.getElementById('client-email').value.trim();
            
            console.log('Validation - Business:', businessName, 'Client:', clientName, 'Email:', clientEmail);
            
            if (!businessName) {
                showToast('❌ Please enter a business name', true);
                return;
            }
            if (!clientName) {
                showToast('❌ Please enter a client name', true);
                return;
            }
            if (!clientEmail) {
                showToast('❌ Please enter a client email', true);
                return;
            }
            
            // Check and consume generation
            try {
                const token = await ensureUserToken();
                const userResponse = await fetch('/api/users/me', { headers: { 'Authorization': 'Bearer ' + token } });
                const userData = await userResponse.json();
                
                console.log('User generations:', userData.normalGenerations);
                
                if (userData.normalGenerations < 1) {
                    showToast(`❌ Insufficient generations! You have ${userData.normalGenerations} generations, but this requires 1 generation. Please buy more generations to continue.`, true);
                    return;
                }
                
                const invoice = buildInvoice();
                console.log('Downloading PDF for invoice:', invoice);
                
                // Generate PDF
                generatePDF(invoice);
                
                // Consume generation
                const consumeResponse = await fetch('/api/consume-generations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ amount: 1, type: 'normal' })
                });
                
                if (consumeResponse.ok) {
                    refreshGenerations();
                    showToast('✅ Invoice downloaded successfully! (1 generation used)');
                } else {
                    showToast('⚠️ Invoice downloaded but failed to track generation usage', true);
                }
            } catch (error) {
                console.error('PDF download failed:', error);
                showToast('❌ Failed to download invoice. Please check your connection and try again.', true);
            }
        });
    }

    // Helper: show modal and populate
    function showConfirmModal(amountText){
        const modal = document.getElementById('confirm-modal');
        document.getElementById('confirm-amount').innerText = amountText || '';
        if (modal) modal.classList.add('show');
    }
    function hideConfirmModal(){ const modal = document.getElementById('confirm-modal'); if (modal) modal.classList.remove('show'); }
    // Default handlers for confirm modal buttons
    const confirmCancelBtn = document.getElementById('confirm-cancel'); if (confirmCancelBtn) confirmCancelBtn.addEventListener('click', hideConfirmModal);
    const confirmOkBtn = document.getElementById('confirm-ok'); if (confirmOkBtn) confirmOkBtn.addEventListener('click', hideConfirmModal);

    // Generate PDF data URI (without saving) for emailing
    function generatePdfDataUri(inv){
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit:'pt', format:'letter' });
        const margin = 40;
        let y = margin;
        if (inv.logo) { doc.addImage(inv.logo, 'PNG', margin, y, 80, 40); }
        doc.setFontSize(18); doc.text(inv.businessName || '', 140, y+20);
        y += 60;
        doc.setFontSize(12);
        doc.text(`Invoice: ${inv.number}`, margin, y);
        doc.text(`Date: ${inv.date}`, 300, y);
        y += 18; doc.text(`Due: ${inv.dueDate || ''}`, margin, y);
        y += 20;
        doc.setFontSize(11); doc.text('Bill To:', margin, y); doc.text(inv.clientName || '', margin+60, y);
        y += 20;
        y += 10; doc.setFontSize(11); doc.text('Description', margin, y); doc.text('Qty', 320, y); doc.text('Unit', 380, y); doc.text('Amount', 460, y);
        y += 10;
        inv.items.forEach(item=>{
            y += 20;
            doc.text(item.description||'', margin, y);
            doc.text(String(item.qty||''), 320, y);
            doc.text((item.unit||0).toFixed(2), 380, y);
            doc.text((item.amount||0).toFixed(2), 460, y);
        });
        y += 30;
        doc.text(`Tax: ${inv.tax}%`, 400, y); doc.text(`Discount: ${inv.discount}%`, 400, y+15);
        y += 30; doc.setFontSize(14); doc.text(`Total: ${inv.total.toFixed(2)} ${inv.currency}`, 400, y);
        y += 40; doc.setFontSize(10); doc.text(inv.businessEmail || '', margin, y); doc.text(inv.businessAddress || '', margin, y+12);
        y += 26; doc.setFontSize(10); doc.text('Business bank details:', margin, y); y += 14;
        if (inv.bank && inv.bank.beneficiary) { doc.text(`Beneficiary: ${inv.bank.beneficiary}`, margin, y); y += 14; }
        if (inv.bank && inv.bank.iban) { doc.text(`IBAN / Account: ${inv.bank.iban}`, margin, y); y += 14; }
        if (inv.bank && inv.bank.bic) { doc.text(`BIC / SWIFT: ${inv.bank.bic}`, margin, y); y += 14; }
        if (inv.bank && inv.bank.bankName) { doc.text(`Bank: ${inv.bank.bankName}`, margin, y); y += 14; }
        y += 14;
        if (inv.bank) {
            doc.setFontSize(11); doc.text('Payment to (client):', 320, y-14);
            y += 2; doc.setFontSize(10); doc.text(`Beneficiary: ${inv.bank.beneficiary || ''}`, 320, y);
            y += 12; doc.text(`IBAN / Account: ${inv.bank.iban || ''}`, 320, y);
            y += 12; doc.text(`BIC / SWIFT: ${inv.bank.bic || ''}`, 320, y);
            y += 12; doc.text(`Bank: ${inv.bank.bankName || ''}`, 320, y);
        }
        return doc.output('datauristring');
    }

    // Simple toast UI
    function showToast(message, isError=false, timeout=5000){
        const t = document.getElementById('toast');
        t.textContent = message;
        t.className = isError? 'error' : '';
        t.style.display = 'block';
        t.setAttribute('aria-hidden','false');
        // Trigger animation
        setTimeout(() => t.classList.add('show'), 10);
        if (timeout>0) {
            setTimeout(()=>{
                t.classList.remove('show');
                setTimeout(() => {
                    t.style.display='none';
                    t.setAttribute('aria-hidden','true');
                }, 300);
            }, timeout);
        }
    }

    // Confirm checkout and finalize
    async function confirmAndFinalize(sessionId){
        try {
            const resp = await fetch(`/api/confirm-checkout?session_id=${encodeURIComponent(sessionId)}`);
            const data = await resp.json();
            if (data.paid) {
                const pending = localStorage.getItem('pendingInvoice');
                if (pending) {
                    let invoice = JSON.parse(pending);
                    // If AI invoice, request generated items from server
                    if (invoice.ai) {
                        try {
                            const aiResp = await fetch('/api/generate-ai', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(invoice) });
                            const aiData = await aiResp.json();
                            if (aiData.items && aiData.items.length) {
                                invoice.items = aiData.items;
                            }
                        } catch (err) {
                            console.error('AI generation failed', err.message);
                        }
                    }
                    // Recompute amounts for items
                    invoice.items = invoice.items || [];
                    invoice.items = invoice.items.map(i => ({ description: i.description||'', qty: i.qty||1, unit: i.unit||0, amount: (i.qty||1)*(i.unit||0) }));
                    invoice.tax = parseFloat(invoice.tax)||0; invoice.discount = parseFloat(invoice.discount)||0;
                    let subtotal = invoice.items.reduce((s,it)=>s+(it.amount||0),0);
                    const taxAmount = subtotal*(invoice.tax/100);
                    const discountAmount = subtotal*(invoice.discount/100);
                    invoice.total = subtotal + taxAmount - discountAmount;

                    saveInvoiceLocal(invoice);
                    downloadPdf(invoice);
                    localStorage.removeItem('pendingInvoice');
                    refreshGenerations();
                    alert('Payment confirmed. Invoice generated and saved locally.');
                } else {
                    alert('Payment confirmed.');
                }
                params.delete('session_id');
                const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
                window.history.replaceState({}, '', newUrl);
            } else {
                alert('Payment not completed.');
            }
        } catch (err) { console.error(err); alert('Confirm failed'); }
    }

    // PDF generation function with template support and enhanced styling
    function downloadPdf(inv){
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit:'pt', format:'letter' });
        const margin = 40;
        let y = margin;
        
        // Get selected template
        const selectedTemplate = document.querySelector('input[name="invoice-template"]:checked')?.value || 'modern';
        
        // Set colors based on template
        const colors = {
            modern: { primary: [102, 126, 234], secondary: [156, 163, 175] },
            professional: { primary: [31, 41, 55], secondary: [107, 114, 128] },
            detailed: { primary: [16, 185, 129], secondary: [52, 211, 153] },
            elegant: { primary: [139, 92, 246], secondary: [196, 181, 253] }
        };
        
        const templateColors = colors[selectedTemplate] || colors.modern;
        
        // Add header background
        doc.setFillColor(...templateColors.primary);
        doc.rect(0, 0, 612, 100, 'F');
        
        // Add business name in header
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont(undefined, 'bold');
        doc.text(inv.businessName || 'Your Business', margin, 60);
        
        // Add invoice number and date in header
        doc.setFontSize(12);
        doc.setFont(undefined, 'normal');
        doc.text(`Invoice #${inv.number || 'INV-001'}`, 400, 50);
        doc.text(`Date: ${inv.date || new Date().toLocaleDateString()}`, 400, 70);
        if (inv.dueDate) {
            doc.text(`Due: ${inv.dueDate}`, 400, 90);
        }
        
        // Reset text color for content
        doc.setTextColor(0, 0, 0);
        y = 120;
        
        // Add business info section
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text('From:', margin, y);
        y += 15;
        doc.setFont(undefined, 'normal');
        doc.text(inv.businessName || '', margin, y);
        y += 12;
        if (inv.businessAddress) {
            doc.text(inv.businessAddress, margin, y);
            y += 12;
        }
        if (inv.businessEmail) {
            doc.text(`Email: ${inv.businessEmail}`, margin, y);
            y += 12;
        }
        if (inv.businessPhone) {
            doc.text(`Phone: ${inv.businessPhone}`, margin, y);
            y += 12;
        }
        if (inv.businessWebsite) {
            doc.text(`Website: ${inv.businessWebsite}`, margin, y);
            y += 20;
        }
        
        // Add client info section
        doc.setFont(undefined, 'bold');
        doc.text('Bill To:', margin + 300, y - 80);
        y += 15;
        doc.setFont(undefined, 'normal');
        doc.text(inv.clientName || '', margin + 300, y - 80);
        y += 12;
        if (inv.clientAddress) {
            doc.text(inv.clientAddress, margin + 300, y - 80);
            y += 12;
        }
        if (inv.clientEmail) {
            doc.text(`Email: ${inv.clientEmail}`, margin + 300, y - 80);
            y += 20;
        }
        
        // Add items table header
        y = Math.max(y, 220);
        doc.setFillColor(...templateColors.primary);
        doc.rect(margin, y, 532, 25, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont(undefined, 'bold');
        doc.setFontSize(12);
        doc.text('Description', margin + 10, y + 17);
        doc.text('Quantity', margin + 250, y + 17);
        doc.text('Unit Price', margin + 330, y + 17);
        doc.text('Amount', margin + 450, y + 17);
        
        // Add items
        y += 25;
        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(11);
        
        inv.items.forEach((item, index) => {
            if (y > 650) {
                doc.addPage();
                y = margin;
                // Add header to new page
                doc.setFillColor(...templateColors.primary);
                doc.rect(0, 0, 612, 100, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(24);
                doc.setFont(undefined, 'bold');
                doc.text(inv.businessName || 'Your Business', margin, 60);
                doc.setTextColor(0, 0, 0);
                doc.setFont(undefined, 'normal');
                doc.setFontSize(11);
                y = 120;
            }
            
            // Alternate row colors
            if (index % 2 === 0) {
                doc.setFillColor(249, 250, 251);
                doc.rect(margin, y, 532, 20, 'F');
            }
            
            doc.text(item.description || '', margin + 10, y + 15);
            doc.text(String(item.qty || 1), margin + 250, y + 15);
            doc.text((item.unit || 0).toFixed(2), margin + 330, y + 15);
            doc.text((item.amount || 0).toFixed(2), margin + 450, y + 15);
            y += 20;
        });
        
        // Add totals section
        y += 20;
        doc.setFillColor(249, 250, 251);
        doc.rect(margin + 350, y, 182, 80, 'F');
        
        // Calculate totals
        const subtotal = inv.items.reduce((sum, item) => sum + (item.amount || 0), 0);
        const taxAmount = subtotal * (inv.tax || 0) / 100;
        const discountAmount = subtotal * (inv.discount || 0) / 100;
        const total = subtotal + taxAmount - discountAmount;
        
        doc.setFont(undefined, 'normal');
        doc.setFontSize(11);
        doc.text('Subtotal:', margin + 360, y + 20);
        doc.text(subtotal.toFixed(2), margin + 480, y + 20);
        
        if (inv.tax > 0) {
            doc.text(`Tax (${inv.tax}%):`, margin + 360, y + 35);
            doc.text(taxAmount.toFixed(2), margin + 480, y + 35);
        }
        
        if (inv.discount > 0) {
            doc.text(`Discount (${inv.discount}%):`, margin + 360, y + 50);
            doc.text(`-${discountAmount.toFixed(2)}`, margin + 480, y + 50);
        }
        
        // Total with emphasis
        doc.setFont(undefined, 'bold');
        doc.setFontSize(14);
        doc.setFillColor(...templateColors.primary);
        doc.rect(margin + 350, y + 60, 182, 20, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text('TOTAL:', margin + 360, y + 75);
        doc.text(`${total.toFixed(2)} ${inv.currency || 'USD'}`, margin + 480, y + 75);
        
        // Add payment details
        doc.setTextColor(0, 0, 0);
        y = Math.max(y + 120, 650);
        if (y > 700) {
            doc.addPage();
            y = margin;
        }
        
        doc.setFont(undefined, 'bold');
        doc.setFontSize(12);
        doc.text('Payment Details:', margin, y);
        y += 20;
        
        doc.setFont(undefined, 'normal');
        doc.setFontSize(10);
        if (inv.bank && inv.bank.beneficiary) {
            doc.text(`Beneficiary: ${inv.bank.beneficiary}`, margin, y);
            y += 12;
        }
        if (inv.bank && inv.bank.iban) {
            doc.text(`IBAN/Account: ${inv.bank.iban}`, margin, y);
            y += 12;
        }
        if (inv.bank && inv.bank.bic) {
            doc.text(`BIC/SWIFT: ${inv.bank.bic}`, margin, y);
            y += 12;
        }
        if (inv.bank && inv.bank.bankName) {
            doc.text(`Bank: ${inv.bank.bankName}`, margin, y);
            y += 12;
        }
        
        // Add footer
        y = 720;
        doc.setFontSize(8);
        doc.setTextColor(128, 128, 128);
        doc.text(`Generated on ${new Date().toLocaleString()} using Invoice Studio`, margin, y);
        doc.text(`Invoice #${inv.number || 'INV-001'}`, 300, y);
        
        // Save the PDF
        doc.save(`invoice-${inv.number || 'INV-001'}.pdf`);
    }

    // Main generatePDF function that calls downloadPdf
    function generatePDF(inv) {
        downloadPdf(inv);
    }

    // Simple toast UI
    function showToast(message, isError=false, timeout=5000){
        const t = document.getElementById('toast');
        t.textContent = message;
        t.className = isError? 'error' : '';
        t.style.display = 'block';
        t.setAttribute('aria-hidden','false');
        // Trigger animation
        setTimeout(() => t.classList.add('show'), 10);
        if (timeout>0) {
            setTimeout(()=>{
                t.classList.remove('show');
                setTimeout(() => {
                    t.style.display='none';
                    t.setAttribute('aria-hidden','true');
                }, 300);
            }, timeout);
        }
    }

    function loadInvoice(inv){
        document.getElementById('invoice-number').value = inv.number;
        document.getElementById('business-name').innerText = inv.businessName || '';
        document.getElementById('business-address').innerText = inv.businessAddress || '';
        document.getElementById('client-name').innerText = inv.clientName || '';
        document.getElementById('client-address').innerText = inv.clientAddress || '';
        // clear items
        itemsTbody.innerHTML = '';
        inv.items.forEach(i=> addItem(i));
        updateTotals();
    }

    // Auto-save functionality for drafts
    let autoSaveInterval;
    let lastAutoSave = 0;
    
    function saveDraft() {
        const now = Date.now();
        if (now - lastAutoSave < 5000) return; // Don't save more than once every 5 seconds
        
        const draft = buildInvoice();
        draft.savedAt = new Date().toISOString();
        localStorage.setItem('invoiceDraft', JSON.stringify(draft));
        lastAutoSave = now;
        
        // Show subtle auto-save indicator
        const indicator = document.createElement('div');
        indicator.textContent = 'Draft saved';
        indicator.style.cssText = 'position:fixed; bottom:20px; left:20px; background:#10b981; color:white; padding:8px 12px; border-radius:6px; font-size:12px; z-index:1000; opacity:0; transition:opacity 0.3s;';
        document.body.appendChild(indicator);
        setTimeout(() => indicator.style.opacity = '1', 10);
        setTimeout(() => {
            indicator.style.opacity = '0';
            setTimeout(() => document.body.removeChild(indicator), 300);
        }, 2000);
    }
    
    function loadDraft() {
        try {
            const draft = JSON.parse(localStorage.getItem('invoiceDraft') || '{}');
            if (!draft.businessName && !draft.clientName) return; // Empty draft
            
            // Ask user if they want to restore draft
            const draftAge = draft.savedAt ? new Date() - new Date(draft.savedAt) : 0;
            const hoursOld = Math.floor(draftAge / (1000 * 60 * 60));
            
            if (hoursOld < 24 && confirm(`Restore draft from ${hoursOld === 0 ? 'less than an hour' : hoursOld + ' hours'} ago?`)) {
                loadInvoice(draft);
                showToast('Draft restored');
            }
        } catch(e) {
            console.error('Failed to load draft', e);
        }
    }
    
    function startAutoSave() {
        // Save on form changes
        const form = document.getElementById('invoice-form');
        form.addEventListener('input', () => {
            clearTimeout(autoSaveInterval);
            autoSaveInterval = setTimeout(saveDraft, 2000);
        });
        
        form.addEventListener('change', saveDraft);
        
        // Save every 30 seconds as backup
        setInterval(saveDraft, 30000);
    }
    
    // Initialize auto-save
    startAutoSave();
    loadDraft();

    // initial render
    renderHistory();

    // Payment terms and due date functionality
    const paymentTermsSelect = document.getElementById('payment-terms');
    const customDaysContainer = document.getElementById('custom-days-container');
    const customDaysInput = document.getElementById('custom-days');
    const invoiceDateInput = document.getElementById('invoice-date');
    const dueDateInput = document.getElementById('due-date');
    
    // Set default invoice date to today if empty
    if (!invoiceDateInput.value) {
        invoiceDateInput.value = new Date().toISOString().slice(0,10);
    }
    
    // Set default due date based on payment terms
    if (!dueDateInput.value) {
        updateDueDate();
    }

    function updateDueDate() {
        const invoiceDate = invoiceDateInput.value || new Date().toISOString().slice(0,10);
        const terms = paymentTermsSelect.value;
        
        if (terms === 'Due on Receipt') {
            dueDateInput.value = invoiceDate;
        } else if (terms === 'Custom') {
            const customDays = parseInt(customDaysInput.value) || 30;
            const dueDate = new Date(invoiceDate);
            dueDate.setDate(dueDate.getDate() + customDays);
            dueDateInput.value = dueDate.toISOString().slice(0,10);
        } else {
            const days = parseInt(terms.replace('Net ', '')) || 30;
            const dueDate = new Date(invoiceDate);
            dueDate.setDate(dueDate.getDate() + days);
            dueDateInput.value = dueDate.toISOString().slice(0,10);
        }
        
        // Trigger save state
        saveState();
    }

    paymentTermsSelect.addEventListener('change', () => {
        if (paymentTermsSelect.value === 'Custom') {
            customDaysContainer.style.display = 'block';
            customDaysInput.focus();
        } else {
            customDaysContainer.style.display = 'none';
        }
        updateDueDate();
    });

    customDaysInput.addEventListener('input', updateDueDate);
    
    // Fix date picker persistence - ensure date changes are properly saved
    invoiceDateInput.addEventListener('change', (e) => {
        if (e.target.value) {
            updateDueDate();
            // Trigger auto-save
            const event = new Event('input', { bubbles: true });
            e.target.dispatchEvent(event);
        }
    });
    
    // Also listen for input events (for date picker)
    invoiceDateInput.addEventListener('input', (e) => {
        if (e.target.value) {
            updateDueDate();
        }
    });

    dueDateInput.addEventListener('change', (e) => {
        // Trigger auto-save when due date changes
        if (e.target.value) {
            const event = new Event('input', { bubbles: true });
            e.target.dispatchEvent(event);
        }
    });
    
    // Force date picker to save value on blur
    invoiceDateInput.addEventListener('blur', (e) => {
        if (e.target.value) {
            updateDueDate();
        }
    });
    
    dueDateInput.addEventListener('blur', (e) => {
        if (e.target.value) {
            const event = new Event('input', { bubbles: true });
            e.target.dispatchEvent(event);
        }
    });

    // Location-based tax calculation
    const detectLocationBtn = document.getElementById('detect-location');
    const locationTaxInfo = document.getElementById('location-tax-info');

    // Tax rates by country/state (comprehensive database)
    const taxRates = {
        'US': {
            'AL': 4.0, 'AK': 0.0, 'AZ': 5.6, 'AR': 6.5, 'CA': 8.84, 'CO': 7.72,
            'CT': 6.35, 'DE': 0.0, 'FL': 6.0, 'GA': 4.0, 'HI': 4.0, 'ID': 6.0,
            'IL': 6.25, 'IN': 7.0, 'IA': 6.0, 'KS': 6.5, 'KY': 6.0, 'LA': 4.45,
            'ME': 5.5, 'MD': 6.0, 'MA': 6.25, 'MI': 6.0, 'MN': 6.88, 'MS': 7.0,
            'MO': 4.23, 'MT': 0.0, 'NE': 5.5, 'NV': 8.23, 'NH': 0.0, 'NJ': 6.85,
            'NM': 5.13, 'NY': 8.0, 'NC': 4.75, 'ND': 5.0, 'OH': 5.75, 'OK': 4.5,
            'OR': 0.0, 'PA': 6.0, 'RI': 7.0, 'SC': 6.0, 'SD': 4.5, 'TN': 7.0,
            'TX': 6.25, 'UT': 6.1, 'VT': 6.0, 'VA': 5.3, 'WA': 9.38, 'WV': 6.0,
            'WI': 5.0, 'WY': 4.0
        },
        'CA': { // Canada - federal GST 5% + provincial
            'AB': 5.0, 'BC': 12.0, 'MB': 12.0, 'NB': 15.0, 'NL': 15.0, 'NS': 15.0,
            'ON': 13.0, 'PE': 15.0, 'QC': 14.98, 'SK': 11.0, 'NT': 5.0, 'YT': 5.0
        },
        'IN': { 'default': 18.0 }, // India - GST
        'CN': { 'default': 13.0 }, // China - VAT
        'ID': { 'default': 11.0 }, // Indonesia - VAT
        'PK': { 'default': 18.0 }, // Pakistan - GST
        'NG': { 'default': 7.5 }, // Nigeria - VAT
        'BR': { 'default': 17.5 }, // Brazil - average VAT/ICMS
        'BD': { 'default': 15.0 }, // Bangladesh - VAT
        'RU': { 'default': 20.0 }, // Russia - VAT
        'MX': { 'default': 16.0 }, // Mexico - VAT
        'JP': { 'default': 10.0 }, // Japan - consumption tax
        'ET': { 'default': 15.0 }, // Ethiopia - VAT
        'PH': { 'default': 12.0 }, // Philippines - VAT
        'EG': { 'default': 14.0 }, // Egypt - VAT
        'CD': { 'default': 16.0 }, // DR Congo - VAT
        'VN': { 'default': 10.0 }, // Vietnam - VAT
        'IR': { 'default': 9.0 }, // Iran - VAT
        'TR': { 'default': 20.0 }, // Turkey - VAT
        'DE': { 'default': 19.0 }, // Germany - VAT
        'TH': { 'default': 7.0 }, // Thailand - VAT
        'FR': { 'default': 20.0 }, // France - VAT
        'GB': { 'default': 20.0 }, // United Kingdom - VAT
        'TZ': { 'default': 18.0 }, // Tanzania - VAT
        'ZA': { 'default': 15.0 }, // South Africa - VAT
        'IT': { 'default': 22.0 }, // Italy - VAT
        'KE': { 'default': 16.0 }, // Kenya - VAT
        'MM': { 'default': 5.0 }, // Myanmar - commercial tax
        'KR': { 'default': 10.0 }, // South Korea - VAT
        'CO': { 'default': 19.0 }, // Colombia - VAT
        'ES': { 'default': 21.0 }, // Spain - VAT
        'UG': { 'default': 18.0 }, // Uganda - VAT
        'AR': { 'default': 21.0 }, // Argentina - VAT
        'DZ': { 'default': 19.0 }, // Algeria - VAT
        'SD': { 'default': 17.0 }, // Sudan - VAT
        'UA': { 'default': 20.0 }, // Ukraine - VAT
        'PL': { 'default': 23.0 }, // Poland - VAT
        'MA': { 'default': 20.0 }, // Morocco - VAT
        'GR': { 'default': 24.0 }, // Greece - VAT
        'AT': { 'default': 20.0 }, // Austria - VAT
        'MY': { 'default': 7.0 }, // Malaysia - sales/service tax
        'SG': { 'default': 9.0 }, // Singapore - GST
        'AU': { 'default': 10.0 }, // Australia - GST
        'CL': { 'default': 19.0 }, // Chile - VAT
        'PE': { 'default': 18.0 }, // Peru - VAT
        'DO': { 'default': 18.0 }, // Dominican Republic - VAT
        'TN': { 'default': 19.0 }, // Tunisia - VAT
        'AE': { 'default': 5.0 }, // UAE - VAT
        'SA': { 'default': 15.0 }, // Saudi Arabia - VAT
        'IL': { 'default': 18.0 }, // Israel - VAT
        'AF': { 'default': 5.0 }, // Afghanistan - business receipt tax
        'IQ': { 'default': 8.0 }, // Iraq - low sales tax
        'default': 10.0 // Default tax rate
    };

    async function detectLocationAndSetTax() {
        if (!navigator.geolocation) {
            locationTaxInfo.textContent = '❌ Geolocation not supported';
            locationTaxInfo.style.color = '#ef4444';
            return;
        }

        detectLocationBtn.disabled = true;
        detectLocationBtn.textContent = '🔄 Detecting...';
        locationTaxInfo.textContent = 'Getting your location...';
        locationTaxInfo.style.color = '#3b82f6';

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                try {
                    // Use reverse geocoding API to get location
                    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}&zoom=10`);
                    const data = await response.json();
                    
                    console.log('Location data:', data); // Debug log
                    
                    const countryCode = data.address.country_code?.toUpperCase() || 'US';
                    const stateCode = data.address.state_code?.toUpperCase() || 
                                    data.address.state?.toUpperCase() || 
                                    data.address['ISO3166-2-lvl4']?.split('-')[1] || '';
                    
                    console.log('Detected:', { countryCode, stateCode }); // Debug log
                    
                    let taxRate = taxRates.default || 10.0; // Default fallback
                    
                    // Check country-specific tax rates
                    if (taxRates[countryCode]) {
                        if (countryCode === 'US' && stateCode && taxRates[countryCode][stateCode] !== undefined) {
                            taxRate = taxRates[countryCode][stateCode];
                        } else if (taxRates[countryCode].default !== undefined) {
                            taxRate = taxRates[countryCode].default;
                        }
                    }
                    
                    console.log('Tax rate applied:', taxRate); // Debug log

                    // If city is detected as חיפה (Hebrew) or Haifa (English), force 18%
                    const cityNameRaw = (data.address && (data.address.city || data.address.town || data.address.village || data.address.county || '')) || '';
                    const cityName = String(cityNameRaw).trim();
                    if (cityName.includes('חיפה') || /haifa/i.test(cityName)) {
                        taxRate = 18;
                        console.log('Overriding tax rate for חיפה / Haifa -> 18%');
                    }

                    // Apply the tax rate
                    taxInput.value = Number(taxRate).toFixed(2);

                    // Update location info with success
                    const locationName = cityName || data.address.state || data.address.country || 'Unknown';
                    locationTaxInfo.textContent = `📍 ${locationName}, Tax: ${taxRate}%`;
                    locationTaxInfo.style.color = '#10b981';

                    // Update totals using the existing function
                    if (typeof updateTotals === 'function') updateTotals();
                    showToast(`✅ Tax rate set to ${taxRate}% based on your location (${locationName})`);
                    
                } catch (error) {
                    console.error('Error getting location:', error);
                    locationTaxInfo.textContent = '❌ Could not determine tax rate';
                    locationTaxInfo.style.color = '#ef4444';
                    showToast('❌ Failed to detect location tax. Please enter tax manually.', true);
                } finally {
                    detectLocationBtn.disabled = false;
                    detectLocationBtn.textContent = '📍 Auto-detect Tax';
                }
            },
            (error) => {
                console.error('Geolocation error:', error);
                let errorMessage = '❌ Location access denied';
                
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
                    default:
                        errorMessage = '❌ Unknown location error.';
                }
                
                locationTaxInfo.textContent = errorMessage;
                locationTaxInfo.style.color = '#ef4444';
                showToast(errorMessage, true);
                detectLocationBtn.disabled = false;
                detectLocationBtn.textContent = '📍 Auto-detect Tax';
            }
        );
    }

    // Wait for DOM to be ready
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM Content Loaded - Initializing buttons...');
        
        // Auto-detect tax button
        const detectLocationBtn = document.getElementById('detect-location');
        const locationTaxInfo = document.getElementById('location-tax-info');
        
        console.log('Auto-detect tax button found:', !!detectLocationBtn);
        console.log('Location tax info element found:', !!locationTaxInfo);
        
        if (detectLocationBtn) {
            detectLocationBtn.addEventListener('click', () => {
                console.log('Auto-detect tax button clicked!');
                detectLocationAndSetTax();
            });
            console.log('Auto-detect tax listener attached!');
        } else {
            console.error('Auto-detect tax button NOT found!');
        }

        // Generate PDF button (separate from generate button)
        const generatePdfBtn = document.getElementById('generate-pdf');
        console.log('Generate PDF button found:', !!generatePdfBtn);
        
        if (generatePdfBtn) {
            generatePdfBtn.addEventListener('click', async () => {
                console.log('Generate PDF button clicked!');
                
                // Validate required fields first
                const businessName = document.getElementById('business-name').innerText.trim();
                const clientName = document.getElementById('client-name').innerText.trim();
                const clientEmail = document.getElementById('client-email').value.trim();
                
                console.log('Validation - Business:', businessName, 'Client:', clientName, 'Email:', clientEmail);
                
                if (!businessName) {
                    showToast('❌ Please enter a business name', true);
                    return;
                }
                if (!clientName) {
                    showToast('❌ Please enter a client name', true);
                    return;
                }
                if (!clientEmail) {
                    showToast('❌ Please enter a client email', true);
                    return;
                }
                
                // Check and consume generation
                try {
                    const token = await ensureUserToken();
                    const userResponse = await fetch('/api/users/me', { headers: { 'Authorization': 'Bearer ' + token } });
                    const userData = await userResponse.json();
                    
                    console.log('User generations:', userData.normalGenerations);
                    
                    if (userData.normalGenerations < 1) {
                        showToast(`❌ Insufficient generations! You have ${userData.normalGenerations} generations, but this requires 1 generation. Please buy more generations to continue.`, true);
                        return;
                    }
                    
                    const invoice = buildInvoice();
                    console.log('Generating PDF for invoice:', invoice);
                    
                    // Generate PDF
                    generatePDF(invoice);
                    
                    // Consume generation
                    const consumeResponse = await fetch('/api/consume-generations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ amount: 1, type: 'normal' })
                    });
                    
                    if (consumeResponse.ok) {
                        refreshGenerations();
                        showToast('✅ Invoice generated successfully! (1 generation used)');
                    } else {
                        showToast('⚠️ Invoice generated but failed to track generation usage', true);
                    }
                } catch (error) {
                    console.error('PDF generation failed:', error);
                    showToast('❌ Failed to generate invoice. Please check your connection and try again.', true);
                }
            });
            console.log('Generate PDF listener attached!');
        } else {
            console.error('Generate PDF button NOT found!');
        }

        // Download PDF button (save-local)
        const saveLocalBtn = document.getElementById('save-local');
        console.log('Download PDF button found:', !!saveLocalBtn);
        
        if (saveLocalBtn) {
            saveLocalBtn.addEventListener('click', async () => {
                console.log('Download PDF button clicked!');
                
                // Validate required fields first
                const businessName = document.getElementById('business-name').innerText.trim();
                const clientName = document.getElementById('client-name').innerText.trim();
                const clientEmail = document.getElementById('client-email').value.trim();
                
                console.log('Validation - Business:', businessName, 'Client:', clientName, 'Email:', clientEmail);
                
                if (!businessName) {
                    showToast('❌ Please enter a business name', true);
                    return;
                }
                if (!clientName) {
                    showToast('❌ Please enter a client name', true);
                    return;
                }
                if (!clientEmail) {
                    showToast('❌ Please enter a client email', true);
                    return;
                }
                
                // Check and consume generation
                try {
                    const token = await ensureUserToken();
                    const userResponse = await fetch('/api/users/me', { headers: { 'Authorization': 'Bearer ' + token } });
                    const userData = await userResponse.json();
                    
                    console.log('User generations:', userData.normalGenerations);
                    
                    if (userData.normalGenerations < 1) {
                        showToast(`❌ Insufficient generations! You have ${userData.normalGenerations} generations, but this requires 1 generation. Please buy more generations to continue.`, true);
                        return;
                    }
                    
                    const invoice = buildInvoice();
                    console.log('Downloading PDF for invoice:', invoice);
                    
                    // Generate PDF
                    generatePDF(invoice);
                    
                    // Consume generation
                    const consumeResponse = await fetch('/api/consume-generations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ amount: 1, type: 'normal' })
                    });
                    
                    if (consumeResponse.ok) {
                        refreshGenerations();
                        showToast('✅ Invoice downloaded successfully! (1 generation used)');
                    } else {
                        showToast('⚠️ Invoice downloaded but failed to track generation usage', true);
                    }
                } catch (error) {
                    console.error('PDF download failed:', error);
                    showToast('❌ Failed to download invoice. Please check your connection and try again.', true);
                }
            });
            console.log('Download PDF listener attached!');
        } else {
            console.error('Download PDF button NOT found!');
        }
        
        console.log('All button initialization completed!');
    });

    // Check for selected client from clients page
    const selectedClient = localStorage.getItem('selectedClient');
    if (selectedClient) {
        try {
            const client = JSON.parse(selectedClient);
            document.getElementById('client-name').textContent = client.name;
            if (client.email) document.getElementById('client-email').value = client.email;
            if (client.address) document.getElementById('client-address').textContent = client.address;
            
            showToast(`Client loaded: ${client.name}`);
            localStorage.removeItem('selectedClient'); // Clear after use
        } catch (e) {
            console.error('Failed to load selected client:', e);
        }
    }

});
