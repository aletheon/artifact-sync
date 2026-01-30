// content.js
console.log("Artifact Sync: Logic v20 (Vicinity Scan) loaded.");

let currentTurn = {
  promptNode: null,
  promptText: "",
  startTime: 0,
  lastUpdate: 0,
  timer: null,
  status: 'IDLE',
  pendingImages: [],
  pendingAttachments: []
};

// Global state
let lastProcessedPrompt = "";
let lastSavedResponse = "";
const DEBOUNCE_TIME = 4000;
const MAX_WAIT_TIME = 180000;

// --- MARKDOWN CONVERTER ---
function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function domToMarkdown(node) {
  if (!node) return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  let md = "";
  node.childNodes.forEach(child => md += domToMarkdown(child));

  const tag = node.tagName.toLowerCase();

  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
    const level = parseInt(tag[1]);
    return `\n${'#'.repeat(level)} ${cleanText(node.textContent)}\n\n`;
  }
  if (tag === 'p') return `\n${md.trim()}\n\n`;

  if (tag === 'pre') {
    const code = node.querySelector('code');
    let lang = "";
    if (code) {
      const classes = Array.from(code.classList || []);
      const langClass = classes.find(c => c.startsWith('language-'));
      if (langClass) lang = langClass.replace('language-', '');
    }
    return `\n\`\`\`${lang}\n${node.innerText.trim()}\n\`\`\`\n\n`;
  }

  if (tag === 'img') {
    if (node.alt) return `[${node.alt}]`;
    return "";
  }

  if (tag === 'ul') {
    let listMd = "\n";
    for (const child of node.children) {
      if (child.tagName.toLowerCase() === 'li') listMd += `- ${child.innerText.trim()}\n`;
    }
    return listMd + "\n";
  }
  if (tag === 'ol') {
    let listMd = "\n";
    let idx = 1;
    for (const child of node.children) {
      if (child.tagName.toLowerCase() === 'li') listMd += `${idx++}. ${child.innerText.trim()}\n`;
    }
    return listMd + "\n";
  }

  if (tag === 'strong' || tag === 'b') return `**${md}**`;
  if (tag === 'em' || tag === 'i') return `*${md}*`;

  return md;
}

function getConversationTitle() {
  const titleEl = document.querySelector('h1[data-test-id="conversation-title"]') ||
    document.querySelector('.conversation-title');
  if (titleEl) return titleEl.innerText;
  return document.title.replace(/ - (Gemini|Antigravity)$/g, '').trim();
}

function checkTurnCompletion() {
  const now = Date.now();
  if (currentTurn.status === 'RECORDING' && (now - currentTurn.lastUpdate >= DEBOUNCE_TIME)) {
    finishTurn();
  }
}

function findResponseAfter(promptNode) {
  const candidates = Array.from(document.querySelectorAll('.model-response-text, .message-content, [data-message-author-role="model"], .model-response'));
  for (const node of candidates) {
    if (promptNode.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
      return node;
    }
  }
  return null;
}

function isLastPrompt(node) {
  const allPrompts = document.querySelectorAll('.user-query-bubble-with-background');
  if (allPrompts.length === 0) return false;
  return allPrompts[allPrompts.length - 1] === node;
}

