// background.js (ES Module)
// Import libs FIRST to ensure side-effects run
import './lib/jspdf.js';
import { StorageManager } from './modules/StorageManager.js';

console.log("Artifact Sync: Background Service Worker (Module) Loaded.");

const storageManager = new StorageManager();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SAVE_TURN') {
        // Must return true synchronously to keep channel open
        (async () => {
            try {
                await storageManager.handleTurn(message.data);
                sendResponse({ success: true });
            } catch (err) {
                console.error("Artifact Sync Processing Error:", err);
                sendResponse({ success: false, error: err.toString() });
            }
        })();
        return true;
    }
});
