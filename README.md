Reask

A Chrome extension that adds a highlight-and-ask workflow to Claude and ChatGPT. Select excerpts from any AI response, collect them, add personal notes, and send a single focused follow-up question that references all of them at once.
<img width="1163" height="1217" alt="image" src="https://github.com/user-attachments/assets/9aec331b-ee97-4f7a-8aed-7f09eb9e0cb3" />


What it does

When reading an AI response, you often want to ask about multiple specific parts at once — but copying and pasting excerpts into a new message is tedious. Reask lets you select text directly in the conversation, collect as many excerpts as you want, and send them all in one structured follow-up.


Features


Highlight any text in a Claude or ChatGPT response — a chip appears in the strip for each excerpt
Add a note to any highlight by clicking on it — a small comment box appears right below the highlighted text, autosaves as you type, and closes on Enter or Escape
Drag chips to reorder excerpts before sending
Response length control — choose Short, Normal, or Detailed to guide how long the AI's answer should be
Auto mode — highlights are captured instantly on mouse release. Toggle to Manual mode for a click-to-confirm workflow
Works on both claude.ai and chatgpt.com



How to use


Have a conversation on claude.ai or chatgpt.com
Select any text in a response — it highlights yellow and a chip appears in the strip
Click a highlighted excerpt to add a personal note about what confused you
Collect as many excerpts as you want across the conversation
Type your question in the strip input (or leave it blank for a default clarification prompt)
Choose a response length and hit Send — all excerpts and notes are bundled into one structured message



Installation


Download and unzip this repository
Open Chrome and go to chrome://extensions
Enable Developer mode (toggle in the top right)
Click Load unpacked
Select the Reask folder



Files

Reask/
├── manifest.json   — Extension config (Manifest V3)
├── content.js      — All logic: highlighting, strip, chips, comments, injection
├── styles.css      — All UI styles
├── popup.html      — How-to shown when clicking the extension icon
├── icon16.png
├── icon48.png
└── icon128.png


Notes


No data leaves your browser — everything runs locally as a content script
The extension only activates on claude.ai, chatgpt.com, and chat.openai.com
If Claude or ChatGPT change their input or send button structure, the injection may need a selector update
