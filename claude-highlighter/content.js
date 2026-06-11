// Claude Highlighter - Content Script
(function () {
  if (window.__claudeHighlighterLoaded) return;
  window.__claudeHighlighterLoaded = true;

  // ─── State ────────────────────────────────────────────────────────────────
  let highlights = [];
  let highlightCounter = 0;
  let floatingToolbar = null;
  let currentSelection = null;
  let multiSelectMode = true;
  let stripResizeObserver = null;

  // ─── Strip ────────────────────────────────────────────────────────────────
  function createStrip() {
    const strip = document.createElement('div');
    strip.id = 'ch-strip';
    strip.innerHTML = `
      <div class="ch-strip-top">
        <div class="ch-strip-chips" id="ch-strip-chips"></div>
        <button class="ch-multiselect-toggle ch-ms-active" id="ch-ms-toggle" title="Multi-select: every selection auto-highlights (Alt+H)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 11 12 14 22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          Multi-select
        </button>
      </div>
      <div class="ch-strip-bottom">
        <input
          id="ch-strip-input"
          class="ch-strip-input"
          type="text"
          placeholder="Ask about highlights… (leave blank to clarify)"
        />
        <button class="ch-strip-send" id="ch-strip-send" title="Ask Claude (Enter)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
        <button class="ch-strip-clear" id="ch-strip-clear" title="Clear all highlights">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>
    `;
    strip.style.display = 'none';
    document.body.appendChild(strip);

    document.getElementById('ch-strip-send').addEventListener('click', askClaude);
    document.getElementById('ch-strip-clear').addEventListener('click', clearAllHighlights);
    document.getElementById('ch-ms-toggle').addEventListener('click', toggleMultiSelectMode);

    document.getElementById('ch-strip-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askClaude(); }
    });

    return strip;
  }

  // ─── Strip positioning ────────────────────────────────────────────────────
  function positionStrip() {
    const strip = document.getElementById('ch-strip');
    if (!strip || strip.style.display === 'none') return;

    const input = findInputElement();
    if (!input) return;

    const rect = input.getBoundingClientRect();

    // Walk up to find the full-width composer container
    let composerEl = input;
    let el = input.parentNode;
    for (let i = 0; i < 8; i++) {
      if (!el || el === document.body) break;
      if (el.getBoundingClientRect().width > window.innerWidth * 0.45) {
        composerEl = el;
        break;
      }
      el = el.parentNode;
    }
    const composerRect = composerEl.getBoundingClientRect();
    const stripHeight = strip.offsetHeight || 90;
    const gap = 6;

    strip.style.top   = `${Math.max(8, rect.top - stripHeight - gap)}px`;
    strip.style.left  = `${composerRect.left}px`;
    strip.style.width = `${composerRect.width}px`;
  }

  function showStrip() {
    const strip = document.getElementById('ch-strip');
    if (!strip) return;
    strip.style.display = 'flex';
    positionStrip();
    requestAnimationFrame(positionStrip);
    startPositioner();
  }

  function hideStrip() {
    const strip = document.getElementById('ch-strip');
    if (strip) strip.style.display = 'none';
    stopPositioner();
  }

  function startPositioner() {
    stopPositioner();
    window.addEventListener('scroll', positionStrip, { passive: true });
    window.addEventListener('resize', positionStrip, { passive: true });
    const input = findInputElement();
    if (input && window.ResizeObserver) {
      stripResizeObserver = new ResizeObserver(positionStrip);
      stripResizeObserver.observe(input);
      if (input.parentNode) stripResizeObserver.observe(input.parentNode);
    }
  }

  function stopPositioner() {
    window.removeEventListener('scroll', positionStrip);
    window.removeEventListener('resize', positionStrip);
    if (stripResizeObserver) { stripResizeObserver.disconnect(); stripResizeObserver = null; }
  }

  // ─── Chips ────────────────────────────────────────────────────────────────
  function renderStripChips() {
    const chips = document.getElementById('ch-strip-chips');
    if (!chips) return;
    chips.innerHTML = '';
    highlights.forEach((h, i) => {
      const chip = document.createElement('div');
      chip.className = 'ch-chip';
      chip.innerHTML = `
        <span class="ch-chip-num">${i + 1}</span>
        <span class="ch-chip-text">${escapeHtml(truncate(h.text, 52))}</span>
        <button class="ch-chip-remove" title="Remove">✕</button>
      `;
      chip.querySelector('.ch-chip-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeHighlight(h.id);
      });
      chips.appendChild(chip);
    });
    // Reposition after chips reflow
    requestAnimationFrame(positionStrip);
  }

  // ─── Multi-select ─────────────────────────────────────────────────────────
  function toggleMultiSelectMode() {
    multiSelectMode = !multiSelectMode;
    const btn = document.getElementById('ch-ms-toggle');
    if (btn) btn.classList.toggle('ch-ms-active', multiSelectMode);
    if (multiSelectMode) hideFloatingToolbar();
  }

  // ─── Floating toolbar (when multi-select is OFF) ──────────────────────────
  function createFloatingToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = 'ch-floating-toolbar';
    toolbar.innerHTML = `
      <button class="ch-toolbar-btn" id="ch-add-highlight-btn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Highlight
      </button>
    `;
    toolbar.style.display = 'none';
    document.body.appendChild(toolbar);
    document.getElementById('ch-add-highlight-btn').addEventListener('click', () => {
      if (currentSelection) addHighlight(currentSelection);
      hideFloatingToolbar();
    });
    return toolbar;
  }

  // ─── Highlight logic ──────────────────────────────────────────────────────
  function addHighlight(selectionData) {
    const id = ++highlightCounter;
    try {
      const range = selectionData.range.cloneRange();
      const mark = document.createElement('mark');
      mark.className = 'ch-highlight';
      mark.dataset.highlightId = id;
      mark.addEventListener('click', () => removeHighlight(id));
      mark.title = 'Click to remove highlight';
      range.surroundContents(mark);
    } catch (e) {
      try {
        const range = selectionData.range.cloneRange();
        const fragment = range.extractContents();
        const mark = document.createElement('mark');
        mark.className = 'ch-highlight';
        mark.dataset.highlightId = id;
        mark.addEventListener('click', () => removeHighlight(id));
        mark.title = 'Click to remove highlight';
        mark.appendChild(fragment);
        range.insertNode(mark);
      } catch (e2) {
        console.warn('Claude Highlighter: Could not wrap selection', e2);
        return;
      }
    }

    highlights.push({ id, text: selectionData.text });
    window.getSelection().removeAllRanges();
    renderStripChips();
    if (highlights.length === 1) showStrip();
  }

  function removeHighlight(id) {
    const mark = document.querySelector(`mark[data-highlight-id="${id}"]`);
    if (mark) {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    }
    highlights = highlights.filter(h => h.id !== id);
    renderStripChips();
    if (highlights.length === 0) hideStrip();
  }

  function clearAllHighlights() {
    document.querySelectorAll('mark.ch-highlight').forEach(mark => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    });
    highlights = [];
    renderStripChips();
    hideStrip();
  }

  // ─── Ask Claude ───────────────────────────────────────────────────────────
  function askClaude() {
    if (highlights.length === 0) return;
    const stripInput = document.getElementById('ch-strip-input');
    const userQuestion = stripInput ? stripInput.value.trim() : '';

    let message = highlights.length === 1
      ? `Regarding this part of your response:\n\n> "${highlights[0].text}"`
      : `I have ${highlights.length} highlighted excerpts I'd like to ask about:\n\n` +
        highlights.map((h, i) => `**Excerpt ${i + 1}:**\n> "${h.text}"`).join('\n\n');

    message += userQuestion
      ? `\n\n${userQuestion}`
      : `\n\nCould you clarify or expand on ${highlights.length === 1 ? 'this' : 'these'}?`;

    injectIntoClaudeTextarea(message);
    clearAllHighlights();
    if (stripInput) stripInput.value = '';
  }

  // ─── Inject + auto-send ───────────────────────────────────────────────────
  function findInputElement() {
    const candidates = document.querySelectorAll('div[contenteditable="true"]');
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (candidates[i].offsetParent !== null) return candidates[i];
    }
    return null;
  }

  function injectIntoClaudeTextarea(text) {
    const inputEl = findInputElement();
    if (!inputEl) { alert('Claude Highlighter: Could not find the message input.'); return; }

    inputEl.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, text);
    inputEl.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: text,
    }));

    setTimeout(() => {
      let sendBtn = null;
      for (const testId of ['send-button', 'composer-send-button']) {
        const btn = document.querySelector(`button[data-testid="${testId}"]`);
        if (btn && !btn.disabled && btn.offsetParent !== null) { sendBtn = btn; break; }
      }
      if (!sendBtn) {
        const container = inputEl.closest('div[class]');
        if (container) {
          const btns = Array.from(container.querySelectorAll('button'));
          for (let i = btns.length - 1; i >= 0; i--) {
            if (!btns[i].disabled && btns[i].offsetParent !== null) { sendBtn = btns[i]; break; }
          }
        }
      }
      if (sendBtn) {
        sendBtn.click();
      } else {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true,
        }));
      }
    }, 150);
  }

  // ─── Selection listener ───────────────────────────────────────────────────
  document.addEventListener('mouseup', (e) => {
    if (e.target.closest('#ch-strip') || e.target.closest('#ch-floating-toolbar')) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (text.length > 2 && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        currentSelection = { text, range: range.cloneRange() };
        if (multiSelectMode) {
          addHighlight(currentSelection);
          currentSelection = null;
        } else {
          showFloatingToolbar(range.getBoundingClientRect());
        }
      } else {
        currentSelection = null;
        if (!multiSelectMode) hideFloatingToolbar();
      }
    }, 10);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideFloatingToolbar();
    if (e.altKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      toggleMultiSelectMode();
    }
  });

  // ─── Floating toolbar positioning ─────────────────────────────────────────
  function showFloatingToolbar(rect) {
    if (!floatingToolbar) return;
    const scrollY = window.scrollY;
    floatingToolbar.style.top  = `${Math.max(scrollY + 8, rect.top + scrollY - 44)}px`;
    floatingToolbar.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - 50, window.innerWidth - 120))}px`;
    floatingToolbar.style.display = 'flex';
  }

  function hideFloatingToolbar() {
    if (floatingToolbar) floatingToolbar.style.display = 'none';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    createStrip();
    floatingToolbar = createFloatingToolbar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
