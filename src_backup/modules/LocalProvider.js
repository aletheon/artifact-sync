// modules/LocalProvider.js
import { DirectoryHandleManager } from './DirectoryHandleManager.js';

export class LocalProvider {
    constructor() {
        this.handleManager = new DirectoryHandleManager();
    }

    async toDataURL(content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // --- FS ACCESS METHODS ---
    async getRootHandle() {
        const handle = await this.handleManager.getHandle();
        if (!handle) {
            this.notifyError("No Folder Selected. Please Open Extension Settings.");
            throw new Error("No Local Folder selected.");
        }
        return handle;
    }

    async verifyPermission(handle, readWrite) {
        const options = {};
        if (readWrite) {
            options.mode = 'readwrite';
        }
        try {
            if ((await handle.queryPermission(options)) === 'granted') {
                return true;
            }
        } catch (e) { console.error("Permission Query Failed", e); }
        // We cannot requestPermission in BG, so we fail.
        return false;
    }

    notifyError(msg) {
        if (chrome && chrome.notifications) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon128.png',
                title: 'Artifact Sync Error',
                message: msg,
                priority: 2
            });
        }
        console.error("Artifact Sync LocalProvider:", msg);
    }

    // --- MAIN SAVE ---
    async listFiles(pathArray, config) {
        const strategy = config?.localStrategy || 'downloads';
        const rootName = config?.rootFolder || "Artifact Sync";

        if (strategy === 'custom') {
            try {
                let rootHandle = await this.getRootHandle();
                const hasPerm = await this.verifyPermission(rootHandle, false); // Read is enough
                if (!hasPerm) return [];

                let currentHandle = rootHandle;

                // 1. Enter Root (if exists)
                try {
                    currentHandle = await currentHandle.getDirectoryHandle(rootName);
                } catch (e) { return []; } // Root doesn't exist, so no files.

                // 2. Traverse
                for (const dirName of pathArray) {
                    const safeDir = dirName.replace(/[:\/]/g, "_");
                    try {
                        currentHandle = await currentHandle.getDirectoryHandle(safeDir);
                    } catch (e) { return []; }
                }

                // 3. List
                const files = [];
                for await (const key of currentHandle.keys()) {
                    files.push(key);
                }
                return files;

            } catch (e) {
                console.error("LocalProvider FS List Failed", e);
                return [];
            }
        }

        if (strategy === 'downloads') {
            const relativePath = [rootName, ...pathArray].join("/");
            console.log(`LocalProvider (Downloads): Listing files in ${relativePath}`);

            return new Promise((resolve) => {
                if (!chrome.downloads || !chrome.downloads.search) {
                    console.warn("LocalProvider: chrome.downloads API not available");
                    resolve([]);
                    return;
                }

                // Search for the specific conversation strictly if possible, or fall back to broader search
                // We use the last part of the path (Title) as the main query to ensure we find files even if paths vary slightly
                const searchTitle = pathArray[pathArray.length - 1];

                chrome.downloads.search({
                    limit: 1000,
                    orderBy: ['-startTime'],
                    query: [searchTitle]
                }, (results) => {
                    if (chrome.runtime.lastError) {
                        console.warn("LocalProvider: Download search failed", chrome.runtime.lastError);
                        resolve([]);
                        return;
                    }

                    const matchedFiles = [];
                    // We expect the file path to contain the full relative structure
                    // relativePath is like "Artifact Sync/Gemini/Title"
                    const normalizedStructure = relativePath.replace(/\\/g, '/');

                    results.forEach(item => {
                        if (!item.filename || !item.state || item.state === 'interrupted') return;

                        let normalizedPath = item.filename.replace(/\\/g, '/');

                        // Strict check: The file path must contain the expected folder structure
                        if (normalizedPath.includes(normalizedStructure)) {
                            // Extract basename
                            const parts = normalizedPath.split('/');
                            const basename = parts.pop();
                            matchedFiles.push(basename);
                        }
                    });

                    console.log(`LocalProvider (Downloads): Search for "${searchTitle}" found ${results.length} items. Matched ${matchedFiles.length} in correct folder.`);
                    resolve(matchedFiles);
                });
            });
        }

        return [];
    }

    async readFile(pathArray, filename, config) {
        const strategy = config?.localStrategy || 'downloads';
        const rootName = config?.rootFolder || "Artifact Sync";

        if (strategy === 'custom') {
            try {
                let currentHandle = await this.getRootHandle();
                // Traverse
                try {
                    currentHandle = await currentHandle.getDirectoryHandle(rootName);
                    for (const dirName of pathArray) {
                        const safeDir = dirName.replace(/[:\/]/g, "_");
                        currentHandle = await currentHandle.getDirectoryHandle(safeDir);
                    }
                    const fileHandle = await currentHandle.getFileHandle(filename);
                    const file = await fileHandle.getFile();
                    return await file.text();
                } catch (e) {
                    return null; // File or path not found
                }
            } catch (e) {
                console.error("LocalProvider FS Read Failed", e);
                return null;
            }
        }
        return null;
    }

    async saveFile(pathArray, filename, content, mimeType, config) {
        const strategy = config?.localStrategy || 'downloads';
        const rootName = config?.rootFolder || "Artifact Sync";

        // STRATEGY: DOWNLOADS API 
        if (strategy === 'downloads') {
            const saveAs = config?.showSaveAs || false;
            // Full Path: "{Root}/{Conversation}/subdir/filename"
            const fullPath = [rootName, ...pathArray, filename].join("/");
            console.log(`LocalProvider (Downloads): Saving to ${fullPath}`);

            const url = await this.toDataURL(content, mimeType);

            return new Promise((resolve, reject) => {
                chrome.downloads.download({
                    url: url,
                    filename: fullPath,
                    conflictAction: 'overwrite',
                    saveAs: saveAs
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        // Fallback notification since downloads API errors are silent usually
                        this.notifyError("Download Failed: " + chrome.runtime.lastError.message);
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(downloadId);
                    }
                });
            });
        }

        // STRATEGY: CUSTOM FOLDER (FileSystem Access)
        if (strategy === 'custom') {
            console.log(`LocalProvider (FS): Saving ${filename} to ${rootName}/` + pathArray.join("/"));

            let rootHandle = await this.getRootHandle();

            // CHECK PERMISSION
            const hasPerm = await this.verifyPermission(rootHandle, true);
            if (!hasPerm) {
                const err = "Permission Lost. Browser Security blocked background write. Please open Settings Popup to re-authorize.";
                this.notifyError(err);
                throw new Error(err);
            }

            try {
                // 1. Enter Root
                let currentHandle = await rootHandle.getDirectoryHandle(rootName, { create: true });

                // 2. Traverse
                for (const dirName of pathArray) {
                    const safeDir = dirName.replace(/[:\/]/g, "_");
                    currentHandle = await currentHandle.getDirectoryHandle(safeDir, { create: true });
                }

                // 3. File
                const fileHandle = await currentHandle.getFileHandle(filename, { create: true });

                // 4. Write
                const writable = await fileHandle.createWritable();
                await writable.write(content);
                await writable.close();
                console.log("LocalProvider: Write success");
                return true;

            } catch (e) {
                this.notifyError("FS Write Failed: " + e.message);
                throw e;
            }
        }
    }
}
