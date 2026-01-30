// content_gemini.js
console.log("Artifact Sync: Gemini Scraper Loaded.");

let lastProcessedPrompt = "";
let lastSavedResponse = "";

const currentTurn = {
  status: 'IDLE', // IDLE, RECORDING, SAVING
  promptNode: null,
  pendingImages: [],
  pendingAttachments: [],
  timer: null,
  startTime: 0,
  lastUpdate: 0
};

const DEBOUNCE_TIME = 2000;
const MAX_WAIT_TIME = 60000; // 60s timeout

function getConversationTitle() {
  const titleEl = document.querySelector('.conversation-title');
  if (titleEl) return titleEl.innerText.trim();
  return document.title.replace("Gemini", "").trim() || "Conversation";
}

function domToMarkdown(node) {
  // Simple markdown converter
  let md = node.innerText;
  return md;
}

function findResponseAfter(userNode) {
  // STRATEGY: 
  // 1. Check direct siblings (old way)
  // 2. If not found, go up one level (wrapper) and check ITS siblings.
  // 3. Repeat (up to 3 levels).

  // Helper to check if a node is a model message
  const isModel = (n) => {
    if (!n || n.nodeType !== Node.ELEMENT_NODE) return false;
    if (n.getAttribute('data-message-author-role') === 'model') return true;
    if (n.classList.contains('model-query-bubble')) return true;
    if (n.querySelector('.model-query-bubble')) return true;
    return false;
  };

  // 1. Sibling Scan
  let next = userNode.nextElementSibling;
  while (next) {
    if (isModel(next)) return next;
    next = next.nextElementSibling;
  }

  // 2. Parent-Sibling Scan (Row Level)
  let parent = userNode.parentElement;
  // Don't go too high (e.g. body)
  for (let i = 0; i < 3 && parent && parent.tagName !== 'MAIN'; i++) {
    let pNext = parent.nextElementSibling;
    while (pNext) {
      if (isModel(pNext)) return pNext;
      // Also check inside the sibling
      if (pNext.querySelector && pNext.querySelector('.model-query-bubble')) return pNext.querySelector('.model-query-bubble');
      pNext = pNext.nextElementSibling;
    }
    parent = parent.parentElement;
  }

  return null;
}

