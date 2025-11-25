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

        this.initializeElements();
        this.loadSettings();
        this.bindEvents();
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