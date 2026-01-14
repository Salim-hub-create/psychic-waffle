// Invoice Studio - Comprehensive JavaScript Implementation

// Global State Management
class InvoiceStudio {
    constructor() {
        this.state = {
            business: {
                name: '',
                address: '',
                phone: '',
                email: '',
                website: ''
            },
            client: {
                name: '',
                email: '',
                address: ''
            },
            invoice: {
                number: '',
                date: '',
                dueDate: '',
                paymentTerms: 'net30',
                currency: 'USD',
                template: 'modern'
            },
            bank: {
                beneficiaryName: '',
                ibanAccount: '',
                bicSwift: '',
                bankName: ''
            },
            items: [],
            totals: {
                subtotal: 0,
                taxRate: 0,
                taxAmount: 0,
                discountRate: 0,
                discountAmount: 0,
                total: 0
            },
            generations: {
                normal: 0,
                ai: 0
            }
        };
        
        this.history = {
            undoStack: [],
            redoStack: [],
            maxSize: 50
        };
        
        this.validation = {
            errors: {},
            isValid: false
        };
        
        this.templates = {
            modern: { name: 'Modern', description: 'Clean & Minimal' },
            professional: { name: 'Professional', description: 'Classic Layout' },
            detailed: { name: 'Detailed', description: 'Full Information' },
            elegant: { name: 'Elegant', description: 'Premium Design' }
        };
        
        this.isGenerating = false;
        this.pdfGenerated = false;
        
        this.init();
    }
    
    // Initialize the application
    init() {
        this.setupEventListeners();
        this.loadFromLocalStorage();
        this.updateUI();
        this.addInitialItem();
        this.setupKeyboardShortcuts();
        console.log('Invoice Studio initialized');
    }
    
    // Setup all event listeners
    setupEventListeners() {
        // Form field listeners
        this.setupFieldListeners();
        
        // Navigation buttons
        this.setupNavigationListeners();
        
        // Template selection
        this.setupTemplateListeners();
        
        // Items management
        this.setupItemsListeners();
        
        // Totals and calculations
        this.setupTotalsListeners();
        
        // Actions
        this.setupActionListeners();
        
        // Modals
        this.setupModalListeners();
    }
    
