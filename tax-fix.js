// Fix for the tax calculation syntax error
// Replace the detectLocationAndSetTax function in script.js with this corrected version

async function detectLocationAndSetTax() {
    if (!navigator.geolocation) {
        locationTaxInfo.textContent = 'Geolocation not supported';
        return;
    }

    detectLocationBtn.disabled = true;
    detectLocationBtn.textContent = '🔄 Detecting...';
    locationTaxInfo.textContent = 'Getting your location...';

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            try {
                // Use reverse geocoding API to get location
                const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}&zoom=10`);
                const data = await response.json();
                
                const countryCode = data.address.country_code.toUpperCase();
                const stateCode = data.address.state_code?.toUpperCase() || data.address.state?.toUpperCase();
                
                let taxRate = taxRates.default;
                if (taxRates[countryCode]) {
                    if (countryCode === 'US' && stateCode && taxRates[countryCode][stateCode]) {
                        taxRate = taxRates[countryCode][stateCode];  // FIXED: Added missing closing bracket
                    } else if (taxRates[countryCode].default) {
                        taxRate = taxRates[countryCode].default;
                    }
                }
                
                taxInput.value = taxRate.toFixed(2);
                locationTaxInfo.textContent = `📍 ${data.address.city || data.address.state || data.address.country}, Tax: ${taxRate}%`;
                updateTotals();
                showToast(`Tax rate set to ${taxRate}% based on your location`);
                
            } catch (error) {
                console.error('Error getting location:', error);
                locationTaxInfo.textContent = 'Could not determine tax rate';
                showToast('Failed to detect location tax', true);
            } finally {
                detectLocationBtn.disabled = false;
                detectLocationBtn.textContent = '📍 Auto-detect Tax';
            }
        },
        (error) => {
            console.error('Geolocation error:', error);
            locationTaxInfo.textContent = 'Location access denied';
            detectLocationBtn.disabled = false;
            detectLocationBtn.textContent = '📍 Auto-detect Tax';
            showToast('Location access denied. Please enable location services.', true);
        }
    );
}

console.log('✅ Tax function fix created. Replace the detectLocationAndSetTax function in script.js with this corrected version.');
