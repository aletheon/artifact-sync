// modules/DriveProvider.js

export class DriveProvider {
    constructor() {
        this.folderCache = {};
    }

    async getAuthToken() {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(token);
                }
            });
        });
    }

    async findOrCreateFolder(token, folderName, parentId = null) {
        const cacheKey = parentId ? (parentId + "_" + folderName) : folderName;
        if (this.folderCache[cacheKey]) return this.folderCache[cacheKey];

        const folderPromise = (async () => {
            try {
                const searchUrl = new URL('https://www.googleapis.com/drive/v3/files');
                let q = "mimeType='application/vnd.google-apps.folder' and trashed=false";
                q += " and name='" + folderName.replace(/'/g, "\\'") + "'";
                if (parentId) q += " and '" + parentId + "' in parents";

                searchUrl.searchParams.append('q', q);
                searchUrl.searchParams.append('fields', 'files(id, name)');

                const searchRes = await fetch(searchUrl.toString(), {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const searchData = await searchRes.json();
                if (searchData.files && searchData.files.length > 0) return searchData.files[0].id;

                const metadata = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
                if (parentId) metadata.parents = [parentId];

                const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(metadata)
                });
                const createData = await createRes.json();
                if (createData.error) throw new Error(JSON.stringify(createData.error));
                return createData.id;
            } catch (e) {
                delete this.folderCache[cacheKey];
                throw e;
            }
        })();

        this.folderCache[cacheKey] = folderPromise;
        return folderPromise;
    }

    async uploadFile(token, folderId, filename, content, mimeType) {
        const metadata = { name: filename, parents: [folderId] };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([content], { type: mimeType }));

        const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: form
        });
        return await res.json();
    }

    async listFiles(pathArray, config) {
        const rootName = config?.rootFolder || "Artifact Sync";
        const token = await this.getAuthToken();

        try {
            // 1. Find Target Folder (create if needed, consistent with save flow)
            let currentFolderId = await this.findOrCreateFolder(token, rootName);

            for (const folderName of pathArray) {
                currentFolderId = await this.findOrCreateFolder(token, folderName, currentFolderId);
            }

            // 2. List Children
            const searchUrl = new URL('https://www.googleapis.com/drive/v3/files');
            let q = `'${currentFolderId}' in parents and trashed=false`;
            searchUrl.searchParams.append('q', q);
            searchUrl.searchParams.append('fields', 'files(name)');

            const res = await fetch(searchUrl.toString(), {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await res.json();
            return (data.files || []).map(f => f.name);

        } catch (e) {
            console.error("DriveProvider List Failed", e);
            return [];
        }
    }

    async readFile(pathArray, filename, config) {
        const rootName = config?.rootFolder || "Artifact Sync";
        const token = await this.getAuthToken();

        try {
            let currentFolderId = await this.findOrCreateFolder(token, rootName);
            for (const folderName of pathArray) {
                currentFolderId = await this.findOrCreateFolder(token, folderName, currentFolderId);
            }

            // Find file id
            const searchUrl = new URL('https://www.googleapis.com/drive/v3/files');
            let q = `'${currentFolderId}' in parents and name = '${filename.replace(/'/g, "\\'")}' and trashed=false`;
            searchUrl.searchParams.append('q', q);
            searchUrl.searchParams.append('fields', 'files(id)');

            const sRes = await fetch(searchUrl.toString(), {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const sData = await sRes.json();
            if (!sData.files || sData.files.length === 0) return null;

            const fileId = sData.files[0].id;

            // Download
            const dRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            return await dRes.text();
        } catch (e) {
            console.error("DriveProvider Read Failed", e);
            return null;
        }
    }

    async saveFile(pathArray, filename, content, mimeType, config) {
        // config = { rootFolder: "...", showSaveAs: bool }
        const rootName = config?.rootFolder || "Artifact Sync";

        const token = await this.getAuthToken();

        let currentFolderId = await this.findOrCreateFolder(token, rootName);

        for (const folderName of pathArray) {
            currentFolderId = await this.findOrCreateFolder(token, folderName, currentFolderId);
        }

        return await this.uploadFile(token, currentFolderId, filename, content, mimeType);
    }
}
