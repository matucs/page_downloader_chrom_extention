// Popup JavaScript for Webpage Resource Downloader Extension
// Cross-browser compatible for Chrome and Firefox

const CATEGORY_ORDER = ['image', 'video', 'audio', 'subtitle', 'archive', 'other', 'link'];

const CATEGORY_LABELS = {
    image: 'Images',
    video: 'Videos',
    audio: 'Audio',
    subtitle: 'Subtitles',
    archive: 'Archives',
    other: 'Other files',
    link: 'Links'
};

class ResourceDownloader {
    constructor() {
        this.resources = [];
        this.selectedResources = new Set();
        this.isScanning = false;
        this.isDownloading = false;
        this.downloadSessionStatus = null;
        this.currentTabId = null;
        this.licenseManager = null;

        this.browserCompat = window.BrowserCompat ? new BrowserCompat() : null;
        console.log(`Popup running on ${this.browserCompat?.getBrowserName() || 'Unknown browser'}`);

        this.initializeElements();
        this.bindEvents();
        this.bindStorageListener();
        this.updateUI();
        this.initializeLicense();
        this.updateDownloadLocationInfo();
        this.restorePersistedState();
    }

    async getActiveTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab || null;
    }

    async ensureCurrentTab() {
        if (!this.currentTabId) {
            const tab = await this.getActiveTab();
            if (tab) {
                this.currentTabId = tab.id;
            }
        }
        return this.currentTabId;
    }

    sendTabMessage(message) {
        return this.ensureCurrentTab().then((tabId) => {
            if (!tabId) {
                return Promise.reject(new Error('No active tab found'));
            }
            return this.sendMessage({ ...message, tabId });
        });
    }

    async initializeLicense() {
        try {
            if (typeof LicenseManager !== 'undefined') {
                this.licenseManager = new LicenseManager();
                await this.updateLicenseStatus();
            } else {
                console.warn('LicenseManager not available');
                this.updateLicenseStatusDisplay(false, false, { dailyDownloads: 0 });
            }
        } catch (error) {
            console.error('Error initializing license:', error);
            this.updateLicenseStatusDisplay(false, false, { dailyDownloads: 0 });
        }
    }

    initializeElements() {
        this.scanBtn = document.getElementById('scanBtn');
        this.settingsBtn = document.getElementById('settingsBtn');
        this.selectAllBtn = document.getElementById('selectAllBtn');
        this.selectNoneBtn = document.getElementById('selectNoneBtn');
        this.downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
        this.selectionHint = document.getElementById('selectionHint');

        this.statusSection = document.getElementById('statusSection');
        this.statusMessage = document.getElementById('statusMessage');
        this.progressBar = document.getElementById('progressBar');
        this.controlsSection = document.getElementById('controlsSection');
        this.resourceList = document.getElementById('resourceList');
        this.downloadSection = document.getElementById('downloadSection');
        this.downloadProgress = document.getElementById('downloadProgress');
        this.downloadProgressFill = document.getElementById('downloadProgressFill');
        this.downloadProgressTitle = document.getElementById('downloadProgressTitle');
        this.downloadPercent = document.getElementById('downloadPercent');
        this.downloadStatusBadge = document.getElementById('downloadStatusBadge');
        this.downloadCurrentFile = document.getElementById('downloadCurrentFile');
        this.statCompleted = document.getElementById('statCompleted');
        this.statFailed = document.getElementById('statFailed');
        this.statRemaining = document.getElementById('statRemaining');
        this.pauseDownloadBtn = document.getElementById('pauseDownloadBtn');
        this.resumeDownloadBtn = document.getElementById('resumeDownloadBtn');
        this.cancelDownloadBtn = document.getElementById('cancelDownloadBtn');

        this.resourceCount = document.getElementById('resourceCount');
        this.selectedCount = document.getElementById('selectedCount');
        this.downloadStatus = document.getElementById('downloadStatus');
        this.downloadLocationInfo = document.getElementById('downloadLocationInfo');

        this.licenseStatus = document.getElementById('licenseStatus');
        this.licenseStatusText = document.getElementById('licenseStatusText');
        this.upgradeBtn = document.getElementById('upgradeBtn');
        this.limitWarning = document.getElementById('limitWarning');
        this.limitMessage = document.getElementById('limitMessage');
        this.upgradeLimitBtn = document.getElementById('upgradeLimitBtn');
    }

    bindEvents() {
        this.scanBtn.addEventListener('click', () => this.scanPage());
        this.settingsBtn.addEventListener('click', () => this.openSettings());
        this.selectAllBtn.addEventListener('click', () => this.selectAll());
        this.selectNoneBtn.addEventListener('click', () => this.selectNone());
        this.downloadSelectedBtn.addEventListener('click', () => this.downloadSelected());
        this.pauseDownloadBtn.addEventListener('click', () => this.pauseDownload());
        this.resumeDownloadBtn.addEventListener('click', () => this.resumeDownload());
        this.cancelDownloadBtn.addEventListener('click', () => this.cancelDownload());

        this.upgradeBtn.addEventListener('click', () => this.showUpgradeModal());
        this.upgradeLimitBtn.addEventListener('click', () => this.showUpgradeModal());

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

    bindStorageListener() {
        const storage = chrome.storage.session || chrome.storage.local;
        storage.onChanged.addListener((changes) => {
            if (!this.currentTabId) {
                return;
            }

            const tabKey = String(this.currentTabId);

            if (changes.downloadSessionsByTab) {
                const sessions = changes.downloadSessionsByTab.newValue || {};
                const session = sessions[tabKey];
                if (session) {
                    this.applyDownloadSession(session);
                } else if (this.downloadSessionStatus) {
                    this.resetDownloadUI();
                }
            }
        });
    }

    async restorePersistedState() {
        const tab = await this.getActiveTab();
        if (!tab) {
            return;
        }

        this.currentTabId = tab.id;
        await Promise.all([
            this.restoreDownloadSession(),
            this.restoreLastScan()
        ]);
    }

    async restoreDownloadSession() {
        try {
            const response = await this.sendTabMessage({ action: 'getDownloadSession' });
            const session = response?.session;
            if (!session) {
                this.resetDownloadUI();
                return;
            }

            const isActive = session.status === 'downloading' || session.status === 'paused';
            if (isActive) {
                this.applyDownloadSession(session);
            } else {
                this.resetDownloadUI();
            }
        } catch (error) {
            console.error('Error restoring download session:', error);
        }
    }

    async restoreLastScan() {
        try {
            const response = await this.sendTabMessage({ action: 'getScanState' });
            const scanState = response?.scanState;
            if (!scanState?.resources?.length) {
                return;
            }

            this.resources = scanState.resources;
            this.selectedResources = new Set(scanState.selectedResources || []);
            this.displayResources();
            this.updateCategoryGroupsUI();
            this.updateUI();
            this.controlsSection.style.display = 'block';
            this.downloadSection.style.display = 'block';
        } catch (error) {
            console.error('Error restoring scan state:', error);
        }
    }

    async persistScanState() {
        try {
            await this.sendTabMessage({
                action: 'saveScanState',
                scanState: {
                    resources: this.resources,
                    selectedResources: Array.from(this.selectedResources),
                    scannedAt: Date.now()
                }
            });
        } catch (error) {
            console.error('Error saving scan state:', error);
        }
    }

    resetDownloadUI() {
        this.downloadSessionStatus = null;
        this.isDownloading = false;
        this.updateDownloadingUI(false, false);

        if (this.downloadProgressFill) {
            this.downloadProgressFill.style.width = '0%';
        }
        if (this.downloadPercent) {
            this.downloadPercent.textContent = '0%';
        }
        if (this.downloadStatus) {
            this.downloadStatus.textContent = '';
        }
        if (this.downloadCurrentFile) {
            this.downloadCurrentFile.textContent = '—';
        }
        if (this.statCompleted) {
            this.statCompleted.textContent = '0';
        }
        if (this.statFailed) {
            this.statFailed.textContent = '0';
        }
        if (this.statRemaining) {
            this.statRemaining.textContent = '0';
        }
        if (this.downloadProgressTitle) {
            this.downloadProgressTitle.textContent = 'Ready to download';
        }
        if (this.downloadStatusBadge) {
            this.downloadStatusBadge.textContent = 'Idle';
            this.downloadStatusBadge.className = 'status-badge';
        }
    }

    applyDownloadSession(session) {
        if (!session) {
            return;
        }

        this.downloadSection.style.display = 'block';
        this.downloadSessionStatus = session.status;
        this.isDownloading = session.status === 'downloading';
        const showProgress = session.status === 'downloading' || session.status === 'paused';
        this.updateDownloadingUI(this.isDownloading || session.status === 'paused', showProgress);
        this.updateDownloadProgressUI(session);

        if (session.status === 'downloading') {
            this.showStatus(session.message || 'Download in progress...');
        } else if (session.status === 'paused') {
            this.showStatus(session.message || 'Download paused');
        } else if (session.status === 'complete') {
            this.showStatus(session.message || 'Download complete');
            this.handleDownloadComplete(session);
        } else if (session.status === 'cancelled') {
            this.showStatus(session.message || 'Download cancelled');
            this.isDownloading = false;
            this.resetDownloadUI();
        } else if (session.status === 'error') {
            this.showStatus(session.message || 'Download failed');
            this.isDownloading = false;
            this.resetDownloadUI();
        }
    }

    updateDownloadProgressUI(session) {
        const percent = session.percent || 0;
        const completed = session.completed || 0;
        const failed = session.failed || 0;
        const total = session.total || 0;
        const remaining = Math.max(0, total - completed - failed);

        if (this.downloadProgressFill) {
            this.downloadProgressFill.style.width = `${percent}%`;
        }
        if (this.downloadPercent) {
            this.downloadPercent.textContent = `${percent}%`;
        }
        if (this.downloadStatus) {
            this.downloadStatus.textContent = session.message || '';
        }
        if (this.downloadCurrentFile) {
            this.downloadCurrentFile.textContent = session.currentFile || '—';
        }
        if (this.statCompleted) {
            this.statCompleted.textContent = String(completed);
        }
        if (this.statFailed) {
            this.statFailed.textContent = String(failed);
        }
        if (this.statRemaining) {
            this.statRemaining.textContent = String(remaining);
        }
        if (this.downloadProgressTitle) {
            if (session.status === 'complete') {
                this.downloadProgressTitle.textContent = 'All files processed';
            } else if (session.status === 'cancelled') {
                this.downloadProgressTitle.textContent = 'Download cancelled';
            } else if (session.status === 'error') {
                this.downloadProgressTitle.textContent = 'Download failed';
            } else if (session.status === 'paused') {
                this.downloadProgressTitle.textContent = `Paused at ${completed + failed} of ${total}`;
            } else {
                this.downloadProgressTitle.textContent = `Processing ${completed + failed} of ${total}`;
            }
        }

        this.updateDownloadControls(session);
        this.updateStatusBadge(session.status);
    }

    updateStatusBadge(status) {
        if (!this.downloadStatusBadge) {
            return;
        }

        const labels = {
            downloading: 'Downloading',
            paused: 'Paused',
            complete: 'Complete',
            cancelled: 'Cancelled',
            error: 'Failed'
        };

        this.downloadStatusBadge.textContent = labels[status] || 'Idle';
        this.downloadStatusBadge.className = `status-badge status-${status || 'downloading'}`;
    }

    updateDownloadControls(session) {
        const isActive = session.status === 'downloading';
        const isPaused = session.status === 'paused';
        const isFinished = ['complete', 'cancelled', 'error'].includes(session.status);

        if (this.pauseDownloadBtn) {
            this.pauseDownloadBtn.style.display = isActive ? 'inline-flex' : 'none';
            this.pauseDownloadBtn.disabled = !isActive;
        }
        if (this.resumeDownloadBtn) {
            this.resumeDownloadBtn.style.display = isPaused ? 'inline-flex' : 'none';
            this.resumeDownloadBtn.disabled = !isPaused;
        }
        if (this.cancelDownloadBtn) {
            this.cancelDownloadBtn.style.display = (isActive || isPaused) ? 'inline-flex' : 'none';
            this.cancelDownloadBtn.disabled = isFinished;
        }
    }

    async pauseDownload() {
        try {
            const response = await this.sendTabMessage({ action: 'pauseDownload' });
            if (!response?.success) {
                throw new Error(response?.error || 'Could not pause download');
            }
        } catch (error) {
            console.error('Error pausing download:', error);
            this.showStatus(`Pause failed: ${error.message}`);
        }
    }

    async resumeDownload() {
        try {
            const response = await this.sendTabMessage({ action: 'resumeDownload' });
            if (!response?.success) {
                throw new Error(response?.error || 'Could not resume download');
            }
            this.isDownloading = true;
            this.updateDownloadingUI(true, true);
        } catch (error) {
            console.error('Error resuming download:', error);
            this.showStatus(`Resume failed: ${error.message}`);
        }
    }

    async cancelDownload() {
        if (!confirm('Cancel the current download batch?')) {
            return;
        }

        try {
            const response = await this.sendTabMessage({ action: 'cancelDownload' });
            if (!response?.success) {
                throw new Error(response?.error || 'Could not cancel download');
            }
            this.isDownloading = false;
            this.downloadSessionStatus = 'cancelled';
            this.updateDownloadingUI(false, false);
            await this.sendTabMessage({ action: 'clearDownloadSession', onlyIfFinished: false });
            this.resetDownloadUI();
        } catch (error) {
            console.error('Error cancelling download:', error);
            this.showStatus(`Cancel failed: ${error.message}`);
        }
    }

    async handleDownloadComplete(session) {
        if (session.licenseRecorded) {
            return;
        }

        if (this.licenseManager && session.completed > 0) {
            try {
                await this.licenseManager.recordDownload(session.completed);
                await this.sendTabMessage({ action: 'markSessionLicenseRecorded' });
                await this.updateLicenseStatus();
            } catch (error) {
                console.error('Error recording download:', error);
            }
        }

        this.isDownloading = false;
        this.downloadSessionStatus = 'complete';
        this.updateDownloadingUI(false, false);
        this.updateUI();
    }

    async scanPage() {
        if (this.isScanning) return;

        this.isScanning = true;
        this.updateScanningUI(true);

        try {
            const tab = await this.getActiveTab();

            if (!tab) {
                throw new Error('No active tab found');
            }

            this.currentTabId = tab.id;

            await this.sendTabMessage({
                action: 'clearDownloadSession',
                onlyIfFinished: true
            });
            this.resetDownloadUI();

            const response = await Promise.race([
                this.sendMessage({
                    action: 'scanPage',
                    tabId: tab.id
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Scan timeout after 10 seconds')), 10000)
                )
            ]);

            if (response && response.success) {
                this.resources = response.resources || [];
                this.selectedResources.clear();
                this.displayResources();
                this.updateUI();
                await this.persistScanState();

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
            this.displayResources();
            this.updateUI();
        } finally {
            this.isScanning = false;
            this.updateScanningUI(false);
        }
    }

    groupResourcesByCategory() {
        const groups = new Map();

        this.resources.forEach((resource, index) => {
            const type = resource.type || 'link';
            if (!groups.has(type)) {
                groups.set(type, []);
            }
            groups.get(type).push({ resource, index });
        });

        return groups;
    }

    displayResources() {
        this.resourceList.innerHTML = '';

        if (this.resources.length === 0) {
            this.showEmptyState();
            return;
        }

        const groups = this.groupResourcesByCategory();
        const rendered = new Set();

        CATEGORY_ORDER.forEach((type) => {
            if (!groups.has(type)) {
                return;
            }
            this.resourceList.appendChild(this.createCategoryGroup(type, groups.get(type)));
            rendered.add(type);
        });

        groups.forEach((items, type) => {
            if (rendered.has(type)) {
                return;
            }
            this.resourceList.appendChild(this.createCategoryGroup(type, items));
        });

        this.controlsSection.style.display = 'block';
        this.downloadSection.style.display = 'block';
    }

    createCategoryGroup(type, items) {
        const group = document.createElement('div');
        group.className = 'category-group collapsed';
        group.dataset.category = type;
        group._categoryItems = items;
        group._itemsLoaded = false;

        const label = CATEGORY_LABELS[type] || type;
        const selectedInCategory = items.filter(({ index }) => this.selectedResources.has(index)).length;
        const allSelected = items.length > 0 && selectedInCategory === items.length;
        const someSelected = selectedInCategory > 0 && selectedInCategory < items.length;

        const header = document.createElement('div');
        header.className = 'category-header';
        header.innerHTML = `
            <input
                type="checkbox"
                class="category-checkbox"
                data-category="${type}"
                ${allSelected ? 'checked' : ''}
                aria-label="Select all ${label}"
            >
            <button type="button" class="category-toggle" aria-expanded="false">
                <span class="category-name">${this.escapeHtml(label)}</span>
                <span class="category-count">${items.length}</span>
                <span class="category-selected">${selectedInCategory} selected</span>
                <span class="category-arrow">▼</span>
            </button>
        `;

        const body = document.createElement('div');
        body.className = 'category-body';

        group.appendChild(header);
        group.appendChild(body);

        const categoryCheckbox = header.querySelector('.category-checkbox');
        categoryCheckbox.indeterminate = someSelected;

        categoryCheckbox.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        categoryCheckbox.addEventListener('change', (event) => {
            event.stopPropagation();
            this.setCategorySelection(items, event.target.checked);
            this.persistScanState();
        });

        header.querySelector('.category-toggle').addEventListener('click', () => {
            this.toggleCategoryGroup(group);
        });

        return group;
    }

    renderCategoryItems(group) {
        if (group._itemsLoaded) {
            return;
        }

        group._itemsLoaded = true;
        const body = group.querySelector('.category-body');
        const items = group._categoryItems;
        const batchSize = 50;
        let index = 0;

        const renderBatch = () => {
            const fragment = document.createDocumentFragment();
            const end = Math.min(index + batchSize, items.length);

            for (; index < end; index++) {
                const { resource, index: resourceIndex } = items[index];
                fragment.appendChild(this.createResourceItem(resource, resourceIndex));
            }

            body.appendChild(fragment);

            if (index < items.length) {
                requestAnimationFrame(renderBatch);
            }
        };

        requestAnimationFrame(renderBatch);
    }

    toggleCategoryGroup(group) {
        const isCollapsed = group.classList.contains('collapsed');

        if (isCollapsed) {
            this.renderCategoryItems(group);
        }

        group.classList.toggle('collapsed');
        const toggle = group.querySelector('.category-toggle');
        toggle.setAttribute('aria-expanded', String(isCollapsed));
    }

    setCategorySelection(items, selected) {
        items.forEach(({ index }) => {
            if (selected) {
                this.selectedResources.add(index);
            } else {
                this.selectedResources.delete(index);
            }
        });

        this.syncResourceCheckboxes();
        this.updateCategoryGroupsUI();
        this.updateSelectionUI();
    }

    syncResourceCheckboxes() {
        document.querySelectorAll('.resource-item input[type="checkbox"]').forEach((checkbox) => {
            const index = parseInt(checkbox.dataset.resourceIndex, 10);
            const isSelected = this.selectedResources.has(index);
            checkbox.checked = isSelected;

            const item = checkbox.closest('.resource-item');
            if (item) {
                this.updateResourceItemSelectionState(item, isSelected);
            }
        });
    }

    updateCategoryGroupsUI() {
        document.querySelectorAll('.category-group').forEach((group) => {
            const items = group._categoryItems || [];
            const indices = items.map(({ index }) => index);
            const selectedCount = indices.filter((index) => this.selectedResources.has(index)).length;
            const total = indices.length;
            const categoryCheckbox = group.querySelector('.category-checkbox');

            if (categoryCheckbox) {
                categoryCheckbox.checked = total > 0 && selectedCount === total;
                categoryCheckbox.indeterminate = selectedCount > 0 && selectedCount < total;
            }

            const selectedLabel = group.querySelector('.category-selected');
            if (selectedLabel) {
                selectedLabel.textContent = `${selectedCount} selected`;
            }
        });
    }

    updateResourceItemSelectionState(item, isSelected) {
        item.classList.toggle('selected', isSelected);
    }

    createResourceItem(resource, index) {
        const item = document.createElement('div');
        const isSelected = this.selectedResources.has(index);
        item.className = `resource-item${isSelected ? ' selected' : ''}`;
        item.dataset.index = index;
        item.dataset.type = resource.type;

        const checkbox = document.createElement('div');
        checkbox.className = 'resource-checkbox';
        checkbox.innerHTML = `
            <input
                type="checkbox"
                id="resource-${index}"
                data-resource-index="${index}"
                ${isSelected ? 'checked' : ''}
                aria-label="Select ${this.escapeHtml(resource.text || resource.filename || 'resource')}"
            >
        `;

        const info = document.createElement('div');
        info.className = 'resource-info';

        const title = this.truncateText(resource.text || resource.filename || 'Unknown', 50);
        const extension = resource.extension ? resource.extension.toUpperCase() : 'FILE';

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
            </div>
        `;
        item.title = resource.url;

        item.appendChild(checkbox);
        item.appendChild(info);

        const checkboxInput = checkbox.querySelector('input');
        checkboxInput.addEventListener('change', (event) => {
            if (event.target.checked) {
                this.selectedResources.add(index);
            } else {
                this.selectedResources.delete(index);
            }
            this.updateResourceItemSelectionState(item, event.target.checked);
            this.updateCategoryGroupsUI();
            this.updateSelectionUI();
            this.persistScanState();
        });

        item.addEventListener('click', (event) => {
            if (event.target.type !== 'checkbox') {
                checkboxInput.checked = !checkboxInput.checked;
                checkboxInput.dispatchEvent(new Event('change'));
            }
        });

        return item;
    }

    selectAll() {
        const allSelected = this.resources.length > 0 &&
            this.selectedResources.size === this.resources.length;

        if (allSelected) {
            this.selectedResources.clear();
        } else {
            this.resources.forEach((_, index) => {
                this.selectedResources.add(index);
            });
        }

        this.syncResourceCheckboxes();
        this.updateCategoryGroupsUI();
        this.updateSelectionUI();
        this.persistScanState();
    }

    selectNone() {
        this.selectedResources.clear();
        this.syncResourceCheckboxes();
        this.updateCategoryGroupsUI();
        this.updateSelectionUI();
        this.persistScanState();
    }

    async downloadSelected() {
        if (this.selectedResources.size === 0 || this.isDownloading ||
            this.downloadSessionStatus === 'downloading' ||
            this.downloadSessionStatus === 'paused') {
            return;
        }

        this.hideLimitWarning();

        if (this.licenseManager) {
            try {
                const canDownload = await this.licenseManager.canDownload(this.selectedResources.size);

                if (!canDownload.allowed) {
                    this.showImprovedLimitWarning(canDownload);
                    return;
                }
            } catch (error) {
                console.error('Error checking license limits:', error);
            }
        }

        this.isDownloading = true;
        this.updateDownloadingUI(true);

        try {
            const selectedResourceObjects = Array.from(this.selectedResources)
                .map((index) => this.resources[index])
                .filter(Boolean)
                .map((resource) => ({
                    ...resource,
                    filename: this.generateSafeFilename(resource)
                }));

            if (selectedResourceObjects.length === 0) {
                throw new Error('No valid resources selected');
            }

            this.downloadStatus.textContent = `Downloading ${selectedResourceObjects.length} files...`;
            this.showStatus(`Starting download of ${selectedResourceObjects.length} files...`);

            const response = await this.sendTabMessage({
                action: 'downloadResources',
                resources: selectedResourceObjects
            });

            if (response && response.success && response.started) {
                this.isDownloading = true;
                this.updateDownloadingUI(true, true);
                this.showStatus(`Downloading ${response.total} files in background...`);
                const sessionResponse = await this.sendTabMessage({ action: 'getDownloadSession' });
                if (sessionResponse?.session) {
                    this.applyDownloadSession(sessionResponse.session);
                }
                return;
            }

            if (response && response.success) {
                const { downloaded, failed, total } = response;

                if (this.licenseManager) {
                    await this.licenseManager.recordDownload(downloaded);
                }

                this.downloadStatus.textContent =
                    `Download complete! ${downloaded} successful, ${failed} failed out of ${total} total`;
                this.showStatus(`Downloaded ${downloaded} of ${total} files`);

                await this.updateLicenseStatus();

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
            this.showStatus(`Download error: ${error.message}`);
            setTimeout(() => {
                this.updateDownloadingUI(false);
            }, 3000);
        } finally {
            if (!this.isDownloading) {
                this.updateUI();
            }
        }
    }

    hideLimitWarning() {
        if (this.limitWarning) {
            this.limitWarning.style.display = 'none';
        }
    }

    showLimitWarning(message) {
        if (!this.limitWarning || !this.limitMessage) {
            this.showStatus(message);
            return;
        }

        this.limitMessage.textContent = message;
        this.limitWarning.style.display = 'flex';
    }

    generateSafeFilename(resource) {
        let filename = resource.filename;
        filename = filename.replace(/[<>:"/\\|?*]/g, '_');

        if (!filename.includes('.') && resource.extension) {
            filename += `.${resource.extension}`;
        }

        if (filename.length > 100) {
            const ext = filename.substring(filename.lastIndexOf('.'));
            filename = filename.substring(0, 100 - ext.length) + ext;
        }

        return filename;
    }

    updateUI() {
        this.resourceCount.textContent = this.resources.length;
        this.selectedCount.textContent = this.selectedResources.size;

        if (this.selectionHint) {
            this.selectionHint.textContent = `${this.selectedResources.size} selected`;
        }

        this.downloadSelectedBtn.disabled = this.selectedResources.size === 0 || this.isDownloading;

        if (this.resources.length > 0) {
            const allSelected = this.selectedResources.size === this.resources.length;
            this.selectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
        } else {
            this.selectAllBtn.textContent = 'Select All';
        }

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

    updateDownloadingUI(isDownloading, showProgress = isDownloading) {
        if (showProgress) {
            this.downloadProgress.style.display = 'block';
            this.downloadSelectedBtn.disabled = isDownloading;
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

    sendMessage(message) {
        return new Promise((resolve, reject) => {
            const api = this.browserCompat?.api || (typeof browser !== 'undefined' ? browser : chrome);

            if (this.browserCompat?.isFirefox || typeof browser !== 'undefined') {
                api.runtime.sendMessage(message).then(resolve).catch(reject);
            } else {
                api.runtime.sendMessage(message, (response) => {
                    if (api.runtime.lastError) {
                        reject(new Error(api.runtime.lastError.message));
                        return;
                    }

                    if (response === undefined) {
                        reject(new Error('No response from background script'));
                        return;
                    }

                    resolve(response);
                });
            }
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

    getFileSizeDisplay() {
        return '';
    }

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
                        <div style="background: #2196F3; height: 100%; border-radius: 10px; width: ${Math.min(100, (downloadsUsed / 25) * 100)}%; transition: width 0.3s ease;"></div>
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
            const selectedCount = this.selectedResources.size;
            this.downloadSelectedBtn.textContent = `Download Selected (${selectedCount})`;
            this.downloadSelectedBtn.disabled = selectedCount === 0 || this.isDownloading;
        }
    }

    showDownloadLimitWarning(canDownloadResult = null) {
        const message = canDownloadResult?.message ||
            "You've reached your daily download limit. Upgrade to Pro for unlimited downloads!";
        this.showLimitWarning(message);
    }

    showImprovedLimitWarning(canDownloadResult) {
        if (canDownloadResult.reason === 'batch_limit') {
            const limit = canDownloadResult.limit || 3;
            this.showLimitWarning(
                canDownloadResult.message ||
                `Free plan allows ${limit} files per download. Select fewer files or upgrade to Pro.`
            );
            return;
        }

        if (canDownloadResult.reason === 'daily_limit') {
            this.showLimitWarning(
                canDownloadResult.message ||
                "You've reached your daily download limit. Upgrade to Pro for unlimited downloads!"
            );
        }
    }

    showUpgradeModal() {
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

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
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

        modal.querySelector('.modal-close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

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

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                document.body.removeChild(modal);
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.resourceDownloader = new ResourceDownloader();
});
