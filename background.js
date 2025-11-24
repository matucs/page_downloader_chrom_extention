// Background Service Worker for Webpage Resource Downloader Extension
// Handles downloads and communication between popup and content scripts

// Keep track of download progress for UI updates
let downloadProgress = new Map();

// Keep the service worker alive during operations
let keepAliveInterval;

function startKeepAlive() {
    if (keepAliveInterval) return;

    keepAliveInterval = setInterval(() => {
        chrome.runtime.getPlatformInfo(() => {
            // This is just a dummy operation to keep the service worker alive
        });
    }, 20000); // Every 20 seconds
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
            handleDownloadResources(message.resources, sendResponse);
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
        // Inject content script to scan for resources
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: scanPageForResources
        });

        console.log('Scan results:', results);

        if (results && results[0] && results[0].result) {
            const resources = results[0].result;
            console.log(`Found ${resources.length} resources`);

            sendResponse({
                success: true,
                resources: resources
            });

            // Stop keep-alive after scan completes
            setTimeout(stopKeepAlive, 2000);
        } else {
            sendResponse({
                success: false,
                error: 'No results returned from page scan'
            });
        }
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
            const match = pathname.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
            return match ? match[1].toLowerCase() : '';
        } catch {
            return '';
        }
    }

    // Helper function to generate filename from URL
    function generateFilename(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            let filename = pathname.split('/').pop() || 'download';

            // Handle special cases
            if (url.includes('youtube.com') || url.includes('youtu.be')) {
                const videoIdMatch = url.match(/(?:v=|embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
                if (videoIdMatch) {
                    filename = `youtube_${videoIdMatch[1]}.mp4`;
                }
            } else if (url.includes('vimeo.com')) {
                const videoIdMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
                if (videoIdMatch) {
                    filename = `vimeo_${videoIdMatch[1]}.mp4`;
                }
            } else if (url.startsWith('blob:')) {
                // Generate timestamp-based filename for blob URLs
                const timestamp = Date.now();
                const ext = getFileExtension(url) || 'mp4';
                filename = `media_${timestamp}.${ext}`;
            }

            // If no extension, try to guess from content-type or URL patterns
            if (!filename.includes('.')) {
                const ext = getFileExtension(url);
                if (ext) {
                    filename = `${filename}.${ext}`;
                } else {
                    // Default extensions based on URL patterns
                    if (url.includes('video') || /\.(mp4|webm|avi|mov|mkv|m4v|3gp|flv|wmv)/i.test(url)) {
                        filename = `${filename}.mp4`;
                    } else if (url.includes('audio') || /\.(mp3|wav|ogg|m4a|aac|flac|wma)/i.test(url)) {
                        filename = `${filename}.mp3`;
                    } else {
                        filename = `${filename}.file`;
                    }
                }
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
            const ext = getFileExtension(url);
            resources.add(JSON.stringify({
                url: url,
                type: 'link',
                filename: generateFilename(url),
                element: 'a',
                text: link.textContent?.trim() || link.title || 'Link',
                extension: ext
            }));
        }
    });

    // Scan for images
    document.querySelectorAll('img').forEach(img => {
        // Regular src attribute
        if (img.src && img.src.startsWith('http')) {
            resources.add(JSON.stringify({
                url: img.src,
                type: 'image',
                filename: generateFilename(img.src),
                element: 'img',
                text: img.alt || img.title || 'Image',
                extension: getFileExtension(img.src)
            }));
        }

        // Lazy loading attributes
        ['data-src', 'data-lazy', 'data-original', 'data-srcset'].forEach(attr => {
            const value = img.getAttribute(attr);
            if (value) {
                const url = resolveUrl(value);
                if (url && url.startsWith('http')) {
                    resources.add(JSON.stringify({
                        url: url,
                        type: 'image',
                        filename: generateFilename(url),
                        element: 'img',
                        text: img.alt || img.title || 'Lazy Image',
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
                    resources.add(JSON.stringify({
                        url: url,
                        type: 'video',
                        filename: generateFilename(url),
                        element: 'video',
                        text: video.title || video.getAttribute('alt') || 'Video',
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
                    resources.add(JSON.stringify({
                        url: url,
                        type: 'audio',
                        filename: generateFilename(url),
                        element: 'audio',
                        text: audio.title || audio.getAttribute('alt') || 'Audio',
                        extension: getFileExtension(url)
                    }));
                }
            }
        });
    });

    // Scan for YouTube videos
    function scanYouTubeVideos() {
        // YouTube embedded iframes
        document.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtu.be"]').forEach(iframe => {
            const src = iframe.src;
            if (src) {
                // Extract video ID from YouTube URL
                const videoIdMatch = src.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
                if (videoIdMatch) {
                    const videoId = videoIdMatch[1];
                    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
                    resources.add(JSON.stringify({
                        url: videoUrl,
                        type: 'video',
                        filename: `youtube_video_${videoId}.mp4`,
                        element: 'youtube-embed',
                        text: iframe.title || 'YouTube Video',
                        extension: 'mp4'
                    }));
                }
            }
        });

        // YouTube player divs (for dynamic loading)
        document.querySelectorAll('[data-video-id]').forEach(el => {
            const videoId = el.getAttribute('data-video-id');
            if (videoId && videoId.match(/^[a-zA-Z0-9_-]{11}$/)) {
                const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
                resources.add(JSON.stringify({
                    url: videoUrl,
                    type: 'video',
                    filename: `youtube_video_${videoId}.mp4`,
                    element: 'youtube-player',
                    text: el.title || el.getAttribute('aria-label') || 'YouTube Video',
                    extension: 'mp4'
                }));
            }
        });
    }

    // Scan for Vimeo videos
    function scanVimeoVideos() {
        document.querySelectorAll('iframe[src*="vimeo.com"]').forEach(iframe => {
            const src = iframe.src;
            if (src) {
                const videoIdMatch = src.match(/vimeo\.com\/(?:video\/)?(\d+)/);
                if (videoIdMatch) {
                    const videoId = videoIdMatch[1];
                    const videoUrl = `https://vimeo.com/${videoId}`;
                    resources.add(JSON.stringify({
                        url: videoUrl,
                        type: 'video',
                        filename: `vimeo_video_${videoId}.mp4`,
                        element: 'vimeo-embed',
                        text: iframe.title || 'Vimeo Video',
                        extension: 'mp4'
                    }));
                }
            }
        });
    }

    // Scan for Twitch streams/videos
    function scanTwitchContent() {
        document.querySelectorAll('iframe[src*="twitch.tv"]').forEach(iframe => {
            const src = iframe.src;
            if (src) {
                resources.add(JSON.stringify({
                    url: src,
                    type: 'video',
                    filename: 'twitch_stream.mp4',
                    element: 'twitch-embed',
                    text: iframe.title || 'Twitch Stream',
                    extension: 'mp4'
                }));
            }
        });
    }

    // Scan for HTML5 video/audio blob URLs
    function scanBlobUrls() {
        // Find all media elements with blob URLs
        document.querySelectorAll('video, audio').forEach(media => {
            if (media.src && media.src.startsWith('blob:')) {
                resources.add(JSON.stringify({
                    url: media.src,
                    type: media.tagName.toLowerCase(),
                    filename: `${media.tagName.toLowerCase()}_${Date.now()}.${media.tagName === 'VIDEO' ? 'mp4' : 'mp3'}`,
                    element: 'blob-media',
                    text: media.title || `${media.tagName} (blob)`,
                    extension: media.tagName === 'VIDEO' ? 'mp4' : 'mp3'
                }));
            }
        });
    }

    // Scan for embedded media players (generic)
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
                                resources.add(JSON.stringify({
                                    url: resolvedUrl,
                                    type: isVideo ? 'video' : 'audio',
                                    filename: generateFilename(resolvedUrl),
                                    element: 'embedded-player',
                                    text: el.title || el.getAttribute('alt') || `${isVideo ? 'Video' : 'Audio'} Player`,
                                    extension: ext
                                }));
                            }
                        }
                    }
                });
            });
        });
    }

    // Scan for streaming manifests (HLS, DASH)
    function scanStreamingManifests() {
        // Look for .m3u8 (HLS) and .mpd (DASH) files
        document.querySelectorAll('*').forEach(el => {
            ['src', 'data-src', 'data-url', 'href'].forEach(attr => {
                const url = el.getAttribute(attr);
                if (url && (url.includes('.m3u8') || url.includes('.mpd'))) {
                    const resolvedUrl = resolveUrl(url);
                    if (resolvedUrl && resolvedUrl.startsWith('http')) {
                        resources.add(JSON.stringify({
                            url: resolvedUrl,
                            type: 'video',
                            filename: generateFilename(resolvedUrl),
                            element: 'streaming-manifest',
                            text: `Streaming ${url.includes('.m3u8') ? 'HLS' : 'DASH'} Manifest`,
                            extension: url.includes('.m3u8') ? 'm3u8' : 'mpd'
                        }));
                    }
                }
            });
        });
    }

    // Execute all scanning functions
    scanYouTubeVideos();
    scanVimeoVideos();
    scanTwitchContent();
    scanBlobUrls();
    scanEmbeddedPlayers();
    scanStreamingManifests();

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
                        filename: generateFilename(url),
                        element: 'source',
                        text: 'Source Image',
                        extension: getFileExtension(url)
                    }));
                }
            });
        }
    });

    // Scan for background images in CSS
    document.querySelectorAll('*').forEach(element => {
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
                            filename: generateFilename(url),
                            element: 'css-background',
                            text: 'Background Image',
                            extension: getFileExtension(url)
                        }));
                    }
                });
            }
        }
    });

    // Convert Set back to array and parse JSON
    return Array.from(resources).map(r => JSON.parse(r));
}

