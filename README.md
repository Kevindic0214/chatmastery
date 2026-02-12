# ChatMastery — Your AI Learning Companion

> **Track depth. Build mastery. Learn, not just ask.**

ChatMastery is a Chrome/Edge browser extension that transforms your ChatGPT conversations into a structured learning experience. It overlays a sleek, glassmorphism-styled panel on ChatGPT pages — giving you a real-time Table of Contents, depth scoring for every question, and mastery goal tracking to keep you accountable.

> ⚠️ This is a **browser extension** (content script), not an OpenAI plugin. It enhances the ChatGPT page UI locally in your browser.

---

## ✨ Features

### 📋 Smart Table of Contents
- Auto-generates a clickable TOC from your conversation turns
- Click any item to **smooth-scroll** to that message
- Supports text, 📷 image, and 📎 file prompts
- Shows assistant response previews inline
- **Keyword search** to filter TOC items instantly

### 🎯 Mastery Goal Tracker
- Tracks the number of unique questions **per chat session**
- Visual progress bar toward a customizable mastery goal (default: 100)
- Per-chat storage — each conversation has its own stats

### 🧠 Depth Scoring
Every question is analyzed and scored on depth:
| Level | Score | Indicator |
|---|---|---|
| 🟢 **Deep Dive** | 80–100 | Teal glow dot |
| 🟡 **Learning** | 40–79 | Amber dot |
| ⚪ **Surface** | 0–39 | Gray dot |

Depth is calculated from question length, structure (code blocks, lists), curiosity signals (questions, "how", "why"), and persistence indicators ("still", "error", "detail").

### 🪟 Modern Glass UI
- **Glassmorphism** design with blur + transparency
- Draggable panel and launcher — position persists across sessions
- **Minimize** into a floating action button (FAB); click to restore
- Smooth **fade + scale** animations
- Auto-updates via `MutationObserver` — even during streaming

### 🔒 Privacy-First
- Runs **100% locally** in your browser
- **Zero** data sent externally — no analytics, no tracking
- Only accesses `chatgpt.com` and `chat.openai.com` pages

---

## 📸 Screenshot

<img width="3399" height="1596" alt="ChatMastery Screenshot" src="https://github.com/user-attachments/assets/83c47078-38b8-4ba8-b908-a395402d00b7" />

---

## 🚀 Install (Developer Mode)

1. **Clone** this repository:
   ```bash
   git clone https://github.com/Kevindic0214/chatmastery.git
   ```
2. Open your browser's extension page:
   - Chrome → `chrome://extensions`
   - Edge → `edge://extensions`
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. Navigate to [chatgpt.com](https://chatgpt.com/) — the ChatMastery panel should appear!

---

## 🎮 How to Use

| Action | How |
|---|---|
| **Open panel** | Click the floating ❓ launcher button |
| **Drag panel** | Hold and drag the header bar |
| **Minimize** | Click the ⏷ minimize button → panel collapses into a FAB |
| **Restore** | Click the FAB → panel reopens |
| **Toggle list** | Click the 👁 hide/show button |
| **Search** | Type in the search box to filter items |
| **Jump to message** | Click any TOC item → smooth scroll |
| **Refresh** | Click the 🔄 refresh button to rebuild the TOC |

---

## 📁 Project Structure

```
chatmastery/
├── manifest.json      # Extension manifest (MV3)
├── content.js         # Core logic — TOC, scoring, tracking, UI
├── styles.css         # Glassmorphism design system
├── PRIVACY.md         # Privacy policy
└── README.md          # You are here
```

---

## ⚙️ Technical Details

- **Manifest Version**: 3 (MV3)
- **Content Script**: Injected at `document_idle` on ChatGPT pages
- **Storage**: `chrome.storage.local` — per-chat stats & global UI state
- **DOM Detection**: Dual strategy — `data-testid` attributes with fallback to `data-message-author-role` selectors
- **Deduplication**: Content-based hashing (`djb2`) to prevent duplicate question counting
- **Streaming**: `MutationObserver` with debounced updates for real-time assistant response previews

---

## ⚠️ Notes & Limitations

- ChatGPT's DOM structure may change with updates — selectors might need adjustments.
- Some file cards may not expose filenames consistently; the extension uses best-effort detection.
- The extension only works on `chatgpt.com` and `chat.openai.com`.

---

## 🗺️ Roadmap

- [ ] Nested TOC — parse assistant headings (`#` / `##` / `###`) as sub-items
- [ ] Bookmark / star important turns
- [ ] Export TOC to Markdown
- [ ] Keyboard shortcut to toggle panel (e.g., `Alt+T`)
- [ ] Custom depth scoring weights
- [ ] Dark / light theme toggle

---

## 📜 License & Disclaimer

This project is not affiliated with or endorsed by OpenAI.  
"ChatGPT" is a trademark of OpenAI.
