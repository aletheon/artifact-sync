document.addEventListener('DOMContentLoaded', () => {
    const modeSelect = document.getElementById('storageMode');
    const status = document.getElementById('status');

    // Load
    chrome.storage.local.get(['storageMode'], (result) => {
        if (result.storageMode) {
            modeSelect.value = result.storageMode;
        }
    });

    // Save
    document.getElementById('save').addEventListener('click', () => {
        const mode = modeSelect.value;
        chrome.storage.local.set({ storageMode: mode }, () => {
            status.style.display = 'block';
            setTimeout(() => { status.style.display = 'none'; }, 2000);

            // Notify background to reload settings?
            // For now, background loads on startup or we can reload extension
        });
    });
});
