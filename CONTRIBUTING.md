# Contributing to Artifact Sync

Thank you for your interest in contributing! We want to make this extension the best tool for archiving AI interactions.

## How to Contribute

1.  **Fork the Repository**: Click the "Fork" button on the top right of this page.
2.  **Clone your Fork**: `git clone https://github.com/YOUR_USERNAME/artifact-sync.git`
3.  **Create a Branch**: `git checkout -b feature/amazing-new-feature`
4.  **Make Changes**: Write your code, fix bugs, or improve documentation.
5.  **Test**: Load the extension as an "Unpacked Extension" in Chrome:
    *   Go to `chrome://extensions/`
    *   Enable "Developer mode" (top right).
    *   Click "Load unpacked" and select the `src` folder of this repository.
6.  **Commit**: `git commit -m "Add amazing new feature"`
7.  **Push**: `git push origin feature/amazing-new-feature`
8.  **Open a Pull Request**: Go to the original repository and open a PR.

## Areas for Improvement

*   **Claude Support**: As noted in the README, Claude support was removed due to image capture synchronization issues. If you can solve the race condition reliably, we'd love to see it!
*   **New Providers**: Support for other AI chat interfaces (e.g., Mistral, Perplexity).
*   **Better PDF/Markdown Formatting**: Improvements to how conversations are rendered.

## Code Style

*   Keep code simple and readable.
*   Use standard JavaScript (ES6+).
*   Respect the existing folder structure (`src/content_scripts`, `src/modules`, etc.).

Thank you for helping build Artifact Sync!
