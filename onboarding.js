document.getElementById('pin-hint').addEventListener('click', (e) => {
  e.preventDefault();
  window.close();
  chrome.tabs.update({ url: 'https://hh.ru/search/vacancy' });
});
