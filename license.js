// Premium License Manager for Webpage Resource Downloader
// Handles free vs pro version limitations and licensing
// Cross-browser compatible for Chrome and Firefox

class LicenseManager {
    constructor() {
        this.FREE_DOWNLOAD_LIMIT = 25; // Files per day for free users - generous for growth
        this.FREE_BATCH_LIMIT = 3; // Max files per batch for free users - encourages frequent usage
        
        // Initialize browser compatibility
        this.browserCompat = window.BrowserCompat ? new BrowserCompat() : null;
        
        // Fallback for direct API access
        this.api = this.browserCompat?.api || (typeof browser !== 'undefined' ? browser : chrome);
        
        this.premiumFeatures = {
            unlimitedDownloads: false,
            customFolders: false,
            batchDownloads: false,
            advancedOrganization: false,
            websiteStructure: false,
            timestampNaming: false,
            apiAccess: false,
            prioritySupport: false
        };
        
        // Payment configuration - UPDATE THESE WITH YOUR DETAILS
        this.paymentConfig = {
            gumroadProductUrl: 'https://gum.co/your-extension-pro', // Replace with your Gumroad product URL
            stripePublishableKey: 'pk_your_stripe_key', // Replace with your Stripe key
            paypalClientId: 'your_paypal_client_id' // Replace with your PayPal client ID
        };
    }
    
    // Get current license status
    async getLicenseStatus() {
        try {
            const defaultData = {
                isPro: false,
                licenseKey: '',
                activationDate: null,
                expiryDate: null,
                trialUsed: false,
                dailyDownloads: 0,
                weeklyDownloads: 0,
                lastResetDate: new Date().toDateString(),
                weeklyResetDate: this.getWeekStartDate(),
                totalDownloads: 0,
                firstUsedDate: new Date().toISOString()
            };
            
            let license;
            if (this.browserCompat) {
                license = await this.browserCompat.getStorage(defaultData);
            } else {
                // Fallback for direct API
                if (this.api.storage?.sync?.get) {
                    if (typeof browser !== 'undefined') {
                        // Firefox
                        license = await this.api.storage.sync.get(defaultData);
                    } else {
                        // Chrome
                        license = await new Promise(resolve => {
                            this.api.storage.sync.get(defaultData, resolve);
                        });
                    }
                } else {
                    license = defaultData;
                }
            }
            
            // Reset daily counter if it's a new day
            const today = new Date().toDateString();
            const weekStart = this.getWeekStartDate();
            
            if (license.lastResetDate !== today) {
                license.dailyDownloads = 0;
                license.lastResetDate = today;
                
                // Reset weekly counter if it's a new week
                if (license.weeklyResetDate !== weekStart) {
                    license.weeklyDownloads = 0;
                    license.weeklyResetDate = weekStart;
                }
                
                const updateData = {
                    dailyDownloads: 0,
                    weeklyDownloads: license.weeklyDownloads,
                    lastResetDate: today,
                    weeklyResetDate: weekStart
                };
                
                if (this.browserCompat) {
                    await this.browserCompat.setStorage(updateData);
                } else {
                    // Fallback
                    if (typeof browser !== 'undefined') {
                        await this.api.storage.sync.set(updateData);
                    } else {
                        await new Promise(resolve => {
                            this.api.storage.sync.set(updateData, resolve);
                        });
                    }
                }
            }
            
            return license;
        } catch (error) {
            console.error('Error getting license status:', error);
            return { isPro: false, dailyDownloads: 0 };
        }
    }
    
    // Check if user can download more files
    async canDownload(fileCount = 1) {
        const license = await this.getLicenseStatus();
        
        if (license.isPro) {
            return { allowed: true, reason: 'pro' };
        }
        
        // Check daily limit for free users
        if (license.dailyDownloads + fileCount > this.FREE_DOWNLOAD_LIMIT) {
            return {
                allowed: false,
                reason: 'daily_limit',
                remaining: Math.max(0, this.FREE_DOWNLOAD_LIMIT - license.dailyDownloads),
                limit: this.FREE_DOWNLOAD_LIMIT
            };
        }
        
        // Check batch limit for free users
        if (fileCount > this.FREE_BATCH_LIMIT) {
            return {
                allowed: false,
                reason: 'batch_limit',
                requested: fileCount,
                limit: this.FREE_BATCH_LIMIT
            };
        }
        
        return { allowed: true, reason: 'free' };
    }
    
