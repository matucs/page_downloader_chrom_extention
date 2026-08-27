// Background Service Worker for Webpage Resource Downloader Extension
// Handles downloads and communication between popup and content scripts
// Cross-browser compatible for Chrome and Firefox

// Import browser compatibility layer and licensing
try {
    importScripts('browser-compatibility.js', 'license.js');
} catch (error) {
    console.error('Could not import extension dependencies:', error);
}

// Initialize browser compatibility
let browserCompat;
try {
    browserCompat = new BrowserCompat();
    console.log(`Extension running on ${browserCompat.getBrowserName()}`);
} catch (error) {
    console.error('Browser compatibility layer initialization failed:', error);
    // Fallback to direct chrome API
    browserCompat = {
        api: (typeof browser !== 'undefined') ? browser : chrome,
        isFirefox: typeof browser !== 'undefined' && typeof chrome === 'undefined',
        isChrome: typeof chrome !== 'undefined'
    };
}

// The background worker owns quota enforcement: the popup can be closed at any
// moment, so counting downloads there would let free users exceed their limit.
function getLicenseManager() {
    if (typeof LicenseManager === 'undefined') {
        return null;
    }
    try {
        return new LicenseManager();
    } catch (error) {
        console.error('Could not create LicenseManager:', error);
        return null;
    }
}

// Keep track of download progress for UI updates
const MAX_TRACKED_DOWNLOADS = 200;
let downloadProgress = new Map();

function trackDownloadProgress(trackerId, entry) {
    downloadProgress.set(trackerId, entry);
    while (downloadProgress.size > MAX_TRACKED_DOWNLOADS) {
        const oldestKey = downloadProgress.keys().next().value;
        downloadProgress.delete(oldestKey);
    }
}
const DOWNLOAD_SESSIONS_KEY = 'downloadSessionsByTab';
const SCAN_STATES_KEY = 'scanStatesByTab';
const chromeDownloadListeners = new Map();
const batchRunningByTab = new Set();
const DOWNLOAD_STALL_TIMEOUT_MS = 120000;

class DownloadCancelledError extends Error {
    constructor() {
        super('Download cancelled');
        this.name = 'DownloadCancelledError';
    }
}

function getPersistentStorage() {
    return chrome.storage.session || chrome.storage.local;
}

function tabKey(tabId) {
    return String(tabId);
}

async function getAllDownloadSessions() {
    const data = await getPersistentStorage().get(DOWNLOAD_SESSIONS_KEY);
    return data[DOWNLOAD_SESSIONS_KEY] || {};
}

async function getDownloadSessionState(tabId) {
    if (!tabId) {
        return null;
    }
    const sessions = await getAllDownloadSessions();
    return sessions[tabKey(tabId)] || null;
}

async function setDownloadSessionState(tabId, updates) {
    if (!tabId) {
        return;
    }
    const sessions = await getAllDownloadSessions();
    const key = tabKey(tabId);
    const existing = sessions[key] || {};
    sessions[key] = {
        ...existing,
        ...updates,
        tabId: Number(tabId),
        updatedAt: Date.now()
    };
    await getPersistentStorage().set({ [DOWNLOAD_SESSIONS_KEY]: sessions });
}

async function clearDownloadSessionState(tabId) {
    if (!tabId) {
        return;
    }
    const sessions = await getAllDownloadSessions();
    delete sessions[tabKey(tabId)];
    await getPersistentStorage().set({ [DOWNLOAD_SESSIONS_KEY]: sessions });
}

async function getAllScanStates() {
    const data = await getPersistentStorage().get(SCAN_STATES_KEY);
    return data[SCAN_STATES_KEY] || {};
}

async function getLastScanState(tabId) {
    if (!tabId) {
        return null;
    }
    const states = await getAllScanStates();
    return states[tabKey(tabId)] || null;
}

async function setLastScanState(tabId, scanState) {
    if (!tabId) {
        return;
    }
    const states = await getAllScanStates();
    states[tabKey(tabId)] = { ...scanState, tabId: Number(tabId) };
    await getPersistentStorage().set({ [SCAN_STATES_KEY]: states });
}

function isBatchRunning(tabId) {
    return batchRunningByTab.has(tabKey(tabId));
}

function setBatchRunning(tabId, running) {
    const key = tabKey(tabId);
    if (running) {
        batchRunningByTab.add(key);
    } else {
        batchRunningByTab.delete(key);
    }
}

function maybeStopKeepAlive() {
    if (batchRunningByTab.size === 0) {
        setTimeout(stopKeepAlive, 5000);
    }
}

function removeDownloadListenersForTab(tabId) {
    for (const [downloadId, entry] of chromeDownloadListeners) {
        if (entry.tabId === Number(tabId)) {
            chrome.downloads.onChanged.removeListener(entry.listener);
            chromeDownloadListeners.delete(downloadId);
        }
    }
}

// Keep the service worker alive during operations
let keepAliveInterval;

function startKeepAlive() {
    if (keepAliveInterval) return;

    // Chrome-specific keep alive mechanism
    if (browserCompat?.isChrome) {
        keepAliveInterval = setInterval(() => {
            chrome.runtime.getPlatformInfo(() => {
                // This is just a dummy operation to keep the service worker alive
            });
        }, 20000); // Every 20 seconds
    }
    // Firefox doesn't need keep alive for background scripts
}

function stopKeepAlive() {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background script received message:', message);
    startKeepAlive(); // Keep service worker alive during operations

    switch (message.action) {
        case 'scanPage':
            handleScanPage(message.tabId || sender?.tab?.id, sendResponse);
            return true; // Keep the message channel open for async response

        case 'downloadResources':
            handleDownloadResources(message.tabId, message.resources, sendResponse);
            return true;

        case 'getDownloadSession':
            getDownloadSessionState(message.tabId).then((session) => {
                sendResponse({ session });
            });
            return true;

        case 'saveScanState':
            setLastScanState(message.tabId, message.scanState).then(() => {
                sendResponse({ success: true });
            });
            return true;

        case 'getScanState':
            getLastScanState(message.tabId).then((scanState) => {
                sendResponse({ scanState });
            });
            return true;

        case 'clearDownloadSession':
            handleClearDownloadSession(message.tabId, message.onlyIfFinished, sendResponse);
            return true;

        case 'pauseDownload':
            handlePauseDownload(message.tabId, sendResponse);
            return true;

        case 'resumeDownload':
            handleResumeDownload(message.tabId, sendResponse);
            return true;

        case 'cancelDownload':
            handleCancelDownload(message.tabId, sendResponse);
            return true;

        case 'getDownloadProgress':
            sendResponse({ progress: Object.fromEntries(downloadProgress) });
            return false;

        default:
            sendResponse({ error: 'Unknown action' });
            return false;
    }
});

