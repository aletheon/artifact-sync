console.log("Artifact Sync: Gemini Observer Loaded (v2.0 Rebuild)");

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
    const titleEl = document.querySelector('.conversation-title');
    if (titleEl) return titleEl.innerText.trim();
    return document.title.replace("Gemini", "").trim() || "Conversation";
}

function domToMarkdown(node) {
    return node.innerText || "";
}

function extractAttachments(promptNode) {
    const candidates = [];
    const scanNode = (n) => {
        if (!n || !n.querySelectorAll) return;
        const imgs = n.querySelectorAll('img');
        imgs.forEach(img => candidates.push(img));
        if (n.tagName === 'IMG') candidates.push(n);
    };

    // 1. Scan Inside
    scanNode(promptNode);
    // 2. Scan Parent (Wrapper)
    if (promptNode.parentElement) scanNode(promptNode.parentElement);
    // 3. Scan Previous Sibling (Separate Block)
    if (promptNode.previousElementSibling) scanNode(promptNode.previousElementSibling);
    // 4. Scan Row Above
    if (promptNode.parentElement && promptNode.parentElement.previousElementSibling) {
        scanNode(promptNode.parentElement.previousElementSibling);
    }

    const list = [];
    candidates.forEach(img => {
        if (img.width < 50 || img.height < 50) return;
        if (img.src.includes("googleusercontent.com") && img.src.includes("s64")) return;
        if (img.className.includes("avatar")) return;
        if (list.includes(img)) return;

        list.push(img);
    });
    return list;
}

const isModel = (n) => {
    if (!n || n.nodeType !== Node.ELEMENT_NODE) return false;
    // Known specific selectors
    if (n.getAttribute('data-message-author-role') === 'model') return true;
    if (n.classList.contains('model-query-bubble')) return true;
    if (n.classList.contains('message-content')) return true;

    // We handle PENDING-RESPONSE manually in the fallback logic now
    // to prevent greedy matching on empty placeholders.
    // if (n.tagName === 'PENDING-RESPONSE') return true; 

    // Structure-based heuristic: If it has "text" class or looks like a message
    if (n.classList.contains('markdown')) return true;

    return false;
};

function findResponseFallback(userNode) {
    let pendingCandidate = null;

    // 1. Sibling Scan (Specific)
    let next = userNode.nextElementSibling;
    let attempts = 0;
    while (next && attempts < 10) {
        console.log("Artifact Sync: Scanning sibling:", next.tagName, next.className);

        // Track Pending/Model tags as backups
        if (next.tagName === 'PENDING-RESPONSE' || next.tagName === 'MODEL-RESPONSE') {
            pendingCandidate = next;
        }

        if (isModel(next)) {
            console.log("Artifact Sync: Found response via Sibling Scan!", next);
            return next;
        }
        // Deep check for markdown if the tag itself isn't obvious
        if (next.querySelector('.markdown')) {
            console.log("Artifact Sync: Found response via Sibling->Markdown Scan!", next);
            return next;
        }
        next = next.nextElementSibling;
        attempts++;
    }

    // 2. Row/Parent Scan (Specific)
    let parent = userNode.parentElement;
    for (let i = 0; i < 15 && parent && parent.tagName !== 'MAIN'; i++) {
        console.log(`Artifact Sync: Ancestor Level ${i}:`, parent.tagName, parent.className);

        let pNext = parent.nextElementSibling;
        let pAttempts = 0;
        while (pNext && pAttempts < 10) {
            console.log(`Artifact Sync: Scanning uncle (L${i}):`, pNext.tagName, pNext.className);

            // Track Pending/Model tags as backups
            if (pNext.tagName === 'PENDING-RESPONSE' || pNext.tagName === 'MODEL-RESPONSE') {
                pendingCandidate = pNext;
            }

            if (isModel(pNext)) {
                console.log("Artifact Sync: Found response via Uncle Scan!", pNext);
                return pNext;
            }
            if (pNext.querySelector) {
                const bubble = pNext.querySelector('.model-query-bubble');
                if (bubble) {
                    console.log("Artifact Sync: Found response via Uncle->Child Scan!", bubble);
                    return bubble;
                }
                const roleModel = pNext.querySelector('[data-message-author-role="model"]');
                if (roleModel) {
                    console.log("Artifact Sync: Found response via Uncle->Role Scan!", roleModel);
                    return roleModel;
                }
                // Generic Markdown Check (Strong Fallback)
                const markdown = pNext.querySelector('.markdown');
                if (markdown) {
                    console.log("Artifact Sync: Found response via Uncle->Markdown Scan!", markdown);
                    return markdown;
                }
            }
            pNext = pNext.nextElementSibling;
            pAttempts++;
        }
        parent = parent.parentElement;
    }

    if (pendingCandidate) {
        console.log("Artifact Sync: No content found, falling back to PENDING-RESPONSE candidate.", pendingCandidate);
        return pendingCandidate;
    }

    // 3. Last Resort (Global Specific) - REMOVED
    // The Global Scan was too aggressive and started grabbing *previous* history nodes
    // if the new response hadn't rendered instantly.
    // We now strictly require the response to be a Sibling or Cousin (Parent's Sibling).
    // If we don't find it, we return null, which causes 'checkTurnCompletion' to wait and retry.
    /* 
    const allModelNodes = document.querySelectorAll('[data-message-author-role="model"], .model-query-bubble, .message-content');
    for (const modelNode of allModelNodes) {
        // ...
    }
    */

    return null;

    return null;
}

