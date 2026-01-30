import '../lib/jspdf.js'; // Ensure jsPDF is loaded

export class LocalAdapter {
    constructor() {
        this.downloadsPending = 0;
    }

    async save(payload) {
        console.log("Artifact Sync: LocalAdapter saving turn...", payload);
        const { title, prompt, response, timestamp, safePrompt, images, attachments, source } = payload;

        // 1. Create Folder Path
        // "Artifact Sync / {Source} / {Title} /"
        // Since Chrome Downloads API doesn't support absolute paths, we rely on relative paths inside Downloads.
        const baseFolder = `Artifact Sync/${source}/${title.replace(/[:\/]/g, '-')}`;

        // 2. Save Conversation Log (Markdown)
        const mdContent = this.generateMarkdown(payload);
        const mdFilename = `${baseFolder}/${safePrompt}_${timestamp}.md`;
        await this.download(mdContent, mdFilename, 'text/markdown');

        // 3. Save Attachments (User Uploads)
        if (attachments && attachments.length > 0) {
            for (const att of attachments) {
                // Filename is already formatted by Content Script (e.g. prompt_time_attachment_1.png)
                // We just need to prepend the folder
                const fullPath = `${baseFolder}/attachments/${att.filename}`;
                await this.downloadUrl(att.url, fullPath);
            }
        }

        // 4. Save Artifacts (AI Generated Images)
        if (images && images.length > 0) {
            for (const img of images) {
                const fullPath = `${baseFolder}/artifacts/${img.filename}`;
                await this.downloadUrl(img.url, fullPath);
            }
        }
    }

    generateMarkdown(payload) {
        const { prompt, response, timestamp, attachments, images } = payload;
        let md = `# Turn: ${timestamp}\n\n`;

        md += `## USER\n${prompt}\n\n`;

        if (attachments && attachments.length > 0) {
            md += `### Attachments\n`;
            attachments.forEach(att => {
                md += `![${att.alt}](attachments/${att.filename})\n`;
            });
            md += `\n`;
        }

        md += `## AI\n${response}\n\n`;

        if (images && images.length > 0) {
            md += `### Artifacts\n`;
            images.forEach(img => {
                md += `![${img.alt}](artifacts/${img.filename})\n`;
            });
            md += `\n`;
        }

        return md;
    }

    download(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        return this.downloadUrl(url, filename);
    }

    downloadUrl(url, filename) {
        return new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: url,
                filename: filename,
                conflictAction: 'uniquify',
                saveAs: false
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error("Download failed", chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(downloadId);
                }
            });
        });
    }
}
