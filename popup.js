// Popup JavaScript for Webpage Resource Downloader Extension

class ResourceDownloader {
    constructor() {
        this.resources = [];
        this.selectedResources = new Set();
        this.currentFilter = 'all';
        this.isScanning = false;
        this.isDownloading = false;

        this.initializeElements();
        this.bindEvents();
        this.updateUI();
    }

    initializeElements() {
        // Main buttons
        this.scanBtn = document.getElementById('scanBtn');
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
    }

    bindEvents() {
        // Main action buttons
        this.scanBtn.addEventListener('click', () => this.scanPage());
        this.selectAllBtn.addEventListener('click', () => this.selectAll());
        this.selectNoneBtn.addEventListener('click', () => this.selectNone());
        this.downloadSelectedBtn.addEventListener('click', () => this.downloadSelected());

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
            <input type="checkbox" id="resource-${index}" ${this.selectedResources.has(index) ? 'checked' : ''}>
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

        filteredResources.forEach((resource, filteredIndex) => {
            const originalIndex = this.resources.indexOf(resource);
            this.selectedResources.add(originalIndex);
        });

        // Update checkboxes
        document.querySelectorAll('.resource-item input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = true;
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
                this.downloadStatus.textContent =
                    `Download complete! ${downloaded} successful, ${failed} failed out of ${total} total`;

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
        // Update counters
        this.resourceCount.textContent = this.filterResources().length;
        this.selectedCount.textContent = this.selectedResources.size;

        // Update button states
        this.downloadSelectedBtn.disabled = this.selectedResources.size === 0 || this.isDownloading;

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