// --- CORE LOGIC ---

// --- PERSISTENCE HELPERS ---

function getChatId() {
    // URL format: https://gemini.google.com/app/123456...
    const match = window.location.pathname.match(/\/app\/([a-zA-Z0-9]+)/);
    return match ? match[1] : 'default';
}

async function loadLastPrompt() {
    const chatId = getChatId();
    return new Promise((resolve) => {
        chrome.storage.local.get([`last_prompt_${chatId}`], (result) => {
            resolve(result[`last_prompt_${chatId}`] || "");
        });
    });
}

async function saveLastPrompt(promptText) {
    const chatId = getChatId();
    const key = `last_prompt_${chatId}`;
    await chrome.storage.local.set({ [key]: promptText });
    lastProcessedPrompt = promptText;
}

// --- CORE LOGIC ---

async function checkTurnCompletion() {
    const now = Date.now();
    if (currentTurn.status !== 'RECORDING') return;

    const promptText = currentTurn.promptNode.innerText.trim();
    console.log("Artifact Sync: Checking turn for prompt node:", currentTurn.promptNode.tagName, currentTurn.promptNode.className);

    // 1. Locate Response Node
    let responseNode = currentTurn.responseNode;

    // VALIDATION: Is cached node still in DOM?
    if (responseNode && !responseNode.isConnected) {
        console.log("Artifact Sync: Cached response node was detached from DOM. Rescanning...");
        responseNode = null;
        currentTurn.responseNode = null;
    }

    if (!responseNode) {
        responseNode = findResponseFallback(currentTurn.promptNode);
    }

    if (!responseNode) {
        if (now - currentTurn.startTime > MAX_WAIT_TIME) {
            console.log("Artifact Sync: Timed out looking for response.");
            resetTurn();
            return;
        }
        currentTurn.status = 'RECORDING';
        currentTurn.lastUpdate = now;
        if (currentTurn.timer) clearTimeout(currentTurn.timer);
        currentTurn.timer = setTimeout(checkTurnCompletion, 2000); // 2s polling
        return;
    }

    // 2. Found it!
    currentTurn.responseNode = responseNode;

    // 3. Extract Content
    const responseText = domToMarkdown(responseNode).trim();

    // 4. Extract Artifacts (Images in Response)
    const responseImages = [];
    responseNode.querySelectorAll('img').forEach(img => {
        if (img.width > 100 && img.height > 100) responseImages.push(img);
    });

    // 5. Extract Attachments
    const attachmentImgs = extractAttachments(currentTurn.promptNode);

    // 6. Check for completion (Empty text + no images = still generating?)
    if (responseText.length < 2 && responseImages.length === 0) {
        console.log(`Artifact Sync: Response incomplete (Len: ${responseText.length}, Imgs: ${responseImages.length}). Waiting...`);
        currentTurn.lastUpdate = now;
        currentTurn.timer = setTimeout(checkTurnCompletion, 2000);
        return;
    }

    // 7. Success - Build Payload
    // DEDUPLICATION: Check against persistent storage
    if (promptText === lastProcessedPrompt) {
        console.log("Artifact Sync: Prompt matches last saved (Memory). Skipping.");
        resetTurn();
        return;
    }

    // Double check storage just in case (race condition or first load)
    const storedLast = await loadLastPrompt();
    if (promptText === storedLast) {
        console.log("Artifact Sync: Prompt matches last saved (Storage). Skipping.");
        lastProcessedPrompt = storedLast; // Sync memory
        resetTurn();
        return;
    }

    // VISUAL DEBUG: Highlight Response (Green)
    highlightNode(responseNode, '2px solid #00ff00'); // Green

    // Process Files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safePrompt = promptText.replace(/[^a-z0-9]/gi, '_').substring(0, 40);

    const finalAttachments = attachmentImgs.map((img, idx) => ({
        url: img.src,
        filename: `${safePrompt}_${timestamp}_attachment${attachmentImgs.length > 1 ? '_' + (idx + 1) : ''}.png`,
        alt: "attachment"
    }));

    const finalArtifacts = responseImages.map((img, idx) => ({
        url: img.src,
        filename: `${safePrompt}_${timestamp}${responseImages.length > 1 ? '_' + (idx + 1) : ''}.png`,
        alt: img.alt || "artifact"
    }));

    const payload = {
        title: getConversationTitle(),
        prompt: promptText,
        response: responseText,
        timestamp: timestamp,
        safePrompt: safePrompt,
        source: 'Gemini',
        images: finalArtifacts,
        attachments: finalAttachments
    };

    console.log("Artifact Sync: Sending completed turn payload...", payload);
    chrome.runtime.sendMessage({ action: 'SAVE_TURN', data: payload });

    // Update Persistence
    await saveLastPrompt(promptText);
    resetTurn();
}