    // Increment download counter with comprehensive tracking
    async recordDownload(fileCount = 1) {
        const license = await this.getLicenseStatus();
        
        if (!license.isPro) {
            const newDailyCount = license.dailyDownloads + fileCount;
            const newWeeklyCount = (license.weeklyDownloads || 0) + fileCount;
            const newTotalCount = (license.totalDownloads || 0) + fileCount;
            
            await chrome.storage.sync.set({ 
                dailyDownloads: newDailyCount,
                weeklyDownloads: newWeeklyCount,
                totalDownloads: newTotalCount
            });
            
            return {
                dailyDownloads: newDailyCount,
                weeklyDownloads: newWeeklyCount,
                totalDownloads: newTotalCount
            };
        }
        
        // Still track for pro users for analytics
        const newTotalCount = (license.totalDownloads || 0) + fileCount;
        await chrome.storage.sync.set({ totalDownloads: newTotalCount });
        
        return { totalDownloads: newTotalCount, isPro: true };
    }
    
    // Check if specific feature is available
    async hasFeature(featureName) {
        const license = await this.getLicenseStatus();
        
        if (license.isPro) {
            return true;
        }
        
        // Free version limitations
        switch (featureName) {
            case 'customFolders':
            case 'advancedOrganization':
            case 'websiteStructure':
            case 'timestampNaming':
            case 'unlimitedDownloads':
            case 'apiAccess':
                return false;
            default:
                return true;
        }
    }
    
    // Activate pro license
    async activateLicense(licenseKey) {
        try {
            // In a real implementation, you'd validate this with your server
            // For now, we'll use a simple validation
            if (this.validateLicenseKey(licenseKey)) {
                const activationDate = new Date();
                const expiryDate = new Date();
                expiryDate.setFullYear(expiryDate.getFullYear() + 1); // 1 year
                
                await chrome.storage.sync.set({
                    isPro: true,
                    licenseKey: licenseKey,
                    activationDate: activationDate.toISOString(),
                    expiryDate: expiryDate.toISOString()
                });
                
                return { success: true, message: 'License activated successfully!' };
            } else {
                return { success: false, message: 'Invalid license key' };
            }
        } catch (error) {
            console.error('Error activating license:', error);
            return { success: false, message: 'Activation failed. Please try again.' };
        }
    }
    
    // Start free trial (7 days)
    async startTrial() {
        try {
            const license = await this.getLicenseStatus();
            
            if (license.trialUsed) {
                return { success: false, message: 'Trial already used' };
            }
            
            const trialStart = new Date();
            const trialEnd = new Date();
            trialEnd.setDate(trialEnd.getDate() + 7); // 7 days
            
            await chrome.storage.sync.set({
                isPro: true,
                trialUsed: true,
                activationDate: trialStart.toISOString(),
                expiryDate: trialEnd.toISOString(),
                licenseKey: 'TRIAL'
            });
            
            return { success: true, message: '7-day free trial started!' };
        } catch (error) {
            console.error('Error starting trial:', error);
            return { success: false, message: 'Failed to start trial' };
        }
    }
    
    // Simple license key validation (in production, use server validation)
    validateLicenseKey(key) {
        // Simple validation - in production, validate with your server
        const validKeys = [
            'PRO-2025-DOWNLOAD-PREMIUM',
            'LIFETIME-ACCESS-2025',
            'DEV-TEST-LICENSE-KEY'
        ];
        
        return validKeys.includes(key) || key.startsWith('PRO-') && key.length >= 20;
    }
    
    // Get remaining downloads for free users
    async getRemainingDownloads() {
        const license = await this.getLicenseStatus();
        
        if (license.isPro) {
            return { unlimited: true };
        }
        
        const remaining = Math.max(0, this.FREE_DOWNLOAD_LIMIT - license.dailyDownloads);
        return {
            unlimited: false,
            remaining: remaining,
            total: this.FREE_DOWNLOAD_LIMIT,
            used: license.dailyDownloads
        };
    }
    
    // Get trial/license status message
    async getStatusMessage() {
        const license = await this.getLicenseStatus();
        
        if (!license.isPro) {
            const remaining = await this.getRemainingDownloads();
            return `Free: ${remaining.remaining}/${remaining.total} downloads today`;
        }
        
        if (license.licenseKey === 'TRIAL') {
            const expiryDate = new Date(license.expiryDate);
            const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
            
            if (daysLeft <= 0) {
                await chrome.storage.sync.set({ isPro: false });
                return 'Trial expired - Upgrade to Pro';
            }
            
            return `Trial: ${daysLeft} days left`;
        }
        
        return 'Pro: All features unlocked';
    }
    
