import { StorageManager } from './storage_manager.js';

// Initialize Storage Manager
const storageManager = new StorageManager();

// Listen for messages from Content Scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'SAVE_TURN') {
        console.log("Artifact Sync: Received SAVE_TURN payload", request.data);

        storageManager.saveTurn(request.data)
            .then(() => {
                console.log("Artifact Sync: Turn saved successfully.");
                sendResponse({ status: 'success' });
            })
            .catch((err) => {
                console.error("Artifact Sync: Save failed.", err);
                sendResponse({ status: 'error', message: err.message });
            });

        return true; // Keep channel open for async response
    }
});

console.log("Artifact Sync: Service Worker Initialized.");
