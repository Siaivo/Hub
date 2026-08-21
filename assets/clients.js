const grid = document.getElementById('clients-grid');
const errEl = document.getElementById('clients-error');
const toastEl = document.getElementById('toast');
const retryBtn = document.getElementById('retry-clients');

const SVG_ICONS = {
  web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></svg>',
  android: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="7" width="14" height="11" rx="2"/><path d="M9 7V5"/><path d="M15 7V5"/><circle cx="9.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M9 15c1.2 1 2.8 1 4 0"/></svg>',
  windows: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9 21h6"/><path d="M12 18v3"/></svg>',
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><circle cx="8" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="1" fill="currentColor" stroke="none"/></svg>',
};
const ICONS = SVG_ICONS;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showToast(msg, isError = false) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.toggle('is-error', isError);
  toastEl.hidden = false;
  toastEl.offsetHeight;
  toastEl.classList.add('show');
  setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => { toastEl.hidden = true; }, 220);
  }, 1800);
}

function badgeHtml(id) {
  if (id === 'tizen-webos') return '<span class="badge badge-sideload">Потрібен sideload</span>';
  if (id === 'web' || id === 'android' || id === 'windows') return '<span class="badge badge-recommended">Рекомендовано</span>';
  return '';
}

function deepLinks() {
  const p = new URLSearchParams(location.search);
  return p.get('highlight') || location.hash.replace('#','') || '';
}

function cardHtml(c) {
  const iconChar = ICONS[c.icon] || SVG_ICONS.server;
  const badge = badgeHtml(c.id);
  const steps = (c.steps || []).map(s => `<li>${esc(s)}</li>`).join('');
  const links = [];
  if (c.links?.download) links.push(`<a class="btn btn-primary" href="${esc(c.links.download)}" target="_blank" rel="noopener">Завантажити</a>`);
  if (c.links?.docs) links.push(`<a class="btn btn-secondary" href="${esc(c.links.docs)}" target="_blank" rel="noopener">Документація</a>`);

  return `
  <article class="card client-card" id="${esc(c.id)}">
    <div class="client-head">
      <span class="client-icon" aria-hidden="true">${iconChar}</span>
      <h3>${esc(c.title)}</h3>
      ${badge}
    </div>
    ${c.audience ? `<p class="client-audience">Для кого: <span>${esc(c.audience)}</span></p>` : ''}
    <ol class="client-steps">${steps}</ol>
    ${c.os_requirements ? `<p class="os-req">Вимоги: ${esc(c.os_requirements)}</p>` : ''}
    ${links.length ? `<div class="client-links">${links.join('')}</div>` : ''}
    <details class="client-details">
      <summary aria-expanded="false">Як додати плагіни</summary>
      <div class="details-body">
        <p>Після встановлення клієнта перейди в <a href="./index.html">каталог</a>, скопіюй URL плагіна та встав його в налаштуваннях клієнта. Після перезапуску плагін зʼявиться у списку.</p>
      </div>
    </details>
  </article>`;
}

async function load() {
  if (!grid) return;
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = '';
  if (errEl) errEl.hidden = true;
  try {
    const res = await fetch('./data/clients.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('clients.json must be array');
    // minimal validation
    for (const c of data) {
      if (!c.id || !c.title || !Array.isArray(c.steps)) throw new Error('invalid entry: ' + JSON.stringify(c).slice(0,120));
    }
    grid.innerHTML = data.map(cardHtml).join('');
    grid.setAttribute('aria-busy', 'false');

    // wire details aria-expanded
    grid.querySelectorAll('details.client-details').forEach(d => {
      const s = d.querySelector('summary');
      const sync = () => s.setAttribute('aria-expanded', String(d.open));
      d.addEventListener('toggle', sync);
      sync();
    });

    // highlight
    const hl = new URLSearchParams(location.search).get('highlight');
    if (hl) {
      const el = document.getElementById(hl);
      if (el) {
        el.classList.add('is-highlight');
        // smooth scroll if hash not already handling it
        if (!location.hash) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else if (location.hash.slice(1) === hl) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) el.classList.add('is-highlight');
    }

    // hash change highlight
    window.addEventListener('hashchange', () => {
      grid.querySelectorAll('.client-card.is-highlight').forEach(e => e.classList.remove('is-highlight'));
      const id = location.hash.slice(1);
      const el = document.getElementById(id);
      if (el) el.classList.add('is-highlight');
    });
  } catch (e) {
    grid.setAttribute('aria-busy', 'false');
    if (errEl) errEl.hidden = false;
    console.error(e);
    showToast('Не вдалося завантажити clients.json', true);
  }
}

if (retryBtn) retryBtn.addEventListener('click', load);
load();
