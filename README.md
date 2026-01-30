# Artifact Sync (v2.0)

A powerful Chrome Extension to automatically archive your AI coding sessions from **Google Gemini** and **ChatGPT**.

## 🚀 Features

*   **Multi-Provider**: Works seamlessly with Gemini and ChatGPT.
*   **Dual Storage**: 
    *   **Local**: Saves files to your computer's Downloads folder (organized by provider/chat).
    *   **Google Drive**: Uploads directly to your Drive (requires setup).
*   **Robust Capture**: Uses event-based detection to ensure no messages are missed.
*   **Artifacts**: Automatically scrapes and saves generated images/diagrams.

## 📦 Installation

1.  Clone this repository.
2.  Open Chrome and go to `chrome://extensions`.
3.  Enable **Developer Mode** (top right).
4.  Click **Load unpacked** and select the folder of this repository.

## ⚙️ Configuration

1.  Click the extension icon in the toolbar.
2.  Select **Options**.
3.  Choose your storage preference:
    *   **Local (Default)**: Files save to `Downloads/Artifact Sync/...`.
    *   **Google Drive**: Requires a generic Client ID (see `manifest.json`).

## 📂 File Structure

The extension organizes data as follows:

```
Artifact Sync/
  ├── Gemini/
  │     └── My Conversation Title/
  │           ├── artifacts/        <-- AI Generated Images
  │           ├── attachments/      <-- Your Uploads
  │           └── Prompt_Text_2024-05-20.md
  └── ChatGPT/
        └── ...
```

## 🛠️ Troubleshooting

*   **No output?** Check the Developer Console (F12) for "Artifact Sync" logs.
*   **Gemini Loops?** The new v2.0 observer is designed to ignore history re-renders. If it persists, refresh the page.
