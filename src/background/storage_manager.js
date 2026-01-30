import { LocalAdapter } from '../storage/local_adapter.js';
import { DriveAdapter } from '../storage/drive_adapter.js';

export class StorageManager {
    constructor() {
        this.localAdapter = new LocalAdapter();
        this.driveAdapter = new DriveAdapter();
        // Default to LOCAL for now, will add settings later
        this.mode = 'LOCAL';
        this.loadSettings();
    }

    async loadSettings() {
        const result = await chrome.storage.local.get(['storageMode']);
        if (result.storageMode) {
            this.mode = result.storageMode;
        }
        console.log(`Artifact Sync: Storage Manager loaded. Mode: ${this.mode}`);
    }

    async saveTurn(payload) {
        if (this.mode === 'DRIVE') {
            return this.driveAdapter.save(payload);
        } else {
            return this.localAdapter.save(payload);
        }
    }
}
