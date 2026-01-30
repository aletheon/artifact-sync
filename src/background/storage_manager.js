import { LocalAdapter } from '../storage/local_adapter.js';
import { DriveAdapter } from '../storage/drive_adapter.js';

export class StorageManager {
    constructor() {
        this.localAdapter = new LocalAdapter();
        this.driveAdapter = new DriveAdapter();
        this.settings = {
            mode: 'LOCAL',
            rootFolderName: 'Artifact Sync',
            pdfEnabled: false
        };

        this.loadSettings();

        // Listen for options updates
        chrome.runtime.onMessage.addListener((request) => {
            if (request.action === 'RELOAD_SETTINGS') {
                this.loadSettings();
            }
        });
    }

    async loadSettings() {
        const result = await chrome.storage.local.get(['storageMode', 'rootFolderName', 'pdfEnabled']);
        if (result.storageMode) this.settings.mode = result.storageMode;
        if (result.rootFolderName) this.settings.rootFolderName = result.rootFolderName;
        if (result.pdfEnabled !== undefined) this.settings.pdfEnabled = result.pdfEnabled;

        console.log(`Artifact Sync: Settings loaded. Mode: ${this.settings.mode}, Root: ${this.settings.rootFolderName}, PDF: ${this.settings.pdfEnabled}`);
    }

    async saveTurn(payload) {
        if (this.settings.mode === 'DRIVE') {
            return this.driveAdapter.save(payload, this.settings);
        } else {
            return this.localAdapter.save(payload, this.settings);
        }
    }
}
