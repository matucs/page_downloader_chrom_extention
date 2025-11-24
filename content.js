// Content Script for Webpage Resource Downloader Extension
// This script is injected into web pages to facilitate communication

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
        sendResponse({ status: 'ready' });
        return false;
    }

    // For other actions, relay to background script
    chrome.runtime.sendMessage(message, (response) => {
        sendResponse(response);
    });

    return true; // Keep message channel open for async response
});

// Notify that content script is ready
console.log('Webpage Resource Downloader content script loaded');