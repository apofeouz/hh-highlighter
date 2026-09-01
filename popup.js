const DEFAULT_COLOR = '#d32f2f';
const DEFAULT_ENABLED = true;

const enabledEl = document.getElementById('enabled');
const colorEl = document.getElementById('color');
const colorTextEl = document.getElementById('colorText');
const previewEl = document.getElementById('preview');
const visitedCountEl = document.getElementById('visitedCount');
const recentListEl = document.getElementById('recentList');
const clearBtn = document.getElementById('clearBtn');
const openHistoryBtn = document.getElementById('openHistory');

function updatePreview(color) {
  previewEl.style.background = color;
  document.querySelectorAll('.preset').forEach(b => b.classList.toggle('active', b.dataset.color.toLowerCase() === color.toLowerCase()));
}
function save(partial) { chrome.storage.sync.set(partial); }

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(ts){
  const d=new Date(ts), now=new Date();
  const isToday=d.toDateString()===now.toDateString();
  const t=d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  return isToday?`сегодня ${t}`: d.toLocaleDateString('ru-RU');
}

function loadSettings(){
  chrome.storage.sync.get({ hh_enabled: DEFAULT_ENABLED, hh_color: DEFAULT_COLOR }, (res)=>{
    enabledEl.checked = res.hh_enabled;
    colorEl.value = res.hh_color;
    colorTextEl.value = res.hh_color;
    updatePreview(res.hh_color);
  });
}

function loadHistory(){
  chrome.storage.local.get({ hh_history: {} }, (res)=>{
    const map=res.hh_history||{};
    const entries=Object.values(map).sort((a,b)=>b.ts-a.ts);
    visitedCountEl.textContent = entries.length;
    if(!entries.length){
      recentListEl.innerHTML = `<div class="empty">Пока пусто — открой вакансию на hh.ru</div>`;
      return;
    }
    const recent=entries.slice(0,5);
    recentListEl.innerHTML = recent.map(e=>`
      <div class="recent-item">
        <a href="${escapeHtml(e.href)}" target="_blank" title="${escapeHtml(e.title)}">${escapeHtml(e.title||e.id)}</a>
        <span class="date">${fmt(e.ts)}</span>
        <button class="x" data-del="${escapeHtml(e.id)}" title="Удалить">×</button>
      </div>
    `).join('') + (entries.length>5?`<div style="text-align:center"><button id="moreBtn" class="link-btn">+ ещё ${entries.length-5}</button></div>`:'');
    recentListEl.querySelectorAll('[data-del]').forEach(b=>{
      b.addEventListener('click', ()=> removeOne(b.dataset.del));
    });
    const more=document.getElementById('moreBtn');
    if(more) more.addEventListener('click', ()=> chrome.tabs.create({url: chrome.runtime.getURL('history.html')}));
  });
}

function removeOne(id){
  chrome.storage.local.get({ hh_history:{} }, (res)=>{
    const map=res.hh_history||{}; delete map[id];
    chrome.storage.local.set({ hh_history: map }, ()=>{
      chrome.runtime.sendMessage({type:'UPDATE_BADGE', count: Object.keys(map).length});
      // сообщим контент-скриптам снять подсветку
      chrome.tabs.query({url:'https://*.hh.ru/*'}, (tabs)=>{
        tabs.forEach(t=> chrome.tabs.sendMessage(t.id,{type:'REMOVE_ONE', id}).catch(()=>{}));
      });
      loadHistory();
    });
  });
}

enabledEl.addEventListener('change', ()=> save({ hh_enabled: enabledEl.checked }));
colorEl.addEventListener('input', ()=>{
  const v=colorEl.value; colorTextEl.value=v; updatePreview(v); save({ hh_color: v });
});
colorTextEl.addEventListener('input', ()=>{
  let v=colorTextEl.value.trim(); if(!v.startsWith('#')) v='#'+v;
  if(/^#[0-9a-fA-F]{6}$/.test(v)){ colorEl.value=v; updatePreview(v); save({ hh_color: v }); }
});
document.querySelectorAll('.preset').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const c=btn.dataset.color; colorEl.value=c; colorTextEl.value=c; updatePreview(c); save({ hh_color: c });
  });
});
openHistoryBtn.addEventListener('click', ()=> chrome.tabs.create({url: chrome.runtime.getURL('history.html')}));
clearBtn.addEventListener('click', ()=>{
  chrome.storage.local.get({ hh_history:{} }, (res)=>{
    const n=Object.keys(res.hh_history||{}).length;
    if(!n) return;
    if(!confirm(`Очистить всю историю (${n})?`)) return;
    chrome.storage.local.set({ hh_history:{} }, ()=>{
      chrome.tabs.query({url:'https://*.hh.ru/*'}, (tabs)=>{
        tabs.forEach(t=> chrome.tabs.sendMessage(t.id,{type:'CLEAR'}).catch(()=>{}));
      });
      chrome.runtime.sendMessage({type:'UPDATE_BADGE', count:0});
      loadHistory();
    });
  });
});

loadSettings();
loadHistory();
