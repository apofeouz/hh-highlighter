const DEFAULT_BADGE_COLOR = '#d32f2f';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
    // выставим дефолты
    chrome.storage.sync.get({ hh_enabled: true, hh_color: '#d32f2f' }, (res) => {
      chrome.storage.sync.set({ hh_enabled: res.hh_enabled, hh_color: res.hh_color });
    });
  }
  updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.hh_history) updateBadge();
  if (area === 'sync' && changes.hh_enabled) updateBadge();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'UPDATE_BADGE') {
    updateBadge(msg.count);
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === 'GET_HISTORY') {
    chrome.storage.local.get({ hh_history: {} }, (res) => sendResponse(res.hh_history));
    return true;
  }
});

function updateBadge(explicitCount) {
  if (typeof explicitCount === 'number') {
    setBadge(explicitCount);
    return;
  }
  chrome.storage.sync.get({ hh_enabled: true }, (syncRes) => {
    if (!syncRes.hh_enabled) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    chrome.storage.local.get({ hh_history: {} }, (res) => {
      const count = Object.keys(res.hh_history || {}).length;
      // fallback: если истории ещё нет, но есть старый localStorage - покажем 0, бейдж появится после первого визита
      setBadge(count);
    });
  });
}

function setBadge(count) {
  if (!count || count === 0) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    const txt = count > 99 ? '99+' : String(count);
    chrome.action.setBadgeText({ text: txt });
    chrome.action.setBadgeBackgroundColor({ color: DEFAULT_BADGE_COLOR });
  }
}
