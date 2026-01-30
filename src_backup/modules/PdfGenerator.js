// modules/PdfGenerator.js
import "../lib/jspdf.js";

// In a Service Worker environment with UMD libs, 
// they often attach to 'self' or 'this' instead of window.
// We fallback to checking self.jspdf
const jsPDFArg = (typeof self !== 'undefined' && self.jspdf) ? self.jspdf.jsPDF : window.jspdf.jsPDF;

export class PdfGenerator {
    constructor() {
    }

    async createPdf(title, prompt, response, attachments = [], artifacts = []) {
        // Ensure library loaded
        if (!jsPDFArg) {
            throw new Error("jsPDF library not loaded correctly in global scope.");
        }

        const doc = new jsPDFArg();
        let y = 20; // Cursor Y position
        const pageHeight = doc.internal.pageSize.height;
        const margin = 20;

        const addText = (text, fontSize = 12, isBold = false) => {
            if (!text) return;
            doc.setFontSize(fontSize);
            doc.setFont("helvetica", isBold ? "bold" : "normal");

            // Text Wrap
            const lines = doc.splitTextToSize(text, 170);

            for (const line of lines) {
                if (y > pageHeight - margin) {
                    doc.addPage();
                    y = margin;
                }
                doc.text(line, margin, y);
                y += (fontSize / 2);
            }
            y += 5; // Paragraph spacing
        };

        // Header
        addText(title, 18, true);
        y += 5;

        // Prompt
        addText("User Prompt", 14, true);
        addText(prompt);
        y += 5;

        // Response
        addText("Gemini Response", 14, true);
        addText(response);

        // Helper to add Image Page
        const addImagePage = async (imgObj, label) => {
            try {
                doc.addPage();
                doc.setFontSize(14);
                doc.text(label + ": " + imgObj.filename, 20, 20);

                if (imgObj.blob) {
                    const dataUrl = await this.blobToDataURL(imgObj.blob);

                    // Constrain image to page
                    const imgProps = doc.getImageProperties(dataUrl);
                    const pdfWidth = doc.internal.pageSize.getWidth() - 40;
                    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

                    doc.addImage(dataUrl, 'PNG', 20, 30, pdfWidth, pdfHeight);
                }
            } catch (e) {
                console.error("PDF Image Error", e);
                doc.text("Error rendering image: " + imgObj.filename, 20, 40);
            }
        };

        // Append Attachments
        if (attachments && attachments.length > 0) {
            for (const att of attachments) await addImagePage(att, "Attachment");
        }

        // Append Artifacts
        if (artifacts && artifacts.length > 0) {
            for (const art of artifacts) await addImagePage(art, "Artifact");
        }

        return doc.output('blob');
    }

    blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
}