    // Helper method to get week start date
    getWeekStartDate() {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - dayOfWeek);
        return weekStart.toDateString();
    }
    
    // Get user engagement stats for growth tracking
    async getUserEngagementStats() {
        try {
            const license = await this.getLicenseStatus();
            const firstUsed = new Date(license.firstUsedDate || new Date());
            const daysSinceFirstUse = Math.floor((Date.now() - firstUsed.getTime()) / (1000 * 60 * 60 * 24));
            
            return {
                totalDownloads: license.totalDownloads || 0,
                dailyDownloads: license.dailyDownloads,
                weeklyDownloads: license.weeklyDownloads || 0,
                daysSinceFirstUse,
                averageDownloadsPerDay: daysSinceFirstUse > 0 ? Math.round((license.totalDownloads || 0) / daysSinceFirstUse * 10) / 10 : 0
            };
        } catch (error) {
            console.error('Error getting engagement stats:', error);
            return { totalDownloads: 0, dailyDownloads: 0, weeklyDownloads: 0, daysSinceFirstUse: 0, averageDownloadsPerDay: 0 };
        }
    }
    
    // Improved can download check with growth-focused messaging
    async canDownload(count = 1) {
        try {
            const license = await this.getLicenseStatus();
            
            if (license.isPro) {
                return { allowed: true, reason: 'pro' };
            }
            
            // Check batch limit (smaller to encourage frequent usage)
            if (count > this.FREE_BATCH_LIMIT) {
                return { 
                    allowed: false, 
                    reason: 'batch_limit',
                    message: `Free users can download ${this.FREE_BATCH_LIMIT} files at once. Pro users get unlimited batch downloads!`,
                    suggestion: 'Select fewer files or upgrade to Pro for unlimited batch downloads.'
                };
            }
            
            // Check daily limit (more generous now)
            if (license.dailyDownloads + count > this.FREE_DOWNLOAD_LIMIT) {
                const remaining = this.FREE_DOWNLOAD_LIMIT - license.dailyDownloads;
                const stats = await this.getUserEngagementStats();
                
                return { 
                    allowed: false, 
                    reason: 'daily_limit',
                    remaining,
                    stats,
                    message: `You've used ${license.dailyDownloads}/${this.FREE_DOWNLOAD_LIMIT} daily downloads. Upgrade to Pro for unlimited downloads!`,
                    encouragement: stats.totalDownloads > 50 ? 
                        `You've downloaded ${stats.totalDownloads} files total! You're a power user - Pro features would save you time.` :
                        `Great job using the extension! ${remaining} downloads left today.`
                };
            }
            
            return { allowed: true, reason: 'free_within_limits' };
            
        } catch (error) {
            console.error('Error checking download permission:', error);
            return { allowed: true, reason: 'error_fallback' }; // Allow on error to not block users
        }
    }
    
    // Generate license key after payment
    generateLicenseKey() {
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        return `PRO-${timestamp}-${randomString}`.toUpperCase();
    }
    
    // Payment integration methods
    async processPayment(provider = 'gumroad') {
        switch (provider) {
            case 'gumroad':
                return this.processGumroadPayment();
            case 'stripe':
                return this.processStripePayment();
            case 'paypal':
                return this.processPayPalPayment();
            default:
                throw new Error('Unsupported payment provider');
        }
    }
    
    async processGumroadPayment() {
        // Open Gumroad checkout in new tab
        const gumroadUrl = this.paymentConfig.gumroadProductUrl;
        const newTab = window.open(gumroadUrl, '_blank');
        
        if (!newTab) {
            throw new Error('Please allow popups to complete payment');
        }
        
        // Return payment instructions
        return {
            success: true,
            message: 'Complete your purchase on Gumroad and enter the license key you receive.',
            provider: 'gumroad'
        };
    }
    
    async processStripePayment() {
        // This requires a backend server to create checkout sessions
        try {
            const response = await fetch('https://your-backend.com/create-checkout-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product: 'pro-license',
                    amount: 499 // $4.99 in cents
                })
            });
            
            const session = await response.json();
            
            // Redirect to Stripe Checkout
            const stripe = Stripe(this.paymentConfig.stripePublishableKey);
            return stripe.redirectToCheckout({ sessionId: session.id });
            
        } catch (error) {
            throw new Error('Payment processing failed. Please try again.');
        }
    }
    
    async processPayPalPayment() {
        // PayPal integration (requires PayPal SDK)
        return new Promise((resolve, reject) => {
            if (!window.paypal) {
                reject(new Error('PayPal SDK not loaded'));
                return;
            }
            
            // This would typically be handled in the UI
            resolve({
                success: true,
                message: 'PayPal payment initiated',
                provider: 'paypal'
            });
        });
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LicenseManager;
} else {
    window.LicenseManager = LicenseManager;
}