(() => {
  // =========================
  // Config / IDs ('cm' = ChatMastery)
  // =========================
  const PANEL_ID = "cm-panel";
  const LAUNCHER_ID = "cm-launcher";
  const WIDGET_ID = "cm-widget";
  const LIST_ID = "cm-list";
  const DATA_ID = "data-cm-id";
  const EXTRA_STYLE_ID = "cm-extra-style";
  const STATE_KEY = "cm_state_v2";
  const STATS_KEY = "cm_stats_v1";

  // Performance knobs
  const SHOW_ASSISTANT_PREVIEW = true;
  const MAX_ITEMS = 300;
  const ASSISTANT_IDLE_MS = 600;

  // Icons (Simple Paths)
  const ICONS = {
    refresh: '<path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>',
    min: '<path d="M6 19h12v2H6z"/>',
    hide: '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>', // eye
    logo: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>' // question mark circle
  };

  // File detection helpers (Same as before)
  const FILE_SIZE_RE = /\b\d+(\.\d+)?\s*(KB|MB|GB)\b/i;
  const DOWNLOAD_RE = /(download|下载)/i;
  const FILE_HINT_RE = /(file|attachment|附件|文件)/i;
  const FILE_LINK_RE = /\/files\/|file-|blob:|oaiusercontent|backend-api\/files/i;
  const FILE_EXT_RE = /\b[\w][\w\- .]{0,80}\.(pdf|docx?|pptx?|xlsx?|csv|txt|zip|rar|7z|png|jpe?g|gif|webp|mp4|mov|webm|py|js|html|css|json)\b/gi;

  let lastBuiltUserCount = -1;
  let lastRenderedItems = 0;
  let lastRenderedTurnTargetId = null;

  // Assistant observer
  let assistantObserver = null;
  let assistantIdleTimer = null;
  let lastObservedAssistantEl = null;

  // Global State
  let g_stats = null;
  let g_uiState = null;
  let g_seenIds = new Set();
  let g_storageLoaded = false;
  let g_currentChatId = "global";

  // Helpers
  function getChatId() {
    const m = window.location.pathname.match(/\/c\/([a-zA-Z0-9\-]+)/);
    return m ? m[1] : `temp-${Date.now()}`;
  }

  function getStorageKeys(chatId) {
    return {
      stats: `cm_chat_${chatId}_stats`,
      seen: `cm_chat_${chatId}_seen`
    };
  }

  async function initStorage(chatId) {
    g_storageLoaded = false;
    g_currentChatId = chatId || getChatId();
    const keys = getStorageKeys(g_currentChatId);

    try {
      const data = await chrome.storage.local.get([keys.stats, STATE_KEY, keys.seen]);
      g_stats = data[keys.stats] || { totalQuestions: 0, goal: 100, depthHistory: [] };
      g_uiState = data[STATE_KEY] || {}; // UI State remains global
      g_seenIds = new Set(data[keys.seen] || []);
      g_storageLoaded = true;

      // Listen for changes from other tabs/windows
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;

        const runtimeKeys = getStorageKeys(g_currentChatId);

        if (changes[runtimeKeys.stats]) {
          g_stats = changes[runtimeKeys.stats].newValue || { totalQuestions: 0, goal: 100, depthHistory: [] };
          updateWidget();
        }
        if (changes[STATE_KEY]) {
          g_uiState = changes[STATE_KEY].newValue || {};
        }
        if (changes[runtimeKeys.seen]) {
          const newSeen = changes[runtimeKeys.seen].newValue || [];
          g_seenIds = new Set(newSeen);
        }
      });

    } catch (e) {
      console.error("ChatMastery: Storage init failed", e);
      // Fallback defaults
      g_stats = { totalQuestions: 0, goal: 100, depthHistory: [] };
      g_uiState = {};
      g_storageLoaded = true;
    }
  }

  // =========================
  // Utils
  // =========================
  function djb2Hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
    return (h >>> 0).toString(36);
  }

  function summarize(text, maxLen = 48) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (!t) return "(empty)";
    return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
  }

  function uniq(arr) { return Array.from(new Set(arr.filter(Boolean))); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function getIcon(name) {
    return `<svg viewBox="0 0 24 24">${ICONS[name] || ""}</svg>`;
  }

  // =========================
  // Storage (Stats & Goals)
  // =========================
  const StorageManager = {
    get() {
      return g_stats || { totalQuestions: 0, goal: 100, depthHistory: [] };
    },
    save(stats) {
      g_stats = stats;
      const keys = getStorageKeys(g_currentChatId);
      chrome.storage.local.set({ [keys.stats]: stats });
    },
    async incrementQuestions(qualityScore) {
      const keys = getStorageKeys(g_currentChatId);
      // Fetch fresh to minimize race condition
      try {
        const data = await chrome.storage.local.get(keys.stats);
        const s = data[keys.stats] || { totalQuestions: 0, goal: 100, depthHistory: [] };

        s.totalQuestions++;
        s.depthHistory.push(qualityScore || 0);
        if (s.depthHistory.length > 500) s.depthHistory.shift();

        this.save(s);
        return s;
      } catch (e) {
        // Fallback to memory if fetch fails
        const s = this.get();
        s.totalQuestions++;
        this.save(s);
        return s;
      }
    },
    getGoalProgress() {
      const s = this.get();
      return { current: s.totalQuestions, goal: s.goal };
    }
  };

  const UIStorage = {
    load() {
      return g_uiState || {};
    },
    save(patch) {
      g_uiState = { ...g_uiState, ...patch };
      chrome.storage.local.set({ [STATE_KEY]: g_uiState });
    }
  };

  // =========================
  // Depth Scorer (Renamed from QualityScorer)
  // =========================
  const DepthScorer = {
    calculate(text) {
      if (!text) return 0;
      const cleanText = text.trim();
      let score = 0;
      const len = cleanText.length;

      // 1. Depth via Length
      if (len > 15) score += 10;
      if (len > 80) score += 15;
      if (len > 200) score += 10;

      // 2. Structure (Code, Lists)
      if (/```/.test(cleanText)) score += 20;
      if (/^[-*]\s/m.test(cleanText)) score += 10;

      // 3. Curiosity (Questions)
      if (/\?/.test(cleanText)) score += 10;
      if (/(how|why|what if|explain|compare|diff)/i.test(cleanText)) score += 10;

      // 4. Persistence (Follow-up words)
      if (/(but|however|still|error|detail)/i.test(cleanText)) score += 5;

      return Math.min(100, score);
    },
    getLevel(score) {
      if (score >= 80) return { label: "Deep Dive", class: "high" };
      if (score >= 40) return { label: "Learning", class: "med" };
      return { label: "Surface", class: "low" };
    }
  };

  // =========================
  // UI Building
  // =========================
  function ensureLauncher() {
    let launcher = document.getElementById(LAUNCHER_ID);
    if (launcher) return launcher;

    launcher = document.createElement("div");
    launcher.id = LAUNCHER_ID;
    launcher.innerHTML = getIcon("logo"); // or just "M" text
    launcher.title = "Open ChatMastery";

    launcher.addEventListener("click", () => {
      if (launcher.__movedRecently) return;
      setMinimized(false);
    });

    document.documentElement.appendChild(launcher);
    makeDraggable(launcher, launcher, {
      onDragEnd: (el) => saveSharedPosFrom(el)
    });
    return launcher;
  }

  function setMinimized(minimized, opts = {}) {
    const panel = document.getElementById(PANEL_ID);
    const launcher = ensureLauncher();
    if (!panel || !launcher) return;

    if (minimized) {
      saveSharedPosFrom(panel);
      applySharedPosTo(launcher);
      launcher.classList.remove("cm-hidden");
      panel.classList.add("cm-hidden");
    } else {
      // saveSharedPosFrom(launcher);
      // applySharedPosTo(panel);
      panel.classList.remove("cm-hidden");
      launcher.classList.add("cm-hidden");
    }
    if (!opts.skipSave) UIStorage.save({ minimized: !!minimized });
  }

  function ensurePanel() {
    if (document.getElementById(PANEL_ID)) return;

    // Structure: Panel -> Header, Widget, Search, List
    const panel = document.createElement("div");
    panel.id = PANEL_ID;

    // --- Header ---
    const header = document.createElement("div");
    header.id = "cm-header";
    header.innerHTML = `
      <div id="cm-title">ChatMastery</div>
      <div class="cm-actions">
        <button class="cm-icon-btn" id="btn-refresh" title="Refresh">${getIcon("refresh")}</button>
        <button class="cm-icon-btn" id="btn-hide" title="Toggle List">${getIcon("hide")}</button>
        <button class="cm-icon-btn" id="btn-min" title="Minimize">${getIcon("min")}</button>
      </div>
    `;

    // Events
    header.querySelector("#btn-refresh").onclick = () => rebuild({ force: true });
    header.querySelector("#btn-min").onclick = () => setMinimized(true);
    header.querySelector("#btn-hide").onclick = () => {
      const list = panel.querySelector("#" + LIST_ID);
      const search = panel.querySelector("#cm-search-wrap");
      const hidden = list.classList.contains("cm-hidden");
      if (hidden) {
        list.classList.remove("cm-hidden");
        search.classList.remove("cm-hidden");
      } else {
        list.classList.add("cm-hidden");
        search.classList.add("cm-hidden");
      }
    };

    // --- Widget (Mastery Stats) ---
    const widget = document.createElement("div");
    widget.id = WIDGET_ID;
    widget.innerHTML = `
      <div class="cm-widget-row">
        <span class="cm-label">Mastery Goal</span>
        <span class="cm-value" id="cm-stat-ratio">0/100</span>
      </div>
      <div class="cm-progress-track">
        <div class="cm-progress-fill" id="cm-stat-bar" style="width:0%"></div>
      </div>
    `;

    // --- Search ---
    const searchWrap = document.createElement("div");
    searchWrap.id = "cm-search-wrap";
    const search = document.createElement("input");
    search.id = "cm-search";
    search.placeholder = "Search keywords...";
    search.addEventListener("input", () => filterList(search.value));
    searchWrap.appendChild(search);

    // --- List ---
    const list = document.createElement("div");
    list.id = LIST_ID;

    panel.appendChild(header);
    panel.appendChild(widget);
    panel.appendChild(searchWrap);
    panel.appendChild(list);

    document.documentElement.appendChild(panel);

    // Draggable
    makeDraggable(panel, header, {
      onDragEnd: (el) => saveSharedPosFrom(el)
    });

    // Initial State
    const s = UIStorage.load();
    applySharedPosTo(panel);
    if (s.minimized) setMinimized(true, { skipSave: true });
    else setMinimized(false, { skipSave: true });
  }

  // =========================
  // Logic: Rebuild
  // =========================
  function rebuild({ force = false } = {}) {
    ensurePanel();

    if (!g_storageLoaded) return;

    // Check if user count changed
    const userNodes = document.querySelectorAll('[data-message-author-role="user"]');
    if (!force && userNodes.length === lastBuiltUserCount) return;

    lastBuiltUserCount = userNodes.length;
    let newFound = false;

    // Get turns AND Filter duplicates first (WYSIWYG Mode)
    const allTurns = getTurns();
    const start = Math.max(0, allTurns.length - MAX_ITEMS);
    const turns = allTurns.slice(start);

    // 1. Filter unique turns based on normalized content hash
    const uniqueTurns = [];
    const seenHashesInThisRender = new Set();
    const seenIdsInThisRender = new Set();

    for (const t of turns) {
      if (!t.user) continue;

      // Calculate ID (Content Hash)
      // Normalize whitespace
      const rawTxt = t.user.textContent || "";
      const txt = rawTxt.trim().replace(/\s+/g, " ");
      const id = `cm-${djb2Hash(txt)}`;

      // Deduplicate
      if (seenHashesInThisRender.has(id)) continue;
      seenHashesInThisRender.add(id);
      seenIdsInThisRender.add(id); // Use this for storage sync later

      t._cmId = id; // Store for render loop
      uniqueTurns.push(t);
    }

    // 2. Count is strictly based on UNIQUE visible items
    const currentUniqueCount = uniqueTurns.length;

    // Sync Stats (Force Overwrite)
    const s = StorageManager.get();
    if (s.totalQuestions !== currentUniqueCount) {
      s.totalQuestions = currentUniqueCount;
      StorageManager.save(s);
      // Also update g_seenIds to match reality
      g_seenIds = new Set(seenIdsInThisRender);
      newFound = true;
    }

    const list = document.getElementById(LIST_ID);
    list.textContent = "";

    if (uniqueTurns.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.className = "cm-item";
      emptyMsg.style.textAlign = "center";
      emptyMsg.style.color = "#888";
      emptyMsg.style.padding = "20px";
      emptyMsg.textContent = "No messages detected.";
      list.appendChild(emptyMsg);
      // Update widget to 0
      updateWidget();
      return;
    }

    const frag = document.createDocumentFragment();
    lastRenderedTurnTargetId = null;

    // 3. Render Unique Turns
    for (let i = 0; i < uniqueTurns.length; i++) {
      const t = uniqueTurns[i];
      const id = t._cmId;
      const globalIndex = start + i; // Index relative to start of slice
      const userDisp = getUserDisplay(t.user);

      // --- Score ---
      const depthScore = DepthScorer.calculate(t.user?.textContent || "");
      const level = DepthScorer.getLevel(depthScore);

      // --- Item UI ---
      const item = document.createElement("div");
      item.className = "cm-item";
      item.dataset.target = id;

      const assistSummary = SHOW_ASSISTANT_PREVIEW ? getAssistantSummary(t.assistant) : "";
      item.dataset.search = (userDisp.title + " " + assistSummary).toLowerCase();

      // Header Line
      const headerDiv = document.createElement("div");
      headerDiv.className = "cm-item-header";

      // Index (1-based from filtered list)
      const idx = document.createElement("span");
      idx.className = "cm-idx";
      idx.textContent = (i + 1) + ".";

      // Depth Dot
      const dot = document.createElement("span");
      dot.className = "cm-depth-dot " + level.class;
      dot.title = `Depth: ${depthScore}% (${level.label})`;

      // Title
      const titleSpan = document.createElement("span");
      titleSpan.className = "cm-title-text";
      titleSpan.textContent = userDisp.title;

      headerDiv.appendChild(idx);
      headerDiv.appendChild(dot);
      headerDiv.appendChild(titleSpan);

      // Badges
      if (userDisp.filesCount > 0) {
        const b = document.createElement("span");
        b.className = "cm-badge";
        b.textContent = "📎 " + userDisp.filesCount;
        headerDiv.appendChild(b);
      }
      if (userDisp.imgsCount > 0) {
        const b = document.createElement("span");
        b.className = "cm-badge";
        b.textContent = "📷 " + userDisp.imgsCount;
        headerDiv.appendChild(b);
      }

      item.appendChild(headerDiv);

      // Thumbs
      if (userDisp.thumbs && userDisp.thumbs.length) {
        const thumbsWrap = document.createElement("div");
        thumbsWrap.className = "cm-thumbs";
        for (const src of userDisp.thumbs) {
          const im = document.createElement("img");
          im.className = "cm-thumb";
          im.src = src;
          thumbsWrap.appendChild(im);
        }
        item.appendChild(thumbsWrap);
      }

      // Meta
      if (SHOW_ASSISTANT_PREVIEW && assistSummary) {
        const meta = document.createElement("div");
        meta.className = "cm-meta";
        meta.textContent = assistSummary;
        item.appendChild(meta);
      }

      // Click
      item.addEventListener("click", () => {
        const el = document.getElementById(id) || document.querySelector(`[${DATA_ID}="${id}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        list.querySelectorAll(".cm-item").forEach(x => x.classList.remove("active"));
        item.classList.add("active");
      });

      frag.appendChild(item);
      lastRenderedTurnTargetId = id;
    }

    list.appendChild(frag);

    // Save seen (Only if updated)
    if (newFound) {
      const keys = getStorageKeys(g_currentChatId);
      chrome.storage.local.set({ [keys.seen]: Array.from(g_seenIds) });
    }

    // Update Widget
    updateWidget();

    // Restore search
    const searchVal = document.getElementById("cm-search")?.value;
    if (searchVal) filterList(searchVal);

    // Auto-scroll to bottom
    list.scrollTop = list.scrollHeight;

    observeLastAssistantDuringStreaming(turns, start);
  }

  function updateWidget() {
    const wRatio = document.getElementById("cm-stat-ratio");
    const wBar = document.getElementById("cm-stat-bar");
    if (!wRatio || !wBar) return;

    const { current, goal } = StorageManager.getGoalProgress();
    wRatio.textContent = `${current}/${goal}`;

    const pct = Math.min(100, Math.round((current / goal) * 100));
    wBar.style.width = pct + "%";
  }

  // =========================
  // Detection / Dom Helpers
  // =========================
  // Helpers for file/image detection
  function matchFileNames(text) {
    if (!text) return null;
    return String(text).match(FILE_EXT_RE);
  }

  function getTextExcluding(scopeNode, assistantNode) {
    if (!scopeNode) return "";
    const parts = [];
    const walker = document.createTreeWalker(scopeNode, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;
        if (assistantNode && assistantNode.contains(node.parentElement)) return NodeFilter.FILTER_REJECT;
        const t = node.nodeValue?.trim();
        if (!t) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) parts.push(walker.currentNode.nodeValue.trim());
    return parts.join(" ");
  }

  function extractFileNames(scopeNode, assistantNode) {
    if (!scopeNode) return [];
    const inAssistant = (el) => assistantNode && assistantNode.contains(el);
    const names = [];
    const candidates = Array.from(scopeNode.querySelectorAll("a, button, [role='button'], [download], [aria-label], [title], [data-testid]"));

    for (const el of candidates) {
      if (!(el instanceof HTMLElement)) continue;
      if (inAssistant(el)) continue;

      const download = el.getAttribute?.("download") || "";
      const title = el.getAttribute?.("title") || "";
      const aria = el.getAttribute?.("aria-label") || "";
      const text = (el.textContent || "").trim();
      const href = el.getAttribute?.("href") || "";
      const testid = el.getAttribute?.("data-testid") || "";

      for (const v of [download, title, aria, text]) {
        const m = matchFileNames(v);
        if (m) names.push(...m);
      }

      const looksLikeFileLink = FILE_LINK_RE.test(href);
      const looksLikeHint = FILE_HINT_RE.test(testid) || DOWNLOAD_RE.test(aria) || DOWNLOAD_RE.test(title) || FILE_SIZE_RE.test(text);

      if ((looksLikeFileLink || looksLikeHint) && names.length === 0) names.push("File");
    }

    const rawText = getTextExcluding(scopeNode, assistantNode);
    const matches = matchFileNames(rawText);
    if (matches) names.push(...matches);

    const cleaned = uniq(names).map((n) => n.trim());
    const hasRealName = cleaned.some((x) => x !== "File");
    return hasRealName ? cleaned.filter((x) => x !== "File") : cleaned;
  }

  function extractImages(scopeNode, assistantNode) {
    if (!scopeNode) return [];
    const inAssistant = (el) => assistantNode && assistantNode.contains(el);

    const imgs = Array.from(scopeNode.querySelectorAll("img")).filter((img) => {
      if (!img?.src) return false;
      if (img.src.startsWith("data:image/svg+xml")) return false;
      if (inAssistant(img)) return false;
      const card = img.closest?.('[data-testid*="file"], [data-testid*="attachment"]');
      if (card) return false;
      const r = img.getBoundingClientRect?.();
      if (r && r.width <= 60 && r.height <= 60) return false;
      return true;
    }).map((img) => img.src);

    return uniq(imgs);
  }

  function getTurns() {
    // Strategy 1: TestID
    const turnNodes = Array.from(document.querySelectorAll('[data-testid="conversation-turn"]'));
    if (turnNodes.length) {
      return turnNodes.map((root) => ({
        root,
        user: root.querySelector('[data-message-author-role="user"]'),
        assistant: root.querySelector('[data-message-author-role="assistant"]')
      }));
    }

    // Strategy 2: Fallback (Structure)
    const roleNodes = Array.from(document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'));
    const turns = [];
    for (let i = 0; i < roleNodes.length; i++) {
      const n = roleNodes[i];
      if (n.getAttribute("data-message-author-role") !== "user") continue;

      const next = roleNodes[i + 1];
      const assistant = next && next.getAttribute("data-message-author-role") === "assistant" ? next : null;
      const root = n.closest("article") || n.parentElement || n;

      turns.push({ root, user: n, assistant });
      if (assistant) i++;
    }
    return turns;
  }


  function getUserDisplay(userNode) {
    const userText = (userNode?.textContent || "").trim();
    const turnRoot = userNode?.closest?.('[data-testid="conversation-turn"]') || userNode;
    const assistantNode = turnRoot?.querySelector?.('[data-message-author-role="assistant"]') || null;
    const scope = turnRoot || userNode;

    const fileNames = extractFileNames(scope, assistantNode);
    const imgSrcs = extractImages(scope, assistantNode);

    const filesCount = fileNames.length;
    const imgsCount = imgSrcs.length;

    let title = "";
    if (userText) {
      title = summarize(userText);
    } else if (filesCount) {
      title = filesCount === 1 ? summarize(fileNames[0], 60) : `${filesCount} files`;
    } else if (imgsCount) {
      title = `Image${imgsCount > 1 ? "s" : ""}`;
    } else {
      title = "(non-text)";
    }

    return { title, thumbs: imgSrcs.slice(0, 3), filesCount, imgsCount, fileNames };
  }

  function getAssistantSummary(node) {
    if (!node) return "";
    return summarize(node.textContent, 80);
  }

  function assignStableId(turn, idx) {
    // Force simple content hash for User messages to avoid "Sending..." vs "Sent" ID changes.
    // This prevents double-counting when the DOM updates from optimistic to confirmed state.
    // ALSO: Normalize whitespace to avoid invisible differences (e.g. trailing newline).
    const rawTxt = turn.user?.textContent || "";
    const txt = rawTxt.trim().replace(/\s+/g, " ");

    // Prefix "cm-" to avoid collisions with page IDs
    const id = `cm-${djb2Hash(txt)}`;

    if (!turn.root.getAttribute(DATA_ID)) {
      turn.root.setAttribute(DATA_ID, id);
      turn.root.id = id;
    }
    return id;
  }

  function filterList(k) {
    k = k.toLowerCase().trim();
    document.querySelectorAll(".cm-item").forEach(it => {
      it.style.display = (!k || it.dataset.search.includes(k)) ? "block" : "none";
    });
  }

  // =========================
  // Draggable / Pos Helpers
  // =========================
  function placeFixed(el, left, top) {
    const rect = el.getBoundingClientRect();
    const L = clamp(left, 10, window.innerWidth - rect.width - 10);
    const T = clamp(top, 10, window.innerHeight - rect.height - 10);
    el.style.left = L + "px";
    el.style.top = T + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.position = "fixed";
  }

  function saveSharedPosFrom(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    UIStorage.save({ posLeft: r.left, posTop: r.top });
  }

  function applySharedPosTo(el) {
    if (!el) return;
    const s = UIStorage.load();
    if (typeof s.posLeft === "number") placeFixed(el, s.posLeft, s.posTop);
  }

  function makeDraggable(target, handle, { onDragEnd } = {}) {
    if (!target || !handle) return;
    let isDown = false, startX, startY, startL, startT;
    let hasMoved = false;

    handle.addEventListener("pointerdown", e => {
      if (e.target.closest("button, input")) return;
      isDown = true;
      hasMoved = false;
      startX = e.clientX; startY = e.clientY;
      const r = target.getBoundingClientRect();
      startL = r.left; startT = r.top;
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener("pointermove", e => {
      if (!isDown) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Threshold
      if (!hasMoved && Math.hypot(dx, dy) < 5) return;

      hasMoved = true;
      e.preventDefault();
      placeFixed(target, startL + dx, startT + dy);
    });

    handle.addEventListener("pointerup", e => {
      if (!isDown) return;
      isDown = false;

      if (hasMoved) {
        target.__movedRecently = true;
        setTimeout(() => target.__movedRecently = false, 200);
        if (onDragEnd) onDragEnd(target);
      }
    });
  }

  // Streaming Update Logic (Simplified)
  function observeLastAssistantDuringStreaming(turns, start) {
    // ... same implementation as before broadly ...
    // For this massive refactor, let's keep it simple: 
    // We rely on the periodic observer to catch updates.
    // But if we want smooth streaming:
    const last = turns[turns.length - 1];
    if (!last?.assistant) return;

    if (assistantObserver) { assistantObserver.disconnect(); assistantObserver = null; }

    assistantObserver = new MutationObserver(() => {
      // Debounce update for this specific item text
      if (assistantIdleTimer) clearTimeout(assistantIdleTimer);
      assistantIdleTimer = setTimeout(() => {
        // Update just the text of the last item in list
        if (lastRenderedTurnTargetId) {
          const item = document.querySelector(`.cm-item[data-target="${lastRenderedTurnTargetId}"] .cm-meta`);
          if (item) item.textContent = getAssistantSummary(last.assistant);
        }
      }, ASSISTANT_IDLE_MS);
    });

    assistantObserver.observe(last.assistant, { subtree: true, characterData: true, childList: true });
  }


  // =========================
  // Boot
  // =========================
  // URL Change Detection
  let lastUrl = window.location.href;
  function checkUrlChange() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // Re-init storage if chat ID changed
      const newChatId = getChatId();
      if (newChatId !== g_currentChatId) {
        console.log("ChatMastery: Chat changed to", newChatId);
        g_storageLoaded = false; // Block rebuilds until loaded
        initStorage(newChatId).then(() => {
          rebuild({ force: true });
        });
      }
    }
  }

  function startObserver() {
    // Poll for user messages count AND URL changes
    setInterval(() => {
      checkUrlChange();
      rebuild();
    }, 2000);

    // Also mutation observer for new nodes
    const obs = new MutationObserver(() => rebuild());
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // Init
  initStorage(getChatId()).then(() => {
    startObserver();
  });
})();
