// modules/StorageManager.js
import { DriveProvider } from './DriveProvider.js';
import { LocalProvider } from './LocalProvider.js';
import { PdfGenerator } from './PdfGenerator.js';

export class StorageManager {
    constructor() {
        this.drive = new DriveProvider();
        this.local = new LocalProvider();
        this.pdfGen = new PdfGenerator();
        this.settings = {};
    }

    async refreshSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get({
                savePrompts: true,
                saveAttachments: true,
                saveResponses: true,
                saveArtifacts: true,
                storageProvider: 'drive',
                localStrategy: 'downloads',
                outputFormat: 'markdown',
                rootFolderName: 'Artifact Sync',
                showSaveAs: false
            }, (items) => {
                this.settings = items;
                resolve(items);
            });
        });
    }

    async fetchBlob(url) {
        try {
            console.log("SM: Fetching", url);
            const res = await fetch(url);
            if (!res.ok) throw new Error("Fetch failed: " + res.status);
            return await res.blob();
        } catch (e) {
            console.error("SM: Fetch Error", e);
            return null;
        }
    }

    async handleTurn(payload) {
        await this.refreshSettings();
        const provider = this.settings.storageProvider === 'local' ? this.local : this.drive;
        const usePdf = this.settings.outputFormat === 'pdf';

        // Pass configuration
        const config = {
            rootFolder: this.settings.rootFolderName || 'Artifact Sync',
            showSaveAs: this.settings.showSaveAs,
            localStrategy: this.settings.localStrategy || 'downloads'
        };

        console.log(`SM: Turn. Provider: ${this.settings.storageProvider} (${config.localStrategy}), PDF: ${usePdf}, Root: ${config.rootFolder}`);

        const timestamp = payload.timestamp || new Date().toISOString().replace(/[:.]/g, '-');
        const safePrompt = payload.safePrompt || payload.prompt.replace(/[^a-z0-9]/gi, '_').substring(0, 40);
        const source = payload.source || 'Gemini';

        const conversationPath = [source, payload.title];

        // 1. DE-DUPLICATION CHECK
        try {
            const existingFiles = await provider.listFiles(conversationPath, config);
            // Check if any file starts with safePrompt (ignoring timestamp suffix)
            const duplicate = existingFiles.find(f => f.startsWith(safePrompt + "_"));
            if (duplicate) {
                console.log(`SM: Duplicate Turn Detected in ${source}/${payload.title}. File: ${duplicate}. Skipping.`);
                return;
            }
        } catch (e) {
            console.warn("SM: Dedupe Check Error", e);
        }

        const processImages = async (list) => {
            if (!list) return [];
            for (const img of list) {
                if (img.dataUrl) {
                    // Convert Base64 DataURL back to Blob for generic handling
                    // fetch(dataUrl) works in Service Worker and is an easy way to get a Blob from Base64
                    try {
                        const res = await fetch(img.dataUrl);
                        img.blob = await res.blob();
                    } catch (e) {
                        console.error("SM: Failed to hydrate blob from dataUrl", e);
                    }
                } else if (img.url && !img.blob) {
                    img.blob = await this.fetchBlob(img.url);
                }
            }
            return list;
        };

        await processImages(payload.attachments);
        await processImages(payload.images);

        // 2. SAVE ASSETS
        if (this.settings.saveAttachments && payload.attachments) {
            for (const att of payload.attachments) {
                if (att.blob) {
                    await provider.saveFile([...conversationPath, "attachments"], att.filename, att.blob, att.blob.type, config);
                }
            }
        }

        if (this.settings.saveArtifacts && payload.images) {
            for (const img of payload.images) {
                if (img.blob) {
                    await provider.saveFile([...conversationPath, "artifacts"], img.filename, img.blob, img.blob.type, config);
                }
            }
        }

        // 3. SAVE DOCUMENT
        if (this.settings.savePrompts || this.settings.saveResponses) {
            const filenameBase = `${safePrompt}_${timestamp}`;

            if (usePdf) {
                console.log("SM: Generating PDF...");
                const pdfBlob = await this.pdfGen.createPdf(
                    payload.title,
                    this.settings.savePrompts ? payload.prompt : "",
                    this.settings.saveResponses ? payload.response : "",
                    payload.attachments,
                    payload.images
                );

                await provider.saveFile([...conversationPath, "pdfs"], filenameBase + ".pdf", pdfBlob, "application/pdf", config);
                console.log("SM: Saved PDF");

            } else {
                console.log("SM: Generating Markdown...");
                let fileContent = "# " + payload.title + "\n\n";

                if (this.settings.savePrompts) {
                    fileContent += "## User Prompt\n" + payload.prompt + "\n\n";
                    if (payload.attachments && payload.attachments.length > 0) {
                        fileContent += "### Attachments\n";
                        payload.attachments.forEach(att => {
                            fileContent += `![${att.alt}](attachments/${att.filename})\n`;
                        });
                        fileContent += "\n";
                    }
                }

                if (this.settings.saveResponses) {
                    fileContent += "## Gemini Response\n" + payload.response + "\n\n";
                    if (payload.images && payload.images.length > 0) {
                        fileContent += "### Artifacts\n";
                        payload.images.forEach(img => {
                            fileContent += `![${img.alt}](artifacts/${img.filename})\n`;
                        });
                    }
                }

                await provider.saveFile(conversationPath, filenameBase + ".md", fileContent, 'text/markdown', config);
                console.log("SM: Saved MD");
            }
        }
    }
}
