// content_chatgpt.js
console.log("Artifact Sync: ChatGPT Scraper Loaded.");

let lastProcessedPrompt = "";
let timer = null;

function getConversationTitle() {
    return document.title.replace("ChatGPT", "").trim();
}

function findLatestTurn() {
    // ChatGPT: [data-message-author-role="user"] and [data-message-author-role="assistant"]
    const userNotes = document.querySelectorAll('[data-message-author-role="user"]');
    const assistNotes = document.querySelectorAll('[data-message-author-role="assistant"]');

    if (userNotes.length === 0) return null;

    const lastUser = userNotes[userNotes.length - 1];

    // Find corresponding assistant message (should be after user)
    // ChatGPT structure is sometimes flat, sometimes nested.
    // Usually they are in a list of articles.

    // We can try to see if there is an assistant message *after* the user message in the DOM
    let response = null;
    const all = document.querySelectorAll('[data-message-author-role]');
    let foundUser = false;
    for (const node of all) {
        if (node === lastUser) foundUser = true;
        else if (foundUser && node.getAttribute('data-message-author-role') === 'assistant') {
            response = node; // Update to latest response after user
        }
    }

    return { user: lastUser, assistant: response };
}

function checkTurn() {
    const turn = findLatestTurn();
    if (!turn || !turn.user) return;

    const userText = turn.user.innerText.trim();
    if (userText === lastProcessedPrompt) return;

    if (turn.assistant) {
        // Check for streaming
        const stopBtn = document.querySelector('[data-testid="stop-button"]');
        if (stopBtn) {
            // Still streaming
            if (timer) clearTimeout(timer);
            timer = setTimeout(checkTurn, 1000);
            return;
        }

        // Ready
        saveTurn(turn.user, turn.assistant);
    } else {
        if (timer) clearTimeout(timer);
        timer = setTimeout(checkTurn, 1000);
    }
}

function saveTurn(userNode, responseNode) {
    const promptText = userNode.innerText.trim();
    const responseText = responseNode.innerText.trim();
    const title = getConversationTitle();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safePrompt = promptText.replace(/[^a-z0-9]/gi, '_').substring(0, 40);

    // EXTRACT ATTACHMENTS (User)
    const attachments = extractAttachments(userNode, safePrompt, timestamp);

    // EXTRACT ARTIFACTS (Assistant)
    const artifacts = extractImages(responseNode, safePrompt, timestamp);

    // Convert Blobs if needed (Async operation)
    Promise.all([
        processImages(attachments),
        processImages(artifacts)
    ]).then(([procAttachments, procArtifacts]) => {
        const payload = {
            source: 'ChatGPT',
            title: title,
            prompt: promptText,
            response: responseText,
            timestamp: timestamp,
            safePrompt: safePrompt,
            images: procArtifacts,
            attachments: procAttachments
        };

        console.log("Artifact Sync: Saving ChatGPT Turn", payload);

        chrome.runtime.sendMessage({ action: 'SAVE_TURN', data: payload }, () => {
            if (chrome.runtime.lastError) console.log("BG Error: " + chrome.runtime.lastError.message);
            else {
                lastProcessedPrompt = promptText;
                console.log("Artifact Sync: ChatGPT Turn Saved");
            }
        });
    });
}

function extractAttachments(node, safePrompt, timestamp) {
    // ChatGPT attachments are usually images inside the user message or wrapper
    // We can look for img tags.
    const imgs = node.querySelectorAll('img');
    const list = [];
    imgs.forEach((img, idx) => {
        // Filter out avatars
        if (img.width < 50 || img.height < 50) return;
        if (img.alt === "User") return;

        // STRATEGY (v4): Visual Text & Regex Scan for ChatGPT
        let bestName = null;
        const candidates = [];

        const addCandidate = (val) => {
            if (val && typeof val === 'string' && val.trim().length > 0) candidates.push(val.trim());
        };

        addCandidate(img.getAttribute('title'));
        addCandidate(img.getAttribute('aria-label'));
        addCandidate(img.alt);

        // Vicinity Scan
        let p = img.parentElement;
        for (let i = 0; i < 4 && p; i++) {
            addCandidate(p.getAttribute('title'));
            addCandidate(p.getAttribute('aria-label'));

            // Text Scan
            const textParts = p.innerText.split(/[\n\t]+/);
            for (const part of textParts) addCandidate(part);

            p = p.parentElement;
        }

        const badNames = ["uploaded image", "image", "attachment", "preview", "user"];
        const filenameRegex = /[a-zA-Z0-9_\-\(\)\s]+\.(png|jpg|jpeg|webp|gif|bmp|txt|csv|pdf|md|json|js|html|css)/i;

        for (const c of candidates) {
            let s = c.trim();
            if (s.toLowerCase().startsWith("remove ")) s = s.substring(7).trim();

            if (badNames.some(b => s.toLowerCase() === b)) continue;
            if (badNames.some(b => s.toLowerCase().includes(b) && !s.includes('.'))) continue;

            const match = s.match(filenameRegex);
            if (match) {
                if (s.length < 50) bestName = s;
                else bestName = match[0];
                break;
            }
        }

        if (!bestName) {
            for (const c of candidates) {
                let s = c.trim();
                if (badNames.some(b => s.toLowerCase().includes(b))) continue;
                if (s.length > 50) continue;
                bestName = s;
                break;
            }
        }

        const rawName = bestName || "attachment";
        let safeName = rawName.replace(/[^a-z0-9\.\-_]/gi, '_');

        if (safeName.length < 3) safeName = "attachment";

        const suffix = list.length > 0 ? `_${list.length + 1}` : "";
        const filename = `${safePrompt}_${timestamp}_${safeName}${suffix}.png`;
        list.push({ src: img.src, filename: filename, alt: rawName });
    });
    return list;
}

function extractImages(node, safePrompt, timestamp) {
    const imgs = node.querySelectorAll('img');
    const list = [];
    imgs.forEach((img, idx) => {
        // Filter out tiny icons
        if (img.width < 100 || img.height < 100) return;

        const suffix = list.length > 0 ? `_${list.length + 1}` : "";
        const filename = `${safePrompt}_${timestamp}_artifact${suffix}.png`;
        list.push({ src: img.src, filename: filename, alt: img.alt || "artifact" });
    });
    return list;
}

async function processImages(list) {
    // Converts blob URLs to Base64/DataURL if possible, 
    // because BG script might not be able to fetch blob: from content script context.
    const processed = [];
    for (const item of list) {
        let url = item.src;
        if (url.startsWith('blob:')) {
            try {
                url = await blobToDataURL(url);
            } catch (e) {
                console.error("Failed to convert blob", e);
            }
        }
        processed.push({
            filename: item.filename,
            url: url,
            alt: item.alt
        });
    }
    return processed;
}

async function blobToDataURL(blobUrl) {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

const observer = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(checkTurn, 2000);
});
observer.observe(document.body, { childList: true, subtree: true, characterData: true });
