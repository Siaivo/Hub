#!/usr/bin/env node
/**
 * vote-tally.mjs — добовий зріз голосування
 * Рахує 👍/👎 для відкритих issue з міткою needs-votes, створених через Issue Form.
 * Додає approved якщо 👍 >= THRESHOLD_APPROVE && 👎 <= LIMIT_REJECT
 * Додає rejected якщо 👎 > LIMIT_REJECT
 */
import process from 'node:process';

const THRESHOLD_APPROVE = parseInt(process.env.THRESHOLD_APPROVE || '10', 10);
const LIMIT_REJECT = parseInt(process.env.LIMIT_REJECT || '5', 10);
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY || '';

if (!TOKEN) {
  console.error('❌ GH_TOKEN / GITHUB_TOKEN не задано');
  process.exit(1);
}
if (!REPO || !REPO.includes('/')) {
  console.error('❌ GITHUB_REPOSITORY не задано (очікується owner/repo)');
  process.exit(1);
}
const [owner, repo] = REPO.split('/');

const API = 'https://api.github.com';
const HEADERS = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${TOKEN}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'PluginHub-vote-tally',
};
const REACTIONS_HEADERS = {
  ...HEADERS,
  Accept: 'application/vnd.github.squirrel-girl-preview+json',
};

async function ghFetch(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || HEADERS), Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${opts.method || 'GET'} ${url} → ${res.status} ${text.slice(0, 500)}`);
  }
  return res;
}

function isIssueForm(body) {
  if (!body || typeof body !== 'string') return false;
  const low = body.toLowerCase();
  if (!low.includes('###')) return false;
  // Перевірка ключових заголовків форми
  const hasName = low.includes('### назва');
  const hasDesc = low.includes('### короткий опис');
  const hasUrl = low.includes('### посилання на плагін');
  return hasName && hasDesc && hasUrl;
}

async function* listOpenNeedsVotes() {
  let page = 1;
  while (true) {
    const res = await ghFetch(`/repos/${owner}/${repo}/issues?state=open&labels=needs-votes&per_page=100&page=${page}`);
    const issues = await res.json();
    if (!Array.isArray(issues) || issues.length === 0) break;
    for (const issue of issues) {
      // Пропустити PR (issues API повертає PR теж)
      if (issue.pull_request) continue;
      yield issue;
    }
    if (issues.length < 100) break;
    page++;
  }
}

async function getReactions(issueNumber) {
  const thumbsUp = new Set();
  const thumbsDown = new Set();
  let page = 1;
  while (true) {
    const res = await fetch(`${API}/repos/${owner}/${repo}/issues/${issueNumber}/reactions?per_page=100&page=${page}`, {
      headers: REACTIONS_HEADERS,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`GET reactions #${issueNumber} → ${res.status} ${t.slice(0, 300)}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    for (const r of data) {
      const uid = r.user && r.user.id;
      if (!uid) continue;
      if (r.content === '+1') thumbsUp.add(uid);
      else if (r.content === '-1') thumbsDown.add(uid);
    }
    if (data.length < 100) break;
    page++;
  }
  return { up: thumbsUp.size, down: thumbsDown.size };
}

async function addLabels(issueNumber, labels) {
  await ghFetch(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels }),
  });
}

async function postComment(issueNumber, body) {
  await ghFetch(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

async function main() {
  console.log(`⚙️  vote-tally: threshold=${THRESHOLD_APPROVE} limit_reject=${LIMIT_REJECT} repo=${owner}/${repo}`);

  let processed = 0;
  let approved = 0;
  let rejected = 0;
  let skipped = 0;

  for await (const issue of listOpenNeedsVotes()) {
    const n = issue.number;
    const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));

    // Пропустити вже оброблені
    if (labels.includes('merged') || labels.includes('rejected') || labels.includes('invalid')) {
      console.log(`#${n} — skip (має merged/rejected/invalid: ${labels.join(',')})`);
      skipped++;
      continue;
    }
    if (labels.includes('approved')) {
      console.log(`#${n} — skip (вже approved)`);
      skipped++;
      continue;
    }

    const body = issue.body || '';
    if (!isIssueForm(body)) {
      console.log(`#${n} — skip (не Issue Form, немає заголовків ### Назва/Опис/Посилання)`);
      skipped++;
      continue;
    }

    let up, down;
    try {
      ({ up, down } = await getReactions(n));
    } catch (e) {
      console.error(`#${n} — помилка отримання reactions: ${e.message}`);
      continue;
    }

    console.log(`#${n} "${issue.title}" — 👍 ${up} 👎 ${down}`);

    try {
      if (up >= THRESHOLD_APPROVE && down <= LIMIT_REJECT) {
        await addLabels(n, ['approved']);
        console.log(`  → ✅ approved (👍 ${up} >= ${THRESHOLD_APPROVE} && 👎 ${down} <= ${LIMIT_REJECT})`);
        approved++;
      } else if (down > LIMIT_REJECT) {
        await addLabels(n, ['rejected']);
        await postComment(
          n,
          `🔴 Автовідхилено: 👎 ${down} > ліміту ${LIMIT_REJECT} (👍 ${up}).\n\n` +
            `Пороги: \`THRESHOLD_APPROVE=${THRESHOLD_APPROVE}\`, \`LIMIT_REJECT=${LIMIT_REJECT}\`. Модератор може переглянути рішення.`,
        );
        console.log(`  → 🔴 rejected (👎 ${down} > ${LIMIT_REJECT})`);
        rejected++;
      } else {
        console.log(`  → ⏳ залишається needs-votes (пороги не досягнуті)`);
      }
    } catch (e) {
      console.error(`  ✗ помилка оновлення #${n}: ${e.message}`);
    }
    processed++;
  }

  console.log(`\nГотово — оброблено: ${processed}, approved: ${approved}, rejected: ${rejected}, пропущено: ${skipped}`);
}

await main();