// Handle downloading multiple resources
async function handleDownloadResources(resources, sendResponse) {
    try {
        downloadProgress.clear();
        const downloadPromises = [];

        for (const resource of resources) {
            const downloadPromise = downloadResource(resource);
            downloadPromises.push(downloadPromise);
        }

        // Wait for all downloads to complete
        const results = await Promise.allSettled(downloadPromises);

        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        sendResponse({
            success: true,
            downloaded: successful,
            failed: failed,
            total: resources.length
        });

        // Stop keep-alive after operations complete
        setTimeout(stopKeepAlive, 5000);

    } catch (error) {
        console.error('Error downloading resources:', error);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

// Download a single resource
async function downloadResource(resource) {
    return new Promise((resolve, reject) => {
        const downloadId = `download_${Date.now()}_${Math.random()}`;
        downloadProgress.set(downloadId, { status: 'starting', filename: resource.filename });

        chrome.downloads.download({
            url: resource.url,
            filename: resource.filename,
            conflictAction: 'uniquify'
        }, (id) => {
            if (chrome.runtime.lastError) {
                downloadProgress.set(downloadId, { status: 'failed', error: chrome.runtime.lastError.message });
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                downloadProgress.set(downloadId, { status: 'completed', chromeDownloadId: id });
                resolve(id);
            }
        });
    });
}

// Listen for download completion events
chrome.downloads.onChanged.addListener((downloadDelta) => {
    // Update progress information
    for (let [key, value] of downloadProgress.entries()) {
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