// Options page JavaScript for Webpage Resource Downloader

class SettingsManager {
    constructor() {
        this.defaultSettings = {
            downloadFolder: '',
            createSubfolders: false,
            avoidDuplicates: true,
            preserveStructure: false,
            addTimestamp: false,
            addWebsiteName: false
        };

        this.browserCompat = window.BrowserCompat ? new BrowserCompat() : null;
        this.licenseManager = null;
        this.statusHideTimer = null;
        this.saveButtonResetTimer = null;
        this.lastSavedAt = null;
        this.initializeLicenseManager();
        this.initializeElements();
        this.loadSettings();
        this.bindEvents();
        this.updateLicenseUI();
    }

    async initializeLicenseManager() {
        try {
            if (typeof LicenseManager !== 'undefined') {
                this.licenseManager = new LicenseManager();
                await this.updateLicenseUI();
            } else {
                console.warn('LicenseManager not available');
                this.setDefaultLicenseUI();
            }
        } catch (error) {
            console.error('Error initializing license manager:', error);
            this.setDefaultLicenseUI();
        }
    }

    setDefaultLicenseUI() {
        if (this.licenseStatus) {
            this.licenseStatus.textContent = 'Free License (Limited)';
            this.licenseStatus.className = 'license-status free';
        }
        if (this.licenseType) {
            this.licenseType.textContent = 'Free';
        }
        if (this.dailyDownloads) {
            this.dailyDownloads.textContent = '0/10';
        }
        if (this.startTrialBtn) {
            this.startTrialBtn.style.display = 'block';
        }
    }

    initializeElements() {
        this.downloadFolderInput = document.getElementById('downloadFolder');
        this.currentFolderDisplay = document.getElementById('currentFolderDisplay');
        this.currentFolderPath = document.getElementById('currentFolderPath');
        this.resetFolderBtn = document.getElementById('resetFolderBtn');
        this.saveSettingsBtn = document.getElementById('saveSettingsBtn');
        this.saveStatus = document.getElementById('saveStatus');
        this.settingsSummaryList = document.getElementById('settingsSummaryList');
        this.settingsSummaryUpdated = document.getElementById('settingsSummaryUpdated');

        // Checkboxes
        this.createSubfoldersCheck = document.getElementById('createSubfolders');
        this.avoidDuplicatesCheck = document.getElementById('avoidDuplicates');
        this.preserveStructureCheck = document.getElementById('preserveStructure');
        this.addTimestampCheck = document.getElementById('addTimestamp');
        this.addWebsiteNameCheck = document.getElementById('addWebsiteName');

        // License management elements
        this.licenseStatus = document.getElementById('license-status');
        this.dailyDownloads = document.getElementById('daily-downloads');
        this.licenseType = document.getElementById('license-type');
        this.startTrialBtn = document.getElementById('start-trial-btn');
        this.upgradeBtn = document.getElementById('upgrade-btn');
        this.activateLicenseBtn = document.getElementById('activate-license-btn');
    }

