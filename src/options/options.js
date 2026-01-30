document.addEventListener('DOMContentLoaded', () => {
    const modeSelect = document.getElementById('storageMode');
    const rootInput = document.getElementById('rootFolderName');
    const pdfCheckbox = document.getElementById('pdfEnabled');
    const status = document.getElementById('status');

    // Load
    chrome.storage.local.get(['storageMode', 'rootFolderName', 'pdfEnabled'], (result) => {
        if (result.storageMode) modeSelect.value = result.storageMode;
        if (result.rootFolderName) rootInput.value = result.rootFolderName;
        if (result.pdfEnabled !== undefined) pdfCheckbox.checked = result.pdfEnabled;
    });

    // Save
    document.getElementById('save').addEventListener('click', () => {
        const settings = {
            storageMode: modeSelect.value,
            rootFolderName: rootInput.value.trim() || "Artifact Sync",
            pdfEnabled: pdfCheckbox.checked
        };

        chrome.storage.local.set(settings, () => {
            status.style.display = 'block';
            setTimeout(() => { status.style.display = 'none'; }, 2000);

            // Notify background to reload settings
            chrome.runtime.sendMessage({ action: 'RELOAD_SETTINGS' });
        });
    });
});
