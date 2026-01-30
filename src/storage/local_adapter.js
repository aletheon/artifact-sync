import '../lib/jspdf.js'; // Ensure jsPDF is loaded

export class LocalAdapter {
    constructor() {
        this.downloadsPending = 0;
    }

    async save(payload, settings) {
        console.log("Artifact Sync: LocalAdapter saving turn...", payload);
        const { title, prompt, response, timestamp, safePrompt, images, attachments, source } = payload;

        // 1. Create Folder Path
        const rootName = settings.rootFolderName || "Artifact Sync";
        const baseFolder = `${rootName}/${source}/${title.replace(/[:\/]/g, '-')}`;

        // 2. Save Logic (Exclusive: PDF or Markdown)
        if (settings.pdfEnabled) {
            // OPTION A: Save PDF
            try {
                console.log("Artifact Sync: Generating PDF (PDF Enabled)...");
                const pdfBlob = await this.generatePdf(payload);
                const pdfFilename = `${baseFolder}/${safePrompt}_${timestamp}.pdf`;
                await this.downloadBlob(pdfBlob, pdfFilename);
                console.log("Artifact Sync: PDF saved.");
            } catch (err) {
                console.error("Artifact Sync: PDF Generation failed", err);
                // Fallback to Markdown contextually? For now user requested strict exclusive.
            }
        } else {
            // OPTION B: Save Markdown (Default)
            console.log("Artifact Sync: Saving Markdown (PDF Disabled)...");
            const mdContent = this.generateMarkdown(payload);
            const mdFilename = `${baseFolder}/${safePrompt}_${timestamp}.md`;
            await this.download(mdContent, mdFilename, 'text/markdown');
        }

        // 3. Save Attachments (User Uploads)
        if (attachments && attachments.length > 0) {
            for (const att of attachments) {
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

    async generatePdf(payload) {
        // Access jsPDF from global scope (loaded via import)
        const { jsPDF } = self.jspdf;
        const doc = new jsPDF();
        const { title, prompt, response, timestamp, images, attachments } = payload;

        let y = 20;
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 15;
        const maxLineWidth = pageWidth - (margin * 2);

        // Helper to add text and advance Y
        const addText = (text, size = 12, style = 'normal', color = '#000000') => {
            doc.setFontSize(size);
            doc.setFont('helvetica', style);
            doc.setTextColor(color);

            // Text wrapping
            const lines = doc.splitTextToSize(text, maxLineWidth);
            doc.text(lines, margin, y);
            y += (lines.length * size * 0.4) + 5; // Approx line height

            // Page break check
            if (y > doc.internal.pageSize.getHeight() - 20) {
                doc.addPage();
                y = 20;
            }
        };

        // Header
        addText(`Artifact Sync: ${title}`, 16, 'bold', '#4A90E2');
        addText(`Time: ${timestamp}`, 10, 'normal', '#888888');
        y += 5;

        // USER
        addText("USER:", 12, 'bold', '#2C3E50');
        addText(prompt, 11, 'normal', '#000000');
        y += 5;

        // Attachments (Images)
        if (attachments && attachments.length > 0) {
            addText("Attachments:", 10, 'italic', '#666666');
            for (const att of attachments) {
                try {
                    const imgData = await this.fetchImageAsBase64(att.url);
                    // Constraint image size
                    const props = doc.getImageProperties(imgData);
                    const imgWidth = Math.min(100, maxLineWidth);
                    const imgHeight = (props.height * imgWidth) / props.width;

                    if (y + imgHeight > doc.internal.pageSize.getHeight() - 20) {
                        doc.addPage();
                        y = 20;
                    }

                    doc.addImage(imgData, 'PNG', margin, y, imgWidth, imgHeight);
                    y += imgHeight + 10;
                } catch (e) {
                    console.warn("Failed to embed attachment PDF", e);
                    addText(`[Image: ${att.filename}]`, 10, 'italic', '#Red');
                }
            }
            y += 5;
        }

        // AI RESPONSE
        addText("GEMINI:", 12, 'bold', '#27AE60');

        // Clean markdown a bit for PDF (basic)
        const cleanResponse = response.replace(/\*\*/g, '').replace(/###/g, ''); // Simple strip
        addText(cleanResponse, 11, 'normal', '#000000');
        y += 5;

        // Artifacts (Images)
        if (images && images.length > 0) {
            addText("Artifacts:", 10, 'italic', '#666666');
            for (const img of images) {
                try {
                    const imgData = await this.fetchImageAsBase64(img.url);
                    const props = doc.getImageProperties(imgData);
                    const imgWidth = Math.min(150, maxLineWidth);
                    const imgHeight = (props.height * imgWidth) / props.width;

                    if (y + imgHeight > doc.internal.pageSize.getHeight() - 20) {
                        doc.addPage();
                        y = 20;
                    }

                    doc.addImage(imgData, 'PNG', margin, y, imgWidth, imgHeight);
                    y += imgHeight + 10;
                } catch (e) {
                    console.warn("Failed to embed artifact PDF", e);
                    addText(`[Image: ${img.filename}]`, 10, 'italic', '#Red');
                }
            }
        }

        return doc.output('blob');
    }

    async fetchImageAsBase64(url) {
        const response = await fetch(url);
        const blob = await response.blob();
        return await this.blobToDataURL(blob);
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

    async download(content, filename, mimeType) {
        const base64 = await this.blobToDataURL(new Blob([content], { type: mimeType }));
        return this.downloadUrl(base64, filename);
    }

    async downloadBlob(blob, filename) {
        const base64 = await this.blobToDataURL(blob);
        return this.downloadUrl(base64, filename);
    }

    blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
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