function checkTurnCompletion() {
  const now = Date.now();
  if (currentTurn.status !== 'RECORDING') return;

  const promptText = currentTurn.promptNode.innerText.trim();

  // 1.5 Scan for Attachments (Robust Vicinity Scan)
  // We look in:
  // A. The prompt node itself
  // B. The prompt node's parent (often a wrapper for both text and image)
  // C. The prompt node's PREVIOUS SIBLING (often the image block is separate)
  // D. The prompt node's PARENT'S Previous Sibling (Row above)

  const candidates = [];

  const scanNode = (n) => {
    if (!n || !n.querySelectorAll) return;
    const imgs = n.querySelectorAll('img');
    imgs.forEach(img => candidates.push(img));
    // Also check if n itself is an image
    if (n.tagName === 'IMG') candidates.push(n);
  };

  // A & B
  scanNode(currentTurn.promptNode);
  if (currentTurn.promptNode.parentElement) scanNode(currentTurn.promptNode.parentElement);

  // C
  scanNode(currentTurn.promptNode.previousElementSibling);

  // D (Row above)
  if (currentTurn.promptNode.parentElement) {
    scanNode(currentTurn.promptNode.parentElement.previousElementSibling);
  }

  const attachmentList = [];
  candidates.forEach(img => {
    // Skip if tiny or avatar
    if (img.width < 50 || img.height < 50) return;
    if (img.src.includes("googleusercontent.com") && img.src.includes("s64")) return;
    if (img.className.includes("avatar")) return;

    // Avoid duplicates
    if (attachmentList.includes(img)) return;

    attachmentList.push(img);
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safePrompt = promptText.replace(/[^a-z0-9]/gi, '_').substring(0, 40);

  attachmentList.forEach((img, index) => {
    // DEFAULT NAMING (Requested rollback)
    let suffix = "";
    if (attachmentList.length > 1) suffix = "_" + (index + 1);

    const safeName = "attachment";

    const filename = `${safePrompt}_${timestamp}_${safeName}${suffix}.png`;

    currentTurn.pendingAttachments.push({
      filename: filename,
      url: img.src,
      alt: "attachment"
    });
  });

  // 2. Find Response
  const responseNode = findResponseAfter(currentTurn.promptNode);

  if (!responseNode) {
    if (now - currentTurn.startTime > MAX_WAIT_TIME) {
      console.log("Artifact Sync: Timed out. Could not find response node.");
      resetTurn();
      return;
    }
    currentTurn.status = 'RECORDING';
    currentTurn.lastUpdate = now;
    if (currentTurn.timer) clearTimeout(currentTurn.timer);
    currentTurn.timer = setTimeout(checkTurnCompletion, 2000);
    return;
  }


  // 3. TEXT EXTRACTION
  const responseText = domToMarkdown(responseNode).trim();

  // 4. ARTIFACT SCAN (Response Node)
  const responseImages = responseNode.querySelectorAll('img');
  const artifactList = [];

  for (const img of responseImages) {
    if (img.width < 100 || img.height < 100) continue;
    artifactList.push(img);
  }

  artifactList.forEach((img, index) => {
    let suffix = "";
    if (artifactList.length > 1) suffix = "_" + (index + 1);

    const filename = `${safePrompt}_${timestamp}${suffix}.png`;

    currentTurn.pendingImages.push({
      filename: filename,
      url: img.src,
      alt: img.alt || "artifact"
    });
  });

  // Emptiness check
  if (responseText.length < 2 && currentTurn.pendingImages.length === 0) {
    currentTurn.status = 'RECORDING';
    currentTurn.lastUpdate = now;
    currentTurn.timer = setTimeout(checkTurnCompletion, 2000);
    return;
  }

  // Deduplication
  if (promptText === lastProcessedPrompt) {
    resetTurn();
    return;
  }

  const title = getConversationTitle();
  const payload = {
    title: title,
    prompt: promptText,
    response: responseText,
    timestamp: timestamp,
    safePrompt: safePrompt,
    source: 'Gemini',
    images: currentTurn.pendingImages,
    attachments: currentTurn.pendingAttachments
  };

  chrome.runtime.sendMessage({ action: 'SAVE_TURN', data: payload }, (resp) => {
    // Best effort
  });
  lastProcessedPrompt = promptText;
  lastSavedResponse = responseText;

  resetTurn();
}

function resetTurn() {
  if (currentTurn.timer) clearTimeout(currentTurn.timer);
  currentTurn.status = 'IDLE';
  currentTurn.promptNode = null;
  currentTurn.pendingImages = [];
  currentTurn.pendingAttachments = [];
}

// 2. Find Response
const responseNode = findResponseAfter(currentTurn.promptNode);

if (!responseNode) {
  if (now - currentTurn.startTime > MAX_WAIT_TIME) {
    console.log("Artifact Sync: Timed out. Could not find response node.");
    resetTurn();
    return;
  }
  // console.log("Artifact Sync: Waiting for response..."); 
  // Reduce noise, only log every 5s or state change
  currentTurn.status = 'RECORDING';
  currentTurn.lastUpdate = now;
  if (currentTurn.timer) clearTimeout(currentTurn.timer);
  currentTurn.timer = setTimeout(checkTurnCompletion, 2000);
  return;
}

console.log("Artifact Sync: Response Node Found.");

// 3. TEXT EXTRACTION
const responseText = domToMarkdown(responseNode).trim();

// ... (rest of function unchanged until resetTurn) ...
// To avoid tedious scrolling, I will just patch the handleMutation and findResponse logic mainly.

// ... (skipping to handleMutation replacement) ...

function handleMutation(mutations) {
  const now = Date.now();
  let interactionDetected = false;

  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // BROADENED SELECTOR STRATEGY
        let userMatch = null;

        // 1. Classic Class
        if (node.matches && node.matches('.user-query-bubble-with-background')) userMatch = node;
        else if (node.querySelector) userMatch = node.querySelector('.user-query-bubble-with-background');

        // 2. Semantic Attribute (Backup)
        if (!userMatch) {
          if (node.matches && node.matches('[data-message-author-role="user"]')) userMatch = node;
          else if (node.querySelector) userMatch = node.querySelector('[data-message-author-role="user"]');
        }

        if (userMatch) {
          console.log("Artifact Sync: User Message Detected via Mutation!", userMatch);
          if (currentTurn.status === 'SAVING') continue;
          if (currentTurn.timer) clearTimeout(currentTurn.timer);
          currentTurn.status = 'RECORDING';
          currentTurn.promptNode = userMatch;
          currentTurn.startTime = now;
          currentTurn.lastUpdate = now;
          interactionDetected = true;
        }
      }
    }
    if (currentTurn.status === 'RECORDING') interactionDetected = true;
  }

  if (interactionDetected && currentTurn.status !== 'SAVING') {
    currentTurn.lastUpdate = now;
    if (currentTurn.timer) clearTimeout(currentTurn.timer);
    currentTurn.timer = setTimeout(checkTurnCompletion, DEBOUNCE_TIME);
  }
}

const observer = new MutationObserver(handleMutation);
observer.observe(document.body, { childList: true, subtree: true, characterData: true });
