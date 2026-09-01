(() => {
  'use strict';
  const DEFAULT_COLOR = '#d32f2f';
  const DEFAULT_ENABLED = true;

  let HIGHLIGHT_COLOR = DEFAULT_COLOR;
  let ENABLED = DEFAULT_ENABLED;
  let styleEl = null;

  const STORAGE_KEYS = { enabled: 'hh_enabled', color: 'hh_color' };
  const HISTORY_KEY = 'hh_history';

  function buildStyleContent(color) {
    return `
    a.hh-visited, .hh-visited a, a.hh-visited:visited, .hh-visited a:visited,
    a.hh-visited *, .hh-visited a * {
      color: ${color} !important;
      text-decoration: underline !important;
    }
    .hh-visited-card [data-qa="serp-item__title"],
    .hh-visited-card [data-qa="serp-item__title"] *,
    .hh-visited-card [data-qa="serp-item__title-text"],
    .hh-visited-card [data-qa="serp-item__title-text"] * {
      color: ${color} !important;
      text-decoration: underline !important;
    }
    .hh-visited-card {
      outline: 2px solid ${color} !important;
      outline-offset: 6px !important;
      border-radius: 6px !important;
    }
  `;
  }

  function ensureStyle(color) {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'hh-highlighter-style';
      document.documentElement.appendChild(styleEl);
    }
    styleEl.textContent = buildStyleContent(color);
  }

  function applySettings({ enabled, color }) {
    if (typeof enabled === 'boolean') ENABLED = enabled;
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) HIGHLIGHT_COLOR = color;
    ensureStyle(HIGHLIGHT_COLOR);
    if (ENABLED) {
      document.querySelectorAll('.hh-visited-card').forEach(card => paintTitleStrong(card));
      document.querySelectorAll(LINK_SELECTORS.join(',')).forEach(applyHighlightToLink);
    } else {
      document.querySelectorAll('.hh-visited-card').forEach(card => {
        card.classList.remove('hh-visited-card');
        card.querySelectorAll('[data-qa="serp-item__title"], [data-qa="serp-item__title-text"]').forEach(n => {
          n.style.removeProperty('color');
          n.style.removeProperty('text-decoration');
        });
      });
      document.querySelectorAll('a.hh-visited').forEach(a => a.classList.remove('hh-visited'));
      PROCESSED_CARDS_WEAK = new WeakSet();
    }
  }

  function loadSettings(cb) {
    try {
      if (chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get({ [STORAGE_KEYS.enabled]: DEFAULT_ENABLED, [STORAGE_KEYS.color]: DEFAULT_COLOR }, (res) => {
          if (chrome.runtime.lastError) { ensureStyle(DEFAULT_COLOR); if (cb) cb(); return; }
          ENABLED = res[STORAGE_KEYS.enabled];
          HIGHLIGHT_COLOR = res[STORAGE_KEYS.color];
          ensureStyle(HIGHLIGHT_COLOR);
          if (cb) cb();
        });
      } else { ensureStyle(DEFAULT_COLOR); if (cb) cb(); }
    } catch (e) { ensureStyle(DEFAULT_COLOR); if (cb) cb(); }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' && area !== 'local') return;
      const next = {};
      if (changes[STORAGE_KEYS.enabled]) next.enabled = changes[STORAGE_KEYS.enabled].newValue;
      if (changes[STORAGE_KEYS.color]) next.color = changes[STORAGE_KEYS.color].newValue;
      if (Object.keys(next).length) applySettings(next);
    });
  } catch {}

  // ===== История с метаданными + badge + legacy localStorage =====
  function getTitleForCard(card, fallbackHref) {
    if (card) {
      const el = card.querySelector('[data-qa="serp-item__title-text"]') || card.querySelector('[data-qa="serp-item__title"]');
      if (el && el.textContent.trim()) return el.textContent.trim().slice(0,120);
    }
    // если на странице вакансии - title страницы
    if (fallbackHref && location.href.includes(fallbackHref)) {
      const t = document.title.replace(/—.*hh\.ru.*/i,'').trim();
      if (t) return t.slice(0,120);
    }
    return fallbackHref ? fallbackHref : 'Вакансия';
  }

  function saveHistory(id, href, card) {
    if (!id) return;
    const title = getTitleForCard(card, href);
    const cleanHref = href ? href.split('?')[0].split('#')[0] : location.origin + '/vacancy/' + id.split(':')[1];
    const entry = { id, href: cleanHref, title, ts: Date.now() };
    try {
      chrome.storage.local.get({ [HISTORY_KEY]: {} }, (res) => {
        const map = res[HISTORY_KEY] || {};
        const isNew = !map[id];
        map[id] = entry;
        chrome.storage.local.set({ [HISTORY_KEY]: map }, () => {
          if (isNew) {
            const count = Object.keys(map).length;
            try { chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count }); } catch {}
          }
        });
      });
    } catch {}
  }

  function removeHistoryOne(id) {
    try {
      chrome.storage.local.get({ [HISTORY_KEY]: {} }, (res) => {
        const map = res[HISTORY_KEY] || {};
        if (map[id]) {
          delete map[id];
          chrome.storage.local.set({ [HISTORY_KEY]: map }, () => {
            try { chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: Object.keys(map).length }); } catch {}
          });
        }
      });
    } catch {}
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'CLEAR') {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('hh-visited:')) toRemove.push(k);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
        try { chrome.storage.local.set({ [HISTORY_KEY]: {} }, () => { try{ chrome.runtime.sendMessage({type:'UPDATE_BADGE', count:0}); }catch{} }); } catch {}
        document.querySelectorAll('.hh-visited-card').forEach(c => c.classList.remove('hh-visited-card'));
        document.querySelectorAll('a.hh-visited').forEach(a => a.classList.remove('hh-visited'));
        sendResponse({ ok: true, removed: toRemove.length });
        return true;
      }
      if (msg.type === 'REMOVE_ONE') {
        if (msg.id) {
          localStorage.removeItem('hh-visited:' + msg.id);
          removeHistoryOne(msg.id);
          // снять подсветку у конкретной карточки
          document.querySelectorAll('.hh-visited-card').forEach(card => {
            if (card.__hhId === msg.id || card.getAttribute('data-hh-id') === msg.id) {
              card.classList.remove('hh-visited-card');
              card.querySelectorAll('[data-qa="serp-item__title"], [data-qa="serp-item__title-text"]').forEach(n=>{n.style.removeProperty('color'); n.style.removeProperty('text-decoration');});
            }
          });
          document.querySelectorAll('a.hh-visited').forEach(a=>{
            const card = closestCard(a);
            const cid = card ? getCardId(card) : extractIdFromHref(a.href);
            if (cid === msg.id) a.classList.remove('hh-visited');
          });
        }
        sendResponse({ ok: true });
        return true;
      }
      if (msg.type === 'GET_COUNT') {
        chrome.storage.local.get({ [HISTORY_KEY]: {} }, (res) => {
          const map = res[HISTORY_KEY] || {};
          let c = Object.keys(map).length;
          if (c===0) { // fallback на legacy localStorage
            for (let i=0;i<localStorage.length;i++) if(localStorage.key(i).startsWith('hh-visited:')) c++;
          }
          sendResponse({ count: c });
        });
        return true;
      }
      if (msg.type === 'GET_HISTORY') {
        chrome.storage.local.get({ [HISTORY_KEY]: {} }, (res) => sendResponse(res[HISTORY_KEY]||{}));
        return true;
      }
    });
  } catch {}

  // ===== Утилиты =====
  const LINK_SELECTORS = [
    'a[data-qa="serp-item__title"]',
    'a[href*="/vacancy/"]',
    'a[href*="/resume/"]',
    'a.magritte-link_enable-visited___Biyib_6-0-5',
  ];
  const PROCESSED_LINKS = new WeakSet();
  let PROCESSED_CARDS_WEAK = new WeakSet();

  function extractIdFromHref(href) {
    try {
      const u = new URL(href, location.origin);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && (parts[0] === 'vacancy' || parts[0] === 'resume')) return `${parts[0]}:${parts[1]}`;
      const qid = u.searchParams.get('vacancyId');
      if (qid) return `vacancy:${qid}`;
    } catch {}
    return null;
  }
  function closestCard(el) {
    return el.closest?.('[data-qa="serp-item"]')
      || el.closest?.('[data-qa="vacancy-serp__vacancy"]')
      || el.closest?.('[class*="vacancy-card"]')
      || el.closest?.('[data-qa*="vacancy-serp"]')
      || el.closest?.('article, li, div');
  }
  function getCardId(card) {
    if (!card) return null;
    if (card.__hhId) return card.__hhId;
    const cached = card.getAttribute('data-hh-id');
    if (cached) { card.__hhId = cached; return cached; }
    const btn = card.querySelector('a[data-qa="vacancy-serp__vacancy_response"][href*="vacancyId="]');
    if (btn) { const id = extractIdFromHref(btn.href); if (id) { card.setAttribute('data-hh-id', id); card.__hhId = id; return id; } }
    const aVac = card.querySelector('a[href*="/vacancy/"]');
    if (aVac) { const id = extractIdFromHref(aVac.href); if (id) { card.setAttribute('data-hh-id', id); card.__hhId = id; return id; } }
    return null;
  }
  function canonicalizeAdsLinkOnce(a, card) {
    if (a.__hhCanonDone) return;
    if (/adsrv\.hh\.ru\/click/.test(a.href)) {
      const id = getCardId(card);
      if (id) { const vid = id.split(':')[1]; a.href = `${location.origin}/vacancy/${vid}`; }
    }
    a.__hhCanonDone = true;
  }

  const key = id => `hh-visited:${id}`;
  const markVisitedId = (id, href, card) => {
    if (!id) return;
    localStorage.setItem(key(id), '1');
    saveHistory(id, href || location.href, card);
  };
  const isVisited = id => !!id && localStorage.getItem(key(id)) === '1';

  // миграция: если есть localStorage но нет history - заполним history заглушками (без title)
  (function migrateLegacy() {
    try {
      chrome.storage.local.get({ [HISTORY_KEY]: null }, (res) => {
        if (res[HISTORY_KEY] && Object.keys(res[HISTORY_KEY]).length) return;
        const map = {};
        for (let i=0;i<localStorage.length;i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('hh-visited:')) {
            const id = k.slice('hh-visited:'.length);
            map[id] = { id, href: location.origin + '/' + id.replace(':','/'), title: id, ts: Date.now() - Math.random()*1000000 };
          }
        }
        if (Object.keys(map).length) chrome.storage.local.set({ [HISTORY_KEY]: map }, ()=>{ try{ chrome.runtime.sendMessage({type:'UPDATE_BADGE', count: Object.keys(map).length}); }catch{} });
      });
    } catch {}
  })();

  (function markCurrentPage() {
    const id = extractIdFromHref(location.href);
    if (id) markVisitedId(id, location.href, null);
  })();

  function paintTitleStrong(card) {
    if (!card || !ENABLED) return;
    const nodes = card.querySelectorAll('[data-qa="serp-item__title"], [data-qa="serp-item__title-text"]');
    if (!nodes.length) return;
    const paint = () => {
      if (!ENABLED) return;
      nodes.forEach(n => {
        n.style.setProperty('color', HIGHLIGHT_COLOR, 'important');
        n.style.setProperty('text-decoration', 'underline', 'important');
      });
    };
    paint(); requestAnimationFrame(paint); setTimeout(paint, 50);
  }
  function markCardAndLink(card, a) {
    if (!ENABLED) return;
    if (card && !PROCESSED_CARDS_WEAK.has(card)) { card.classList.add('hh-visited-card'); PROCESSED_CARDS_WEAK.add(card); }
    if (a) a.classList.add('hh-visited');
    paintTitleStrong(card);
  }
  function applyHighlightToLink(a) {
    if (!ENABLED) return;
    const card = closestCard(a);
    let id = card ? getCardId(card) : null;
    if (!id) id = extractIdFromHref(a.href);
    if (!id || !isVisited(id)) return;
    markCardAndLink(card, a);
  }
  function wireLink(a) {
    if (PROCESSED_LINKS.has(a)) { applyHighlightToLink(a); return; }
    PROCESSED_LINKS.add(a);
    const card = closestCard(a);
    if (card) canonicalizeAdsLinkOnce(a, card);
    const markNow = () => {
      const c = closestCard(a);
      let id = c ? getCardId(c) : null;
      if (!id) id = extractIdFromHref(a.href);
      if (id) { markVisitedId(id, a.href, c); if (ENABLED) markCardAndLink(c, a); }
    };
    a.addEventListener('mousedown', markNow, { capture: true });
    a.addEventListener('auxclick', markNow, { capture: true });
    a.addEventListener('click', markNow, { capture: true });
    applyHighlightToLink(a);
  }
  function processNode(node) {
    if (node.nodeType !== 1) return;
    if (node.matches?.(LINK_SELECTORS.join(','))) { wireLink(node); return; }
    node.querySelectorAll?.(LINK_SELECTORS.join(',')).forEach(wireLink);
  }

  loadSettings(() => { document.querySelectorAll(LINK_SELECTORS.join(',')).forEach(wireLink); });

  let queued = false;
  const queueProcess = (targets) => {
    if (queued) return; queued = true;
    (window.requestIdleCallback || window.requestAnimationFrame)(() => {
      queued = false;
      targets.forEach(t => {
        if (t.matches?.('[data-qa="serp-item__title"], [data-qa="serp-item__title-text"]')) {
          const card = closestCard(t);
          if (card && isVisited(getCardId(card))) paintTitleStrong(card);
        } else processNode(t);
      });
    });
  };
  const mo = new MutationObserver(muts => {
    const targets = [];
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes && m.addedNodes.forEach(n => { if (n.nodeType===1) targets.push(n); });
      else if (m.type === 'attributes') {
        const t = m.target;
        if (t && t.matches?.('[data-qa="serp-item__title"], [data-qa="serp-item__title-text"], ' + LINK_SELECTORS.join(','))) targets.push(t);
      }
    }
    if (targets.length) queueProcess(targets);
  });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','style'] });
  window.addEventListener('pageshow', () => { if (!ENABLED) return; document.querySelectorAll(LINK_SELECTORS.join(',')).forEach(applyHighlightToLink); });
})();