function finishTurn() {
  if (currentTurn.status === 'SAVING') return;
  const now = Date.now();
  currentTurn.status = 'SAVING';

  if (!isLastPrompt(currentTurn.promptNode)) {
    console.log("Artifact Sync: Abort - Not latest prompt.");
    resetTurn();
    return;
  }

  // 1. Verify Prompt & Timestamp
  currentTurn.pendingImages = [];
  currentTurn.pendingAttachments = [];

  const promptText = domToMarkdown(currentTurn.promptNode).trim();

  if (!promptText || promptText.length === 0) {
    resetTurn();
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safePrompt = promptText.replace(/[^a-z0-9]/gi, '_').substring(0, 40);

  // --- VICINITY SCAN FOR ATTACHMENTS ---
  // The uploaded images might be:
  // 1. Inside the prompt bubble (Unlikely but possible)
  // 2. In the Parent container (Likely wrapper)
  // 3. In the Previous Sibling (User Block usually stacks items)

  const candidates = new Set();

  // Scans
  const scanArray = (list) => {
    list.forEach(img => candidates.add(img));
  };

  // A. Internal
  scanArray(currentTurn.promptNode.querySelectorAll('img'));

  // B. Parent (Go up 2 levels max)
  let parent = currentTurn.promptNode.parentElement;
  if (parent) {
    scanArray(parent.querySelectorAll('img'));
    if (parent.parentElement) {
      scanArray(parent.parentElement.querySelectorAll('img'));
    }
  }

  // C. Previous Sibling (Often the image block is just defined before the text block)
  let prev = currentTurn.promptNode.previousElementSibling;
  if (prev) {
    scanArray(prev.querySelectorAll('img'));
  }

  const attachmentList = [];
  // Filter candidates
  // We exclude avatars (usually small, circular, or specific class)
  // But uploaded images can be thumbnails too. 
  // Let's rely on size > 50px OR specific exclusion if needed.
  // We also must ensure we aren't picking up the Gemini Logo or User Avatar.
  // User Avatar often has class 'avatar' or is tiny.

  candidates.forEach(img => {
    // Skip if tiny
    if (img.width < 50 || img.height < 50) return;

    // Skip if it looks like a profile picture (heuristic)
    if (img.src.includes("googleusercontent.com") && img.src.includes("s64")) return; // s64 is often avatar size param
    if (img.className.includes("avatar")) return;

    // Avoid duplicates
    if (attachmentList.includes(img)) return;

    attachmentList.push(img);
  });

  console.log(`Artifact Sync: Found ${attachmentList.length} potential attachments via Vicinity Scan.`);

  attachmentList.forEach((img, index) => {
    // STRATEGY (v3): Deep Search for Filename
    // The user sees "7.png" on hover. This implies a tooltip.
    // We check: title, aria-label, data-tooltip, dataset.tooltip
    // We check: img, and up to 5 parents.

    let bestName = null;
    const candidates = [];

    const addCandidate = (val) => {
      if (val && typeof val === 'string' && val.trim().length > 0) candidates.push(val);
    };

    // 1. Check Image Attributes
    addCandidate(img.getAttribute('title'));
    addCandidate(img.getAttribute('aria-label'));
    addCandidate(img.getAttribute('data-tooltip'));
    addCandidate(img.alt);

    // 2. Check Parents (up to 5 levels)
    // Sometimes the tooltip is on a wrapper far up.
    let p = img.parentElement;
    for (let i = 0; i < 5 && p; i++) {
      addCandidate(p.getAttribute('title'));
      addCandidate(p.getAttribute('aria-label'));
      addCandidate(p.getAttribute('data-tooltip'));

      // Also look for specific classes that might hold the filename?
      // e.g. .file-name
      const nameEl = p.querySelector('.file-name, .name, [class*="filename"]');
      if (nameEl) addCandidate(nameEl.innerText);

      p = p.parentElement;
    }

    console.log("Artifact Sync: Attachment Candidates for", img.src.substring(0, 30) + "...", candidates);

    const badNames = ["uploaded image preview", "image", "attachment", "preview", "thumbnail"];

    // 3. Filter & Pick
    // Priority: Has Extension > Not Bad > Fallback
    for (const c of candidates) {
      const s = c.trim();
      // Skip bad names immediately
      if (badNames.some(b => s.toLowerCase().includes(b))) continue;

      // Check for extension (strong signal)
      if (/\.[a-zA-Z0-9]{3,4}$/.test(s)) {
        bestName = s;
        break; // Found it!
      }
    }

    // 4. Fallback: If no extension found, take the first reasonable string
    if (!bestName) {
      for (const c of candidates) {
        const s = c.trim();
        if (badNames.some(b => s.toLowerCase().includes(b))) continue;
        bestName = s;
        break;
      }
    }

    let rawName = bestName || "attachment";

    // Sanitize
    let safeName = rawName.replace(/[^a-z0-9\.\-_]/gi, '_');

    // Ensure we don't end up with just an extension or empty
    if (safeName.length < 3) safeName = "attachment";

    let suffix = "";
    if (attachmentList.length > 1) suffix = "_" + (index + 1);

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

  console.log(`Artifact Sync: Payload | Attachments: ${currentTurn.pendingAttachments.length} | Artifacts: ${currentTurn.pendingImages.length}`);

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
