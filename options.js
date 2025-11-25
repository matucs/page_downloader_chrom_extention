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

        this.licenseManager = null;
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
                this.licenseStatus.textContent = 'Free License (Limited)';
                this.licenseStatus.className = 'license-status free';
                this.licenseType.textContent = 'Free';
            }

            // Update usage stats
            if (this.dailyDownloads) {
                this.dailyDownloads.textContent = `${usage.dailyDownloads}/25`;
            }

            // Add total downloads display if element exists
            const totalDownloadsEl = document.getElementById('total-downloads');
            if (totalDownloadsEl && usage.totalDownloads) {
                totalDownloadsEl.textContent = usage.totalDownloads;
            }

            // Update button visibility
            this.startTrialBtn.style.display = !isActive ? 'block' : 'none';
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
            this.showMessage('Failed to start trial. Please try again.', 'error');
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
                                <li>10 downloads per day</li>
                                <li>5 files per batch</li>
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

        modal.querySelector('#purchase-pro').addEventListener('click', () => {
            this.showMessage('Payment integration coming soon! Please check back later.', 'info');
            document.body.removeChild(modal);
        });

        // Close modal when clicking overlay
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
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
            if (!licenseKey) {
                this.showMessage('Please enter a license key.', 'error');
                return;
            }

            try {
                await this.licenseManager.activateLicense(licenseKey);
                await this.updateLicenseUI();
                closeModal();
                this.showMessage('License activated successfully!', 'success');
            } catch (error) {
                console.error('License activation error:', error);
                this.showMessage('Invalid license key. Please try again.', 'error');
            }
        });

        // Close modal when clicking overlay
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }

    showMessage(text, type = 'success') {
        this.saveStatus.textContent = text;
        this.saveStatus.className = `save-status ${type}`;
        this.saveStatus.style.display = 'block';

        setTimeout(() => {
            this.saveStatus.style.display = 'none';
        }, 3000);
    }

    async loadSettings() {
        try {
            const stored = await chrome.storage.sync.get(this.defaultSettings);

            // Update input values
            this.downloadFolderInput.value = stored.downloadFolder || '';
            this.createSubfoldersCheck.checked = stored.createSubfolders;
            this.avoidDuplicatesCheck.checked = stored.avoidDuplicates;
            this.preserveStructureCheck.checked = stored.preserveStructure;
            this.addTimestampCheck.checked = stored.addTimestamp;
            this.addWebsiteNameCheck.checked = stored.addWebsiteName;

            this.updateFolderDisplay();

            console.log('Settings loaded:', stored);
        } catch (error) {
            console.error('Error loading settings:', error);
            this.showStatus('Error loading settings', 'error');
        }
    }

    async saveSettings() {
        try {
            const settings = {
                downloadFolder: this.downloadFolderInput.value.trim(),
                createSubfolders: this.createSubfoldersCheck.checked,
                avoidDuplicates: this.avoidDuplicatesCheck.checked,
                preserveStructure: this.preserveStructureCheck.checked,
                addTimestamp: this.addTimestampCheck.checked,
                addWebsiteName: this.addWebsiteNameCheck.checked
            };

            await chrome.storage.sync.set(settings);
            this.updateFolderDisplay();
            this.showStatus('Settings saved successfully!', 'success');

            console.log('Settings saved:', settings);
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showStatus('Error saving settings', 'error');
        }
    }

    resetFolder() {
        this.downloadFolderInput.value = '';
        this.updateFolderDisplay();
        this.saveSettings();
    }

    updateFolderDisplay() {
        const folderValue = this.downloadFolderInput.value.trim();

        if (folderValue) {
            this.currentFolderPath.textContent = folderValue;
            this.currentFolderDisplay.style.display = 'block';
        } else {
            this.currentFolderPath.textContent = 'Default Downloads folder';
            this.currentFolderDisplay.style.display = 'block';
        }
    }

    showStatus(message, type) {
        this.saveStatus.textContent = message;
        this.saveStatus.className = `save-status ${type}`;

        // Hide status after 3 seconds
        setTimeout(() => {
            this.saveStatus.style.display = 'none';
            setTimeout(() => {
                this.saveStatus.className = 'save-status';
            }, 300);
        }, 3000);
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