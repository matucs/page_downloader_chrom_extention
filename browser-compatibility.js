// Cross-browser compatibility layer for Chrome and Firefox
// Handles API differences between Chrome and Firefox WebExtensions

class BrowserCompat {
    constructor() {
        this.isFirefox = typeof browser !== 'undefined' && typeof chrome === 'undefined';
        this.isChrome = typeof chrome !== 'undefined' && typeof browser === 'undefined';
        this.isWebExtPolyfill = typeof browser !== 'undefined' && typeof chrome !== 'undefined';
        
        // Use the appropriate API
        this.api = this.isFirefox ? browser : chrome;
        
        console.log(`Browser detected: ${this.getBrowserName()}`);
    }
    
    getBrowserName() {
        if (this.isFirefox) return 'Firefox';
        if (this.isChrome) return 'Chrome';
        return 'Unknown';
    }
    
    // Storage API with Promise/Callback compatibility
    async getStorage(keys) {
        if (this.isFirefox) {
            return await this.api.storage.sync.get(keys);
        } else {
            return new Promise((resolve) => {
                this.api.storage.sync.get(keys, resolve);
            });
        }
    }
    
    async setStorage(data) {
        if (this.isFirefox) {
            return await this.api.storage.sync.set(data);
        } else {
            return new Promise((resolve) => {
                this.api.storage.sync.set(data, resolve);
            });
        }
    }
    
    // Downloads API
    async downloadFile(options) {
        try {
            if (this.isFirefox) {
                return await this.api.downloads.download(options);
            } else {
                return new Promise((resolve, reject) => {
                    this.api.downloads.download(options, (downloadId) => {
                        if (this.api.runtime.lastError) {
                            reject(new Error(this.api.runtime.lastError.message));
                        } else {
                            resolve(downloadId);
                        }
                    });
                });
            }
        } catch (error) {
            console.error('Download error:', error);
            throw error;
        }
    }
    
    // Tabs API
    async getCurrentTab() {
        if (this.isFirefox) {
            const tabs = await this.api.tabs.query({ active: true, currentWindow: true });
            return tabs[0];
        } else {
            return new Promise((resolve) => {
                this.api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    resolve(tabs[0]);
                });
            });
        }
    }
    
    // Scripting API (Chrome) vs Tabs.executeScript (Firefox fallback)
    async executeScript(tabId, details) {
        try {
            if (this.api.scripting && this.api.scripting.executeScript) {
                // Chrome Manifest V3 style
                const results = await this.api.scripting.executeScript({
                    target: { tabId: tabId },
                    func: details.func || null,
                    files: details.files || null
                });
                return results[0]?.result;
            } else {
                // Firefox or Chrome Manifest V2 fallback
                if (this.isFirefox) {
                    return await this.api.tabs.executeScript(tabId, {
                        code: details.code || null,
                        file: details.files?.[0] || null
                    });
                } else {
                    return new Promise((resolve, reject) => {
                        this.api.tabs.executeScript(tabId, {
                            code: details.code || null,
                            file: details.files?.[0] || null
                        }, (result) => {
                            if (this.api.runtime.lastError) {
                                reject(new Error(this.api.runtime.lastError.message));
                            } else {
                                resolve(result?.[0]);
                            }
                        });
                    });
                }
            }
        } catch (error) {
            console.error('Script execution error:', error);
            throw error;
        }
    }
    
    // Runtime messaging
    sendMessage(message) {
        return this.api.runtime.sendMessage(message);
    }
    
    onMessage(callback) {
        this.api.runtime.onMessage.addListener(callback);
    }
    
    // Extension URL
    getURL(path) {
        return this.api.runtime.getURL(path);
    }
    
    // Browser action (different between Chrome and Firefox)
    setBadgeText(text) {
        if (this.api.action?.setBadgeText) {
            // Chrome Manifest V3
            this.api.action.setBadgeText({ text: text });
        } else if (this.api.browserAction?.setBadgeText) {
            // Firefox or Chrome Manifest V2
            this.api.browserAction.setBadgeText({ text: text });
        }
    }
    
    setBadgeBackgroundColor(color) {
        if (this.api.action?.setBadgeBackgroundColor) {
            // Chrome Manifest V3
            this.api.action.setBadgeBackgroundColor({ color: color });
        } else if (this.api.browserAction?.setBadgeBackgroundColor) {
            // Firefox or Chrome Manifest V2
            this.api.browserAction.setBadgeBackgroundColor({ color: color });
        }
    }
    
    // Notifications (if needed)
    createNotification(options) {
        if (this.isFirefox) {
            return this.api.notifications.create(options);
        } else {
            return new Promise((resolve) => {
                this.api.notifications.create(options, resolve);
            });
        }
    }
    
    // Firefox-specific: Handle different file naming restrictions
    sanitizeFilename(filename) {
        if (this.isFirefox) {
            // Firefox has stricter filename restrictions
            return filename
                .replace(/[<>:"/\\|?*]/g, '_')
                .replace(/\s+/g, '_')
                .substring(0, 200); // Firefox has shorter path limits
        } else {
            // Chrome is more lenient
            return filename
                .replace(/[<>:"/\\|?*]/g, '_')
                .substring(0, 255);
        }
    }
    
    // Handle browser-specific download path differences
    getDownloadPath(filename, subfolder = '') {
        if (this.isFirefox) {
            // Firefox uses simpler path handling
            return subfolder ? `${subfolder}/${filename}` : filename;
        } else {
            // Chrome supports more complex paths
            return subfolder ? `${subfolder}/${filename}` : filename;
        }
    }
}

// Export as global for use in other scripts
if (typeof window !== 'undefined') {
    window.BrowserCompat = BrowserCompat;
}

// For use in service worker/background scripts
if (typeof self !== 'undefined') {
    self.BrowserCompat = BrowserCompat;
}

// Node.js export (if needed for testing)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BrowserCompat;
}