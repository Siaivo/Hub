import { CATEGORY_LABELS } from './i18n.js';

const grid = document.getElementById('grid');
const counter = document.getElementById('counter');
const searchInput = document.getElementById('search');
const clearBtn = document.getElementById('clear-search');
const chips = [...document.querySelectorAll('.chip')];
const stateEmpty = document.getElementById('state-empty');
const stateError = document.getElementById('state-error');
const toastEl = document.getElementById('toast');
const resetBtn = document.getElementById('reset-filters');
const retryBtn = document.getElementById('retry-load');
const deadBtn = document.getElementById('toggle-dead');

let allData = [];
let q = '';
let category = 'all';
let showDead = false;
let toastTimer = 0;
let copyTimerMap = new WeakMap();

const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);

function getParams() {
  const p = new URLSearchParams(location.search);
  return { q: p.get('q') || '', category: p.get('category') || 'all' };
}

function syncUrl() {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (category !== 'all') p.set('category', category);
  const qs = p.toString();
  history.replaceState(null, '', qs ? '?' + qs : location.pathname);
}

function debounce(fn, ms) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function showToast(msg, isError = false) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.toggle('is-error', isError);
  toastEl.hidden = false;
  // force reflow for transition
  toastEl.offsetHeight;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => { toastEl.hidden = true; }, 220);
  }, 1800);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  // fallback
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

function esc(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderSkeleton() {
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = Array.from({ length: 6 }, () => `
    <div class="skeleton" aria-hidden="true">
      <div class="sk-line h-20 w-60"></div>
      <div class="sk-line w-90"></div>
      <div class="sk-line w-90"></div>
      <div class="sk-line w-40"></div>
    </div>`).join('');
}

function filterData() {
  const needle = q.trim().toLowerCase();
  return allData.filter(item => {
    if (showDead && !item.dead) return false;
    if (!showDead && item.dead) return false;
    if (category !== 'all' && item.category !== category) return false;
    if (!needle) return true;
    return item.name.toLowerCase().includes(needle) || item.author.toLowerCase().includes(needle);
  });
}

const DEAD_ICON = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16" class="dead-icon" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.91" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"><path d="M18.68 5.32h1.91A1.9 1.9 0 0 1 22.5 7.23v9.54a1.9 1.9 0 0 1-1.91 1.91H3.41A1.9 1.9 0 0 1 1.5 16.77V7.23A1.9 1.9 0 0 1 3.41 5.32H6.27"/><path d="M16.77 5.8a4.3 4.3 0 1 0-6.68 3.57v1.68h4.77V9.37A4.32 4.32 0 0 0 16.77 5.8Z"/><circle cx="11.05" cy="6.27" r="0.95" fill="currentColor" stroke="none"/><circle cx="13.91" cy="6.27" r="0.95" fill="currentColor" stroke="none"/><line x1="12" y1="22.5" x2="12" y2="18.68"/><line x1="16.77" y1="22.5" x2="7.23" y2="22.5"/></svg>';

function cardHtml(item) {
  const catLabel = CATEGORY_LABELS[item.category] || item.category;
  const catKey = item.category || 'all';
  const siaivoIcon = item.siaivo ? '<img src="./assets/siaivo-logo.svg" alt="" class="siaivo-icon" title="Плагін від Siaivo" width="18" height="17">' : '';
  const deadIcon = item.dead ? DEAD_ICON : '';
  return `
  <article class="card${item.dead ? ' card-dead' : ''}">
    <div class="card-top">
      <h3>${deadIcon}${siaivoIcon}${esc(item.name)}</h3>
      <span class="category-badge" data-cat="${esc(catKey)}">${esc(catLabel)}</span>
    </div>
    <p class="card-desc" title="${esc(item.description)}">${esc(item.description)}</p>
    <small class="card-author">Автор: <span>${esc(item.author)}</span></small>
    <a class="card-url" href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.url)}</a>
    <div class="card-actions">
      <button type="button" class="btn btn-primary" data-copy-url="${esc(item.url)}" aria-label="Копіювати посилання ${esc(item.name)}">Копіювати посилання</button>
      <button type="button" class="btn btn-secondary" data-copy-lampac="${esc(item.url)}" aria-label="Копіювати для Lampac ${esc(item.name)}">Копіювати для Lampac</button>
    </div>
  </article>`;
}

function render() {
  const filtered = filterData();
  counter.textContent = `Знайдено: ${filtered.length}`;
  grid.setAttribute('aria-busy', 'false');

  if (!filtered.length) {
    // distunguish empty vs initial - if we have data but filter yields 0 -> empty state
    if (allData.length) {
      grid.innerHTML = '';
      stateEmpty.hidden = false;
      stateError.hidden = true;
    } else {
      // no data at all (edge)
      grid.innerHTML = '';
      stateEmpty.hidden = false;
      stateError.hidden = true;
    }
    return;
  }

  stateEmpty.hidden = true;
  stateError.hidden = true;
  grid.innerHTML = filtered.map(cardHtml).join('');

  // wire copy buttons
  grid.querySelectorAll('[data-copy-url]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.getAttribute('data-copy-url');
      const ok = await copyText(url);
      if (ok) flashCopied(btn); else showToast('Не вдалося скопіювати', true);
      if (ok) showToast('Скопійовано ✓');
    });
  });
  grid.querySelectorAll('[data-copy-lampac]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.getAttribute('data-copy-lampac');
      const payload = JSON.stringify({ url, status: 1 });
      const ok = await copyText(payload);
      if (ok) flashCopied(btn); else showToast('Не вдалося скопіювати', true);
      if (ok) showToast('Скопійовано ✓');
    });
  });
}

