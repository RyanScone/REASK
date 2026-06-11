# Claude Highlighter — Chrome Extension

Highlight text anywhere in a Claude.ai conversation, collect multiple excerpts, and ask clarifying questions about all of them at once.

---

## Installation (Chrome / Edge / Brave)

1. **Unzip** this folder somewhere permanent on your computer (e.g. `~/Extensions/claude-highlighter`)
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `claude-highlighter` folder
6. The extension icon (✏️) will appear in your toolbar

---

## How to use

1. Go to [claude.ai](https://claude.ai) and have a conversation
2. **Select any text** in a Claude response — a small **Highlight** toolbar appears above your selection
3. Click **Highlight** to save that excerpt to the sidebar
4. Repeat for as many passages as you want across the conversation
5. The sidebar opens automatically on your first highlight (or click the ✏️ button bottom-right)
6. Type your question in the sidebar's text box
7. Click **Ask Claude** — your question + all highlights get injected into the Claude message box, ready to send

---

## Tips

- **Click any highlight** (the yellow text) to remove it from the selection
- **Clear all** removes all highlights at once
- If you just click **Ask Claude** without typing a question, it sends a default "could you clarify?" prompt
- The extension only activates on `claude.ai` — it has no permissions on other sites

---

## Files

```
claude-highlighter/
├── manifest.json     — Extension config
├── content.js        — Main logic (highlight, sidebar, inject into Claude)
├── styles.css        — All UI styles
├── popup.html        — Toolbar button popup
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
