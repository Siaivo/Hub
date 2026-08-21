#!/usr/bin/env node
/**
 * on-approved.mjs — обробка мітки approved
 * Парсить issue body через parse-issue.mjs, валідує, додає в data/base.json,
 * комітить, створює PR.
 *
 * Використання в CI:
 *   ISSUE_NUMBER=123 node scripts/on-approved.mjs
 *   або з GH CLI / API в on-approved.yml
 *
 * Змінні: GH_TOKEN/GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { parseIssueBody, buildEntry, slugify } from './parse-issue.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY || '';

function apiHeaders(extra = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'PluginHub-on-approved',
    ...extra,
  };
}

async function ghFetch(p, opts = {}) {
  const API = 'https://api.github.com';
  const url = p.startsWith('http') ? p : `${API}${p}`;
  const res = await fetch(url, { ...opts, headers: { ...apiHeaders(), ...(opts.headers || {}) } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${opts.method || 'GET'} ${url} → ${res.status} ${t.slice(0, 800)}`);
  }
  return res;
}

async function getIssue(number) {
  const [owner, repo] = REPO.split('/');
  const res = await ghFetch(`/repos/${owner}/${repo}/issues/${number}`);
  return res.json();
}

async function postComment(number, body) {
  const [owner, repo] = REPO.split('/');
  await ghFetch(`/repos/${owner}/${repo}/issues/${number}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

async function setLabels(number, labels) {
  const [owner, repo] = REPO.split('/');
  // PUT replaces all labels — use POST /labels to add; here we PUT to keep full set
  // Для додавання invalid без втрати інших — спочатку читаємо, потім PUT
  const issue = await getIssue(number);
  const current = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const next = [...new Set([...current, ...labels])];
  await ghFetch(`/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels: next }),
  });
}

async function removeLabel(number, name) {
  const [owner, repo] = REPO.split('/');
  await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: apiHeaders(),
  });
}

async function closeIssue(number) {
  const [owner, repo] = REPO.split('/');
  await ghFetch(`/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
  });
}

function validateEntry(entry, existing) {
  const ALLOWED = new Set(['id', 'name', 'description', 'url', 'author', 'category']);
  const CATEGORIES = new Set(['styles', 'content', 'media', 'external-services', 'developers']);
  const ID_RE = /^[A-Za-z0-9._-]+$/;
  const errors = [];

  for (const k of Object.keys(entry)) if (!ALLOWED.has(k)) errors.push(`зайве поле "${k}"`);

  for (const f of ['id', 'name', 'description', 'url', 'author', 'category'])
    if (!(f in entry) || !String(entry[f] || '').trim()) errors.push(`відсутнє поле "${f}"`);

  if (entry.id) {
    if (entry.id.length < 2 || entry.id.length > 60) errors.push(`id: довжина 2-60 (зараз ${entry.id.length})`);
    if (!ID_RE.test(entry.id)) errors.push(`id: має відповідати ^[A-Za-z0-9._-]+$ ("${entry.id}")`);
  }
  if (entry.name && (entry.name.length < 2 || entry.name.length > 60)) errors.push(`name: довжина 2-60 (зараз ${entry.name.length})`);
  if (entry.description && (entry.description.length < 20 || entry.description.length > 300))
    errors.push(`description: довжина 20-300 (зараз ${entry.description.length})`);
  if (entry.url) {
    if (!entry.url.startsWith('https://')) errors.push(`url: має починатися з https://`);
    try {
      const u = new URL(entry.url);
      if (u.protocol !== 'https:') errors.push(`url: протокол має бути https:`);
    } catch {
      errors.push(`url: невалідний URI`);
    }
  }
  if (entry.author && entry.author.trim().length < 2) errors.push(`author: minLength 2`);
  if (entry.category && !CATEGORIES.has(entry.category))
    errors.push(`category: має бути одним з [${[...CATEGORIES].join(', ')}] (значення: "${entry.category}")`);

  // Унікальність case-insensitive
  const lowId = (entry.id || '').toLowerCase();
  const lowName = (entry.name || '').toLowerCase();
  for (const e of existing) {
    if ((e.id || '').toLowerCase() === lowId) errors.push(`дублікат id (case-insensitive): "${entry.id}" вже існує`);
    if ((e.name || '').toLowerCase() === lowName) errors.push(`дублікат name (case-insensitive): "${entry.name}" вже існує`);
  }

  return errors;
}

function sh(cmd, opts = {}) {
  const { allowFail, ...execOpts } = opts;
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...execOpts });
  } catch (e) {
    if (allowFail) return { exitCode: e.status || 1, stdout: e.stdout || '', stderr: e.stderr || '' };
    throw e;
  }
}

async function addToBaseAndPR(issueNumber, entry) {
  const basePath = path.join(root, 'data', 'base.json');
  const raw = fs.readFileSync(basePath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('data/base.json має бути масивом');

  data.push(entry);
  // Сортування за name (locale, case-insensitive аналог — за lower)
  data.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  fs.writeFileSync(basePath, JSON.stringify(data, null, 2) + '\n', 'utf8');

  // Валідація через існуючий скрипт (той же що й у validate-pr.yml)
  try {
    sh('node scripts/validate.mjs', { cwd: root });
  } catch (e) {
    // rollback файлу
    fs.writeFileSync(basePath, raw, 'utf8');
    throw new Error(`validate.mjs провалився:\n${(e.stdout || '') + (e.stderr || '')}`);
  }

  const branch = `plugin/add-${entry.id}-${issueNumber}`;
  const [owner, repo] = REPO.split('/');

  // Перевірити чи вже існує PR (відкритий або закритий) для цієї гілки
  for (const state of ['open', 'closed']) {
    const existingPrRes = await ghFetch(`/repos/${owner}/${repo}/pulls?state=${state}&head=${owner}:${branch}&base=main`);
    const existingPrs = await existingPrRes.json();
    if (Array.isArray(existingPrs) && existingPrs.length > 0) {
      const existingPr = existingPrs[0];
      if (existingPr.merged) {
        throw new Error(`PR #${existingPr.number} вже замержено — ${entry.id} вже в реєстрі`);
      }
      return { html_url: existingPr.html_url, number: existingPr.number };
    }
  }

  // git
  try {
    sh(`git checkout -b ${branch}`, { cwd: root });
  } catch {
    sh(`git checkout ${branch}`, { cwd: root });
  }
  sh(`git config user.name "github-actions[bot]"`, { cwd: root });
  sh(`git config user.email "github-actions[bot]@users.noreply.github.com"`, { cwd: root });
  sh(`git add data/base.json`, { cwd: root });
  const diffCheck = sh(`git diff --cached --quiet`, { cwd: root, allowFail: true });
  if (diffCheck.exitCode === 0) {
    console.log('⚠️  Немає змін у base.json — пропускаємо коміт');
    return { html_url: '', number: 0, noChanges: true };
  }
  sh(`git commit -m "feat: add ${entry.id} from #${issueNumber}"`, { cwd: root });
  sh(`git push --force-with-lease -u origin ${branch}`, { cwd: root });

  // Створити PR через API
  const prRes = await ghFetch(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `feat: add ${entry.name} (#${issueNumber})`,
      head: branch,
      base: 'main',
      body: `Автоматично з issue #${issueNumber}\n\nЗапис:\n\`\`\`json\n${JSON.stringify(entry, null, 2)}\n\`\`\`\n\nCloses #${issueNumber}`,
    }),
  });
  const pr = await prRes.json();

  if (!pr.number) {
    throw new Error(`Не вдалося створити PR: ${JSON.stringify(pr).slice(0, 500)}`);
  }

  // Автоматичний merge
  console.log(`🔀 Мерж PR #${pr.number}...`);
  const mergeRes = await ghFetch(`/repos/${owner}/${repo}/pulls/${pr.number}/merge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merge_method: 'squash',
      commit_title: `feat: add ${entry.id} (#${issueNumber})`,
      commit_message: `Додано плагін ${entry.name} з issue #${issueNumber}`,
    }),
  });
  const mergeData = await mergeRes.json();
  console.log(`✅ PR #${pr.number} замержено: ${mergeData.merged}`);

  // Видалити гілку після мержу
  try {
    await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, { method: 'DELETE' });
    console.log(`🗑️ Гілка ${branch} видалена`);
  } catch {
    console.log(`⚠️ Не вдалося видалити гілку ${branch}`);
  }

  return pr;
}

async function handleInvalid(issueNumber, reason) {
  console.error(`❌ #${issueNumber} invalid: ${reason}`);
  try {
    await postComment(issueNumber, `❌ Валідація провалена:\n\n\`\`\`\n${reason}\n\`\`\`\n\nВиправте дані й попросіть мейнтейнера знову додати \`approved\`.`);
    await setLabels(issueNumber, ['invalid']);
    await removeLabel(issueNumber, 'approved');
  } catch (e) {
    console.error(`Не вдалося оновити issue #${issueNumber}: ${e.message}`);
  }
}

async function main() {
  const argNum = process.argv.find((a) => /^\d+$/.test(a));
  const issueNumber = parseInt(process.env.ISSUE_NUMBER || argNum || '', 10);
  const issueBodyEnv = process.env.ISSUE_BODY || '';

  if (!TOKEN) {
    console.error('❌ GH_TOKEN / GITHUB_TOKEN не задано');
    process.exit(1);
  }
  if (!REPO || !REPO.includes('/')) {
    console.error('❌ GITHUB_REPOSITORY не задано');
    process.exit(1);
  }
  if (!issueNumber) {
    console.error('Usage: ISSUE_NUMBER=123 GITHUB_REPOSITORY=owner/repo GH_TOKEN=... node scripts/on-approved.mjs');
    process.exit(1);
  }

  let body = issueBodyEnv;
  if (!body) {
    const issue = await getIssue(issueNumber);
    body = issue.body || '';
  }

  // Перевірка що це Issue Form
  const low = (body || '').toLowerCase();
  if (!low.includes('###')) {
    await handleInvalid(issueNumber, 'Issue створено не через Issue Form (немає заголовків ###).');
    process.exit(1);
  }

  let entry;
  try {
    entry = buildEntry(body);
  } catch (e) {
    await handleInvalid(issueNumber, e.message);
    process.exit(1);
  }

  // Базова валідація + унікальність
  const baseRaw = fs.readFileSync(path.join(root, 'data', 'base.json'), 'utf8');
  const existing = JSON.parse(baseRaw);
  const errors = validateEntry(entry, existing);
  if (errors.length) {
    await handleInvalid(issueNumber, errors.join('\n'));
    process.exit(1);
  }

  // Створити гілку, коміт, PR
  try {
    const pr = await addToBaseAndPR(issueNumber, entry);
    if (pr.noChanges) {
      console.log('⚠️  Запис вже є в реєстрі — нічого не змінено');
      await postComment(issueNumber, `⚠️ Запис \`${entry.id}\` вже є в реєстрі. Нічого не змінено.`);
      await setLabels(issueNumber, ['merged']);
      await closeIssue(issueNumber);
    } else {
      console.log(`✅ PR створено та замержено: ${pr.html_url} (#${pr.number})`);
      await postComment(issueNumber, `✅ Плагін \`${entry.id}\` додано в реєстр!\n\nPR: ${pr.html_url} (#${pr.number})\n\nСайт оновиться найближчим часом.`);
      await setLabels(issueNumber, ['merged']);
      await closeIssue(issueNumber);
    }
  } catch (e) {
    const msg = e.message || String(e);
    if (msg.includes('вже замержено')) {
      await postComment(issueNumber, `✅ ${msg}`);
      await setLabels(issueNumber, ['merged']);
      await closeIssue(issueNumber);
      process.exit(0);
    }
    if (msg.includes('already exists') || msg.includes('pull request already exists')) {
      await postComment(issueNumber, `⚠️ PR вже існує або гілка зайнята: ${msg.slice(0, 800)}`);
      console.error(msg);
      process.exit(0);
    }
    await handleInvalid(issueNumber, msg.slice(0, 2000));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

export { validateEntry };
