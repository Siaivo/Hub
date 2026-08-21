const grid = document.getElementById('portals-grid');
const errEl = document.getElementById('portals-error');
const toastEl = document.getElementById('toast');
const retryBtn = document.getElementById('retry-portals');

const BADGE = {
  clean: { label: 'Чистий', cls: 'badge-recommended' },
  mirror: { label: 'Дзеркало', cls: 'badge-sideload' },
  community: { label: 'Спільноти', cls: 'badge-community' },
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

async function copyText(text, okMsg) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else throw new Error('no clipboard');
    showToast(okMsg || 'Скопійовано ✓');
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast(okMsg || 'Скопійовано ✓');
      return true;
    } catch {
      showToast('Не вдалося скопіювати', true);
      return false;
    }
  }
}

function cardHtml(p) {
  const b = BADGE[p.badge] || { label: esc(p.badge || ''), cls: '' };
  const mirrors = Array.isArray(p.mirrors) ? p.mirrors.filter(Boolean) : [];
  // For siaivo: first mirror is canonical url itself — don't duplicate
  const extraMirrors = mirrors.filter((m) => m !== p.url);
  const hasMirrors = extraMirrors.length > 0;
  const mirrorsHtml = hasMirrors
    ? extraMirrors.length <= 3
      ? `<div class="mirrors-row" aria-label="Дзеркала">${extraMirrors.map((m) => `<span class="mirror-chip">${esc(m)}</span>`).join('')}</div>`
      : `<details class="mirror-details"><summary>Показати дзеркала (${extraMirrors.length})</summary><div class="mirrors-row">${extraMirrors.map((m) => `<span class="mirror-chip">${esc(m)}</span>`).join('')}</div></details>`
    : '';

  return `
  <article class="card portal-card" id="portals-${esc(p.id)}">
    <div class="portal-head">
      <h3>${esc(p.title)}</h3>
      <span class="badge ${esc(b.cls)}">${esc(b.label)}</span>
    </div>
    <div class="portal-url-row">
      <a class="portal-url" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>
      <button type="button" class="btn btn-secondary btn-copy" data-copy="${esc(p.url)}" aria-label="Копіювати URL ${esc(p.title)}">Копіювати</button>
    </div>
    ${hasMirrors ? `<p class="portal-mirrors-label">Дзеркала:</p>${mirrorsHtml}` : ''}
    ${p.description ? `<p class="portal-desc">${esc(p.description)}</p>` : ''}
    ${p.note ? `<p class="portal-note">${esc(p.note)}</p>` : ''}
    <div class="portal-foot">
      <a href="./index.html">Перейти в каталог</a>
      <span class="dot" aria-hidden="true">·</span>
      <a href="./clients.html">Як підключити → Клієнти</a>
    </div>
  </article>`;
}

async function load() {
  if (!grid) return;
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = '';
  if (errEl) errEl.hidden = true;
  try {
    const res = await fetch('./data/portals.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('portals.json must be array');
    for (const p of data) {
      if (!p.id || !p.title || !p.url) throw new Error('invalid portal: ' + JSON.stringify(p).slice(0, 120));
      if (!/^https?:\/\//.test(p.url)) throw new Error('invalid URL: ' + p.url);
    }
    grid.innerHTML = data.map(cardHtml).join('');
    grid.setAttribute('aria-busy', 'false');

    // copy buttons
    grid.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const url = btn.getAttribute('data-copy');
        const ok = await copyText(url, 'Скопійовано ✓');
        if (ok) {
          const prev = btn.textContent;
          btn.textContent = 'Скопійовано ✓';
          btn.classList.add('is-copied');
          setTimeout(() => { btn.textContent = prev; btn.classList.remove('is-copied'); }, 1800);
        }
      });
    });

    // highlight via ?highlight= or #portals-id
    const params = new URLSearchParams(location.search);
    const hl = params.get('highlight') || location.hash.replace(/^#/, '');
    if (hl) {
      const el = document.getElementById(hl) || document.getElementById('portals-' + hl);
      if (el) {
        el.classList.add('is-highlight');
        if (!location.hash || location.hash.slice(1) === hl || hl.startsWith('portals-')) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
    window.addEventListener('hashchange', () => {
      grid.querySelectorAll('.portal-card.is-highlight').forEach((e) => e.classList.remove('is-highlight'));
      const id = location.hash.slice(1);
      const el = document.getElementById(id);
      if (el) el.classList.add('is-highlight');
    });
  } catch (e) {
    grid.setAttribute('aria-busy', 'false');
    if (errEl) errEl.hidden = false;
    console.error(e);
    showToast('Не вдалося завантажити portals.json', true);
  }
}

if (retryBtn) retryBtn.addEventListener('click', load);
load();
