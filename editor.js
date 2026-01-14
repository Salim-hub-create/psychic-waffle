document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('back-btn');
  const downloadBtn = document.getElementById('download-pdf');
  const doc = document.getElementById('doc');
  const preview = document.getElementById('preview');
  const serverSelect = document.getElementById('server-invoices');
  const loadServerBtn = document.getElementById('load-server');
  const saveServerBtn = document.getElementById('save-server');

  // Keep preview in sync with editor content
  function renderPreview() {
    preview.innerHTML = '';
    preview.appendChild(doc.cloneNode(true));
  }

  // Load list of invoices from server
  async function fetchServerInvoices() {
    try {
      loadServerBtn.disabled = true;
      loadServerBtn.textContent = 'Loading...';
      
      const r = await fetch('/api/invoices');
      if (!r.ok) throw new Error('Failed to fetch invoices');
      
      const list = await r.json();
      serverSelect.innerHTML = '<option value="">— Select invoice —</option>';
      
      if (!list || list.length === 0) {
        serverSelect.innerHTML = '<option value="">— No invoices found —</option>';
        return;
      }
      
      list.forEach((inv, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = `${inv.number || ('#' + idx)} — ${inv.clientName || 'No client'} — ${inv.total || '0.00'} ${inv.currency || 'USD'}`;
        serverSelect.appendChild(opt);
      });
      
      console.log(`Loaded ${list.length} invoices from server`);
    } catch (e) {
      console.warn('Could not load server invoices', e);
      serverSelect.innerHTML = '<option value="">— Error loading invoices —</option>';
      alert('Could not load server invoices: ' + (e.message || e));
    } finally {
      loadServerBtn.disabled = false;
      loadServerBtn.textContent = 'Load From Server';
    }
  }

  // Load selected invoice and render as editable HTML
  async function loadInvoiceFromServer() {
    const idx = serverSelect.value;
    if (!idx) {
      alert('Please select an invoice to load');
      return;
    }
    
    try {
      loadServerBtn.disabled = true;
      loadServerBtn.textContent = 'Loading...';
      
      const r = await fetch('/api/invoices');
      if (!r.ok) throw new Error('Failed to fetch invoices');
      
      const list = await r.json();
      const inv = list[parseInt(idx, 10)];
      
      if (!inv) {
        throw new Error('Invoice not found on server');
      }
      
      // Clear current content
      doc.innerHTML = '';
      
      if (inv.content) {
        // Use saved content if available
        doc.innerHTML = inv.content;
      } else {
        // Build a comprehensive HTML fallback
        const parts = [];
        parts.push(`<h1>Invoice ${inv.number || ''}</h1>`);
        
        // Business info
        if (inv.businessName || inv.businessAddress) {
          parts.push('<div class="business-info">');
          parts.push(`<h3>From:</h3>`);
          if (inv.businessName) parts.push(`<div>${inv.businessName}</div>`);
          if (inv.businessAddress) parts.push(`<div>${inv.businessAddress}</div>`);
          if (inv.businessPhone) parts.push(`<div>${inv.businessPhone}</div>`);
          if (inv.businessEmail) parts.push(`<div>${inv.businessEmail}</div>`);
          parts.push('</div>');
        }
        
        // Client info
        if (inv.clientName || inv.clientAddress) {
          parts.push('<div class="client-info">');
          parts.push(`<h3>To:</h3>`);
          if (inv.clientName) parts.push(`<div>${inv.clientName}</div>`);
          if (inv.clientAddress) parts.push(`<div>${inv.clientAddress}</div>`);
          if (inv.clientEmail) parts.push(`<div>${inv.clientEmail}</div>`);
          parts.push('</div>');
        }
        
        // Invoice details
        parts.push('<div class="invoice-details">');
        if (inv.date) parts.push(`<div><strong>Date:</strong> ${inv.date}</div>`);
        if (inv.dueDate) parts.push(`<div><strong>Due:</strong> ${inv.dueDate}</div>`);
        parts.push('</div>');
        
        // Items table
        if (Array.isArray(inv.items) && inv.items.length) {
          parts.push('<table class="items-table">');
          parts.push('<thead><tr><th>Qty</th><th>Description</th><th>Unit Price</th><th>Total</th></tr></thead>');
          parts.push('<tbody>');
          
          inv.items.forEach(it => {
            const itemTotal = (it.qty || 1) * (it.unit || 0);
            parts.push(`<tr>`);
            parts.push(`<td>${it.qty || 1}</td>`);
            parts.push(`<td>${it.description || ''}</td>`);
            parts.push(`<td>${(it.unit || 0).toFixed(2)}</td>`);
            parts.push(`<td>${itemTotal.toFixed(2)}</td>`);
            parts.push(`</tr>`);
          });
          
          parts.push('</tbody></table>');
        }
        
        // Totals
        parts.push('<div class="totals">');
        const subtotal = inv.items ? inv.items.reduce((s, it) => s + ((it.qty || 1) * (it.unit || 0)), 0) : 0;
        if (subtotal > 0) parts.push(`<div><strong>Subtotal:</strong> ${subtotal.toFixed(2)}</div>`);
        
        if (inv.tax && inv.tax > 0) {
          const taxAmount = subtotal * (inv.tax / 100);
          parts.push(`<div><strong>Tax (${inv.tax}%):</strong> ${taxAmount.toFixed(2)}</div>`);
        }
        
        if (inv.discount && inv.discount > 0) {
          const discountAmount = subtotal * (inv.discount / 100);
          parts.push(`<div><strong>Discount (${inv.discount}%):</strong> -${discountAmount.toFixed(2)}</div>`);
        }
        
        if (typeof inv.total !== 'undefined') {
          parts.push(`<div class="grand-total"><strong>TOTAL:</strong> ${inv.total.toFixed(2)} ${inv.currency || 'USD'}</div>`);
        }
        parts.push('</div>');
        
        doc.innerHTML = parts.join('\n');
      }
      
      renderPreview();
      updateTotalDisplay();
      alert(`Successfully loaded invoice ${inv.number || ''}`);
      console.log('Invoice loaded:', inv);
      
    } catch (e) {
      console.error('Failed to load invoice:', e);
      alert('Failed to load invoice: ' + (e.message || e));
    } finally {
      loadServerBtn.disabled = false;
      loadServerBtn.textContent = 'Load From Server';
    }
  }
  
  // Update total display in the editor
  function updateTotalDisplay() {
    const totalElement = document.getElementById('total');
    if (totalElement) {
      // Try to extract total from the content
      const totalMatch = doc.innerHTML.match(/TOTAL:\s*([\d.,]+)/);
      if (totalMatch) {
        totalElement.textContent = totalMatch[1];
      }
    }
  }

  // Save edited HTML back to server as invoice.content
  async function saveInvoiceToServer() {
    try {
      const number = prompt('Invoice number to save as (existing or new):', ('INV-' + Date.now()));
      if (!number) return alert('Save cancelled');
      const invoice = { number, content: doc.innerHTML, created_at: new Date().toISOString() };
      const resp = await fetch('/api/save-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) });
      const data = await resp.json();
      if (resp.ok && data && data.success) { alert('Saved to server'); await fetchServerInvoices(); }
      else { alert('Save failed: ' + (data && data.error ? data.error : resp.statusText)); }
    } catch (e) { console.error(e); alert('Save error: ' + (e.message || e)); }
  }

  // PDF export using html2canvas + jsPDF
  function downloadPdf() {
    downloadBtn.disabled = true; downloadBtn.innerText = 'Rendering...';
    html2canvas(doc, { scale: 2 }).then(canvas => {
      const imgData = canvas.toDataURL('image/png');
      const pdf = new window.jspdf.jsPDF({ unit: 'px', format: [canvas.width, canvas.height] });
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save('invoice.pdf');
    }).catch(err => { console.error('PDF generation failed', err); alert('PDF export failed: ' + (err && err.message || err)); })
    .finally(() => { downloadBtn.disabled = false; downloadBtn.innerText = 'Download (Ctrl+S)'; });
  }

  // Bind events
  backBtn.addEventListener('click', () => { window.location.href = 'index.html'; });
  downloadBtn.addEventListener('click', downloadPdf);
  loadServerBtn.addEventListener('click', loadInvoiceFromServer);
  saveServerBtn.addEventListener('click', saveInvoiceToServer);
  doc.addEventListener('input', renderPreview);

  // Ctrl+S to download
  window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); downloadPdf(); } });

  // init
  if (!doc.innerHTML || doc.innerHTML.trim() === '') doc.innerHTML = '<h1>Edit your invoice</h1><p>Click to edit. Delete or insert text freely.</p>';
  renderPreview();
  fetchServerInvoices();
});