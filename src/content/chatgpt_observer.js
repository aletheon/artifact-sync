console.log("Artifact Sync: ChatGPT Observer Loaded");

let lastProcessedPrompt = "";

const currentTurn = {
    status: 'IDLE',
    promptNode: null,
    promptText: "",
    responseNode: null,
    pendingImages: [],
    pendingAttachments: [],
    timer: null,
    startTime: 0,
    lastUpdate: 0
};

const DEBOUNCE_TIME = 2000;

function domToMarkdown(node) {
    return node.innerText || "";
}

function checkTurnCompletion() {
    if (currentTurn.status !== 'RECORDING') return;
    const promptText = currentTurn.promptNode.innerText.trim();

    // Find Response: direct sibling or next article
    let responseNode = currentTurn.responseNode;
    if (!responseNode) {
        let next = currentTurn.promptNode.nextElementSibling;
        while (next) {
            if (next.querySelector('[data-message-author-role="assistant"]') || next.innerText.length > 0) {
                responseNode = next;
                break;
            }
            next = next.nextElementSibling;
        }
    }

    if (!responseNode) {
        currentTurn.timer = setTimeout(checkTurnCompletion, 2000);
        return;
    }

    // Check if complete (ChatGPT streams, so we wait for stable text)
    const responseText = domToMarkdown(responseNode).trim();
    const isStreaming = responseNode.querySelector('.result-streaming') !== null;

    if (isStreaming) {
        currentTurn.timer = setTimeout(checkTurnCompletion, 1000);
        return;
    }

    // Save
    if (promptText === lastProcessedPrompt) {
        resetTurn();
        return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safePrompt = promptText.replace(/[^a-z0-9]/gi, '_').substring(0, 40);

    const payload = {
        title: document.title,
        prompt: promptText,
        response: responseText,
        timestamp: timestamp,
        safePrompt: safePrompt,
        source: 'ChatGPT',
        images: [], // ChatGPT images handling can be added here
        attachments: []
    };

    chrome.runtime.sendMessage({ action: 'SAVE_TURN', data: payload });
    lastProcessedPrompt = promptText;
    resetTurn();
}

function resetTurn() {
    if (currentTurn.timer) clearTimeout(currentTurn.timer);
    currentTurn.status = 'IDLE';
    currentTurn.promptNode = null;
    currentTurn.promptText = "";
    currentTurn.responseNode = null;
}

const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
        for (const n of m.addedNodes) {
            if (n.nodeType !== Node.ELEMENT_NODE) continue;

            // ChatGPT User Message Selector (Subject to change, simplified here)
            const userMsg = n.querySelector('[data-message-author-role="user"]');
            if (userMsg) {
                const text = userMsg.innerText.trim();
                if (text === lastProcessedPrompt) continue;
                if (currentTurn.status === 'RECORDING') continue;

                console.log("Artifact Sync: ChatGPT User Message detected");
                currentTurn.status = 'RECORDING';
                currentTurn.promptNode = n; // Usually the wrapper article
                currentTurn.promptText = text;
                currentTurn.timer = setTimeout(checkTurnCompletion, DEBOUNCE_TIME);
            }
        }
    }
});

observer.observe(document.body, { childList: true, subtree: true });