function flashCopied(btn) {
  const orig = btn.textContent;
  const prev = copyTimerMap.get(btn);
  if (prev) clearTimeout(prev);
  btn.textContent = 'Скопійовано ✓';
  btn.classList.add('is-copied');
  const t = setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove('is-copied');
  }, 1700);
  copyTimerMap.set(btn, t);
}

function applyChips() {
  chips.forEach(c => {
    const active = c.dataset.category === category;
    c.classList.toggle('is-active', active);
    c.setAttribute('aria-pressed', String(active));
  });
}

function updateSearchUi() {
  clearBtn.hidden = !searchInput.value;
}

async function load() {
  renderSkeleton();
  stateEmpty.hidden = true;
  stateError.hidden = true;
  try {
    const res = await fetch('./data/base.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('base.json must be array');
    allData = data;
    render();
  } catch (e) {
    grid.innerHTML = '';
    grid.setAttribute('aria-busy', 'false');
    counter.textContent = 'Знайдено: —';
    stateError.hidden = false;
    stateEmpty.hidden = true;
    console.error(e);
  }
}

// init from URL
{
  const p = getParams();
  q = p.q;
  category = CATEGORY_KEYS.includes(p.category) ? p.category : (p.category === 'all' ? 'all' : 'all');
  searchInput.value = q;
  updateSearchUi();
  applyChips();
}

// events
deadBtn.addEventListener('click', () => {
  showDead = !showDead;
  deadBtn.classList.toggle('is-active', showDead);
  deadBtn.setAttribute('aria-pressed', String(showDead));
  render();
});

const onSearch = debounce(() => {
  q = searchInput.value;
  updateSearchUi();
  syncUrl();
  render();
}, 200);

searchInput.addEventListener('input', onSearch);
searchInput.addEventListener('search', () => { // native clear (webkit)
  q = searchInput.value;
  updateSearchUi();
  syncUrl();
  render();
});

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  q = '';
  updateSearchUi();
  syncUrl();
  render();
  searchInput.focus();
});

chips.forEach(chip => {
  chip.addEventListener('click', () => {
    category = chip.dataset.category;
    applyChips();
    syncUrl();
    render();
  });
});

resetBtn.addEventListener('click', () => {
  q = '';
  category = 'all';
  showDead = false;
  searchInput.value = '';
  updateSearchUi();
  applyChips();
  deadBtn.classList.remove('is-active');
  deadBtn.setAttribute('aria-pressed', 'false');
  syncUrl();
  render();
});

retryBtn.addEventListener('click', load);

load();
