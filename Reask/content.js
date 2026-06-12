// Reask - Content Script v1.5
// Works on claude.ai and chatgpt.com
(function () {
  if (window.__reaskLoaded) return;
  window.__reaskLoaded = true;

  // ─── State ────────────────────────────────────────────────────────────────
  let highlights = [];
  let highlightCounter = 0;
  let floatingToolbar = null;
  let currentSelection = null;
  let multiSelectMode = true;
  let stripResizeObserver = null;
  let responseLength = 'normal';

  // Active floating comment box: { el, id, markEl }
  let activeComment = null;

  // ─── Strip ────────────────────────────────────────────────────────────────
  function createStrip() {
    const strip = document.createElement('div');
    strip.id = 'ch-strip';
    strip.innerHTML = `
      <div class="ch-strip-top">
        <div class="ch-strip-chips" id="ch-strip-chips"></div>
        <button class="ch-multiselect-toggle ch-ms-active" id="ch-ms-toggle" title="Auto-highlight on select (Alt+H)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 11 12 14 22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          Auto
        </button>
      </div>
      <div class="ch-strip-bottom">
        <input id="ch-strip-input" class="ch-strip-input" type="text"
          placeholder="Ask about highlights… (leave blank to clarify)" />
        <div class="ch-length-pills" id="ch-length-pills">
          <button class="ch-length-pill" data-length="short">Short</button>
          <button class="ch-length-pill ch-length-active" data-length="normal">Normal</button>
          <button class="ch-length-pill" data-length="detailed">Detailed</button>
        </div>
        <button class="ch-strip-send" id="ch-strip-send" title="Send (Enter)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
        <button class="ch-strip-clear" id="ch-strip-clear" title="Clear all">
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
    document.getElementById('ch-length-pills').addEventListener('click', (e) => {
      const pill = e.target.closest('.ch-length-pill');
      if (!pill) return;
      responseLength = pill.dataset.length;
      document.querySelectorAll('.ch-length-pill').forEach(p => p.classList.remove('ch-length-active'));
      pill.classList.add('ch-length-active');
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
    let composerEl = input;
    let el = input.parentNode;
    const vw = window.innerWidth;
    for (let i = 0; i < 12; i++) {
      if (!el || el === document.body || el === document.documentElement) break;
      const r = el.getBoundingClientRect();
      if (r.width >= vw * 0.4 && r.width <= vw * 0.98) { composerEl = el; break; }
      el = el.parentNode;
    }
    const cr = composerEl.getBoundingClientRect();
    strip.style.top   = `${Math.max(8, rect.top - (strip.offsetHeight || 90) - 6)}px`;
    strip.style.left  = `${cr.left}px`;
    strip.style.width = `${cr.width}px`;
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
    window.addEventListener('scroll', onScrollResize, { passive: true });
    window.addEventListener('resize', onScrollResize, { passive: true });
    const input = findInputElement();
    if (input && window.ResizeObserver) {
      stripResizeObserver = new ResizeObserver(onScrollResize);
      stripResizeObserver.observe(input);
      if (input.parentNode) stripResizeObserver.observe(input.parentNode);
    }
  }

  function stopPositioner() {
    window.removeEventListener('scroll', onScrollResize);
    window.removeEventListener('resize', onScrollResize);
    if (stripResizeObserver) { stripResizeObserver.disconnect(); stripResizeObserver = null; }
  }

  function onScrollResize() {
    positionStrip();
    repositionActiveComment();
  }

  // ─── Chips ────────────────────────────────────────────────────────────────
  function renderStripChips() {
    const container = document.getElementById('ch-strip-chips');
    if (!container) return;
    container.innerHTML = '';

    highlights.forEach((h, i) => {
      const chip = document.createElement('div');
      chip.className = 'ch-chip';
      chip.dataset.id = h.id;
      chip.draggable = true;

      const hasComment = h.comment && h.comment.trim().length > 0;
      chip.innerHTML = `
        <span class="ch-chip-num">${i + 1}</span>
        <span class="ch-chip-text" title="${escapeHtml(h.text)}">${escapeHtml(truncate(h.text, 42))}</span>
        ${hasComment ? '<span class="ch-chip-comment-dot" title="Has a note">●</span>' : ''}
        <button class="ch-chip-note-toggle${activeComment && activeComment.id === h.id ? ' ch-note-open' : ''}"
          data-id="${h.id}" title="Add / edit note">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button class="ch-chip-remove" data-id="${h.id}" title="Remove highlight">✕</button>
      `;

      chip.querySelector('.ch-chip-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeHighlight(h.id);
      });

      // Chat bubble on chip also opens the floating comment box
      chip.querySelector('.ch-chip-note-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        const span = document.querySelector(`span.ch-highlight[data-highlight-id="${h.id}"]`);
        if (activeComment && activeComment.id === h.id) {
          closeActiveComment();
        } else {
          openFloatingComment(h.id, span);
        }
      });

      chip.addEventListener('dragstart', onChipDragStart);
      chip.addEventListener('dragover',  onChipDragOver);
      chip.addEventListener('drop',      onChipDrop);
      chip.addEventListener('dragend',   onChipDragEnd);

      container.appendChild(chip);
    });

    requestAnimationFrame(positionStrip);
  }

  // ─── Floating comment box (position: fixed, outside conversation DOM) ─────
  function openFloatingComment(id, markEl) {
    closeActiveComment();

    const h = highlights.find(x => x.id === id);
    if (!h) return;

    const box = document.createElement('div');
    box.id = 'ch-float-comment';
    box.className = 'ch-float-comment';

    const icon = document.createElement('span');
    icon.className = 'ch-float-comment-icon';
    icon.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>`;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ch-float-input';
    input.placeholder = 'Add a note…';
    input.maxLength = 400;
    input.value = h.comment || '';
    if (input.value.trim()) input.classList.add('ch-has-note');

    input.addEventListener('input', () => {
      const target = highlights.find(x => x.id === id);
      if (target) {
        target.comment = input.value;
        input.classList.toggle('ch-has-note', input.value.trim().length > 0);
        // Update dot on chip without full re-render
        const chipEl = document.querySelector(`.ch-chip[data-id="${id}"]`);
        if (chipEl) {
          let dot = chipEl.querySelector('.ch-chip-comment-dot');
          if (input.value.trim() && !dot) {
            dot = document.createElement('span');
            dot.className = 'ch-chip-comment-dot';
            dot.title = 'Has a note';
            dot.textContent = '●';
            const toggle = chipEl.querySelector('.ch-chip-note-toggle');
            chipEl.insertBefore(dot, toggle);
          } else if (!input.value.trim() && dot) {
            dot.remove();
          }
        }
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeActiveComment();
      }
    });

    // Prevent clicks inside from bubbling to document (which would close it)
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    box.addEventListener('click',     (e) => e.stopPropagation());

    box.appendChild(icon);
    box.appendChild(input);
    document.body.appendChild(box);

    activeComment = { el: box, id, markEl };

    // Position below the mark
    positionFloatingComment(box, markEl);

    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });

    // Close on outside click after a tick
    setTimeout(() => {
      document.addEventListener('mousedown', onOutsideCommentClick);
    }, 10);

    // Update chip bubble icon state
    renderStripChips();
  }

  function positionFloatingComment(box, markEl) {
    if (!markEl) return;
    const rect = markEl.getBoundingClientRect();
    const boxW = 260;
    let left = rect.left;
    if (left + boxW > window.innerWidth - 8) left = window.innerWidth - boxW - 8;
    left = Math.max(8, left);
    box.style.top  = `${rect.bottom + 6}px`;
    box.style.left = `${left}px`;
    box.style.width = `${boxW}px`;
  }

  function repositionActiveComment() {
    if (activeComment) {
      positionFloatingComment(activeComment.el, activeComment.markEl);
    }
  }

  function closeActiveComment() {
    if (activeComment) {
      activeComment.el.remove();
      activeComment = null;
      document.removeEventListener('mousedown', onOutsideCommentClick);
      renderStripChips(); // update bubble icon state
    }
  }

  function onOutsideCommentClick(e) {
    if (activeComment && !activeComment.el.contains(e.target)) {
      closeActiveComment();
    }
  }

  // ─── Drag-to-reorder ──────────────────────────────────────────────────────
  let dragSrcId = null;

  function onChipDragStart(e) {
    dragSrcId = this.dataset.id;
    this.classList.add('ch-chip-dragging');
    e.dataTransfer.effectAllowed = 'move';
  }
  function onChipDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.ch-chip').forEach(c => c.classList.remove('ch-chip-drag-over'));
    if (this.dataset.id !== dragSrcId) this.classList.add('ch-chip-drag-over');
  }
  function onChipDrop(e) {
    e.preventDefault();
    if (!dragSrcId || this.dataset.id === dragSrcId) return;
    const si = highlights.findIndex(h => String(h.id) === dragSrcId);
    const ti = highlights.findIndex(h => String(h.id) === this.dataset.id);
    if (si === -1 || ti === -1) return;
    const [moved] = highlights.splice(si, 1);
    highlights.splice(ti, 0, moved);
    renderStripChips();
  }
  function onChipDragEnd() {
    dragSrcId = null;
    document.querySelectorAll('.ch-chip').forEach(c =>
      c.classList.remove('ch-chip-dragging', 'ch-chip-drag-over'));
  }

  // ─── Multi-select ─────────────────────────────────────────────────────────
  function toggleMultiSelectMode() {
    multiSelectMode = !multiSelectMode;
    const btn = document.getElementById('ch-ms-toggle');
    if (btn) btn.classList.toggle('ch-ms-active', multiSelectMode);
    if (multiSelectMode) hideFloatingToolbar();
  }

  // ─── Floating highlight toolbar (manual mode) ─────────────────────────────
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
    let spanEl = null;

    try {
      const range = selectionData.range.cloneRange();
      spanEl = document.createElement('span');
      spanEl.className = 'ch-highlight';
      spanEl.dataset.highlightId = id;
      spanEl.title = 'Click to add a note';
      range.surroundContents(spanEl);
    } catch (e) {
      try {
        const range = selectionData.range.cloneRange();
        const frag = range.extractContents();
        spanEl = document.createElement('span');
        spanEl.className = 'ch-highlight';
        spanEl.dataset.highlightId = id;
        spanEl.title = 'Click to add a note';
        spanEl.appendChild(frag);
        range.insertNode(spanEl);
      } catch (e2) {
        console.warn('Reask: Could not wrap selection', e2);
        return;
      }
    }

    // Single click → toggle floating comment box
    spanEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeComment && activeComment.id === id) {
        closeActiveComment();
      } else {
        openFloatingComment(id, spanEl);
      }
    });

    highlights.push({ id, text: selectionData.text, comment: '', spanEl });
    window.getSelection().removeAllRanges();

    renderStripChips();
    if (highlights.length === 1) {
      showStrip();
    } else {
      requestAnimationFrame(() => {
        const allChips = document.querySelectorAll('.ch-chip');
        const newest = allChips[allChips.length - 1];
        if (newest) {
          newest.classList.add('ch-chip-pop');
          newest.addEventListener('animationend', () => newest.classList.remove('ch-chip-pop'), { once: true });
        }
      });
    }
  }

  function removeHighlight(id) {
    if (activeComment && activeComment.id === id) closeActiveComment();
    const span = document.querySelector(`span.ch-highlight[data-highlight-id="${id}"]`);
    if (span) {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    }
    highlights = highlights.filter(h => h.id !== id);
    renderStripChips();
    if (highlights.length === 0) hideStrip();
  }

  function clearAllHighlights() {
    closeActiveComment();
    document.querySelectorAll('span.ch-highlight').forEach(span => {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    });
    highlights = [];
    renderStripChips();
    hideStrip();
  }

  // ─── Ask Claude / ChatGPT ─────────────────────────────────────────────────
  function askClaude() {
    if (highlights.length === 0) return;
    const stripInput = document.getElementById('ch-strip-input');
    const userQuestion = stripInput ? stripInput.value.trim() : '';

    const anyComments = highlights.some(h => h.comment && h.comment.trim());

    // Build excerpt blocks
    const excerptBlocks = highlights
      .map((h, i) => {
        const lines = [
          `--- Excerpt ${i + 1} ---`,
          `Text: "${h.text}"`,
        ];
        if (h.comment && h.comment.trim()) {
          lines.push(`My note: ${h.comment.trim()}`);
        }
        return lines.join('\n');
      })
      .join('\n\n');

    // Only include the annotation framing if at least one comment exists
    const annotationFrame = anyComments
      ? `I have highlighted ${highlights.length === 1 ? 'an excerpt' : `${highlights.length} excerpts`} from your response. Each excerpt is labeled and self-contained. Where I have added a note, it reflects what specifically confused me about that excerpt only — please address each excerpt independently.\n\n`
      : `I have a question about ${highlights.length === 1 ? 'this excerpt' : `these ${highlights.length} excerpts`} from your response.\n\n`;

    const closing = userQuestion
      ? `\n\n---\n\n${userQuestion}`
      : `\n\n---\n\nCould you clarify or expand on ${highlights.length === 1 ? 'this' : 'these'}?`;

    const lengthSuffix = responseLength === 'short'
      ? '\n\nPlease keep your response concise.'
      : responseLength === 'detailed'
      ? '\n\nPlease give a thorough, step-by-step explanation.'
      : '';

    const message = annotationFrame + excerptBlocks + closing + lengthSuffix;

    injectAndSend(message);
    clearAllHighlights();
    if (stripInput) stripInput.value = '';
  }

  // ─── Input injection ──────────────────────────────────────────────────────
  function findInputElement() {
    const candidates = document.querySelectorAll('div[contenteditable="true"]');
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (candidates[i].offsetParent !== null) return candidates[i];
    }
    return null;
  }

  function injectAndSend(text) {
    const inputEl = findInputElement();
    if (!inputEl) { console.warn('Reask: Could not find message input.'); return; }

    inputEl.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(inputEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);

    const existing = inputEl.textContent.trim();
    const toInsert = existing ? '\n\n' + text : text;

    if (!document.execCommand('insertText', false, toInsert)) {
      inputEl.textContent = (existing ? existing + '\n\n' : '') + text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    inputEl.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: toInsert,
    }));

    setTimeout(() => clickSend(inputEl), 150);
  }

  function clickSend(inputEl) {
    for (const testId of ['send-button', 'composer-send-button']) {
      const btn = document.querySelector(`button[data-testid="${testId}"]`);
      if (btn && !btn.disabled && btn.offsetParent !== null) { btn.click(); return; }
    }
    const ariaBtn = document.querySelector('button[aria-label*="send" i]');
    if (ariaBtn && !ariaBtn.disabled && ariaBtn.offsetParent !== null) { ariaBtn.click(); return; }
    const container = inputEl.closest('div[class]');
    if (container) {
      const btns = Array.from(container.querySelectorAll('button'));
      for (let i = btns.length - 1; i >= 0; i--) {
        if (!btns[i].disabled && btns[i].offsetParent !== null) { btns[i].click(); return; }
      }
    }
    inputEl.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true,
    }));
  }

  // ─── Selection listener ───────────────────────────────────────────────────
  document.addEventListener('mouseup', (e) => {
    if (e.target.closest('#ch-strip') || e.target.closest('#ch-floating-toolbar') ||
        e.target.closest('#ch-float-comment')) return;
    if (e.target.closest('mark.ch-highlight')) return;
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
    if (e.key === 'Escape') {
      hideFloatingToolbar();
      closeActiveComment();
    }
    if (e.altKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      toggleMultiSelectMode();
    }
  });

  // ─── Floating toolbar positioning ─────────────────────────────────────────
  function showFloatingToolbar(rect) {
    if (!floatingToolbar) return;
    const sy = window.scrollY;
    floatingToolbar.style.top  = `${Math.max(sy + 8, rect.top + sy - 44)}px`;
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

  // ─── Init ─────────────────────────────────────────────────────────────────
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
