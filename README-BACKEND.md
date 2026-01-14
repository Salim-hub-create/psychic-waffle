# Backend Integration Guide

## Overview
The modular invoice generator has been successfully integrated with the backend server, providing user management, generation tracking, and location-based tax calculation.

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Configuration
Create or update your `.env` file:
```env
PORT=3000
TEST_MODE=true
# Optional: Stripe configuration for real payments
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### 3. Start the Server
```bash
npm run dev
```

The server will start on `http://localhost:3000` and serve the modular invoice generator.

## Features

### ✅ Backend Integration
- **User Management**: Automatic user creation and authentication
- **Generation Tracking**: Persistent generation counts stored on server
- **Purchase System**: Stripe checkout integration (test mode available)
- **API Endpoints**: RESTful API for all operations

### ✅ Location-Based Tax Calculator
- **Geolocation Detection**: Uses browser's geolocation API
- **Reverse Geocoding**: Converts coordinates to location names
- **Comprehensive Tax Database**: Tax rates for 50+ countries and states
- **Automatic Tax Application**: Sets tax rate based on detected location

## API Endpoints

### User Management
- `POST /api/user/create` - Create new user
- `GET /api/user` - Validate user token
- `GET /api/user/generations` - Get user's generation counts
- `POST /api/user/add-generations` - Add generations to user
- `POST /api/user/consume-generation` - Consume a generation

### Tax Calculation
- `POST /api/tax-by-location` - Calculate tax based on coordinates

### Payments
- `POST /api/create-checkout-session` - Create Stripe checkout session

## File Structure

```
invoice-generator/
├── invoice.html              # Main HTML file (served by server)
├── invoice-styles.css        # Modular CSS
├── invoice-script.js         # JavaScript with backend integration
├── server.js                 # Express.js backend server
├── package.json              # Dependencies and scripts
├── .env                      # Environment variables
└── data/                     # Server data storage
    ├── users.json            # User data
    ├── purchases.json        # Purchase records
    └── ...
```

## Usage

### 1. Access the Application
Open `http://localhost:3000` in your browser.

### 2. Location-Based Tax
- Click "📍 Auto-detect Tax" button
- Allow location access when prompted
- Tax rate will be automatically calculated based on your location

### 3. Purchase Generations
- Click "Buy Generations" 
- Select a package (Basic, Pro, Enterprise)
- Complete checkout via Stripe (test mode simulated)

### 4. Generate Invoice
- Fill in all required fields
- Add invoice items
- Click "Generate Invoice" (consumes 1 normal generation)
- Download PDF when ready

## Tax Coverage

### United States (all 50 states)
- State-level tax rates included
- Examples: CA (7.25%), NY (4.0%), TX (6.25%), FL (6.0%)

### Canada (all provinces)
- Provincial tax rates
- Examples: ON (13%), BC (7%), QC (9.975%)

### Europe (25+ countries)
- VAT/GST rates
- Examples: UK (20%), Germany (19%), France (20%)

### Other Regions
- Australia, New Zealand, Asia, South America, Africa
- Comprehensive tax database

## Test Mode

When `TEST_MODE=true` in `.env`:
- Stripe payments are simulated
- Test checkout sessions are created
- No actual charges are made

## Data Persistence

- **User Data**: Stored in `data/users.json`
- **Purchase Records**: Stored in `data/purchases.json`
- **Local Storage**: Form data and UI state

## Security Features

- Token-based authentication
- CORS protection
- Input validation
- Error handling

## Browser Compatibility

- Modern browsers with geolocation support
- Chrome 60+, Firefox 55+, Safari 12+, Edge 79+

## Troubleshooting

### Location Not Working
- Ensure HTTPS (geolocation requires secure context)
- Check browser location permissions
- Try manual tax entry as fallback

### Server Not Starting
- Check if port 3000 is available
- Verify all dependencies installed
- Check `.env` configuration

### Payments Not Working
- Verify Stripe keys in `.env` (for live mode)
- Check `TEST_MODE` setting
- Review server logs for errors

## Development

### Adding New Tax Rates
Edit the `taxRates` object in `server.js`:
```javascript
'taxRates': {
  'COUNTRY_CODE': rate,
  'US': {
    'STATE_CODE': rate
  }
}
```

### Custom API Endpoints
Add new routes to `server.js` following the existing pattern.

## Next Steps

1. Configure Stripe for live payments
2. Add more invoice templates
3. Implement invoice history
4. Add email delivery options
5. Create admin dashboard