    // Setup field listeners with validation
    setupFieldListeners() {
        // Business fields
        const businessFields = ['business-name', 'business-address', 'business-phone', 'business-email', 'business-website'];
        businessFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('input', (e) => this.handleFieldChange('business', fieldId.replace('business-', ''), e.target.value));
                field.addEventListener('blur', () => this.validateField(fieldId));
            }
        });
        
        // Client fields
        const clientFields = ['client-name', 'client-email', 'client-address'];
        clientFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('input', (e) => this.handleFieldChange('client', fieldId.replace('client-', ''), e.target.value));
                field.addEventListener('blur', () => this.validateField(fieldId));
            }
        });
        
        // Invoice fields
        const invoiceFields = ['invoice-number', 'invoice-date', 'due-date', 'payment-terms', 'currency'];
        invoiceFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('change', (e) => this.handleFieldChange('invoice', this.camelCase(fieldId.replace('invoice-', '')), e.target.value));
                field.addEventListener('blur', () => this.validateField(fieldId));
            }
        });
        
        // Bank fields
        const bankFields = ['beneficiary-name', 'iban-account', 'bic-swift', 'bank-name'];
        bankFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('input', (e) => this.handleFieldChange('bank', this.camelCase(fieldId), e.target.value));
                field.addEventListener('blur', () => this.validateField(fieldId));
            }
        });
    }
    
    // Setup navigation listeners
    setupNavigationListeners() {
        const navButtons = {
            'history-btn': () => this.openModal('history-modal'),
            'clients-btn': () => this.openModal('clients-modal'),
            'save-template-btn': () => this.saveTemplate(),
            'templates-btn': () => this.openModal('templates-modal'),
            'marketplace-btn': () => this.openModal('marketplace-modal'),
            'buy-generations-btn': () => this.openModal('pricing-modal')
        };
        
        Object.entries(navButtons).forEach(([id, handler]) => {
            const button = document.getElementById(id);
            if (button) {
                button.addEventListener('click', handler);
            }
        });
    }
    
    // Setup template selection listeners
    setupTemplateListeners() {
        const templateRadios = document.querySelectorAll('input[name="invoice-template"]');
        templateRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.state.invoice.template = e.target.value;
                this.saveToLocalStorage();
                this.showToast('Template changed to ' + this.templates[e.target.value].name, 'info');
            });
        });
    }
    
    // Setup items management listeners
    setupItemsListeners() {
        const addBtn = document.getElementById('add-item-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.addItem());
        }
    }
    
    // Setup totals and calculation listeners
    setupTotalsListeners() {
        const taxRate = document.getElementById('tax-rate');
        const discountRate = document.getElementById('discount-rate');
        const autoDetectTaxBtn = document.getElementById('auto-detect-tax-btn');
        
        if (taxRate) {
            taxRate.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value) || 0;
                if (value < 0) e.target.value = 0;
                if (value > 100) e.target.value = 100;
                this.state.totals.taxRate = value;
                this.calculateTotals();
            });
        }
        
        if (discountRate) {
            discountRate.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value) || 0;
                if (value < 0) e.target.value = 0;
                if (value > 100) e.target.value = 100;
                this.state.totals.discountRate = value;
                this.calculateTotals();
            });
        }
        
        if (autoDetectTaxBtn) {
            autoDetectTaxBtn.addEventListener('click', () => this.autoDetectTax());
        }
    }
    
    // Setup action listeners
    setupActionListeners() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        const generateBtn = document.getElementById('generate-invoice-btn');
        const downloadBtn = document.getElementById('download-pdf-btn');
        
        if (undoBtn) {
            undoBtn.addEventListener('click', () => this.undo());
        }
        
        if (redoBtn) {
            redoBtn.addEventListener('click', () => this.redo());
        }
        
        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.generateInvoice());
        }
        
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadPDF());
        }
    }
    
    // Setup modal listeners
    setupModalListeners() {
        // Close modal on backdrop click
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-backdrop')) {
                this.closeAllModals();
            }
        });
        
        // Close modal on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });
        
        // Pricing package buttons
        const packageButtons = document.querySelectorAll('[data-package]');
        packageButtons.forEach(btn => {
            btn.addEventListener('click', (e) => this.buyPackage(e.target.dataset.package));
        });
    }
    
    // Setup keyboard shortcuts
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch(e.key) {
                    case 'z':
                        e.preventDefault();
                        this.undo();
                        break;
                    case 'y':
                        e.preventDefault();
                        this.redo();
                        break;
                    case 's':
                        e.preventDefault();
                        this.saveTemplate();
                        break;
                    case 'Enter':
                        e.preventDefault();
                        this.generateInvoice();
                        break;
                }
            }
        });
    }
    
    // Handle field changes with history tracking
    handleFieldChange(section, field, value) {
        this.saveState();
        this.state[section][field] = value;
        this.validateField(`${section}-${field.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
        this.saveToLocalStorage();
    }
    
    // Field validation
    validateField(fieldId) {
        const field = document.getElementById(fieldId);
        if (!field) return true;
        
        let isValid = true;
        let errorMessage = '';
        
        // Remove previous error
        field.classList.remove('error');
        const errorElement = document.getElementById(`${fieldId}-error`);
        if (errorElement) {
            errorElement.classList.remove('show');
            errorElement.textContent = '';
        }
        
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
        
        // Phone validation
        if (field.type === 'tel' && field.value) {
            const phoneRegex = /^[\d\s\-\+\(\)]+$/;
            if (!phoneRegex.test(field.value)) {
                isValid = false;
                errorMessage = 'Please enter a valid phone number';
            }
        }
        
        // URL validation
        if (field.type === 'url' && field.value) {
            try {
                new URL(field.value);
            } catch {
                isValid = false;
                errorMessage = 'Please enter a valid URL (e.g., https://example.com)';
            }
        }
        
        // Invoice number validation
        if (fieldId === 'invoice-number' && field.value) {
            const invoiceRegex = /^INV-[0-9]{3,}$/;
            if (!invoiceRegex.test(field.value)) {
                isValid = false;
                errorMessage = 'Invoice number must follow format: INV-001, INV-002, etc.';
            }
        }
        
        // IBAN validation
        if (fieldId === 'iban-account' && field.value) {
            const ibanRegex = /^[A-Z]{2}[0-9]{2}[A-Z0-9\s]{11,30}$/;
            if (!ibanRegex.test(field.value.replace(/\s/g, '').toUpperCase())) {
                isValid = false;
                errorMessage = 'Please enter a valid IBAN format';
            }
        }
        
        // BIC/SWIFT validation
        if (fieldId === 'bic-swift' && field.value) {
            const bicRegex = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
            if (!bicRegex.test(field.value.toUpperCase())) {
                isValid = false;
                errorMessage = 'Please enter a valid BIC/SWIFT code';
            }
        }
        
        // Date validation
        if ((fieldId === 'invoice-date' || fieldId === 'due-date') && field.value) {
            const date = new Date(field.value);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            if (date < today && fieldId === 'invoice-date') {
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
        
        // Show error if invalid
        if (!isValid) {
            field.classList.add('error');
            if (errorElement) {
                errorElement.textContent = errorMessage;
                errorElement.classList.add('show');
            }
        }
        
        this.validation.errors[fieldId] = isValid ? null : errorMessage;
        this.updateValidationStatus();
        
        return isValid;
    }
    
    // Update overall validation status
    updateValidationStatus() {
        const requiredFields = [
            'business-name', 'business-email', 'client-name', 'client-email', 
            'invoice-number', 'invoice-date', 'due-date'
        ];
        
        const hasErrors = Object.values(this.validation.errors).some(error => error !== null);
        const hasRequiredFields = requiredFields.every(fieldId => {
            const field = document.getElementById(fieldId);
            return field && field.value.trim();
        });
        
        const hasItems = this.state.items.length > 0;
        
        this.validation.isValid = !hasErrors && hasRequiredFields && hasItems;
        
        // Update generate button state
        const generateBtn = document.getElementById('generate-invoice-btn');
        if (generateBtn) {
            generateBtn.disabled = !this.validation.isValid || this.isGenerating;
        }
        
        // Update download button state
        const downloadBtn = document.getElementById('download-pdf-btn');
        if (downloadBtn) {
            downloadBtn.disabled = !this.pdfGenerated;
        }
    }
    
    // Items management
    addItem() {
        this.saveState();
        const item = {
            id: Date.now(),
            description: '',
            quantity: 1,
            unitPrice: 0,
            amount: 0
        };
        
        this.state.items.push(item);
        this.renderItems();
        this.calculateTotals();
        this.saveToLocalStorage();
    }
    
    removeItem(itemId) {
        this.saveState();
        this.state.items = this.state.items.filter(item => item.id !== itemId);
        this.renderItems();
        this.calculateTotals();
        this.saveToLocalStorage();
    }
    
    updateItem(itemId, field, value) {
        const item = this.state.items.find(item => item.id === itemId);
        if (!item) return;
        
        this.saveState();
        
        if (field === 'description') {
            item.description = value;
        } else if (field === 'quantity') {
            item.quantity = Math.max(0, parseFloat(value) || 0);
        } else if (field === 'unitPrice') {
            item.unitPrice = Math.max(0, parseFloat(value) || 0);
        }
        
        item.amount = item.quantity * item.unitPrice;
        this.calculateTotals();
        this.saveToLocalStorage();
    }
    
    renderItems() {
        const tbody = document.getElementById('items-tbody');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        this.state.items.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <input 
                        type="text" 
                        value="${item.description}" 
                        placeholder="Service description"
                        onchange="invoiceStudio.updateItem(${item.id}, 'description', this.value)"
                    >
                </td>
                <td>
                    <input 
                        type="number" 
                        value="${item.quantity}" 
                        min="0" 
                        step="1"
                        onchange="invoiceStudio.updateItem(${item.id}, 'quantity', this.value)"
                    >
                </td>
                <td>
                    <input 
                        type="number" 
                        value="${item.unitPrice}" 
                        min="0" 
                        step="0.01"
                        onchange="invoiceStudio.updateItem(${item.id}, 'unitPrice', this.value)"
                    >
                </td>
                <td class="amount-column">
                    $${item.amount.toFixed(2)}
                </td>
                <td class="actions-column">
                    <div class="item-actions">
                        <button 
                            type="button" 
                            class="btn btn-small btn-secondary"
                            onclick="invoiceStudio.removeItem(${item.id})"
                        >
                            🗑️
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
        
        this.updateValidationStatus();
    }
    
    // Calculate totals
    calculateTotals() {
        const subtotal = this.state.items.reduce((sum, item) => sum + item.amount, 0);
        const taxAmount = subtotal * (this.state.totals.taxRate / 100);
        const discountAmount = subtotal * (this.state.totals.discountRate / 100);
        const total = subtotal + taxAmount - discountAmount;
        
        this.state.totals = {
            ...this.state.totals,
            subtotal,
            taxAmount,
            discountAmount,
            total
        };
        
        this.updateTotalsDisplay();
    }
    
    updateTotalsDisplay() {
        const elements = {
            'subtotal-amount': this.state.totals.subtotal,
            'tax-amount': this.state.totals.taxAmount,
            'discount-amount': this.state.totals.discountAmount,
            'total-amount': this.state.totals.total
        };
        
        Object.entries(elements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = this.formatCurrency(value);
            }
        });
        
        // Update currency label
        const currencyLabel = document.getElementById('currency-label');
        if (currencyLabel) {
            currencyLabel.textContent = this.state.invoice.currency;
        }
    }
    
    // Auto-detect tax functionality
    async autoDetectTax() {
        const btn = document.getElementById('auto-detect-tax-btn');
        const taxInfo = document.getElementById('tax-info');
        
        if (!navigator.geolocation) {
            this.showToast('Geolocation is not supported by your browser', 'error');
            return;
        }
        
        btn.disabled = true;
        btn.textContent = '🔄 Detecting...';
        
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                try {
                    // Mock tax detection based on location
                    // In a real implementation, this would use a geocoding API
                    const mockTaxRates = {
                        'US': 8.25,
                        'GB': 20.0,
                        'DE': 19.0,
                        'FR': 20.0,
                        'CA': 5.0,
                        'AU': 10.0
                    };
                    
                    const detectedTax = mockTaxRates[this.state.invoice.currency] || 10.0;
                    
                    this.state.totals.taxRate = detectedTax;
                    document.getElementById('tax-rate').value = detectedTax;
                    
                    taxInfo.textContent = `Tax rate set to ${detectedTax}% based on your location`;
                    taxInfo.classList.add('show');
                    
                    this.calculateTotals();
                    this.showToast(`Tax rate detected: ${detectedTax}%`, 'success');
                    
                } catch (error) {
                    this.showToast('Failed to detect tax rate', 'error');
                } finally {
                    btn.disabled = false;
                    btn.textContent = '📍 Auto-detect Tax';
                }
            },
            (error) => {
                let errorMessage = 'Failed to detect location';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage = 'Location access denied. Please enable location services.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage = 'Location information unavailable.';
                        break;
                    case error.TIMEOUT:
                        errorMessage = 'Location request timed out.';
                        break;
                }
                
                this.showToast(errorMessage, 'error');
                btn.disabled = false;
                btn.textContent = '📍 Auto-detect Tax';
            }
        );
    }
    
    // History management
    saveState() {
        const state = JSON.stringify(this.state);
        this.history.undoStack.push(state);
        
        if (this.history.undoStack.length > this.history.maxSize) {
            this.history.undoStack.shift();
        }
        
        this.history.redoStack = [];
        this.updateHistoryButtons();
    }
    
    undo() {
        if (this.history.undoStack.length === 0) {
            this.showToast('Nothing to undo', 'warning');
            return;
        }
        
        const currentState = JSON.stringify(this.state);
        this.history.redoStack.push(currentState);
        
        const previousState = JSON.parse(this.history.undoStack.pop());
        this.state = previousState;
        
        this.updateUI();
        this.updateHistoryButtons();
        this.showToast('Undo successful', 'success');
    }
    
    redo() {
        if (this.history.redoStack.length === 0) {
            this.showToast('Nothing to redo', 'warning');
            return;
        }
        
        const currentState = JSON.stringify(this.state);
        this.history.undoStack.push(currentState);
        
        const nextState = JSON.parse(this.history.redoStack.pop());
        this.state = nextState;
        
        this.updateUI();
        this.updateHistoryButtons();
        this.showToast('Redo successful', 'success');
    }
    
    updateHistoryButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        const undoCount = document.getElementById('undo-count');
        const redoCount = document.getElementById('redo-count');
        
        if (undoBtn) undoBtn.disabled = this.history.undoStack.length === 0;
        if (redoBtn) redoBtn.disabled = this.history.redoStack.length === 0;
        if (undoCount) undoCount.textContent = this.history.undoStack.length;
        if (redoCount) redoCount.textContent = this.history.redoStack.length;
    }
    
    // Invoice generation
    async generateInvoice() {
        if (!this.validation.isValid) {
            this.showToast('Please fix validation errors before generating', 'error');
            return;
        }
        
        if (this.isGenerating) {
            return;
        }
        
        this.isGenerating = true;
        const generateBtn = document.getElementById('generate-invoice-btn');
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.textContent = '🔄 Generating...';
        }
        
        try {
            // Simulate generation process
            await this.simulateGeneration();
            
            this.pdfGenerated = true;
            this.updateValidationStatus();
            
            this.showToast('Invoice generated successfully!', 'success');
            
        } catch (error) {
            this.showToast('Failed to generate invoice', 'error');
        } finally {
            this.isGenerating = false;
            if (generateBtn) {
                generateBtn.disabled = false;
                generateBtn.textContent = '📄 Generate Invoice';
            }
        }
    }
    
    async downloadPDF() {
        if (!this.pdfGenerated) {
            this.showToast('Please generate the invoice first', 'warning');
            return;
        }
        
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            // Add content to PDF
            this.addContentToPDF(doc);
            
            // Download the PDF
            const filename = `invoice-${this.state.invoice.number}.pdf`;
            doc.save(filename);
            
            this.showToast('PDF downloaded successfully!', 'success');
            
        } catch (error) {
            this.showToast('Failed to download PDF', 'error');
        }
    }
    
    addContentToPDF(doc) {
        // Add invoice content to PDF
        // This is a simplified version - in production, you'd have proper template rendering
        
        doc.setFontSize(20);
        doc.text('INVOICE', 105, 20, { align: 'center' });
        
        doc.setFontSize(12);
        doc.text(`Invoice Number: ${this.state.invoice.number}`, 20, 40);
        doc.text(`Date: ${this.state.invoice.date}`, 20, 50);
        doc.text(`Due Date: ${this.state.invoice.dueDate}`, 20, 60);
        
        doc.text(`From: ${this.state.business.name}`, 20, 80);
        doc.text(`${this.state.business.address}`, 20, 90);
        doc.text(`Email: ${this.state.business.email}`, 20, 100);
        
        doc.text(`To: ${this.state.client.name}`, 120, 80);
        doc.text(`${this.state.client.address}`, 120, 90);
        doc.text(`Email: ${this.state.client.email}`, 120, 100);
        
        // Add items table
        let yPosition = 130;
        doc.text('Description', 20, yPosition);
        doc.text('Qty', 100, yPosition);
        doc.text('Price', 130, yPosition);
        doc.text('Amount', 160, yPosition);
        
        yPosition += 10;
        this.state.items.forEach(item => {
            doc.text(item.description, 20, yPosition);
            doc.text(item.quantity.toString(), 100, yPosition);
            doc.text(`$${item.unitPrice.toFixed(2)}`, 130, yPosition);
            doc.text(`$${item.amount.toFixed(2)}`, 160, yPosition);
            yPosition += 10;
        });
        
        // Add totals
        yPosition += 20;
        doc.text(`Subtotal: $${this.state.totals.subtotal.toFixed(2)}`, 120, yPosition);
        yPosition += 10;
        doc.text(`Tax: $${this.state.totals.taxAmount.toFixed(2)}`, 120, yPosition);
        yPosition += 10;
        doc.text(`Discount: $${this.state.totals.discountAmount.toFixed(2)}`, 120, yPosition);
        yPosition += 10;
        doc.setFontSize(14);
        doc.text(`Total: $${this.state.totals.total.toFixed(2)}`, 120, yPosition);
    }
    
    // Template management
    saveTemplate() {
        const templateName = prompt('Enter template name:');
        if (!templateName) return;
        
        const template = {
            id: Date.now(),
            name: templateName,
            data: this.state,
            createdAt: new Date().toISOString()
        };
        
        const templates = JSON.parse(localStorage.getItem('invoice-templates') || '[]');
        templates.push(template);
        localStorage.setItem('invoice-templates', JSON.stringify(templates));
        
        this.showToast('Template saved successfully!', 'success');
    }
    
    // Modal management
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.setAttribute('aria-hidden', 'false');
            modal.classList.add('show');
            
            // Load modal content
            if (modalId === 'history-modal') {
                this.loadHistory();
            } else if (modalId === 'clients-modal') {
                this.loadClients();
            } else if (modalId === 'templates-modal') {
                this.loadTemplates();
            } else if (modalId === 'marketplace-modal') {
                this.loadMarketplace();
            }
        }
    }
    
    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.setAttribute('aria-hidden', 'true');
            modal.classList.remove('show');
        }
    }
    
    closeAllModals() {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            modal.setAttribute('aria-hidden', 'true');
            modal.classList.remove('show');
        });
    }
    
    loadHistory() {
        // Mock history data
        const historyList = document.getElementById('history-list');
        if (historyList) {
            historyList.innerHTML = '<p>No invoice history available</p>';
        }
    }
    
    loadClients() {
        // Mock clients data
        const clientsList = document.getElementById('clients-list');
        if (clientsList) {
            clientsList.innerHTML = '<p>No clients saved yet</p>';
        }
    }
    
    loadTemplates() {
        const templates = JSON.parse(localStorage.getItem('invoice-templates') || '[]');
        const templatesList = document.getElementById('templates-list');
        
        if (templatesList) {
            if (templates.length === 0) {
                templatesList.innerHTML = '<p>No saved templates yet</p>';
            } else {
                templatesList.innerHTML = templates.map(template => `
                    <div class="list-item">
                        <div>
                            <h3>${template.name}</h3>
                            <p>Created: ${new Date(template.createdAt).toLocaleDateString()}</p>
                        </div>
                        <div class="list-actions">
                            <button class="btn btn-small btn-primary" onclick="invoiceStudio.loadTemplate(${template.id})">
                                Load
                            </button>
                            <button class="btn btn-small btn-secondary" onclick="invoiceStudio.deleteTemplate(${template.id})">
                                Delete
                            </button>
                        </div>
                    </div>
                `).join('');
            }
        }
    }
    
    loadMarketplace() {
        // Mock marketplace data
        const marketplaceList = document.getElementById('marketplace-list');
        if (marketplaceList) {
            marketplaceList.innerHTML = '<p>Marketplace coming soon!</p>';
        }
    }
    
    loadTemplate(templateId) {
        const templates = JSON.parse(localStorage.getItem('invoice-templates') || '[]');
        const template = templates.find(t => t.id === templateId);
        
        if (template) {
            this.state = template.data;
            this.updateUI();
            this.closeAllModals();
            this.showToast('Template loaded successfully!', 'success');
        }
    }
    
    deleteTemplate(templateId) {
        if (!confirm('Are you sure you want to delete this template?')) return;
        
        const templates = JSON.parse(localStorage.getItem('invoice-templates') || '[]');
        const filteredTemplates = templates.filter(t => t.id !== templateId);
        localStorage.setItem('invoice-templates', JSON.stringify(filteredTemplates));
        
        this.loadTemplates();
        this.showToast('Template deleted successfully!', 'success');
    }
    
    // Package purchase
    buyPackage(packageType) {
        const packages = {
            starter: { normal: 50, ai: 10, price: 9.99 },
            professional: { normal: 150, ai: 50, price: 19.99 },
            enterprise: { normal: 500, ai: 200, price: 49.99 }
        };
        
        const pkg = packages[packageType];
        if (pkg) {
            this.state.generations.normal += pkg.normal;
            this.state.generations.ai += pkg.ai;
            this.updateGenerationsDisplay();
            this.closeAllModals();
            this.showToast(`Purchased ${packageType} pack! ${pkg.normal} normal + ${pkg.ai} AI generations added.`, 'success');
        }
    }
    
    // Utility functions
    formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: this.state.invoice.currency
        }).format(amount);
    }
    
    camelCase(str) {
        return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    }
    
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        if (!toast) return;
        
        toast.textContent = message;
        toast.className = `toast ${type}`;
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
    
    simulateGeneration() {
        return new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Update UI from state
    updateUI() {
        // Update form fields
        Object.entries(this.state.business).forEach(([key, value]) => {
            const field = document.getElementById(`business-${key}`);
            if (field) field.value = value;
        });
        
        Object.entries(this.state.client).forEach(([key, value]) => {
            const field = document.getElementById(`client-${key}`);
            if (field) field.value = value;
        });
        
        Object.entries(this.state.invoice).forEach(([key, value]) => {
            const field = document.getElementById(`invoice-${this.kebabCase(key)}`);
            if (field) {
                if (field.type === 'radio') {
                    const radio = document.querySelector(`input[name="invoice-template"][value="${value}"]`);
                    if (radio) radio.checked = true;
                } else {
                    field.value = value;
                }
            }
        });
        
        Object.entries(this.state.bank).forEach(([key, value]) => {
            const field = document.getElementById(this.kebabCase(key));
            if (field) field.value = value;
        });
        
        // Update items
        this.renderItems();
        
        // Update totals
        document.getElementById('tax-rate').value = this.state.totals.taxRate;
        document.getElementById('discount-rate').value = this.state.totals.discountRate;
        this.calculateTotals();
        
        // Update generations display
        this.updateGenerationsDisplay();
        
        // Update validation status
        this.updateValidationStatus();
    }
    
    updateGenerationsDisplay() {
        const normalGen = document.getElementById('normal-generations');
        const aiGen = document.getElementById('ai-generations');
        
        if (normalGen) normalGen.textContent = this.state.generations.normal;
        if (aiGen) aiGen.textContent = this.state.generations.ai;
    }
    
    kebabCase(str) {
        return str.replace(/([A-Z])/g, '-$1').toLowerCase();
    }
    
    // Local storage management
    saveToLocalStorage() {
        localStorage.setItem('invoice-studio-state', JSON.stringify(this.state));
        localStorage.setItem('invoice-studio-history', JSON.stringify(this.history));
    }
    
    loadFromLocalStorage() {
        const savedState = localStorage.getItem('invoice-studio-state');
        const savedHistory = localStorage.getItem('invoice-studio-history');
        
        if (savedState) {
            try {
                this.state = JSON.parse(savedState);
            } catch (error) {
                console.error('Failed to load saved state:', error);
            }
        }
        
        if (savedHistory) {
            try {
                this.history = JSON.parse(savedHistory);
            } catch (error) {
                console.error('Failed to load saved history:', error);
            }
        }
    }
    
    addInitialItem() {
        if (this.state.items.length === 0) {
            this.addItem();
        }
    }
}

// Initialize the application
let invoiceStudio;

document.addEventListener('DOMContentLoaded', () => {
    invoiceStudio = new InvoiceStudio();
    
    // Set default dates
    const today = new Date();
    const dueDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days
    
    document.getElementById('invoice-date').value = today.toISOString().split('T')[0];
    document.getElementById('due-date').value = dueDate.toISOString().split('T')[0];
    
    console.log('Invoice Studio ready!');
});

// Global functions for inline event handlers
window.closeModal = function(modalId) {
    if (invoiceStudio) {
        invoiceStudio.closeModal(modalId);
    }
};
