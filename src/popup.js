// popup.js (Module)
import { DirectoryHandleManager } from './modules/DirectoryHandleManager.js';

const handleManager = new DirectoryHandleManager();

document.addEventListener('DOMContentLoaded', () => {
    const providerSelect = document.getElementById('storageProvider');
    const localSubOptions = document.getElementById('localSubOptions');
    const localStrategySelect = document.getElementById('localStrategy');
    const strategyNote = document.getElementById('strategyNote');

    const rootFolderInput = document.getElementById('rootFolderName');
    const customFolderUI = document.getElementById('customFolderUI');
    const saveAsUI = document.getElementById('saveAsUI');

    const selectFolderBtn = document.getElementById('selectFolderBtn');
    const folderStatus = document.getElementById('folderStatus');
    const formatSelect = document.getElementById('outputFormat');
    const providerNote = document.getElementById('providerNote');
    const showSaveAs = document.getElementById('showSaveAs');

    const checkboxes = {
        savePrompts: document.getElementById('savePrompts'),
        saveAttachments: document.getElementById('saveAttachments'),
        saveResponses: document.getElementById('saveResponses'),
        saveArtifacts: document.getElementById('saveArtifacts')
    };

    // Load Settings
    chrome.storage.sync.get({
        savePrompts: true,
        saveAttachments: true,
        saveResponses: true,
        saveArtifacts: true,
        storageProvider: 'drive',
        localStrategy: 'downloads', // 'downloads' or 'custom'
        outputFormat: 'markdown',
        rootFolderName: 'Artifact Sync',
        showSaveAs: false
    }, async (items) => {
        checkboxes.savePrompts.checked = items.savePrompts;
        checkboxes.saveAttachments.checked = items.saveAttachments;
        checkboxes.saveResponses.checked = items.saveResponses;
        checkboxes.saveArtifacts.checked = items.saveArtifacts;

        providerSelect.value = items.storageProvider;
        localStrategySelect.value = items.localStrategy;
        formatSelect.value = items.outputFormat;
        rootFolderInput.value = items.rootFolderName;
        showSaveAs.checked = items.showSaveAs;

        await checkLocalHandle();
        updateUiState();
    });

    async function checkLocalHandle() {
        try {
            const handle = await handleManager.getHandle();
            if (handle) {
                folderStatus.textContent = `Selected: ${handle.name}`;
                folderStatus.style.borderColor = '#10b981'; // green
            } else {
                folderStatus.textContent = "No folder selected.";
                folderStatus.style.borderColor = '#ef4444'; // red
            }
        } catch (e) {
            console.error(e);
        }
    }

    function saveOptions() {
        const settings = {
            savePrompts: checkboxes.savePrompts.checked,
            saveAttachments: checkboxes.saveAttachments.checked,
            saveResponses: checkboxes.saveResponses.checked,
            saveArtifacts: checkboxes.saveArtifacts.checked,
            storageProvider: providerSelect.value,
            localStrategy: localStrategySelect.value,
            outputFormat: formatSelect.value,
            rootFolderName: rootFolderInput.value.trim() || 'Artifact Sync',
            showSaveAs: showSaveAs.checked
        };

        chrome.storage.sync.set(settings, () => {
            showStatus('Settings Saved!', 'success');
        });

        updateUiState();
    }

    function showStatus(msg, type) {
        const status = document.getElementById('status');
        status.textContent = msg;
        status.className = 'status ' + type;
        status.style.display = 'block';
        setTimeout(() => { status.style.display = 'none'; }, 2000);
    }

    function updateUiState() {
        const isLocal = providerSelect.value === 'local';
        const strategy = localStrategySelect.value;
        const rootName = rootFolderInput.value.trim() || 'Artifact Sync';

        if (isLocal) {
            localSubOptions.style.display = 'block';

            if (strategy === 'downloads') {
                customFolderUI.style.display = 'none';
                saveAsUI.style.display = 'block'; // Allow 'Save As' for downloads too
                strategyNote.textContent = 'Files saved to Downloads Folder. Note: Deduplication relies on Download History.';
                providerNote.textContent = `Files saved to "Downloads / ${rootName}"`;
            } else {
                // Custom
                customFolderUI.style.display = 'block';
                saveAsUI.style.display = 'none'; // Custom folder implies direct write usually
                strategyNote.textContent = 'Files saved to exact folder selected below.';
                providerNote.textContent = `Files saved to "Selected Folder / ${rootName}"`;
            }
        } else {
            localSubOptions.style.display = 'none';
            customFolderUI.style.display = 'none';
            saveAsUI.style.display = 'none';
            providerNote.textContent = `Files saved to "My Drive / ${rootName}"`;
        }
    }

    // FOLDER PICKER LOGIC
    selectFolderBtn.addEventListener('click', async () => {
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            if (handle) {
                await handleManager.setHandle(handle);
                folderStatus.textContent = `Selected: ${handle.name}`;
                folderStatus.style.borderColor = '#10b981';
                showStatus('Folder Authorized!', 'success');
            }
        } catch (e) {
            console.error(e);
            if (e.name !== 'AbortError') {
                showStatus('Error selecting folder.', 'error');
            }
        }
    });

    // TEST ACCESS LOGIC
    document.getElementById('testAccessBtn').addEventListener('click', async () => {
        try {
            const handle = await handleManager.getHandle();
            if (!handle) {
                showStatus('No folder selected!', 'error');
                return;
            }
            // Try write
            const testFile = await handle.getFileHandle("extension_test.txt", { create: true });
            const writable = await testFile.createWritable();
            await writable.write("Artifact Sync Check: " + new Date().toISOString());
            await writable.close();
            showStatus('Write Successful!', 'success');
        } catch (e) {
            console.error(e);
            showStatus('Write Failed: ' + e.message, 'error');
        }
    });

    // Listeners
    Object.values(checkboxes).forEach(cb => cb.addEventListener('change', saveOptions));
    providerSelect.addEventListener('change', saveOptions);
    localStrategySelect.addEventListener('change', saveOptions);
    formatSelect.addEventListener('change', saveOptions);
    showSaveAs.addEventListener('change', saveOptions);

    let timeout;
    rootFolderInput.addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(saveOptions, 500);
    });
});
