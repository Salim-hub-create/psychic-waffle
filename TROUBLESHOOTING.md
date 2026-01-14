# Troubleshooting Guide

## Issue: Server showing old version instead of new modular version

### 🔧 Quick Fix
1. **Stop the server completely** (Ctrl+C in terminal)
2. **Clear browser cache**:
   - Chrome: Ctrl+Shift+R (hard refresh)
   - Firefox: Ctrl+F5
   - Edge: Ctrl+F5
3. **Restart server**:
   ```bash
   npm run dev
   ```
   OR use the startup script:
   ```bash
   # Windows
   start.bat
   
   # Mac/Linux
   ./start.sh
   ```

### 🛠️ Detailed Steps

#### Step 1: Verify Server Configuration
The server should be serving `invoice.html` (line 31 in server.js):
```javascript
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'invoice.html'));
});
```

#### Step 2: Check File Existence
Ensure these files exist:
- `invoice.html` (main HTML file)
- `invoice-styles.css` (modular CSS)
- `invoice-script.js` (JavaScript with backend integration)

#### Step 3: Clear All Caches
1. **Browser Cache**: Hard refresh (Ctrl+Shift+R)
2. **Server Cache**: Server has cache-busting headers added
3. **DNS Cache**: Not needed for localhost

#### Step 4: Verify Correct Version
When you visit `http://localhost:3000`, you should see:
- **Auto-detect Tax** button in the totals section
- **📍 Auto-detect Tax** functionality
- Modular file structure (if you view page source)

### 🐛 Common Issues

#### Issue: Still seeing old version
**Solution**: 
```bash
# Kill all node processes
taskkill /F /IM node.exe

# Clear npm cache
npm cache clean --force

# Reinstall dependencies
npm install

# Start fresh
npm run dev
```

#### Issue: Location-based tax not working
**Causes**:
- Location permissions denied
- HTTP instead of HTTPS (geolocation requires secure context)
- Firewall blocking location services

**Solutions**:
- Allow location access in browser
- Use `localhost` (considered secure for geolocation)
- Check browser console for errors

#### Issue: Backend API not working
**Check**:
- Server is running on correct port (3000)
- No errors in server console
- API endpoints responding: `http://localhost:3000/api/user`

### 📋 Verification Checklist

Before contacting support, verify:

- [ ] Server restarted after changes
- [ ] Browser cache cleared (hard refresh)
- [ ] `invoice.html` exists in project directory
- [ ] Server console shows no errors
- [ ] Can access `http://localhost:3000/api/user` (should return error about missing token)
- [ ] Location permissions enabled in browser
- [ ] Console shows no JavaScript errors

### 🆘 Still Not Working?

1. **Check server logs** for any errors
2. **Verify file contents** of `invoice.html`
3. **Try a different browser**
4. **Check if port 3000 is available**

### 🔄 Development Mode vs Production

**Development Mode** (`TEST_MODE=true` in .env):
- Simulated payments
- Test checkout sessions
- No actual charges

**Production Mode** (`TEST_MODE=false`):
- Real Stripe payments
- Live checkout sessions
- Actual charges

### 📱 Browser Compatibility

The modular version works with:
- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

**Note**: Geolocation requires HTTPS in production, but works on localhost.

### 🎯 Success Indicators

You'll know it's working when you see:
1. **Auto-detect Tax button** in the totals section
2. **Location-based tax detection** working
3. **Backend API calls** in browser console
4. **Modular file structure** in page source