    bindEvents() {
        this.saveSettingsBtn.addEventListener('click', () => this.saveSettings());
        this.resetFolderBtn.addEventListener('click', () => this.resetFolder());

        // Auto-save on checkbox changes
        [
            this.createSubfoldersCheck,
            this.avoidDuplicatesCheck,
            this.preserveStructureCheck,
            this.addTimestampCheck,
            this.addWebsiteNameCheck
        ].forEach(checkbox => {
            checkbox.addEventListener('change', () => this.saveSettings());
        });

        // Update display when folder input changes
        this.downloadFolderInput.addEventListener('input', () => this.updateFolderDisplay());

        // Save on Enter key in folder input
        this.downloadFolderInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.saveSettings();
            }
        });

        const storage = this.getStorageApi();
        if (storage.onChanged) {
            storage.onChanged.addListener((changes, areaName) => {
                if (areaName !== 'sync') {
                    return;
                }
                const settingKeys = Object.keys(this.defaultSettings);
                const hasSettingChange = settingKeys.some((key) => key in changes);
                if (hasSettingChange) {
                    this.loadSettings();
                }
            });
        }

        // License management events
        if (this.startTrialBtn) {
            this.startTrialBtn.addEventListener('click', () => this.startTrial());
        }
        if (this.upgradeBtn) {
            this.upgradeBtn.addEventListener('click', () => this.showUpgradeModal());
        }
        if (this.activateLicenseBtn) {
            this.activateLicenseBtn.addEventListener('click', () => this.showActivationModal());
        }
    }

    async updateLicenseUI() {
        if (!this.licenseManager) {
            this.setDefaultLicenseUI();
            return;
        }

        try {
            const usage = await this.licenseManager.getUsage();
            const isActive = await this.licenseManager.hasActiveLicense();
            const isPro = await this.licenseManager.isProUser();
            const isTrial = await this.licenseManager.isTrialActive();

            // Update license status
            if (isPro) {
                this.licenseStatus.textContent = '✓ Pro License Active';
                this.licenseStatus.className = 'license-status pro';
                this.licenseType.textContent = 'Pro';
            } else if (isTrial) {
                const trialDays = await this.licenseManager.getTrialDaysRemaining();
                this.licenseStatus.textContent = `✓ Trial Active (${trialDays} days remaining)`;
                this.licenseStatus.className = 'license-status trial';
                this.licenseType.textContent = 'Trial';
            } else {
                this.licenseStatus.textContent = usage.isTrialExpired
                    ? 'Trial ended - Free License (Limited)'
                    : 'Free License (Limited)';
                this.licenseStatus.className = 'license-status free';
                this.licenseType.textContent = 'Free';
            }

            // Update usage stats
            if (this.dailyDownloads) {
                this.dailyDownloads.textContent = `${usage.dailyDownloads}/${usage.dailyLimit || 25}`;
            }

            // Add total downloads display if element exists
            const totalDownloadsEl = document.getElementById('total-downloads');
            if (totalDownloadsEl && usage.totalDownloads) {
                totalDownloadsEl.textContent = usage.totalDownloads;
            }

            // Update button visibility
            const trialAvailable = !isActive && !isTrial && !usage.isTrialExpired;
            this.startTrialBtn.style.display = trialAvailable ? 'block' : 'none';
            this.upgradeBtn.style.display = isPro ? 'none' : 'block';

        } catch (error) {
            console.error('Error updating license UI:', error);
            this.setDefaultLicenseUI();
        }
    }

    async startTrial() {
        if (!this.licenseManager) {
            this.showMessage('License manager not available. Please reload the page.', 'error');
            return;
        }

        try {
            await this.licenseManager.startTrial();
            await this.updateLicenseUI();
            this.showMessage('7-day free trial activated!', 'success');
        } catch (error) {
            console.error('Error starting trial:', error);
            this.showMessage(error.message || 'Failed to start trial. Please try again.', 'error');
        }
    }

    showUpgradeModal() {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'upgrade-modal-overlay';
        modal.innerHTML = `
            <div class="upgrade-modal">
                <div class="modal-header">
                    <h3>Upgrade to Pro</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-content">
                    <div class="license-comparison">
                        <div class="license-tier">
                            <h4>Free</h4>
                            <ul>
                                <li>25 downloads per day</li>
                                <li>3 files per batch</li>
                                <li>Basic file types</li>
                            </ul>
                        </div>
                        <div class="license-tier pro">
                            <h4>Pro</h4>
                            <ul>
                                <li>Unlimited downloads</li>
                                <li>Unlimited batch size</li>
                                <li>All file types</li>
                                <li>Priority support</li>
                            </ul>
                            <div class="price">$4.99/month</div>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button id="purchase-pro" class="btn upgrade-btn">Purchase Pro License</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Add event listeners
        modal.querySelector('.modal-close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modal.querySelector('#purchase-pro').addEventListener('click', async () => {
            try {
                const paymentResult = await this.licenseManager.processPayment('gumroad');
                if (paymentResult.success) {
                    document.body.removeChild(modal);
                    this.showPaymentInstructions(paymentResult);
                }
            } catch (error) {
                console.error('Payment error:', error);
                this.showMessage('Payment failed. Please try again.', 'error');
            }
        });

        // Close modal when clicking overlay
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    }

    showLicenseActivationError(modal, message) {
        const errorEl = modal.querySelector('#license-activation-error');
        if (!errorEl) {
            this.showMessage(message, 'error');
            return;
        }
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }

    clearLicenseActivationError(modal) {
        const errorEl = modal.querySelector('#license-activation-error');
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.style.display = 'none';
        }
    }

    showPaymentInstructions(paymentResult) {
        const modal = document.createElement('div');
        modal.className = 'upgrade-modal-overlay';
        modal.innerHTML = `
            <div class="upgrade-modal">
                <div class="modal-header">
                    <h3>Complete Your Purchase</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-content">
                    <p>${paymentResult.message}</p>
                    <div style="margin: 20px 0; padding: 15px; background: #f0f8ff; border-radius: 8px;">
                        <h4>Step 1:</h4>
                        <p>Complete your purchase on the Gumroad page that just opened.</p>
                        <h4>Step 2:</h4>
                        <p>You'll receive a license key via email after payment.</p>
                        <h4>Step 3:</h4>
                        <p>Enter your license key below to activate Pro features:</p>
                        <input type="text" id="payment-license-key" placeholder="Enter license key..."
                               style="width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 4px;">
                        <p id="license-activation-error" style="display: none; color: #F44336; font-size: 12px; margin: 8px 0 0;"></p>
                        <button id="activate-payment-license" class="btn upgrade-btn" style="width: 100%;">
                            Activate Pro License
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const closeModal = () => document.body.removeChild(modal);
        modal.querySelector('.modal-close').addEventListener('click', closeModal);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeModal();
        });

        modal.querySelector('#activate-payment-license').addEventListener('click', async () => {
            const licenseKey = modal.querySelector('#payment-license-key').value.trim();
            this.clearLicenseActivationError(modal);

            if (!licenseKey) {
                this.showLicenseActivationError(modal, 'Please enter your license key.');
                return;
            }

            try {
                await this.licenseManager.activateLicense(licenseKey);
                await this.updateLicenseUI();
                closeModal();
                this.showMessage('Pro license activated! Enjoy unlimited downloads!', 'success');
            } catch (error) {
                console.error('License activation error:', error);
                this.showLicenseActivationError(
                    modal,
                    error.message || 'Invalid license key. Please check and try again.'
                );
            }
        });
    }

    showActivationModal() {
        // Create activation modal
        const modal = document.createElement('div');
        modal.className = 'upgrade-modal-overlay';
        modal.innerHTML = `
            <div class="upgrade-modal">
                <div class="modal-header">
                    <h3>Activate License Key</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-content">
                    <p>Enter your license key to activate Pro features:</p>
                    <input type="text" id="license-key-input" placeholder="Enter license key..." 
                           style="width: 100%; padding: 10px; margin: 15px 0; border: 1px solid #ccc; border-radius: 4px;">
                    <p id="license-activation-error" style="display: none; color: #F44336; font-size: 12px; margin: 0 0 12px;"></p>
                    <div class="modal-actions">
                        <button id="activate-key" class="btn upgrade-btn">Activate</button>
                        <button id="cancel-activation" class="btn secondary-btn">Cancel</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Add event listeners
        const closeModal = () => document.body.removeChild(modal);

        modal.querySelector('.modal-close').addEventListener('click', closeModal);
        modal.querySelector('#cancel-activation').addEventListener('click', closeModal);

        modal.querySelector('#activate-key').addEventListener('click', async () => {
            const licenseKey = modal.querySelector('#license-key-input').value.trim();
            this.clearLicenseActivationError(modal);

            if (!licenseKey) {
                this.showLicenseActivationError(modal, 'Please enter a license key.');
                return;
            }

            try {
                await this.licenseManager.activateLicense(licenseKey);
                await this.updateLicenseUI();
                closeModal();
                this.showMessage('License activated successfully!', 'success');
            } catch (error) {
                console.error('License activation error:', error);
                this.showLicenseActivationError(
                    modal,
                    error.message || 'Invalid license key. Please try again.'
                );
            }
        });

        // Close modal when clicking overlay
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }

    getStorageApi() {
        if (this.browserCompat?.api?.storage?.sync) {
            return this.browserCompat.api.storage.sync;
        }
        if (typeof browser !== 'undefined' && browser.storage?.sync) {
            return browser.storage.sync;
        }
        return chrome.storage.sync;
    }

    collectSettingsFromForm() {
        return {
            downloadFolder: this.downloadFolderInput.value.trim(),
            createSubfolders: this.createSubfoldersCheck.checked,
            avoidDuplicates: this.avoidDuplicatesCheck.checked,
            preserveStructure: this.preserveStructureCheck.checked,
            addTimestamp: this.addTimestampCheck.checked,
            addWebsiteName: this.addWebsiteNameCheck.checked
        };
    }

    applySettingsToForm(settings) {
        this.downloadFolderInput.value = settings.downloadFolder || '';
        this.createSubfoldersCheck.checked = Boolean(settings.createSubfolders);
        this.avoidDuplicatesCheck.checked = settings.avoidDuplicates !== false;
        this.preserveStructureCheck.checked = Boolean(settings.preserveStructure);
        this.addTimestampCheck.checked = Boolean(settings.addTimestamp);
        this.addWebsiteNameCheck.checked = Boolean(settings.addWebsiteName);
    }

    formatOnOff(value) {
        return value ? 'On' : 'Off';
    }

    updateSettingsSummary(settings, savedAt = this.lastSavedAt) {
        if (!this.settingsSummaryList) {
            return;
        }

        const folderLabel = settings.downloadFolder || 'Default Downloads folder';
        const rows = [
            ['Download folder', folderLabel],
            ['Subfolders by type', this.formatOnOff(settings.createSubfolders)],
            ['Rename duplicates', this.formatOnOff(settings.avoidDuplicates)],
            ['Preserve site structure', this.formatOnOff(settings.preserveStructure)],
            ['Timestamp in filenames', this.formatOnOff(settings.addTimestamp)],
            ['Website name prefix', this.formatOnOff(settings.addWebsiteName)]
        ];

        this.settingsSummaryList.innerHTML = rows.map(([label, value]) => {
            const isToggle = value === 'On' || value === 'Off';
            const valueClass = isToggle ? (value === 'On' ? 'on' : 'off') : '';
            return `
                <li>
                    <span class="label">${label}</span>
                    <span class="value ${valueClass}">${value}</span>
                </li>
            `;
        }).join('');

        if (this.settingsSummaryUpdated) {
            this.settingsSummaryUpdated.textContent = savedAt
                ? `Last saved: ${savedAt.toLocaleString()}`
                : 'Not saved yet on this device';
        }
    }

    showFeedback(message, type = 'success') {
        if (!this.saveStatus) {
            return;
        }

        if (this.statusHideTimer) {
            clearTimeout(this.statusHideTimer);
            this.statusHideTimer = null;
        }

        this.saveStatus.textContent = message;
        this.saveStatus.className = `save-status visible ${type}`;

        this.statusHideTimer = setTimeout(() => {
            this.saveStatus.className = 'save-status';
            this.saveStatus.textContent = '';
            this.statusHideTimer = null;
        }, 4000);
    }

    showSaveButtonFeedback() {
        if (!this.saveSettingsBtn) {
            return;
        }

        const originalText = 'Save Settings';
        this.saveSettingsBtn.textContent = 'Saved!';
        this.saveSettingsBtn.classList.add('saved');
        this.saveSettingsBtn.disabled = true;

        if (this.saveButtonResetTimer) {
            clearTimeout(this.saveButtonResetTimer);
        }

        this.saveButtonResetTimer = setTimeout(() => {
            this.saveSettingsBtn.textContent = originalText;
            this.saveSettingsBtn.classList.remove('saved');
            this.saveSettingsBtn.disabled = false;
            this.saveButtonResetTimer = null;
        }, 2000);
    }

    showMessage(text, type = 'success') {
        this.showFeedback(text, type);
    }

    async loadSettings() {
        try {
            const storage = this.getStorageApi();
            const stored = await storage.get({
                ...this.defaultSettings,
                settingsUpdatedAt: null
            });
            this.applySettingsToForm(stored);
            this.updateFolderDisplay();

            if (stored.settingsUpdatedAt) {
                this.lastSavedAt = new Date(stored.settingsUpdatedAt);
            }
            this.updateSettingsSummary(stored, this.lastSavedAt);

            console.log('Settings loaded:', stored);
        } catch (error) {
            console.error('Error loading settings:', error);
            this.showFeedback('Error loading settings', 'error');
        }
    }

    async saveSettings() {
        try {
            const settings = this.collectSettingsFromForm();
            this.lastSavedAt = new Date();
            const storage = this.getStorageApi();
            await storage.set({
                ...settings,
                settingsUpdatedAt: this.lastSavedAt.toISOString()
            });

            this.applySettingsToForm(settings);
            this.updateFolderDisplay();
            this.updateSettingsSummary(settings, this.lastSavedAt);
            this.showSaveButtonFeedback();
            this.showFeedback('Settings saved successfully!', 'success');

            console.log('Settings saved:', settings);
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showFeedback('Error saving settings. Please try again.', 'error');
        }
    }

    resetFolder() {
        this.downloadFolderInput.value = '';
        this.updateFolderDisplay();
        this.saveSettings();
    }

    updateFolderDisplay() {
        const folderValue = this.downloadFolderInput.value.trim();
        this.currentFolderPath.textContent = folderValue || 'Default Downloads folder';
    }

    showStatus(message, type) {
        this.showFeedback(message, type);
    }
}

// Utility functions for getting settings
window.getDownloadSettings = async function () {
    const defaultSettings = {
        downloadFolder: '',
        createSubfolders: false,
        avoidDuplicates: true,
        preserveStructure: false,
        addTimestamp: false,
        addWebsiteName: false
    };

    try {
        return await chrome.storage.sync.get(defaultSettings);
    } catch (error) {
        console.error('Error getting settings:', error);
        return defaultSettings;
    }
};

// Initialize settings manager when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.settingsManager = new SettingsManager();

    // Add link to open this page from popup
    console.log('Options page loaded. Access via chrome://extensions/ → Extension details → Extension options');
});