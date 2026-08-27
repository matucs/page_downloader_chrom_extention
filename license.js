// Premium License Manager for Webpage Resource Downloader
// Handles free vs pro version limitations and licensing
// Cross-browser compatible for Chrome and Firefox

class LicenseManager {
    constructor() {
        this.FREE_DOWNLOAD_LIMIT = 25; // Files per day for free users - generous for growth
        this.FREE_BATCH_LIMIT = 3; // Max files per batch for free users - encourages frequent usage
        
        // Initialize browser compatibility (works in popup pages and service workers)
        const globalScope = typeof globalThis !== 'undefined' ? globalThis : self;
        this.browserCompat = globalScope.BrowserCompat ? new globalScope.BrowserCompat() : null;
        
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
        
        // Payment configuration
        this.paymentConfig = {
            gumroadProductUrl: 'https://bytewave64.gumroad.com/l/zlqqt',
            gumroadProductPermalink: 'zlqqt',
            subscriptionPeriodDays: 31,
            licenseReverifyHours: 12
        };

        // Accepted only while the extension is loaded unpacked (Load unpacked).
        this.devLicenseKey = 'DEVTE-STONLY-00000-00001';
        this.devInstallPromise = null;

        // Guards so a single popup/options session performs at most one
        // re-verification network call, even though several UI helpers ask.
        this.reverifyPromise = null;
        this.reverifiedThisSession = false;
    }
    
    isDevLicenseKey(licenseKey) {
        return licenseKey?.trim().toUpperCase() === this.devLicenseKey;
    }

    async isDevelopmentInstall() {
        if (this._devInstallOverride != null) {
            return this._devInstallOverride;
        }

        const management = this.api?.management;
        if (!management?.getSelf) {
            return false;
        }

        if (!this.devInstallPromise) {
            this.devInstallPromise = new Promise((resolve) => {
                management.getSelf((info) => {
                    resolve(info?.installType === 'development');
                });
            });
        }

        return this.devInstallPromise;
    }

    async activateDevLicense() {
        if (!(await this.isDevelopmentInstall())) {
            throw new Error('The dev license key only works with an unpacked extension loaded from chrome://extensions.');
        }

        const activationDate = new Date();
        const expiryDate = new Date(activationDate);
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);

        await this.setLicenseStorage({
            isPro: true,
            licenseKey: this.devLicenseKey,
            activationDate: activationDate.toISOString(),
            expiryDate: expiryDate.toISOString(),
            lastVerifiedAt: activationDate.toISOString()
        });

        this.reverifiedThisSession = true;

