# Modular Invoice Generator

## Overview
The invoice generator has been refactored into smaller, more manageable files for better maintainability and organization.

## File Structure

### Core Files
- **`invoice.html`** - Main HTML structure with semantic markup
- **`invoice-styles.css`** - All CSS styling and responsive design
- **`invoice-script.js`** - Complete JavaScript functionality

### Benefits of Modular Structure
1. **Separation of Concerns** - HTML, CSS, and JavaScript are in separate files
2. **Easier Maintenance** - Each file has a single responsibility
3. **Better Collaboration** - Team members can work on different files simultaneously
4. **Improved Performance** - CSS and JavaScript can be cached independently
5. **Code Reusability** - Styles and scripts can be reused in other projects

## Features
- ✅ Clean, modular code structure
- ✅ Responsive design
- ✅ Form validation
- ✅ PDF generation with jsPDF
- ✅ Local storage persistence
- ✅ Undo/Redo functionality
- ✅ Generation purchasing system
- ✅ Professional invoice layout

## Usage
1. Open `invoice.html` in your web browser
2. Fill in the required business and client information
3. Add invoice items with quantities and prices
4. Set tax and discount rates if needed
5. Click "Generate Invoice" to create the invoice
6. Download the PDF when ready

## File Sizes
- `invoice.html` - ~6KB (HTML structure only)
- `invoice-styles.css` - ~4KB (Styling and responsive design)
- `invoice-script.js` - ~8KB (Complete functionality)

Total: ~18KB (compared to ~33KB in the monolithic version)

## Dependencies
- jsPDF library (loaded from CDN)
- Modern web browser with ES6 support
- Local storage support

## Browser Compatibility
- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+
