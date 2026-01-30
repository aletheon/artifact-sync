// content_gemini.js
console.log("Artifact Sync: Gemini Scraper Loaded (v2.1 - Cache System)");

let lastProcessedPrompt = "";
let lastSavedResponse = "";
const filenameCache = new Map(); // Store blob:URL -> "filename.ext"

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
  // Fallback to document title if specific element missing, cleaning generic suffix if needed
  if (titleEl) return titleEl.innerText.trim();
  return document.title.replace("Gemini", "").trim() || "Conversation";
}

function domToMarkdown(node) {
  // Simple markdown converter
  let md = node.innerText;
  return md;
}

function findResponseAfter(userNode) {
  // Gemini structure: user block is followed by a model block
  // They are often siblings in a container
  let next = userNode.nextElementSibling;
  while (next) {
    if (next.getAttribute('data-message-author-role') === 'model' || next.classList.contains('model-query-bubble')) {
      return next;
    }
    next = next.nextElementSibling;
  }
  return null;
}

// CACHE HARVESTER
// Scans the DOM for any image that has a filename-looking string nearby
function scanForFilenames() {
  // 1. Find all images in the document (focusing on input area if possible, but global is safer)
  const imgs = document.querySelectorAll('img');
  const filenameRegex = /[a-zA-Z0-9_\-\(\)\s]+\.(png|jpg|jpeg|webp|gif|bmp|txt|csv|pdf|md|json|js|html|css)/i;

  imgs.forEach(img => {
    // Skip if already cached
    if (filenameCache.has(img.src)) return;
    if (img.width < 50) return; // Skip icons

    // Look at parents for text
    let p = img.parentElement;
    for (let i = 0; i < 4 && p; i++) {
      // Check attributes
      const attrs = [p.getAttribute('aria-label'), p.getAttribute('title'), p.dataset.tooltip];
      for (const a of attrs) {
        if (a && filenameRegex.test(a)) {
          // Extract just the filename part if possible, or take the whole string
          const match = a.match(filenameRegex);
          if (match) {
            filenameCache.set(img.src, match[0]);
            // console.log(`Artifact Sync: Cached [Attr] ${match[0]} for ${img.src}`);
            return;
          }
        }
      }

      // Check text content (e.g. "7.png" text node next to image)
      const text = p.innerText;
      if (text && filenameRegex.test(text)) {
        const match = text.match(filenameRegex);
        if (match) {
          filenameCache.set(img.src, match[0]);
          // console.log(`Artifact Sync: Cached [Text] ${match[0]} for ${img.src}`);
          return;
        }
      }
      p = p.parentElement;
    }
  });
}

function checkTurnCompletion() {
  const now = Date.now();
  if (currentTurn.status !== 'RECORDING') return;

  // 1. Re-validate Input (Prompt)
  // Ensure the user message is "settled" (no typing indicator, processed)
  const promptText = currentTurn.promptNode.innerText.trim();

  // 1.5 Scan for Attachments
  // Look for images INSIDE the user prompt bubble
  // Also look for images immediately preceding the user prompt (Gemini often stacks them)
  const candidates = [];
  const inBubble = currentTurn.promptNode.querySelectorAll('img');
  inBubble.forEach(img => candidates.push(img));

  // C. Previous Sibling (Often the image block is just defined before the text block)
  let prev = currentTurn.promptNode.previousElementSibling;
  if (prev) {
    const siblingImgs = prev.querySelectorAll('img');
    siblingImgs.forEach(img => candidates.push(img));
  }

  const attachmentList = [];
  // Filter candidates
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

  console.log(`Artifact Sync: Details | Attachments: ${attachmentList.length}`);

  attachmentList.forEach((img, index) => {
    // RESOLVE FILENAME: Cache > Regex > Fallback
    let bestName = filenameCache.get(img.src);

    if (!bestName) {
      // Try one last check of the history bubble itself (rarely works for Gemini, but good to have)
      bestName = img.alt || "attachment";
    }

    let rawName = bestName || "attachment";

    // Sanitize
    let safeName = rawName.replace(/[^a-z0-9\.\-_]/gi, '_');

    if (safeName.length < 3) safeName = "attachment";

    let suffix = (attachmentList.length > 1) ? "_" + (index + 1) : "";
    const filename = `${safePrompt}_${timestamp}_${safeName}${suffix}.png`;

    currentTurn.pendingAttachments.push({
      filename: filename,
      url: img.src,
      alt: rawName
    });
  });

  // 2. Find Response
  const responseNode = findResponseAfter(currentTurn.promptNode);

  if (!responseNode) {
    if (now - currentTurn.startTime > MAX_WAIT_TIME) {
      console.log("Artifact Sync: Timed out.");
      resetTurn();
      return;
    }
    console.log("Artifact Sync: Waiting for response...");
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
    console.log("Artifact Sync: Duplicate prompt. Skip.");
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

  try {
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      throw new Error("Extension context invalidated");
    }
    chrome.runtime.sendMessage({ action: 'SAVE_TURN', data: payload }, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (err.message && err.message.includes("context invalidated")) {
          console.log("Artifact Sync: Context invalidated. Silent fail.");
        } else {
          console.error("Artifact Sync BG Error:", err);
        }
      } else {
        console.log("Artifact Sync: MESSAGE SENT.");
      }
    });
    lastProcessedPrompt = promptText;
    lastSavedResponse = responseText;
  } catch (e) {
    console.log("Artifact Sync: Message Failed (Context Invalidated or other).");
  }

  resetTurn();
}

function resetTurn() {
  if (currentTurn.timer) clearTimeout(currentTurn.timer);
  currentTurn.status = 'IDLE';
  currentTurn.promptNode = null;
  currentTurn.pendingImages = [];
  currentTurn.pendingAttachments = [];
}

function handleMutation(mutations) {
  const now = Date.now();
  let interactionDetected = false;

  // RUN CACHE HARVESTER ON DOM CHANGE
  // This ensures we catch the filename while it is still in the Input Preview!
  scanForFilenames();

  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        let userMatch = null;
        if (node.matches && node.matches('.user-query-bubble-with-background')) userMatch = node;
        else if (node.querySelector) userMatch = node.querySelector('.user-query-bubble-with-background');

        if (userMatch) {
          const simpleText = userMatch.innerText.trim();
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