        return {
            success: true,
            message: 'Dev license activated for local testing.'
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
                trialCompletedAt: null,
                lastVerifiedAt: null,
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

            return await this.applyLicenseExpiry(license);
        } catch (error) {
            console.error('Error getting license status:', error);
            return { isPro: false, dailyDownloads: 0 };
        }
    }

    isLicenseExpired(license) {
        if (!license?.expiryDate) {
            return false;
        }
        return new Date(license.expiryDate) <= new Date();
    }

    // Pro benefits apply only while the stored license is both flagged and unexpired.
    isEffectivelyPro(license) {
        return Boolean(license?.isPro && !this.isLicenseExpired(license));
    }

    async applyLicenseExpiry(license) {
        if (!license?.isPro || !license.expiryDate || !this.isLicenseExpired(license)) {
            return license;
        }

        // A finished trial is cleared for good; paid keys keep their key so the
        // next Gumroad re-verification can renew them.
        if (license.licenseKey === 'TRIAL') {
            const clearedTrial = {
                isPro: false,
                licenseKey: '',
                activationDate: null,
                expiryDate: null,
                trialCompletedAt: license.trialCompletedAt || new Date().toISOString()
            };

            await this.setLicenseStorage(clearedTrial);
            return { ...license, ...clearedTrial };
        }

        return license;
    }

    // Distinguishes "this key is not real" from transient API/network trouble,
    // so a Gumroad outage never wipes a paying customer's license.
    isDefinitiveInvalidResponse(result) {
        if (!result || result.success) {
            return false;
        }

        const message = (result.message || '').toLowerCase();
        return message.includes('does not exist') || message.includes('not found');
    }

    formatActivationError(result, error) {
        const rawMessage = result?.message || '';
        if (rawMessage) {
            const message = rawMessage.toLowerCase();
            if (message.includes('does not exist') || message.includes('not found')) {
                return 'This license key is invalid or was not purchased for this product.';
            }
            if (message.includes('refund')) {
                return 'This license has been refunded and is no longer valid.';
            }
            return rawMessage;
        }

        if (error instanceof TypeError) {
            return 'Could not reach Gumroad. Check your internet connection and try again.';
        }

        if (error?.message) {
            return error.message;
        }

        return 'Invalid license key. Please check your key and try again.';
    }

    async hasActiveLicense() {
        await this.ensureStoredLicenseValid();
        const license = await this.getLicenseStatus();
        return Boolean(license.isPro && !this.isLicenseExpired(license));
    }

    async isProUser() {
        await this.ensureStoredLicenseValid();
        const license = await this.getLicenseStatus();
        return Boolean(
            license.isPro &&
            license.licenseKey !== 'TRIAL' &&
            !this.isLicenseExpired(license)
        );
    }

    async isTrialActive() {
        const license = await this.getLicenseStatus();
        return Boolean(
            license.isPro &&
            license.licenseKey === 'TRIAL' &&
            !this.isLicenseExpired(license)
        );
    }

    async isTrialExpired() {
        const license = await this.getLicenseStatus();
        return Boolean(
            license.trialUsed &&
            license.trialCompletedAt &&
            !this.isEffectivelyPro(license)
        );
    }

    async getTrialDaysRemaining() {
        const license = await this.getLicenseStatus();
        if (!license.expiryDate || license.licenseKey !== 'TRIAL') {
            return 0;
        }

        const daysLeft = Math.ceil((new Date(license.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
        return Math.max(0, daysLeft);
    }

    async getUsage() {
        const license = await this.getLicenseStatus();
        return {
            dailyDownloads: license.dailyDownloads || 0,
            weeklyDownloads: license.weeklyDownloads || 0,
            totalDownloads: license.totalDownloads || 0,
            isPro: await this.isProUser(),
            isTrial: await this.isTrialActive(),
            isTrialExpired: await this.isTrialExpired(),
            trialDaysRemaining: await this.getTrialDaysRemaining(),
            dailyLimit: this.FREE_DOWNLOAD_LIMIT,
            batchLimit: this.FREE_BATCH_LIMIT
        };
    }
    
    // Increment download counter with comprehensive tracking
    async recordDownload(fileCount = 1) {
        const license = await this.getLicenseStatus();
        
        if (!this.isEffectivelyPro(license)) {
            const newDailyCount = license.dailyDownloads + fileCount;
            const newWeeklyCount = (license.weeklyDownloads || 0) + fileCount;
            const newTotalCount = (license.totalDownloads || 0) + fileCount;
            
            await this.setLicenseStorage({
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
        await this.setLicenseStorage({ totalDownloads: newTotalCount });
        
        return { totalDownloads: newTotalCount, isPro: true };
    }
    
    // Check if specific feature is available
    async hasFeature(featureName) {
        if (await this.hasActiveLicense()) {
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
    
    async setLicenseStorage(data) {
        if (this.browserCompat) {
            await this.browserCompat.setStorage(data);
        } else if (typeof browser !== 'undefined') {
            await this.api.storage.sync.set(data);
        } else {
            await new Promise(resolve => {
                this.api.storage.sync.set(data, resolve);
            });
        }
    }

    async revokeLicense() {
        await this.setLicenseStorage({
            isPro: false,
            licenseKey: '',
            activationDate: null,
            expiryDate: null,
            lastVerifiedAt: null
        });
        this.reverifiedThisSession = true;
    }

    isPurchaseValid(purchase) {
        if (!purchase) {
            return false;
        }
        if (purchase.refunded || purchase.chargebacked) {
            return false;
        }
        if (purchase.disputed && !purchase.dispute_won) {
            return false;
        }
        if (purchase.subscription_ended_at) {
            return new Date(purchase.subscription_ended_at) > new Date();
        }
        return true;
    }

    getExpiryFromVerification(purchase) {
        if (purchase?.subscription_ended_at) {
            return new Date(purchase.subscription_ended_at);
        }

        const expiryDate = new Date();
        expiryDate.setDate(
            expiryDate.getDate() + (this.paymentConfig.subscriptionPeriodDays || 31)
        );
        return expiryDate;
    }

    async verifyGumroadLicense(licenseKey, incrementUsesCount = false) {
        const normalizedKey = licenseKey.trim();
        const body = new URLSearchParams();

        if (this.paymentConfig.gumroadProductId) {
            body.append('product_id', this.paymentConfig.gumroadProductId);
        } else {
            body.append('product_permalink', this.paymentConfig.gumroadProductPermalink);
        }

        body.append('license_key', normalizedKey);
        body.append('increment_uses_count', incrementUsesCount ? 'true' : 'false');

        const response = await fetch('https://api.gumroad.com/v2/licenses/verify', {
            method: 'POST',
            body
        });

        let data = {};
        try {
            data = await response.json();
        } catch (parseError) {
            console.error('Failed to parse Gumroad response:', parseError);
        }

        if (!response.ok && !data.message) {
            throw new Error('Could not verify license. Check your connection and try again.');
        }

        return data;
    }

    ensureStoredLicenseValid() {
        if (this.reverifiedThisSession) {
            return Promise.resolve();
        }
        if (!this.reverifyPromise) {
            this.reverifyPromise = this.reverifyStoredLicense().finally(() => {
                this.reverifiedThisSession = true;
                this.reverifyPromise = null;
            });
        }
        return this.reverifyPromise;
    }

    async reverifyStoredLicense() {
        const license = await this.getLicenseStatus();
        if (!license.isPro || license.licenseKey === 'TRIAL' || !license.licenseKey) {
            return;
        }

        if (this.isDevLicenseKey(license.licenseKey)) {
            return;
        }

        const lastVerified = license.lastVerifiedAt ? new Date(license.lastVerifiedAt) : null;
        const hoursSinceVerify = lastVerified
            ? (Date.now() - lastVerified.getTime()) / (1000 * 60 * 60)
            : Number.POSITIVE_INFINITY;

        // An already-expired key is re-checked immediately so an active
        // subscription renews itself without the customer re-entering anything.
        const isExpired = this.isLicenseExpired(license);
        if (!isExpired && hoursSinceVerify < (this.paymentConfig.licenseReverifyHours || 12)) {
            return;
        }

        try {
            const result = await this.verifyGumroadLicense(license.licenseKey, false);

            if (result.success) {
                if (!this.isPurchaseValid(result.purchase)) {
                    await this.revokeLicense();
                    return;
                }

                await this.setLicenseStorage({
                    expiryDate: this.getExpiryFromVerification(result.purchase).toISOString(),
                    lastVerifiedAt: new Date().toISOString()
                });
                return;
            }

            if (this.isDefinitiveInvalidResponse(result)) {
                await this.revokeLicense();
                return;
            }

            console.warn('Keeping license: Gumroad verification was inconclusive.', result.message);
        } catch (error) {
            console.error('License re-verification failed:', error);
        }
    }

    async activateLicense(licenseKey) {
        const normalizedKey = licenseKey.trim();

        if (!normalizedKey) {
            throw new Error('Please enter a license key.');
        }
        if (normalizedKey === 'TRIAL') {
            throw new Error('Invalid license key.');
        }

        if (this.isDevLicenseKey(normalizedKey)) {
            return this.activateDevLicense();
        }

        let result;
        try {
            result = await this.verifyGumroadLicense(normalizedKey, false);
        } catch (error) {
            console.error('Error contacting Gumroad during activation:', error);
            throw new Error(this.formatActivationError(null, error));
        }

        if (!result.success) {
            throw new Error(this.formatActivationError(result));
        }
        if (!this.isPurchaseValid(result.purchase)) {
            throw new Error('This license is no longer active. It may have been refunded or cancelled.');
        }

        const activationDate = new Date();
        const expiryDate = this.getExpiryFromVerification(result.purchase);

        await this.setLicenseStorage({
            isPro: true,
            licenseKey: normalizedKey,
            activationDate: activationDate.toISOString(),
            expiryDate: expiryDate.toISOString(),
            lastVerifiedAt: activationDate.toISOString()
        });

        this.reverifiedThisSession = true;

        return { success: true, message: 'License activated successfully!' };
    }
    
    // Start free trial (7 days)
    async startTrial() {
        const license = await this.getLicenseStatus();

        if (license.trialUsed) {
            throw new Error('Your free trial has already been used.');
        }

        const trialStart = new Date();
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 7); // 7 days

        await this.setLicenseStorage({
            isPro: true,
            trialUsed: true,
            trialCompletedAt: null,
            activationDate: trialStart.toISOString(),
            expiryDate: trialEnd.toISOString(),
            licenseKey: 'TRIAL'
        });

        return { success: true, message: '7-day free trial started!' };
    }
    
    // Get remaining downloads for free users
    async getRemainingDownloads() {
        const license = await this.getLicenseStatus();
        
        if (this.isEffectivelyPro(license)) {
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
    
    async getStatusMessage() {
        const license = await this.getLicenseStatus();
        
        if (!this.isEffectivelyPro(license)) {
            const remaining = await this.getRemainingDownloads();
            const quota = `Free: ${remaining.remaining}/${remaining.total} downloads today`;
            return license.trialCompletedAt ? `Trial expired • ${quota}` : quota;
        }
        
        if (license.licenseKey === 'TRIAL') {
            const daysLeft = await this.getTrialDaysRemaining();
            return `Trial: ${daysLeft} days left`;
        }

        if (this.isDevLicenseKey(license.licenseKey)) {
            return 'Dev license (local testing)';
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
            if (await this.hasActiveLicense()) {
                return { allowed: true, reason: 'pro' };
            }

            const license = await this.getLicenseStatus();
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
    
    // Payment integration. Gumroad is the only provider: it hosts the checkout
    // and issues the license keys that verifyGumroadLicense() checks.
    async processPayment(provider = 'gumroad') {
        if (provider !== 'gumroad') {
            throw new Error('Unsupported payment provider');
        }
        return this.processGumroadPayment();
    }

    async processGumroadPayment() {
        const gumroadUrl = this.paymentConfig.gumroadProductUrl;

        // A real browser tab survives the popup closing; window.open does not.
        if (this.api?.tabs?.create) {
            await this.api.tabs.create({ url: gumroadUrl });
        } else if (typeof window !== 'undefined' && !window.open(gumroadUrl, '_blank')) {
            throw new Error('Please allow popups to complete payment');
        }

        return {
            success: true,
            message: 'Complete your purchase on Gumroad and enter the license key you receive.',
            provider: 'gumroad'
        };
    }
    
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LicenseManager;
}
if (typeof globalThis !== 'undefined') {
    globalThis.LicenseManager = LicenseManager;
}