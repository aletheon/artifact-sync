console.log("Artifact Sync: ChatGPT Observer Loaded");

let lastProcessedPrompt = "";

const currentTurn = {
    status: 'IDLE', // IDLE, RECORDING, SAVING
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
const MAX_WAIT_TIME = 60000; // 60s timeout

// --- DOM HELPERS ---

function getConversationTitle() {
    return document.title.replace("ChatGPT", "").trim() || "Conversation";
}

function domToMarkdown(node) {
    if (!node) return "";
    // ChatGPT often uses standard markdown classes or just clean text
    // We can rely on innerText for a basic grab, but might need more if they use strange HTML.
    return node.innerText || "";
}

function getChatId() {
    // URL: https://chatgpt.com/c/1234-5678...
    const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : 'default';
}

async function loadLastPrompt() {
    const chatId = getChatId();
    return new Promise((resolve) => {
        chrome.storage.local.get([`last_prompt_gpt_${chatId}`], (result) => {
            resolve(result[`last_prompt_gpt_${chatId}`] || "");
        });
    });
}

async function saveLastPrompt(promptText) {
    const chatId = getChatId();
    const key = `last_prompt_gpt_${chatId}`;
    await chrome.storage.local.set({ [key]: promptText });
    lastProcessedPrompt = promptText;
}

// Visual Debug Helper
function highlightNode(node, style) {
    if (node && node.style) {
        node.style.border = style;
        if (style) {
            node.setAttribute('data-artifact-sync', 'target');
        } else {
            node.removeAttribute('data-artifact-sync');
        }
    }
}

// --- CORE LOGIC ---

async function checkTurnCompletion() {
    const now = Date.now();
    if (currentTurn.status !== 'RECORDING') return;

    const promptText = currentTurn.promptNode.innerText.trim();

    // 1. Locate Response Node (ChatGPT is usually the next sibling '.group' or 'article')
    // We expect the model response to appear structurally after the prompt.
    let responseNode = currentTurn.responseNode;

    if (!responseNode) {
        // Fallback: Look for the next sibling that is an 'assistant' message
        // ChatGPT Structure: 
        // <article data-message-author-role="user">...</article>
        // <article data-message-author-role="assistant">...</article>

        let candidate = currentTurn.promptNode.nextElementSibling;
        while (candidate) {
            if (candidate.querySelector('[data-message-author-role="assistant"]') ||
                candidate.getAttribute('data-message-author-role') === 'assistant') {
                responseNode = candidate;
                break;
            }
            candidate = candidate.nextElementSibling;
        }
    }

    if (!responseNode) {
        if (now - currentTurn.startTime > MAX_WAIT_TIME) {
            console.log("Artifact Sync: Timed out looking for response.");
            resetTurn();
            return;
        }
        currentTurn.status = 'RECORDING'; // Keep waiting
        currentTurn.lastUpdate = now;
        if (currentTurn.timer) clearTimeout(currentTurn.timer);
        currentTurn.timer = setTimeout(checkTurnCompletion, 2000);
        return;
    }

    // 2. Found it!
    currentTurn.responseNode = responseNode;

    // 3. Extract Content
    // Be careful to select the generic markdown content, not the footer/buttons
    const contentContainer = responseNode.querySelector('.markdown') || responseNode;
    const responseText = domToMarkdown(contentContainer).trim();

    // Check if it's "Thinking..." or empty
    const isThinking = responseText.length === 0 || responseNode.querySelector('.result-streaming');

    if (isThinking) {
        currentTurn.lastUpdate = now;
        currentTurn.timer = setTimeout(checkTurnCompletion, 2000);
        return;
    }

    // 4. Artifacts / Attachments (TODO: Refine for ChatGPT specific structure)
    // For now, we focus on text.
    const finalAttachments = [];
    const finalArtifacts = [];

    // 5. Success - Build Payload
    if (promptText === lastProcessedPrompt) {
        resetTurn();
        return;
    }

    const storedLast = await loadLastPrompt();
    if (promptText === storedLast) {
        lastProcessedPrompt = storedLast;
        resetTurn();
        return;
    }

    // VISUAL DEBUG: Highlight Response (Green)
    highlightNode(responseNode, '2px solid #00ff00');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safePrompt = promptText.replace(/[^a-z0-9]/gi, '_').substring(0, 40);

    const payload = {
        title: getConversationTitle(),
        prompt: promptText,
        response: responseText,
        timestamp: timestamp,
        safePrompt: safePrompt,
        source: 'ChatGPT',
        images: finalArtifacts,
        attachments: finalAttachments
    };

    console.log("Artifact Sync: Sending completed turn payload...", payload);
    chrome.runtime.sendMessage({ action: 'SAVE_TURN', data: payload });

    await saveLastPrompt(promptText);
    resetTurn();
}

function resetTurn() {
    if (currentTurn.promptNode) highlightNode(currentTurn.promptNode, '');
    if (currentTurn.responseNode) highlightNode(currentTurn.responseNode, '');

    if (currentTurn.timer) clearTimeout(currentTurn.timer);
    currentTurn.status = 'IDLE';
    currentTurn.promptNode = null;
    currentTurn.promptText = "";
    currentTurn.responseNode = null;
}

// --- OBSERVER ---

function handleMutation(mutations) {
    const now = Date.now();
    let interactionDetected = false;

    for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;

            // ChatGPT User Message Detection
            // Look for <article data-message-author-role="user">
            let userMatch = null;
            if (node.matches('[data-message-author-role="user"]')) userMatch = node;
            else if (node.querySelector) userMatch = node.querySelector('[data-message-author-role="user"]');

            if (userMatch) {
                // Check if inside a parent that is the user message container?
                // ChatGPT usually wraps them in 'article'.
                // We need the TOP LEVEL container to be the 'promptNode' so we can find the sibling response.
                let container = userMatch.closest('article') || userMatch;

                const newText = container.innerText.trim();

                if (currentTurn.status === 'RECORDING') {
                    // Strict Positional Lock
                    if (currentTurn.promptNode === container) continue;
                    if (currentTurn.promptText === newText) continue;

                    const position = currentTurn.promptNode.compareDocumentPosition(container);
                    if (!(position & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
                }

                if (newText === lastProcessedPrompt) continue;

                // History Lock (Rough check for last element)
                // ChatGPT puts all messages in a list. We want the last one.
                // const allUser = document.querySelectorAll('[data-message-author-role="user"]');
                // ... (Similar logic to Gemini can be applied if needed)

                console.log("Artifact Sync: New ChatGPT User Turn detected.");
                if (currentTurn.status === 'SAVING') continue;

                resetTurn();
                currentTurn.status = 'RECORDING';
                currentTurn.promptNode = container;
                currentTurn.promptText = newText;
                currentTurn.startTime = now;
                currentTurn.lastUpdate = now;

                highlightNode(container, '2px solid #ff0000');
                interactionDetected = true;
            }
        }
    }

    if (interactionDetected && currentTurn.status !== 'SAVING') {
        if (currentTurn.timer) clearTimeout(currentTurn.timer);
        currentTurn.timer = setTimeout(checkTurnCompletion, DEBOUNCE_TIME);
    }
}

const observer = new MutationObserver(handleMutation);
loadLastPrompt().then(val => {
    lastProcessedPrompt = val;
    observer.observe(document.body, { childList: true, subtree: true });
});
