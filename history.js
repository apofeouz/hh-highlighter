const listEl = document.getElementById('list');
const searchEl = document.getElementById('search');
const countEl = document.getElementById('count');
const subtitleEl = document.getElementById('subtitle');
const clearAllBtn = document.getElementById('clearAll');

let allEntries = [];

function load() {
  chrome.storage.local.get({ hh_history: {} }, (res) => {
    const map = res.hh_history || {};
    allEntries = Object.values(map).sort((a,b) => b.ts - a.ts);
    render();
  });
}

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `сегодня ${time}`;
  return d.toLocaleDateString('ru-RU') + ' ' + time;
}

function render() {
  const q = searchEl.value.trim().toLowerCase();
  const filtered = q ? allEntries.filter(e =>
    (e.title && e.title.toLowerCase().includes(q)) ||
    (e.href && e.href.toLowerCase().includes(q)) ||
    (e.id && e.id.toLowerCase().includes(q))
  ) : allEntries;

  subtitleEl.textContent = allEntries.length ? `Всего ${allEntries.length} · показано ${filtered.length}` : 'Пока ничего не просмотрено — откройте любую вакансию на hh.ru';
  countEl.textContent = filtered.length ? `${filtered.length} шт.` : '';

  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty">${q ? 'Ничего не найдено по запросу' : 'История пуста. Откройте вакансию на hh.ru и она появится здесь.'}</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(e => `
    <div class="item" data-id="${escapeHtml(e.id)}">
      <div class="meta">
        <a href="${escapeHtml(e.href)}" target="_blank">${escapeHtml(e.title || e.id)}</a>
        <div class="url">${escapeHtml(e.href)}</div>
      </div>
      <div class="date">${formatDate(e.ts)}</div>
      <button class="del" data-del="${escapeHtml(e.id)}">× удалить</button>
    </div>
  `).join('');

  listEl.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => removeOne(btn.dataset.del));
  });
}

function escapeHtml(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function removeOne(id) {
  chrome.storage.local.get({ hh_history: {} }, (res) => {
    const map = res.hh_history || {};
    delete map[id];
    // также удаляем старый localStorage ключ если есть (для консистентности, но он в другом контексте - очистится при следующем визите)
    chrome.storage.local.set({ hh_history: map }, () => {
      load();
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: Object.keys(map).length });
      // также удаляем из localStorage на активных вкладках hh.ru
      chrome.tabs.query({ url: 'https://*.hh.ru/*' }, (tabs) => {
        tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'REMOVE_ONE', id }).catch(()=>{}));
      });
    });
  });
}

clearAllBtn.addEventListener('click', () => {
  if (!allEntries.length) return;
  if (!confirm(`Очистить всю историю (${allEntries.length})?`)) return;
  chrome.storage.local.set({ hh_history: {} }, () => {
    // чистим и старый формат localStorage на всех вкладках
    chrome.tabs.query({ url: 'https://*.hh.ru/*' }, (tabs) => {
      let pending = tabs.length;
      if (!pending) { load(); return; }
      tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'CLEAR' }, () => {
        if (--pending === 0) load();
      }));
      // fallback если нет вкладок hh.ru
      setTimeout(load, 500);
    });
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: 0 });
    load();
  });
});

searchEl.addEventListener('input', render);

load();