function resetTurn() {
    // Clear Highlights
    if (currentTurn.promptNode) highlightNode(currentTurn.promptNode, '');
    if (currentTurn.responseNode) highlightNode(currentTurn.responseNode, '');

    if (currentTurn.timer) clearTimeout(currentTurn.timer);
    currentTurn.status = 'IDLE';
    currentTurn.promptNode = null;
    currentTurn.promptText = "";
    currentTurn.responseNode = null;
    currentTurn.pendingImages = [];
    currentTurn.pendingAttachments = [];
}

// Visual Debug Helper
function highlightNode(node, style) {
    if (node && node.style) {
        node.style.border = style;
        // Optionally add a label
        if (style) {
            node.setAttribute('data-artifact-sync', 'target');
        } else {
            node.removeAttribute('data-artifact-sync');
        }
    }
}

// --- OBSERVER ---

function handleMutation(mutations) {
    const now = Date.now();
    let interactionDetected = false;

    for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;

            // A. USER MESSAGE DETECTION
            let userMatch = null;
            if (node.matches('.user-query-bubble-with-background')) userMatch = node;
            else if (node.querySelector) {
                userMatch = node.querySelector('.user-query-bubble-with-background');
                if (!userMatch) userMatch = node.querySelector('[data-message-author-role="user"]');
            }

            if (userMatch) {
                const newText = userMatch.innerText.trim();

                // Dedupe 1: Active (Strict Positional Lock)
                if (currentTurn.status === 'RECORDING') {
                    // Check 1: Is it the exact same node?
                    if (currentTurn.promptNode === userMatch) continue;

                    // Check 2: Text Match (Fuzzy)
                    if (currentTurn.promptText === newText) continue;

                    // Check 3: Positional Lock (CRITICAL)
                    // If the new node is NOT strictly *after* the current prompt node,
                    // then it is either a re-render of the current node or a history node.
                    // We only switch turns if we see a node strictly FOLLOWING the current one.
                    const position = currentTurn.promptNode.compareDocumentPosition(userMatch);
                    if (!(position & Node.DOCUMENT_POSITION_FOLLOWING)) {
                        console.log("Artifact Sync: Ignoring upstream/parallel re-render occurring during active turn.");
                        continue;
                    }
                }

                // Dedupe 2: Saved
                if (newText === lastProcessedPrompt) continue;

                // Dedupe 3: History (Is this the LAST node?)
                // We must be careful not to let the "Input Area" (which might have role="user")
                // trick us into thinking the message above it is "history".

                // 1. Get all potential user message nodes
                const candidates = Array.from(document.querySelectorAll('.user-query-bubble-with-background, [data-message-author-role="user"]'));

                // 2. Filter down to "Real" messages (exclude input box/drafts)
                const realMessages = candidates.filter(n => {
                    // Exclude input areas
                    if (n.isContentEditable) return false;
                    if (n.getAttribute('role') === 'textbox') return false;
                    // Check for minimum text content to be a saved message
                    if (!n.innerText || n.innerText.trim().length === 0) return false;
                    return true;
                });

                if (realMessages.length > 0) {
                    const last = realMessages[realMessages.length - 1];

                    // Validation: Is 'userMatch' the Last (or inside the Last) node?
                    const isLast = (userMatch === last) || (last.contains(userMatch));

                    if (!isLast) {
                        // Double check: Sometimes Gemini splits the new message into multiple nodes.
                        // If userMatch is the *second to last* and the last one is identical text...
                        // forcing a strict check might be too aggressive.
                        // Let's rely on the Position Check:
                        // If there is a "Real Message" strictly FOLLOWING this one, then ignore logic applies.

                        const isStrictlyFollowed = realMessages.some(laterNode => {
                            return (userMatch !== laterNode) &&
                                (userMatch.compareDocumentPosition(laterNode) & Node.DOCUMENT_POSITION_FOLLOWING) &&
                                !userMatch.contains(laterNode); // Don't count children
                        });

                        if (isStrictlyFollowed) {
                            // console.log("Artifact Sync: Ignoring history node (found newer message below).");
                            continue;
                        }
                    }
                }

                // New Turn!
                console.log("Artifact Sync: New User Turn detected.");
                if (currentTurn.status === 'SAVING') continue; // Busy

                resetTurn();
                currentTurn.status = 'RECORDING';
                currentTurn.promptNode = userMatch;
                currentTurn.promptText = newText;
                currentTurn.startTime = now;
                currentTurn.lastUpdate = now;

                // VISUAL DEBUG: Highlight Prompt (Red)
                highlightNode(userMatch, '2px solid #ff0000');

                interactionDetected = true;
            }

            // B. MODEL MESSAGE DETECTION (Event-Based)
            if (currentTurn.status === 'RECORDING' && currentTurn.promptNode) {
                let modelMatch = null;
                if (isModel(node)) modelMatch = node;
                else if (node.querySelector) {
                    if (node.classList.contains('model-query-bubble')) modelMatch = node;
                    else modelMatch = node.querySelector('.model-query-bubble') || node.querySelector('[data-message-author-role="model"]');
                }

                if (modelMatch) {
                    if (currentTurn.promptNode.compareDocumentPosition(modelMatch) & Node.DOCUMENT_POSITION_FOLLOWING) {
                        console.log("Artifact Sync: Model Response Appeared.");
                        currentTurn.responseNode = modelMatch;
                    }
                }
            }
        }
    }

    if (interactionDetected && currentTurn.status !== 'SAVING') {
        if (currentTurn.timer) clearTimeout(currentTurn.timer);
        currentTurn.timer = setTimeout(checkTurnCompletion, DEBOUNCE_TIME);
    }
}

const observer = new MutationObserver(handleMutation);

// Initialize: Load last prompt for this chat ID
loadLastPrompt().then(val => {
    lastProcessedPrompt = val;
    console.log("Artifact Sync: Loaded last history prompt =>", val.substring(0, 50) + "...");
    observer.observe(document.body, { childList: true, subtree: true });
});
