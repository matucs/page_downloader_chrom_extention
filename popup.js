// Popup JavaScript for Webpage Resource Downloader Extension

class ResourceDownloader {
    constructor() {
        this.resources = [];
        this.selectedResources = new Set();
        this.currentFilter = 'all';
        this.isScanning = false;
        this.isDownloading = false;
        this.licenseManager = null;
        
        this.initializeElements();
        this.bindEvents();
        this.updateUI();
        this.initializeLicense();
        this.updateDownloadLocationInfo();
    }

    async initializeLicense() {
        try {
            if (typeof LicenseManager !== 'undefined') {
                this.licenseManager = new LicenseManager();
                await this.updateLicenseStatus();
            } else {
                console.warn('LicenseManager not available');
                // Set default free license status
                this.updateLicenseStatusDisplay(false, false, { dailyDownloads: 0 });
            }
        } catch (error) {
            console.error('Error initializing license:', error);
            // Set default free license status on error
            this.updateLicenseStatusDisplay(false, false, { dailyDownloads: 0 });
        }
    }    initializeElements() {
        // Main buttons
        this.scanBtn = document.getElementById('scanBtn');
        this.settingsBtn = document.getElementById('settingsBtn');
        this.selectAllBtn = document.getElementById('selectAllBtn');
        this.selectNoneBtn = document.getElementById('selectNoneBtn');
        this.downloadSelectedBtn = document.getElementById('downloadSelectedBtn');

        // Filter buttons
        this.filterBtns = document.querySelectorAll('.filter-btn');

        // Display elements
        this.statusSection = document.getElementById('statusSection');
        this.statusMessage = document.getElementById('statusMessage');
        this.progressBar = document.getElementById('progressBar');
        this.controlsSection = document.getElementById('controlsSection');
        this.resourceList = document.getElementById('resourceList');
        this.downloadSection = document.getElementById('downloadSection');
        this.downloadProgress = document.getElementById('downloadProgress');

        // Counters
        this.resourceCount = document.getElementById('resourceCount');
        this.selectedCount = document.getElementById('selectedCount');
        this.downloadStatus = document.getElementById('downloadStatus');
        this.downloadLocationInfo = document.getElementById('downloadLocationInfo');
        
        // License elements
        this.licenseStatus = document.getElementById('licenseStatus');
        this.licenseStatusText = document.getElementById('licenseStatusText');
        this.upgradeBtn = document.getElementById('upgradeBtn');
        this.limitWarning = document.getElementById('limitWarning');
        this.limitMessage = document.getElementById('limitMessage');
        this.upgradeLimitBtn = document.getElementById('upgradeLimitBtn');
    }