// Handle scanning the current page for resources
async function handleScanPage(tabId, sendResponse) {
    console.log('Starting page scan for tab:', tabId);

    if (!tabId) {
        sendResponse({
            success: false,
            error: 'No valid tab ID provided'
        });
        return;
    }

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: scanPageForResources
        });

        const resources = results?.[0]?.result || [];
        console.log(`Found ${resources.length} resources from base scan`);

        sendResponse({
            success: true,
            resources
        });

        setTimeout(stopKeepAlive, 2000);
    } catch (error) {
        console.error('Error scanning page:', error);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

// Function to be injected into the page to scan for resources
function scanPageForResources() {
    const resources = new Set();
    const baseUrl = window.location.origin;

    // Helper function to resolve relative URLs
    function resolveUrl(url, base = window.location.href) {
        try {
            return new URL(url, base).href;
        } catch {
            return null;
        }
    }

    // Helper function to get file extension from URL
    function getFileExtension(url) {
        try {
            const pathname = new URL(url).pathname;
            const compoundMatch = pathname.match(/\.(tar\.(gz|bz2|xz|z)|tgz|tbz2|tar\.z)(?:\?|#|$)/i);
            if (compoundMatch) {
                return compoundMatch[1].toLowerCase();
            }
            const match = pathname.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
            return match ? match[1].toLowerCase() : '';
        } catch {
            return '';
        }
    }

    const ARCHIVE_EXTENSIONS = new Set([
        'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tbz2',
        'cab', 'iso', 'dmg', 'apk', 'deb', 'rpm', 'z', 'lz', 'lzma',
        'arj', 'ace', 'zst', 'lz4', 'sit', 'sitx', 'jar', 'war', 'ear',
        'compress', 'cpio', 'lha', 'lzh'
    ]);

    function isArchiveUrl(url) {
        try {
            const pathname = new URL(url).pathname.toLowerCase();
            if (/\.(tar\.(gz|bz2|xz|z)|tgz|tbz2|tar\.z)(?:\?|#|$)/i.test(pathname)) {
                return true;
            }
            return ARCHIVE_EXTENSIONS.has(getFileExtension(url));
        } catch {
            return false;
        }
    }

    const OTHER_FILE_EXTENSIONS = new Set([
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
        'odt', 'ods', 'odp', 'odg', 'odf', 'rtf', 'txt', 'md',
        'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'html', 'htm', 'xhtml',
        'epub', 'mobi', 'azw', 'azw3', 'fb2', 'djvu',
        'ttf', 'otf', 'woff', 'woff2', 'eot',
        'psd', 'ai', 'eps', 'sketch', 'fig', 'xd',
        'css', 'js', 'mjs', 'ts', 'tsx', 'jsx',
        'py', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'php', 'rb', 'sh', 'bat', 'sql',
        'ics', 'vcf', 'torrent', 'bin', 'dat', 'log', 'ini', 'cfg', 'conf',
        'kml', 'kmz', 'gpx', 'geojson', 'wasm', 'swf', 'svg'
    ]);

    function isOtherFileUrl(url, linkText = '') {
        return OTHER_FILE_EXTENSIONS.has(getEffectiveExtension(url, linkText));
    }

    const VIDEO_EXTENSIONS = new Set([
        'mp4', 'webm', 'avi', 'mov', 'mkv', 'm4v', '3gp', 'flv', 'wmv', 'm3u8', 'mpd'
    ]);

    const AUDIO_EXTENSIONS = new Set([
        'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma', 'opus'
    ]);

    const SUBTITLE_EXTENSIONS = new Set([
        'srt', 'vtt', 'ass', 'ssa', 'sub', 'sbv', 'ttml', 'dfxp'
    ]);

    function getFilenameFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const paramName = urlObj.searchParams.get('filename') ||
                urlObj.searchParams.get('file') ||
                urlObj.searchParams.get('name');

            if (paramName) {
                return decodeURIComponent(paramName);
            }

            return decodeURIComponent(urlObj.pathname.split('/').pop() || '');
        } catch {
            return '';
        }
    }

    function getEffectiveExtension(url, linkText = '') {
        const fromFilename = getFilenameFromUrl(url);
        if (fromFilename && fromFilename.includes('.')) {
            const parts = fromFilename.toLowerCase().split('.');
            const ext = parts[parts.length - 1];
            if (ext) {
                return ext;
            }
        }

        const fromUrl = getFileExtension(url);
        if (fromUrl) {
            return fromUrl;
        }

        const text = (linkText || '').trim();
        if (text.includes('.')) {
            const match = text.match(/\.([a-z0-9]+)$/i);
            if (match) {
                return match[1].toLowerCase();
            }
        }

        return '';
    }

    function decodeJsEscapedUrl(url) {
        return String(url)
            .replace(/\\u0026/g, '&')
            .replace(/\\\//g, '/')
            .replace(/\\"/g, '"')
            .replace(/&amp;/g, '&');
    }

    // YouTube/Vimeo watch pages are HTML — not downloadable media files.
    function isStreamingPlatformPage(url) {
        try {
            const urlObj = new URL(url);
            const host = urlObj.hostname.replace(/^www\./, '').replace(/^m\./, '');

            if (/^(youtube\.com|youtu\.be)$/.test(host)) {
                if (host === 'youtu.be') {
                    return urlObj.pathname.length > 1;
                }
                return /\/watch|\/embed|\/shorts|\/live|\/clip/.test(`${urlObj.pathname}${urlObj.search}`);
            }

            if (host === 'vimeo.com') {
                return /^\/(?:\d+|video\/\d+)/.test(urlObj.pathname);
            }

            if (/^(dailymotion\.com|dai\.ly)$/.test(host)) {
                return /\/video\/|dai\.ly\//.test(`${host}${urlObj.pathname}`);
            }

            if (host.endsWith('twitch.tv')) {
                return /\/videos\/|\/clip\//.test(urlObj.pathname);
            }

            return false;
        } catch {
            return false;
        }
    }

    function isGitIrVideoSlug(value) {
        const text = (value || '').toLowerCase();
        if (!text) {
            return false;
        }
        if (/\.(srt|vtt|ass|ssa|sub|sbv|ttml|dfxp)(?:[/?#]|$)/i.test(text)) {
            return false;
        }
        return /-[a-z0-9]+-git\.ir(?:[/?#]|$)/i.test(text);
    }

    function isSubtitleLink(url, linkText = '', linkElement = null) {
        const ext = getEffectiveExtension(url, linkText);
        if (SUBTITLE_EXTENSIONS.has(ext)) {
            return true;
        }

        const filename = getFilenameFromUrl(url) || (linkText || '').trim();
        if (/\.(srt|vtt|ass|ssa|sub|sbv|ttml|dfxp)(?:[/?#]|$)/i.test(filename)) {
            return true;
        }
        if (/\.[a-z]{2}\.srt$/i.test(filename)) {
            return true;
        }

        const combined = `${url} ${linkText}`.toLowerCase();
        if (/subtitle|caption|\bcaption\b|\bsubtitles?\b/.test(combined) &&
            (SUBTITLE_EXTENSIONS.has(ext) || /\.srt|\.vtt/i.test(filename))) {
            return true;
        }

        if (linkElement?.closest('track')) {
            return true;
        }

        return false;
    }

    function isVideoLink(url, linkText = '', linkElement = null) {
        if (isSubtitleLink(url, linkText, linkElement)) {
            return false;
        }

        const ext = getEffectiveExtension(url, linkText);
        if (SUBTITLE_EXTENSIONS.has(ext) || ARCHIVE_EXTENSIONS.has(ext) || OTHER_FILE_EXTENSIONS.has(ext)) {
            return false;
        }
        if (VIDEO_EXTENSIONS.has(ext)) {
            return true;
        }

        const filename = getFilenameFromUrl(url);
        const slug = filename || (linkText || '').trim();
        const urlLower = url.toLowerCase();

        if (isGitIrVideoSlug(slug) || isGitIrVideoSlug(urlLower)) {
            return true;
        }

        if (/git\.ir\/api\/.*download/i.test(urlLower) && filename && isGitIrVideoSlug(filename)) {
            return true;
        }

        if (isStreamingPlatformPage(url)) {
            return false;
        }

        if (/\/(video|videos|stream|streams|media|watch|play|hls|dash)\//i.test(url)) {
            return true;
        }
        if (/aparat\.com|vimeocdn\.com|cloudflarestream|videodelivery\.net|stream\.cloudflare/i.test(urlLower)) {
            return true;
        }
        if (/[?&](format|type|mime)=video/i.test(urlLower)) {
            return true;
        }

        if (linkElement) {
            if (linkElement.closest('video, [data-video], [data-video-url], .video-player, .plyr, .vjs-tech, [class*="video-player"], [class*="lesson-video"], [class*="course-video"]')) {
                return true;
            }

            const mimeType = linkElement.getAttribute('type') || '';
            if (/^video\//i.test(mimeType)) {
                return true;
            }

            const downloadName = linkElement.getAttribute('download') || '';
            if (VIDEO_EXTENSIONS.has(getEffectiveExtension('', downloadName))) {
                return true;
            }
        }

        if (isGitIrVideoSlug(linkText.trim())) {
            return true;
        }

        if (/\b(watch video|play video|download video|video lesson|video overview)\b/i.test((linkText || '').toLowerCase())) {
            return true;
        }

        return false;
    }

    function isAudioLink(url, linkText = '', linkElement = null) {
        if (isSubtitleLink(url, linkText, linkElement)) {
            return false;
        }

        const ext = getEffectiveExtension(url, linkText);
        if (AUDIO_EXTENSIONS.has(ext)) {
            return true;
        }

        const urlLower = url.toLowerCase();
        const textLower = (linkText || '').toLowerCase();

        if (/\/(audio|audios|podcast|podcasts|sound|music)\//i.test(urlLower)) {
            return true;
        }

        if (linkElement) {
            if (linkElement.closest('audio, [data-audio], .audio-player, [class*="audio-player"]')) {
                return true;
            }

            const mimeType = linkElement.getAttribute('type') || '';
            if (/^audio\//i.test(mimeType)) {
                return true;
            }
        }

        if (/\b(podcast|audiobook|soundtrack|download audio|play audio)\b/i.test(textLower)) {
            return true;
        }

        return false;
    }

    function isGenericNavigationLink(url, linkText = '', linkElement = null) {
        if (isSubtitleLink(url, linkText, linkElement)) {
            return false;
        }
        if (isVideoLink(url, linkText, linkElement) || isAudioLink(url, linkText, linkElement)) {
            return false;
        }
        if (isArchiveUrl(url) || isOtherFileUrl(url, linkText)) {
            return false;
        }

        try {
            const urlObj = new URL(url);
            const ext = getEffectiveExtension(url, linkText);
            const pageExtensions = new Set(['html', 'htm', 'php', 'asp', 'aspx', 'jsp', '']);

            if (pageExtensions.has(ext) && urlObj.pathname.length <= 1) {
                return true;
            }

            const text = (linkText || '').trim().toLowerCase();
            if (/^(home|about|contact|login|signup|register|menu|back|next|previous|prev|more|read more|click here)$/i.test(text)) {
                return true;
            }

            if (linkElement && linkElement.getAttribute('role') === 'button' && text.length < 20) {
                return true;
            }
        } catch {
            return false;
        }

        return false;
    }

    function getLinkResourceType(url, linkText = '', linkElement = null) {
        if (isArchiveUrl(url)) return 'archive';
        if (isSubtitleLink(url, linkText, linkElement)) return 'subtitle';
        if (isOtherFileUrl(url, linkText)) return 'other';
        if (isAudioLink(url, linkText, linkElement)) return 'audio';
        if (isVideoLink(url, linkText, linkElement)) return 'video';
        return 'link';
    }

    function getLinkExtension(url, linkType, linkText = '') {
        const ext = getEffectiveExtension(url, linkText);
        if (ext) return ext;
        if (linkType === 'video') return 'mp4';
        if (linkType === 'audio') return 'mp3';
        if (linkType === 'subtitle') return 'srt';
        return '';
    }

    // Helper function to generate filename from URL (preserve original names)
    function generateFilename(url, elementText = '') {
        try {
            const urlObj = new URL(url);
            const paramFilename = urlObj.searchParams.get('filename') ||
                urlObj.searchParams.get('file') ||
                urlObj.searchParams.get('name');
            let filename = paramFilename
                ? decodeURIComponent(paramFilename)
                : decodeURIComponent(urlObj.pathname.split('/').pop() || 'download');

            // Remove query parameters from filename if they exist
            filename = filename.split('?')[0];

            // Handle special cases only for platforms that don't have real filenames
            if (!filename || filename === 'download' || filename.length < 3) {
                if (url.includes('vimeo.com')) {
                    const videoIdMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
                    if (videoIdMatch) {
                        filename = `vimeo_${videoIdMatch[1]}.mp4`;
                    }
                } else if (url.startsWith('blob:')) {
                    // Generate timestamp-based filename for blob URLs
                    const timestamp = Date.now();
                    const ext = getFileExtension(url) || 'mp4';
                    filename = `media_${timestamp}.${ext}`;
                } else {
                    // Use element text as fallback, clean it up
                    const cleanText = elementText.replace(/[<>:"/\\|?*]/g, '_').trim();
                    filename = cleanText || `download_${Date.now()}`;
                }
            }

            // Ensure filename has an extension
            if (!filename.includes('.')) {
                const ext = getFileExtension(url);
                if (ext) {
                    filename = `${filename}.${ext}`;
                } else {
                    // Detect file type from URL patterns or content
                    if (isVideoLink(url, elementText) || /\.(mp4|webm|avi|mov|mkv|m4v|3gp|flv|wmv)/i.test(url)) {
                        filename = `${filename}.mp4`;
                    } else if (isSubtitleLink(url, elementText) || /\.(srt|vtt|ass|ssa)/i.test(url)) {
                        filename = `${filename}.srt`;
                    } else if (url.includes('audio') || isAudioLink(url, elementText) || /\.(mp3|wav|ogg|m4a|aac|flac|wma)/i.test(url)) {
                        filename = `${filename}.mp3`;
                    } else if (/subtitle|caption|srt|vtt|ass|ssa/i.test(url) || /subtitle|caption|srt|vtt|ass|ssa/i.test(elementText)) {
                        filename = `${filename}.srt`;
                    } else if (isArchiveUrl(url)) {
                        filename = `${filename}.${getFileExtension(url) || 'zip'}`;
                    } else if (isOtherFileUrl(url)) {
                        filename = `${filename}.${getFileExtension(url) || 'file'}`;
                    } else {
                        filename = `${filename}.file`;
                    }
                }
            }

            // Clean up filename (remove unsafe characters but preserve structure)
            filename = filename.replace(/[<>:"/\\|?*]/g, '_');

            // Limit length but preserve extension
            if (filename.length > 150) {
                const ext = filename.substring(filename.lastIndexOf('.'));
                filename = filename.substring(0, 150 - ext.length) + ext;
            }

            return filename;
        } catch {
            return `download_${Date.now()}.file`;
        }
    }

    // Scan for <a> tags with href attributes
    document.querySelectorAll('a[href]').forEach(link => {
        const url = resolveUrl(link.href);
        if (url && !url.startsWith('javascript:') && !url.startsWith('mailto:') && !url.startsWith('tel:')) {
            const linkText = link.textContent?.trim() || link.title || 'Link';

            if (isGenericNavigationLink(url, linkText, link)) {
                return;
            }

            if (isStreamingPlatformPage(url)) {
                return;
            }

            const linkType = getLinkResourceType(url, linkText, link);
            const ext = getLinkExtension(url, linkType, linkText);

            resources.add(JSON.stringify({
                url: url,
                type: linkType,
                filename: generateFilename(url, linkText),
                element: linkType === 'link' ? 'a' : `${linkType}-link`,
                text: linkText,
                extension: ext
            }));
        }
    });

    // Scan links inside common course/lesson containers for video URLs missed above
    function scanCourseVideoLinks() {
        const courseSelectors = [
            '.lesson', '.course-lesson', '.video-lesson', '.lecture',
            '[class*="lesson"]', '[class*="lecture"]', '[class*="episode"]',
            '[class*="course-item"]', '[class*="video-item"]', 'li[class*="video"]'
        ];

        courseSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(container => {
                container.querySelectorAll('a[href]').forEach(link => {
                    const url = resolveUrl(link.href);
                    if (!url || !url.startsWith('http')) {
                        return;
                    }

                    const linkText = link.textContent?.trim() || link.title || container.textContent?.trim() || 'Video';

                    if (/^(next|prev|previous|back|home|menu|more)$/i.test(linkText)) {
                        return;
                    }

                    if (!isVideoLink(url, linkText, link)) {
                        return;
                    }

                    resources.add(JSON.stringify({
                        url: url,
                        type: 'video',
                        filename: generateFilename(url, linkText),
                        element: 'course-video-link',
                        text: linkText,
                        extension: getLinkExtension(url, 'video', linkText)
                    }));
                });
            });
        });
    }

    // Scan for images
    document.querySelectorAll('img').forEach(img => {
        // Regular src attribute
        if (img.src && img.src.startsWith('http')) {
            const imgText = img.alt || img.title || 'Image';
            resources.add(JSON.stringify({
                url: img.src,
                type: 'image',
                filename: generateFilename(img.src, imgText),
                element: 'img',
                text: imgText,
                extension: getFileExtension(img.src)
            }));
        }

        // Lazy loading attributes
        ['data-src', 'data-lazy', 'data-original', 'data-srcset'].forEach(attr => {
            const value = img.getAttribute(attr);
            if (value) {
                const url = resolveUrl(value);
                if (url && url.startsWith('http')) {
                    const imgText = img.alt || img.title || 'Lazy Image';
                    resources.add(JSON.stringify({
                        url: url,
                        type: 'image',
                        filename: generateFilename(url, imgText),
                        element: 'img',
                        text: imgText,
                        extension: getFileExtension(url)
                    }));
                }
            }
        });
    });

    // Scan for video sources (including all attributes)
    document.querySelectorAll('video, video source').forEach(video => {
        // Check multiple attributes for video sources
        ['src', 'data-src', 'data-video', 'data-url'].forEach(attr => {
            const src = video.getAttribute(attr);
            if (src) {
                const url = resolveUrl(src);
                if (url && (url.startsWith('http') || url.startsWith('blob:'))) {
                    const videoText = video.title || video.getAttribute('alt') || 'Video';
                    resources.add(JSON.stringify({
                        url: url,
                        type: 'video',
                        filename: generateFilename(url, videoText),
                        element: 'video',
                        text: videoText,
                        extension: getFileExtension(url)
                    }));
                }
            }
        });
    });

    // Scan for audio sources (including all attributes)
    document.querySelectorAll('audio, audio source').forEach(audio => {
        ['src', 'data-src', 'data-audio', 'data-url'].forEach(attr => {
            const src = audio.getAttribute(attr);
            if (src) {
                const url = resolveUrl(src);
                if (url && (url.startsWith('http') || url.startsWith('blob:'))) {
                    const audioText = audio.title || audio.getAttribute('alt') || 'Audio';
                    resources.add(JSON.stringify({
                        url: url,
                        type: 'audio',
                        filename: generateFilename(url, audioText),
                        element: 'audio',
                        text: audioText,
                        extension: getFileExtension(url)
                    }));
                }
            }
        });
    });

    function scanVimeoDirectStreams() {
        document.querySelectorAll('video source[src*="vimeocdn"], video[src*="vimeocdn"]').forEach((el, index) => {
            const src = el.src || el.getAttribute('src');
            if (!src || !src.startsWith('http')) {
                return;
            }

            resources.add(JSON.stringify({
                url: src,
                type: 'video',
                filename: generateFilename(src, `Vimeo stream ${index + 1}`),
                element: 'vimeo-stream',
                text: `Vimeo stream ${index + 1}`,
                extension: getFileExtension(src) || 'mp4',
                downloadMethod: 'fetch-referer',
                referer: 'https://vimeo.com/'
            }));
        });
    }

    // Scan for HTML5 video/audio blob URLs
    function scanBlobUrls() {
        // YouTube's blob src is a MediaSource handle that cannot be read back,
        // so listing it would only produce a guaranteed failure.
        if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(location.hostname)) {
            return;
        }

        document.querySelectorAll('video, audio').forEach(media => {
            if (media.src && media.src.startsWith('blob:')) {
                resources.add(JSON.stringify({
                    url: media.src,
                    type: media.tagName.toLowerCase(),
                    filename: `${media.tagName.toLowerCase()}_${Date.now()}.${media.tagName === 'VIDEO' ? 'mp4' : 'mp3'}`,
                    element: 'blob-media',
                    text: media.title || `${media.tagName} (blob)`,
                    extension: media.tagName === 'VIDEO' ? 'mp4' : 'mp3',
                    downloadMethod: 'blob'
                }));
            }
        });
    }

    // Scan for other downloadable files in data attributes on non-link elements
    function scanOtherFiles() {
        document.querySelectorAll('[data-download], [data-file], [data-document]').forEach(el => {
            if (el.tagName === 'A') return;

            ['data-download', 'data-file', 'data-document', 'data-url', 'data-src'].forEach(attr => {
                const url = resolveUrl(el.getAttribute(attr));
                if (url && url.startsWith('http') && isOtherFileUrl(url) && !isArchiveUrl(url)) {
                    const text = el.textContent?.trim() || el.title || el.getAttribute('aria-label') || 'File';
                    resources.add(JSON.stringify({
                        url: url,
                        type: 'other',
                        filename: generateFilename(url, text),
                        element: 'other-data',
                        text: text,
                        extension: getFileExtension(url) || 'file'
                    }));
                }
            });
        });
    }

    // Scan for compressed/archive files in data attributes on non-link elements
    function scanArchiveFiles() {
        document.querySelectorAll('[data-download], [data-file], [data-archive], [data-zip]').forEach(el => {
            if (el.tagName === 'A') return;

            ['data-download', 'data-file', 'data-archive', 'data-zip', 'data-url', 'data-src'].forEach(attr => {
                const url = resolveUrl(el.getAttribute(attr));
                if (url && url.startsWith('http') && isArchiveUrl(url)) {
                    const text = el.textContent?.trim() || el.title || el.getAttribute('aria-label') || 'Archive';
                    resources.add(JSON.stringify({
                        url: url,
                        type: 'archive',
                        filename: generateFilename(url, text),
                        element: 'archive-data',
                        text: text,
                        extension: getFileExtension(url) || 'zip'
                    }));
                }
            });
        });
    }

    // Scan for subtitle and caption files
    function scanSubtitleFiles() {
        // Look for track elements (common for subtitles)
        document.querySelectorAll('track[src]').forEach(track => {
            const url = resolveUrl(track.src);
            if (url && url.startsWith('http')) {
                const label = track.label || track.getAttribute('srclang') || 'Subtitle';
                const kind = track.kind || 'subtitle';
                resources.add(JSON.stringify({
                    url: url,
                    type: 'subtitle',
                    filename: generateFilename(url, `${label}_${kind}`),
                    element: 'track',
                    text: `${label} (${kind})`,
                    extension: getFileExtension(url) || 'srt'
                }));
            }
        });

        // Look for subtitle files in links
        document.querySelectorAll('a[href]').forEach(link => {
            const url = resolveUrl(link.href);
            const linkText = link.textContent?.trim() || link.title || 'Subtitle';

            if (url && isSubtitleLink(url, linkText, link)) {
                resources.add(JSON.stringify({
                    url: url,
                    type: 'subtitle',
                    filename: generateFilename(url, linkText),
                    element: 'subtitle-link',
                    text: linkText,
                    extension: getLinkExtension(url, 'subtitle', linkText)
                }));
            }
        });

        // Look for subtitle files in data attributes
        document.querySelectorAll('[data-subtitle], [data-caption], [data-srt]').forEach(el => {
            ['data-subtitle', 'data-caption', 'data-srt'].forEach(attr => {
                const url = resolveUrl(el.getAttribute(attr));
                if (url && url.startsWith('http')) {
                    const text = el.textContent?.trim() || el.title || 'Subtitle';
                    resources.add(JSON.stringify({
                        url: url,
                        type: 'subtitle',
                        filename: generateFilename(url, text),
                        element: 'subtitle-data',
                        text: text,
                        extension: getFileExtension(url) || 'srt'
                    }));
                }
            });
        });
    }

    // Enhanced scanning for embedded media players
    function scanEmbeddedPlayers() {
        // Look for common video player containers
        const playerSelectors = [
            '[data-video-url]',
            '[data-src*=".mp4"]',
            '[data-src*=".webm"]',
            '[data-src*=".ogg"]',
            '[data-src*=".m4v"]',
            '[data-src*=".mov"]',
            '[data-source]',
            '.video-player',
            '.media-player'
        ];

        playerSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                // Check various data attributes
                ['data-video-url', 'data-src', 'data-source', 'data-url'].forEach(attr => {
                    const url = el.getAttribute(attr);
                    if (url) {
                        const resolvedUrl = resolveUrl(url);
                        if (resolvedUrl && (resolvedUrl.startsWith('http') || resolvedUrl.startsWith('blob:'))) {
                            const ext = getFileExtension(resolvedUrl);
                            const isVideo = /mp4|webm|ogg|m4v|mov|avi|mkv/i.test(ext);
                            const isAudio = /mp3|wav|ogg|m4a|aac|flac/i.test(ext);

                            if (isVideo || isAudio) {
                                const text = el.title || el.getAttribute('alt') || `${isVideo ? 'Video' : 'Audio'} Player`;
                                resources.add(JSON.stringify({
                                    url: resolvedUrl,
                                    type: isVideo ? 'video' : 'audio',
                                    filename: generateFilename(resolvedUrl, text),
                                    element: 'embedded-player',
                                    text: text,
                                    extension: ext
                                }));
                            }
                        }
                    }
                });
            });
        });
    }    // Scan for streaming manifests (HLS, DASH) using attribute selectors so we
    // never have to walk every element on the page.
    function scanStreamingManifests() {
        const manifestAttributes = ['src', 'data-src', 'data-url', 'href'];
        const selector = manifestAttributes
            .flatMap(attr => [`[${attr}*=".m3u8"]`, `[${attr}*=".mpd"]`])
            .join(', ');

        document.querySelectorAll(selector).forEach(el => {
            manifestAttributes.forEach(attr => {
                const url = el.getAttribute(attr);
                if (url && (url.includes('.m3u8') || url.includes('.mpd'))) {
                    const resolvedUrl = resolveUrl(url);
                    if (resolvedUrl && resolvedUrl.startsWith('http')) {
                        const manifestType = url.includes('.m3u8') ? 'HLS' : 'DASH';
                        resources.add(JSON.stringify({
                            url: resolvedUrl,
                            type: 'video',
                            filename: generateFilename(resolvedUrl, `Streaming ${manifestType} Manifest`),
                            element: 'streaming-manifest',
                            text: `Streaming ${manifestType} Manifest`,
                            extension: url.includes('.m3u8') ? 'm3u8' : 'mpd'
                        }));
                    }
                }
            });
        });
    }

    // Execute all scanning functions
    scanVimeoDirectStreams();
    scanBlobUrls();
    scanEmbeddedPlayers();
    scanStreamingManifests();
    scanArchiveFiles();
    scanOtherFiles();
    scanSubtitleFiles();
    scanCourseVideoLinks();

    // Scan for picture sources
    document.querySelectorAll('source').forEach(source => {
        const srcset = source.srcset || source.getAttribute('srcset');
        if (srcset) {
            // Parse srcset which can have multiple URLs
            const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
            urls.forEach(srcUrl => {
                const url = resolveUrl(srcUrl);
                if (url && url.startsWith('http')) {
                    resources.add(JSON.stringify({
                        url: url,
                        type: 'image',
                        filename: generateFilename(url, 'Source Image'),
                        element: 'source',
                        text: 'Source Image',
                        extension: getFileExtension(url)
                    }));
                }
            });
        }
    });

    // Scan for background images in CSS. getComputedStyle forces layout work per
    // element, so cap how many we inspect to keep huge pages responsive.
    const MAX_BACKGROUND_IMAGE_ELEMENTS = 3000;
    const backgroundCandidates = Array.from(document.querySelectorAll('body *'))
        .slice(0, MAX_BACKGROUND_IMAGE_ELEMENTS);

    backgroundCandidates.forEach(element => {
        const style = window.getComputedStyle(element);
        const backgroundImage = style.backgroundImage;

        if (backgroundImage && backgroundImage !== 'none') {
            const urlMatch = backgroundImage.match(/url\(['"]?([^'"()]+)['"]?\)/g);
            if (urlMatch) {
                urlMatch.forEach(match => {
                    const urlPart = match.match(/url\(['"]?([^'"()]+)['"]?\)/)[1];
                    const url = resolveUrl(urlPart);
                    if (url && url.startsWith('http')) {
                        resources.add(JSON.stringify({
                            url: url,
                            type: 'image',
                            filename: generateFilename(url, 'Background Image'),
                            element: 'css-background',
                            text: 'Background Image',
                            extension: getFileExtension(url)
                        }));
                    }
                });
            }
        }
    });

    const TYPE_PRIORITY = {
        video: 6,
        audio: 5,
        archive: 4,
        other: 3,
        subtitle: 7,
        image: 1,
        link: 0
    };

    const byUrl = new Map();
    Array.from(resources).map(entry => JSON.parse(entry)).forEach((resource) => {
        const existing = byUrl.get(resource.url);
        if (!existing || (TYPE_PRIORITY[resource.type] || 0) > (TYPE_PRIORITY[existing.type] || 0)) {
            byUrl.set(resource.url, resource);
        }
    });

    return Array.from(byUrl.values());
}

// Handle downloading multiple resources (runs in background; state persists per tab)
async function handleDownloadResources(tabId, resources, sendResponse) {
    try {
        if (!tabId) {
            sendResponse({ success: false, error: 'No tab ID provided' });
            return;
        }
        if (!resources?.length) {
            sendResponse({ success: false, error: 'No resources to download' });
            return;
        }

        const existing = await getDownloadSessionState(tabId);
        if (existing && ['downloading', 'paused'].includes(existing.status)) {
            sendResponse({ success: false, error: 'This tab already has an active download' });
            return;
        }

        const licenseManager = getLicenseManager();
        if (licenseManager) {
            const permission = await licenseManager.canDownload(resources.length);
            if (!permission.allowed) {
                sendResponse({
                    success: false,
                    error: permission.message || 'Download limit reached. Upgrade to Pro for unlimited downloads.',
                    limit: permission
                });
                return;
            }
        }

        await setDownloadSessionState(tabId, {
            status: 'downloading',
            total: resources.length,
            completed: 0,
            failed: 0,
            percent: 0,
            currentIndex: 0,
            resources,
            currentFile: '',
            activeChromeDownloadId: null,
            message: `Starting download of ${resources.length} files...`,
            startedAt: Date.now(),
            finishedAt: null,
            licenseRecorded: true
        });

        sendResponse({ success: true, started: true, total: resources.length });

        runDownloadBatchFromSession(tabId).catch(async (error) => {
            if (error instanceof DownloadCancelledError) {
                return;
            }
            console.error('Download batch error:', error);
            await setDownloadSessionState(tabId, {
                status: 'error',
                message: `Download error: ${error.message}`,
                finishedAt: Date.now()
            });
        });
    } catch (error) {
        console.error('Error starting downloads:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleClearDownloadSession(tabId, onlyIfFinished, sendResponse) {
    try {
        if (!tabId) {
            sendResponse({ success: false, error: 'No tab ID provided' });
            return;
        }

        const session = await getDownloadSessionState(tabId);
        if (!session) {
            sendResponse({ success: true });
            return;
        }

        if (onlyIfFinished && ['downloading', 'paused'].includes(session.status)) {
            sendResponse({ success: true, skipped: true });
            return;
        }

        await clearDownloadSessionState(tabId);
        sendResponse({ success: true });
    } catch (error) {
        console.error('Error clearing download session:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function waitWhilePaused(tabId) {
    while (true) {
        const session = await getDownloadSessionState(tabId);
        if (!session) {
            return;
        }
        if (session.status === 'cancelled') {
            throw new DownloadCancelledError();
        }
        if (session.status !== 'paused') {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
}

async function handlePauseDownload(tabId, sendResponse) {
    try {
        const session = await getDownloadSessionState(tabId);
        if (!session || session.status !== 'downloading') {
            sendResponse({ success: false, error: 'No active download to pause' });
            return;
        }

        if (session.activeChromeDownloadId) {
            await chrome.downloads.pause(session.activeChromeDownloadId);
        }

        const done = (session.completed || 0) + (session.failed || 0);
        await setDownloadSessionState(tabId, {
            status: 'paused',
            message: `Paused — ${done} of ${session.total} files processed`
        });

        sendResponse({ success: true });
    } catch (error) {
        console.error('Error pausing download:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleResumeDownload(tabId, sendResponse) {
    try {
        const session = await getDownloadSessionState(tabId);
        if (!session || session.status !== 'paused') {
            sendResponse({ success: false, error: 'No paused download to resume' });
            return;
        }

        if (session.activeChromeDownloadId) {
            try {
                await chrome.downloads.resume(session.activeChromeDownloadId);
            } catch (error) {
                console.warn('Could not resume active Chrome download:', error);
            }
        }

        await setDownloadSessionState(tabId, {
            status: 'downloading',
            message: `Resuming download (${(session.completed || 0) + (session.failed || 0)} of ${session.total} done)...`
        });

        if (!isBatchRunning(tabId)) {
            runDownloadBatchFromSession(tabId).catch(async (error) => {
                if (error instanceof DownloadCancelledError) {
                    return;
                }
                console.error('Download batch error:', error);
                await setDownloadSessionState(tabId, {
                    status: 'error',
                    message: `Download error: ${error.message}`,
                    finishedAt: Date.now()
                });
            });
        }

        sendResponse({ success: true });
    } catch (error) {
        console.error('Error resuming download:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleCancelDownload(tabId, sendResponse) {
    try {
        const session = await getDownloadSessionState(tabId);
        if (!session || !['downloading', 'paused'].includes(session.status)) {
            sendResponse({ success: false, error: 'No active download to cancel' });
            return;
        }

        if (session.activeChromeDownloadId) {
            try {
                await chrome.downloads.cancel(session.activeChromeDownloadId);
            } catch (error) {
                console.warn('Could not cancel active Chrome download:', error);
            }
        }

        removeDownloadListenersForTab(tabId);

        const completed = session.completed || 0;
        const failed = session.failed || 0;
        await setDownloadSessionState(tabId, {
            status: 'cancelled',
            activeChromeDownloadId: null,
            message: `Cancelled — ${completed} downloaded, ${failed} failed, ${Math.max(0, session.total - completed - failed)} skipped`,
            finishedAt: Date.now()
        });

        maybeStopKeepAlive();
        sendResponse({ success: true });
    } catch (error) {
        console.error('Error cancelling download:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function runDownloadBatchFromSession(tabId) {
    if (isBatchRunning(tabId)) {
        return;
    }

    setBatchRunning(tabId, true);
    startKeepAlive();

    try {
        let session = await getDownloadSessionState(tabId);
        const resources = session?.resources;
        if (!resources?.length) {
            return;
        }

        let currentIndex = session.currentIndex || 0;
        let completed = session.completed || 0;
        let failed = session.failed || 0;
        const total = session.total || resources.length;

        for (let i = currentIndex; i < resources.length; i++) {
            await waitWhilePaused(tabId);

            session = await getDownloadSessionState(tabId);
            if (session?.status === 'cancelled') {
                break;
            }

            const resource = resources[i];
            const displayName = resource.filename || resource.text || `File ${i + 1}`;

            await setDownloadSessionState(tabId, {
                status: 'downloading',
                total,
                completed,
                failed,
                currentIndex: i,
                percent: Math.round(((completed + failed) / total) * 100),
                currentFile: displayName,
                message: `Downloading ${i + 1} of ${total}: ${displayName}`
            });

            try {
                await downloadResourceAndWait(tabId, resource);
                completed++;
                await recordDownloadUsage(1);
            } catch (error) {
                if (error instanceof DownloadCancelledError) {
                    break;
                }
                failed++;
                console.error('Download failed:', displayName, error);
            }

            const done = completed + failed;
            await setDownloadSessionState(tabId, {
                status: 'downloading',
                total,
                completed,
                failed,
                currentIndex: i + 1,
                activeChromeDownloadId: null,
                percent: Math.round((done / total) * 100),
                currentFile: displayName,
                message: `Downloaded ${done} of ${total} (${Math.round((done / total) * 100)}%)`
            });

            session = await getDownloadSessionState(tabId);
            if (session?.status === 'cancelled') {
                break;
            }
        }

        session = await getDownloadSessionState(tabId);
        if (session?.status === 'cancelled') {
            return;
        }

        await setDownloadSessionState(tabId, {
            status: 'complete',
            total,
            completed,
            failed,
            currentIndex: total,
            percent: 100,
            currentFile: '',
            activeChromeDownloadId: null,
            message: `Complete! ${completed} successful, ${failed} failed out of ${total}`,
            finishedAt: Date.now(),
            licenseRecorded: true
        });
    } finally {
        setBatchRunning(tabId, false);
        maybeStopKeepAlive();
    }
}

async function recordDownloadUsage(fileCount) {
    const licenseManager = getLicenseManager();
    if (!licenseManager) {
        return;
    }
    try {
        await licenseManager.recordDownload(fileCount);
    } catch (error) {
        console.error('Could not record download usage:', error);
    }
}

function isBlockedPlatformPageUrl(url) {
    try {
        const urlObj = new URL(url);
        const host = urlObj.hostname.replace(/^www\./, '').replace(/^m\./, '');

        if (/^(youtube\.com|youtu\.be)$/.test(host)) {
            if (host === 'youtu.be') {
                return urlObj.pathname.length > 1;
            }
            return /\/watch|\/embed|\/shorts|\/live|\/clip/.test(`${urlObj.pathname}${urlObj.search}`);
        }

        if (host === 'vimeo.com') {
            return /^\/(?:\d+|video\/\d+)/.test(urlObj.pathname);
        }

        return false;
    } catch {
        return false;
    }
}

async function readBlobUrlFromTab(tabId, blobUrl) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (pageBlobUrl) => {
            const response = await fetch(pageBlobUrl);
            if (!response.ok) {
                throw new Error(`Could not read blob stream (${response.status})`);
            }

            const blob = await response.blob();
            if (!blob.size) {
                throw new Error('Blob stream is empty');
            }

            if (/text\/html/i.test(blob.type)) {
                throw new Error('Blob stream is not a media file');
            }

            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 0x8000;

            for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
            }

            return {
                base64: btoa(binary),
                mime: blob.type || 'video/mp4'
            };
        },
        args: [blobUrl]
    });

    const payload = results?.[0]?.result;
    if (!payload?.base64) {
        throw new Error('Could not capture blob stream from the page');
    }

    const binary = atob(payload.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return URL.createObjectURL(new Blob([bytes], { type: payload.mime || 'video/mp4' }));
}

async function waitForChromeDownload(tabId, finalFilename, settings, downloadUrl) {
    const session = await getDownloadSessionState(tabId);
    if (session?.status === 'cancelled') {
        throw new DownloadCancelledError();
    }

    const total = session?.total || 1;
    const baseDone = (session?.completed || 0) + (session?.failed || 0);

    return new Promise((resolve, reject) => {
        chrome.downloads.download({
            url: downloadUrl,
            filename: finalFilename,
            conflictAction: settings.avoidDuplicates ? 'uniquify' : 'overwrite'
        }, (chromeDownloadId) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            setDownloadSessionState(tabId, { activeChromeDownloadId: chromeDownloadId });

            const trackerId = `download_${Date.now()}_${Math.random()}`;
            trackDownloadProgress(trackerId, {
                status: 'downloading',
                filename: finalFilename,
                chromeDownloadId,
                tabId
            });

            let settled = false;
            let stallTimer = null;

            const finish = (outcome, valueOrError) => {
                if (settled) {
                    return;
                }
                settled = true;

                clearTimeout(stallTimer);
                chrome.downloads.onChanged.removeListener(listener);
                chromeDownloadListeners.delete(chromeDownloadId);
                setDownloadSessionState(tabId, { activeChromeDownloadId: null });

                if (outcome === 'resolve') {
                    trackDownloadProgress(trackerId, { status: 'completed', filename: finalFilename, chromeDownloadId });
                    resolve(valueOrError);
                } else {
                    trackDownloadProgress(trackerId, { status: 'failed', filename: finalFilename, chromeDownloadId });
                    reject(valueOrError);
                }
            };

            const armStallTimer = () => {
                clearTimeout(stallTimer);
                stallTimer = setTimeout(async () => {
                    const currentSession = await getDownloadSessionState(tabId);
                    if (currentSession?.status === 'paused') {
                        armStallTimer();
                        return;
                    }
                    try {
                        await chrome.downloads.cancel(chromeDownloadId);
                    } catch (error) {
                        console.warn('Could not cancel stalled download:', error);
                    }
                    finish('reject', new Error('Download timed out'));
                }, DOWNLOAD_STALL_TIMEOUT_MS);
            };

            const listener = (downloadDelta) => {
                if (downloadDelta.id !== chromeDownloadId) {
                    return;
                }

                armStallTimer();

                getDownloadSessionState(tabId).then((currentSession) => {
                    if (currentSession?.status === 'cancelled') {
                        finish('reject', new DownloadCancelledError());
                    }
                });

                if (downloadDelta.bytesReceived && downloadDelta.totalBytes &&
                    downloadDelta.totalBytes.current > 0) {
                    const fileProgress = downloadDelta.bytesReceived.current / downloadDelta.totalBytes.current;
                    const overall = Math.min(99, Math.round(((baseDone + fileProgress) / total) * 100));
                    setDownloadSessionState(tabId, {
                        percent: overall,
                        message: `Downloading ${baseDone + 1} of ${total}: ${finalFilename} (${Math.round(fileProgress * 100)}%)`
                    });
                }

                if (downloadDelta.state?.current === 'complete') {
                    finish('resolve', chromeDownloadId);
                } else if (downloadDelta.state?.current === 'interrupted') {
                    getDownloadSessionState(tabId).then((currentSession) => {
                        finish(
                            'reject',
                            currentSession?.status === 'cancelled'
                                ? new DownloadCancelledError()
                                : new Error('Download interrupted')
                        );
                    });
                }
            };

            chrome.downloads.onChanged.addListener(listener);
            chromeDownloadListeners.set(chromeDownloadId, { listener, tabId: Number(tabId) });
            armStallTimer();
        });
    });
}

async function downloadResourceAndWait(tabId, resource) {
    const settings = await getDownloadSettings();
    const finalFilename = await generateDownloadFilename(resource, settings);
    const session = await getDownloadSessionState(tabId);
    if (session?.status === 'cancelled') {
        throw new DownloadCancelledError();
    }

    if (isBlockedPlatformPageUrl(resource.url)) {
        throw new Error(
            'This link is a video platform\'s watch page, not a video file, so there is nothing to save.'
        );
    }

    let objectUrlToRevoke = null;

    try {
        let downloadUrl = resource.url;

        if (resource.url.startsWith('blob:')) {
            downloadUrl = await readBlobUrlFromTab(tabId, resource.url);
            objectUrlToRevoke = downloadUrl;
        }

        return await waitForChromeDownload(tabId, finalFilename, settings, downloadUrl);
    } finally {
        if (objectUrlToRevoke) {
            setTimeout(() => URL.revokeObjectURL(objectUrlToRevoke), 60000);
        }
    }
}

// Get download settings from storage
async function getDownloadSettings() {
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

// Generate download filename based on settings
async function generateDownloadFilename(resource, settings) {
    let filename = resource.filename;
    const url = new URL(resource.url);
    const hostname = url.hostname.replace(/^www\./, '');

    // Add website name prefix if enabled
    if (settings.addWebsiteName) {
        const cleanHostname = hostname.replace(/[<>:"/\\|?*]/g, '_');
        filename = `${cleanHostname}_${filename}`;
    }

    // Add timestamp if enabled
    if (settings.addTimestamp) {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const dotIndex = filename.lastIndexOf('.');
        if (dotIndex > 0) {
            filename = filename.slice(0, dotIndex) + `_${timestamp}` + filename.slice(dotIndex);
        } else {
            filename = `${filename}_${timestamp}`;
        }
    }

    // Handle custom download folder and subfolders
    let folderPath = '';

    if (settings.downloadFolder) {
        folderPath = settings.downloadFolder;
    }

    // Create subfolders by resource type if enabled
    if (settings.createSubfolders) {
        let typeFolder = '';
        switch (resource.type) {
            case 'image':
                typeFolder = 'images';
                break;
            case 'video':
                typeFolder = 'videos';
                break;
            case 'audio':
                typeFolder = 'audio';
                break;
            case 'subtitle':
                typeFolder = 'subtitles';
                break;
            case 'archive':
                typeFolder = 'archives';
                break;
            case 'other':
                typeFolder = 'other';
                break;
            default:
                typeFolder = 'files';
        }

        if (folderPath) {
            folderPath = `${folderPath}/${typeFolder}`;
        } else {
            folderPath = typeFolder;
        }
    }

    // Preserve website structure if enabled
    if (settings.preserveStructure) {
        const pathParts = url.pathname.split('/').filter(part => part && part !== filename.split('/').pop());
        if (pathParts.length > 0) {
            const sitePath = pathParts.join('/');
            if (folderPath) {
                folderPath = `${folderPath}/${hostname}/${sitePath}`;
            } else {
                folderPath = `${hostname}/${sitePath}`;
            }
        }
    }

    // Combine folder and filename
    if (folderPath) {
        // Sanitize each segment separately; stripping the separators here would
        // collapse the whole hierarchy into one long folder name.
        folderPath = folderPath
            .split('/')
            .map((segment) => segment.replace(/[<>:"\\|?*]/g, '_').trim())
            .filter(Boolean)
            .join('/');
    }

    if (folderPath) {
        return `${folderPath}/${filename}`;
    }

    return filename;
}

// Listen for download completion events (legacy tracker sync)
chrome.downloads.onChanged.addListener((downloadDelta) => {
    for (const [key, value] of downloadProgress.entries()) {
        if (value.chromeDownloadId === downloadDelta.id) {
            if (downloadDelta.state?.current === 'complete') {
                downloadProgress.set(key, { ...value, status: 'completed' });
            } else if (downloadDelta.state?.current === 'interrupted') {
                downloadProgress.set(key, { ...value, status: 'failed' });
            }
        }
    }
});

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
    console.log('Webpage Resource Downloader extension installed');
});

async function recoverDownloadBatchIfNeeded() {
    try {
        const sessions = await getAllDownloadSessions();
        for (const [tabId, session] of Object.entries(sessions)) {
            if (session?.status === 'downloading' && session.resources?.length && !isBatchRunning(tabId)) {
                runDownloadBatchFromSession(Number(tabId)).catch(async (error) => {
                    if (error instanceof DownloadCancelledError) {
                        return;
                    }
                    console.error('Recovered download batch error:', error);
                });
            }
        }
    } catch (error) {
        console.error('Error recovering download batch:', error);
    }
}

recoverDownloadBatchIfNeeded();