    bindEvents() {
        // Main action buttons
        this.scanBtn.addEventListener('click', () => this.scanPage());
        this.settingsBtn.addEventListener('click', () => this.openSettings());
        this.selectAllBtn.addEventListener('click', () => this.selectAll());
        this.selectNoneBtn.addEventListener('click', () => this.selectNone());
        this.downloadSelectedBtn.addEventListener('click', () => this.downloadSelected());
        
        // License buttons
        this.upgradeBtn.addEventListener('click', () => this.showUpgradeModal());
        this.upgradeLimitBtn.addEventListener('click', () => this.showUpgradeModal());

        // Filter buttons
        this.filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => this.setFilter(e.target.dataset.filter));
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'a') {
                    e.preventDefault();
                    this.selectAll();
                } else if (e.key === 'd') {
                    e.preventDefault();
                    if (this.selectedResources.size > 0) {
                        this.downloadSelected();
                    }
                }
            } else if (e.key === 'Escape') {
                this.selectNone();
            }
        });
    }

    async scanPage() {
        if (this.isScanning) return;

        this.isScanning = true;
        this.updateScanningUI(true);

        try {
            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab) {
                throw new Error('No active tab found');
            }

            console.log('Scanning tab:', tab.id, tab.url);

            // Add a timeout to the message sending
            const response = await Promise.race([
                this.sendMessage({
                    action: 'scanPage',
                    tabId: tab.id  // Pass the tab ID explicitly
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Scan timeout after 10 seconds')), 10000)
                )
            ]);

            console.log('Scan response:', response);

            if (response && response.success) {
                this.resources = response.resources || [];
                this.selectedResources.clear();
                this.displayResources();
                this.updateUI();

                if (this.resources.length === 0) {
                    this.showStatus('No downloadable resources found on this page');
                } else {
                    this.showStatus(`Found ${this.resources.length} downloadable resources`);
                }
            } else {
                throw new Error((response && response.error) || 'Failed to scan page');
            }

        } catch (error) {
            console.error('Error scanning page:', error);
            this.showStatus(`Error: ${error.message}`);
            this.resources = [];
            this.selectedResources.clear();
            this.updateUI();
        } finally {
            this.isScanning = false;
            this.updateScanningUI(false);
        }
    }

    displayResources() {
        this.resourceList.innerHTML = '';

        if (this.resources.length === 0) {
            this.showEmptyState();
            return;
        }

        const filteredResources = this.filterResources();

        if (filteredResources.length === 0) {
            this.showEmptyState('No resources match the current filter');
            return;
        }

        filteredResources.forEach((resource, index) => {
            const resourceItem = this.createResourceItem(resource, index);
            this.resourceList.appendChild(resourceItem);
        });

        this.controlsSection.style.display = 'block';
        this.resourceList.style.display = 'block';
        this.downloadSection.style.display = 'block';
    }

    createResourceItem(resource, index) {
        const item = document.createElement('div');
        item.className = 'resource-item';
        item.dataset.index = index;
        item.dataset.type = resource.type;

        const checkbox = document.createElement('div');
        checkbox.className = 'resource-checkbox';
        checkbox.innerHTML = `
            <input type="checkbox" id="resource-${index}" data-resource-index="${index}" ${this.selectedResources.has(index) ? 'checked' : ''}>
        `;

        const info = document.createElement('div');
        info.className = 'resource-info';

        const title = this.truncateText(resource.text || resource.filename || 'Unknown', 50);
        const fileSize = this.getFileSizeDisplay(resource);
        const extension = resource.extension ? resource.extension.toUpperCase() : 'FILE';

        // Determine platform-specific type for styling
        let platformType = resource.type;
        if (resource.element === 'youtube-embed' || resource.element === 'youtube-player') {
            platformType = 'youtube';
        } else if (resource.element === 'vimeo-embed') {
            platformType = 'vimeo';
        } else if (resource.element === 'twitch-embed') {
            platformType = 'twitch';
        } else if (resource.element === 'blob-media') {
            platformType = 'blob';
        } else if (resource.element === 'streaming-manifest') {
            platformType = 'streaming';
        }

        info.innerHTML = `
            <div class="resource-title">${this.escapeHtml(title)}</div>
            <div class="resource-details">
                <span class="resource-type type-${platformType}">${extension}</span>
                ${fileSize}
                <span style="margin-left: 8px;">from ${resource.element}</span>
            </div>
            <div class="resource-url">${this.escapeHtml(this.truncateText(resource.url, 60))}</div>
        `;

        item.appendChild(checkbox);
        item.appendChild(info);

        // Add click handler
        const checkboxInput = checkbox.querySelector('input');
        checkboxInput.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.selectedResources.add(index);
            } else {
                this.selectedResources.delete(index);
            }
            this.updateSelectionUI();
        });

        // Make the entire item clickable
        item.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox') {
                checkboxInput.checked = !checkboxInput.checked;
                checkboxInput.dispatchEvent(new Event('change'));
            }
        });

        return item;
    }

    filterResources() {
        if (this.currentFilter === 'all') {
            return this.resources;
        }
        return this.resources.filter(resource => resource.type === this.currentFilter);
    }

    setFilter(filter) {
        this.currentFilter = filter;

        // Update filter button states
        this.filterBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });

        // Re-display resources with new filter
        this.displayResources();
        this.updateUI();
    }

    selectAll() {
        const filteredResources = this.filterResources();
        
        // Check if all filtered resources are already selected
        const allFilteredSelected = filteredResources.every(resource => {
            const originalIndex = this.resources.indexOf(resource);
            return this.selectedResources.has(originalIndex);
        });
        
        if (allFilteredSelected) {
            // If all are selected, deselect all (toggle behavior)
            filteredResources.forEach(resource => {
                const originalIndex = this.resources.indexOf(resource);
                this.selectedResources.delete(originalIndex);
            });
        } else {
            // If not all are selected, select all
            filteredResources.forEach(resource => {
                const originalIndex = this.resources.indexOf(resource);
                this.selectedResources.add(originalIndex);
            });
        }

        // Update checkboxes to match the selection state
        const checkboxes = document.querySelectorAll('.resource-item input[type="checkbox"]');
        checkboxes.forEach((checkbox, index) => {
            const resourceIndex = parseInt(checkbox.dataset.resourceIndex) || index;
            checkbox.checked = this.selectedResources.has(resourceIndex);
        });

        this.updateSelectionUI();
    }

    selectNone() {
        this.selectedResources.clear();

        // Update checkboxes
        document.querySelectorAll('.resource-item input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = false;
        });

        this.updateSelectionUI();
    }

    async downloadSelected() {
        if (this.selectedResources.size === 0 || this.isDownloading) {
            return;
        }
        
        // Check license limits if license manager is available
        if (this.licenseManager) {
            try {
                const canDownload = await this.licenseManager.canDownload(this.selectedResources.size);
                
                if (!canDownload.allowed) {
                    this.showImprovedLimitWarning(canDownload);
                    return;
                }
            } catch (error) {
                console.error('Error checking license limits:', error);
                // Continue with download if license check fails
            }
        }

        this.isDownloading = true;
        this.updateDownloadingUI(true);

        try {
            const selectedResourceObjects = Array.from(this.selectedResources).map(index => ({
                ...this.resources[index],
                filename: this.generateSafeFilename(this.resources[index])
            }));

            this.downloadStatus.textContent = `Downloading ${selectedResourceObjects.length} files...`;

            const response = await this.sendMessage({
                action: 'downloadResources',
                resources: selectedResourceObjects
            });

            if (response && response.success) {
                const { downloaded, failed, total } = response;
                
                // Record downloads for license tracking
                await this.licenseManager.recordDownload(downloaded);
                
                this.downloadStatus.textContent =
                    `Download complete! ${downloaded} successful, ${failed} failed out of ${total} total`;

                // Update license status
                await this.updateLicenseStatus();

                // Clear selection after successful download
                setTimeout(() => {
                    this.selectNone();
                    this.updateDownloadingUI(false);
                }, 3000);
            } else {
                throw new Error((response && response.error) || 'Download failed');
            }

        } catch (error) {
            console.error('Error downloading resources:', error);
            this.downloadStatus.textContent = `Download error: ${error.message}`;
            setTimeout(() => {
                this.updateDownloadingUI(false);
            }, 3000);
        } finally {
            this.isDownloading = false;
        }
    }

    generateSafeFilename(resource) {
        let filename = resource.filename;

        // Remove unsafe characters
        filename = filename.replace(/[<>:"/\\|?*]/g, '_');

        // Ensure it has an extension
        if (!filename.includes('.') && resource.extension) {
            filename += `.${resource.extension}`;
        }

        // Limit length
        if (filename.length > 100) {
            const ext = filename.substring(filename.lastIndexOf('.'));
            filename = filename.substring(0, 100 - ext.length) + ext;
        }

        return filename;
    }

    updateUI() {
        const filteredResources = this.filterResources();
        
        // Update counters
        this.resourceCount.textContent = filteredResources.length;
        this.selectedCount.textContent = this.selectedResources.size;

        // Update button states
        this.downloadSelectedBtn.disabled = this.selectedResources.size === 0 || this.isDownloading;

        // Update Select All button text based on current selection state
        if (filteredResources.length > 0) {
            const allFilteredSelected = filteredResources.every(resource => {
                const originalIndex = this.resources.indexOf(resource);
                return this.selectedResources.has(originalIndex);
            });
            this.selectAllBtn.textContent = allFilteredSelected ? 'Deselect All' : 'Select All';
        } else {
            this.selectAllBtn.textContent = 'Select All';
        }

        // Update button text
        this.downloadSelectedBtn.innerHTML = `
            <span class="btn-icon">⬇️</span>
            Download Selected (${this.selectedResources.size})
        `;
    }

    updateSelectionUI() {
        this.updateUI();
    }

    updateScanningUI(isScanning) {
        if (isScanning) {
            this.scanBtn.disabled = true;
            this.scanBtn.innerHTML = '<span class="btn-icon loading">🔍</span>Scanning...';
            this.progressBar.style.display = 'block';
            this.statusMessage.textContent = 'Scanning page for resources...';
        } else {
            this.scanBtn.disabled = false;
            this.scanBtn.innerHTML = '<span class="btn-icon">🔍</span>Scan Page';
            this.progressBar.style.display = 'none';
        }
    }

    updateDownloadingUI(isDownloading) {
        if (isDownloading) {
            this.downloadProgress.style.display = 'block';
            this.downloadSelectedBtn.disabled = true;
        } else {
            this.downloadProgress.style.display = 'none';
            this.downloadSelectedBtn.disabled = this.selectedResources.size === 0;
        }
    }

    showStatus(message) {
        this.statusMessage.textContent = message;
    }

    showEmptyState(message = 'No resources to display') {
        this.resourceList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📂</div>
                <div class="empty-state-text">${this.escapeHtml(message)}</div>
            </div>
        `;
    }

    // Utility functions
    sendMessage(message) {
        return new Promise((resolve, reject) => {
            console.log('Sending message:', message);

            chrome.runtime.sendMessage(message, (response) => {
                console.log('Received response:', response, 'Error:', chrome.runtime.lastError);

                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (response === undefined) {
                    reject(new Error('No response from background script'));
                    return;
                }

                resolve(response);
            });
        });
    }

    openSettings() {
        chrome.runtime.openOptionsPage();
    }

    async updateDownloadLocationInfo() {
        try {
            const settings = await this.getDownloadSettings();
            let locationText = 'Downloads to: ';

            if (settings.downloadFolder) {
                locationText += settings.downloadFolder;
            } else {
                locationText += 'Default download folder';
            }

            if (settings.createSubfolders) {
                locationText += ' (organized by type)';
            }

            this.downloadLocationInfo.textContent = locationText;
        } catch (error) {
            console.error('Error updating download location info:', error);
        }
    }

    async getDownloadSettings() {
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
    }

    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    getFileSizeDisplay(resource) {
        // This is a placeholder - actual file size detection would require additional API calls
        return '';
    }

    // License-related methods for freemium features
    async updateLicenseStatus() {
        if (!this.licenseManager) {
            this.updateLicenseStatusDisplay(false, false, { dailyDownloads: 0 });
            return;
        }

        try {
            const isActive = await this.licenseManager.hasActiveLicense();
            const isPro = await this.licenseManager.isProUser();
            const usage = await this.licenseManager.getUsage();
            
            this.updateLicenseStatusDisplay(isActive, isPro, usage);
        } catch (error) {
            console.error('Error updating license status:', error);
            this.updateLicenseStatusDisplay(false, false, { dailyDownloads: 0 });
        }
    }

    updateLicenseStatusDisplay(isActive, isPro, usage) {
        if (!this.licenseStatus) return;
        
        if (isPro) {
            this.licenseStatus.innerHTML = '<span style="color: #4CAF50;">✓ Pro License Active - Unlimited Downloads</span>';
        } else {
            const downloadsUsed = usage?.dailyDownloads || 0;
            const totalDownloads = usage?.totalDownloads || 0;
            const remaining = 25 - downloadsUsed;
            
            // Show encouraging progress message
            let progressMessage = '';
            if (totalDownloads > 100) {
                progressMessage = ` • ${totalDownloads} total downloads! You're a power user 🚀`;
            } else if (totalDownloads > 50) {
                progressMessage = ` • ${totalDownloads} downloads so far! Keep going 📈`;
            } else if (totalDownloads > 10) {
                progressMessage = ` • ${totalDownloads} downloads and counting 📊`;
            }
            
            this.licenseStatus.innerHTML = `
                <div style="color: #2196F3; font-size: 12px;">
                    Free Plan: ${downloadsUsed}/25 used today
                    <div style="background: #E3F2FD; border-radius: 10px; height: 6px; margin: 4px 0;">
                        <div style="background: #2196F3; height: 100%; border-radius: 10px; width: ${Math.min(100, (downloadsUsed/25)*100)}%; transition: width 0.3s ease;"></div>
                    </div>
                    ${remaining} downloads left today${progressMessage}
                </div>
            `;
        }
        
        if (this.upgradeBtn) {
            this.upgradeBtn.style.display = isPro ? 'none' : 'block';
        }
        if (this.trialBtn) {
            this.trialBtn.style.display = !isActive ? 'block' : 'none';
        }
    }

    async updateDownloadButtonText() {
        try {
            const selectedCount = this.selectedResources.size;
            
            if (!this.licenseManager) {
                this.downloadSelectedBtn.textContent = `Download Selected (${selectedCount})`;
                this.downloadSelectedBtn.disabled = selectedCount === 0 || this.isDownloading;
                return;
            }
            
            const canDownload = await this.licenseManager.canDownload(selectedCount);
            
            if (canDownload.allowed) {
                this.downloadSelectedBtn.textContent = `Download Selected (${selectedCount})`;
                this.downloadSelectedBtn.disabled = selectedCount === 0 || this.isDownloading;
            } else {
                this.downloadSelectedBtn.textContent = 'Download Limit Reached';
                this.downloadSelectedBtn.disabled = true;
            }
        } catch (error) {
            console.error('Error updating download button:', error);
            // Fallback to basic functionality
            const selectedCount = this.selectedResources.size;
            this.downloadSelectedBtn.textContent = `Download Selected (${selectedCount})`;
            this.downloadSelectedBtn.disabled = selectedCount === 0 || this.isDownloading;
        }
    }

    showDownloadLimitWarning(canDownloadResult = null) {
        if (!this.downloadLimit) return;
        
        this.downloadLimit.style.display = 'block';
        this.downloadLimit.innerHTML = `
            <div class="warning-content">
                <strong>Download Limit Reached</strong>
                <p>You've reached your daily download limit. Upgrade to Pro for unlimited downloads!</p>
                <button id="upgrade-from-warning" class="upgrade-btn" style="margin-top: 10px;">
                    Upgrade to Pro
                </button>
            </div>
        `;
        
        const upgradeBtn = document.getElementById('upgrade-from-warning');
        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', () => {
                this.showUpgradeModal();
            });
        }
    }
    
    showImprovedLimitWarning(canDownloadResult) {
        if (!this.downloadLimit) return;
        
        this.downloadLimit.style.display = 'block';
        
        let content = '';
        if (canDownloadResult.reason === 'batch_limit') {
            content = `
                <div class="info-content" style="background: #E3F2FD; border: 1px solid #42A5F5; color: #1565C0; padding: 15px; border-radius: 8px;">
                    <strong>💡 Tip: Smaller batches work better!</strong>
                    <p>${canDownloadResult.message}</p>
                    <p>${canDownloadResult.suggestion}</p>
                    <button id="upgrade-batch-warning" class="upgrade-btn" style="margin-top: 10px;">
                        Upgrade to Pro for Unlimited Batches
                    </button>
                </div>
            `;
        } else if (canDownloadResult.reason === 'daily_limit') {
            const stats = canDownloadResult.stats || {};
            content = `
                <div class="progress-content" style="background: linear-gradient(135deg, #E8F5E8, #E3F2FD); border: 1px solid #4CAF50; color: #2E7D32; padding: 15px; border-radius: 8px;">
                    <strong>🎉 Daily limit reached! You're an active user!</strong>
                    <p>${canDownloadResult.message}</p>
                    
                    ${stats.totalDownloads > 50 ? `
                        <div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.8); border-radius: 6px;">
                            📊 <strong>Your Stats:</strong><br>
                            • Total downloads: ${stats.totalDownloads}<br>
                            • Average per day: ${stats.averageDownloadsPerDay}<br>
                            • Days using extension: ${stats.daysSinceFirstUse}
                        </div>
                        <p><strong>You're clearly getting value from this extension!</strong><br>
                        Pro features would save you even more time.</p>
                    ` : ''}
                    
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button id="try-tomorrow" class="btn" style="background: #4CAF50; color: white; flex: 1; padding: 8px; border: none; border-radius: 4px; cursor: pointer;">
                            ✨ Come back tomorrow (25 more downloads!)
                        </button>
                        <button id="upgrade-daily-warning" class="upgrade-btn" style="flex: 1;">
                            🚀 Upgrade to Pro
                        </button>
                    </div>
                </div>
            `;
        }
        
        this.downloadLimit.innerHTML = content;
        
        // Event listeners
        const upgradeBatchBtn = document.getElementById('upgrade-batch-warning');
        if (upgradeBatchBtn) {
            upgradeBatchBtn.addEventListener('click', () => {
                this.showUpgradeModal();
            });
        }
        
        const upgradeDailyBtn = document.getElementById('upgrade-daily-warning');
        if (upgradeDailyBtn) {
            upgradeDailyBtn.addEventListener('click', () => {
                this.showUpgradeModal();
            });
        }
        
        const tryTomorrowBtn = document.getElementById('try-tomorrow');
        if (tryTomorrowBtn) {
            tryTomorrowBtn.addEventListener('click', () => {
                this.downloadLimit.style.display = 'none';
                this.showMessage('Thanks for using our extension! Come back tomorrow for 25 more free downloads! 🌟', 'info');
            });
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
                                <li>Progress tracking</li>
                            </ul>
                        </div>
                        <div class="license-tier pro">
                            <h4>Pro</h4>
                            <ul>
                                <li>Unlimited downloads</li>
                                <li>Unlimited batch size</li>
                                <li>All file types</li>
                                <li>Advanced organization</li>
                                <li>Custom folders</li>
                                <li>Priority support</li>
                            </ul>
                            <div class="price">$4.99/month</div>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button id="start-trial" class="trial-btn">Start 7-Day Free Trial</button>
                        <button id="purchase-pro" class="upgrade-btn">Purchase Pro License</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Add event listeners
        modal.querySelector('.modal-close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modal.querySelector('#start-trial').addEventListener('click', async () => {
            try {
                await this.licenseManager.startTrial();
                await this.updateLicenseStatus();
                await this.updateDownloadButtonText();
                document.body.removeChild(modal);
                this.showMessage('7-day free trial activated!', 'success');
            } catch (error) {
                console.error('Error starting trial:', error);
                this.showMessage('Failed to start trial. Please try again.', 'error');
            }
        });

        modal.querySelector('#purchase-pro').addEventListener('click', async () => {
            try {
                // Start payment process (defaulting to Gumroad for simplicity)
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

    showMessage(text, type = 'info') {
        const message = document.createElement('div');
        message.className = `message message-${type}`;
        message.textContent = text;
        message.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            color: white;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
        `;

        switch (type) {
            case 'success':
                message.style.backgroundColor = '#4CAF50';
                break;
            case 'error':
                message.style.backgroundColor = '#F44336';
                break;
            case 'warning':
                message.style.backgroundColor = '#FF9800';
                break;
            default:
                message.style.backgroundColor = '#2196F3';
        }

        document.body.appendChild(message);

        setTimeout(() => {
            document.body.removeChild(message);
        }, 5000);
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
                        
                        <button id="activate-payment-license" class="upgrade-btn" style="width: 100%;">
                            Activate Pro License
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close modal handler
        modal.querySelector('.modal-close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        // License activation handler
        modal.querySelector('#activate-payment-license').addEventListener('click', async () => {
            const licenseKey = modal.querySelector('#payment-license-key').value.trim();
            
            if (!licenseKey) {
                this.showMessage('Please enter your license key.', 'error');
                return;
            }

            try {
                await this.licenseManager.activateLicense(licenseKey);
                await this.updateLicenseStatus();
                document.body.removeChild(modal);
                this.showMessage('🎉 Pro license activated! Enjoy unlimited downloads!', 'success');
            } catch (error) {
                console.error('License activation error:', error);
                this.showMessage('Invalid license key. Please check and try again.', 'error');
            }
        });

        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    }
}

// Initialize the extension popup
document.addEventListener('DOMContentLoaded', () => {
    window.resourceDownloader = new ResourceDownloader();
});

// Handle extension updates or errors
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'downloadProgress') {
        // Handle download progress updates if needed
        console.log('Download progress:', message.progress);
    }
});