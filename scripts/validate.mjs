import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const basePath = path.join(root, 'data', 'base.json');
const schemaPath = path.join(root, 'data', 'schema.json');

const ALLOWED = new Set(['id', 'name', 'description', 'url', 'author', 'category', 'siaivo']);
const CATEGORIES = new Set(['video', 'iptv', 'theme', 'control', 'collections', 'tracks', 'radio', 'other']);
const ID_RE = /^[A-Za-z0-9._-]+$/;
const checkUrl = process.argv.includes('--check-url');

function fail(msg) {
  console.error(msg);
}

let baseRaw, schemaRaw;
try {
  baseRaw = fs.readFileSync(basePath, 'utf8');
} catch (e) {
  fail(`❌ Не вдалося прочитати ${basePath}: ${e.message}`);
  process.exit(1);
}
try {
  schemaRaw = fs.readFileSync(schemaPath, 'utf8');
} catch (e) {
  fail(`❌ Не вдалося прочитати ${schemaPath}: ${e.message}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(baseRaw);
} catch (e) {
  fail(`❌ data/base.json — невалідний JSON: ${e.message}`);
  process.exit(1);
}
try {
  JSON.parse(schemaRaw);
} catch (e) {
  fail(`❌ data/schema.json — невалідний JSON: ${e.message}`);
  process.exit(1);
}

const errors = [];

if (!Array.isArray(data)) {
  fail('❌ data/base.json має бути масивом');
  process.exit(1);
}

// case-insensitive uniqueness maps: lower -> first index
const seenIds = new Map();
const seenNames = new Map();

for (let i = 0; i < data.length; i++) {
  const entry = data[i];
  const prefix = `[${i}]${entry && entry.id ? ` id="${entry.id}"` : ''}`;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`${prefix}: запис має бути об'єктом`);
    continue;
  }

  // required
  for (const field of ['id', 'name', 'description', 'url', 'author', 'category']) {
    if (!(field in entry)) {
      errors.push(`${prefix}: відсутнє обов'язкове поле "${field}"`);
    }
  }

  // additionalProperties
  for (const key of Object.keys(entry)) {
    if (!ALLOWED.has(key)) {
      errors.push(`${prefix}: зайве поле "${key}" (additionalProperties: false)`);
    }
  }

  // id
  if ('id' in entry) {
    const v = entry.id;
    if (typeof v !== 'string') errors.push(`${prefix} id: має бути рядком`);
    else if (v.length < 2 || v.length > 60) errors.push(`${prefix} id: довжина 2-60 (зараз ${v.length})`);
    else if (!ID_RE.test(v)) errors.push(`${prefix} id: має відповідати ^[A-Za-z0-9._-]+$ (значення: "${v}")`);
    if (typeof v === 'string') {
      const low = v.toLowerCase();
      if (seenIds.has(low)) errors.push(`${prefix} id: дублікат case-insensitive з [${seenIds.get(low)}] ("${v}")`);
      else seenIds.set(low, i);
    }
  }

  // name
  if ('name' in entry) {
    const v = entry.name;
    if (typeof v !== 'string') errors.push(`${prefix} name: має бути рядком`);
    else if (v.length < 2 || v.length > 60) errors.push(`${prefix} name: довжина 2-60 (зараз ${v.length})`);
    if (typeof v === 'string') {
      const low = v.toLowerCase();
      if (seenNames.has(low)) errors.push(`${prefix} name: дублікат case-insensitive з [${seenNames.get(low)}] ("${v}")`);
      else seenNames.set(low, i);
    }
  }

  // description
  if ('description' in entry) {
    const v = entry.description;
    if (typeof v !== 'string') errors.push(`${prefix} description: має бути рядком`);
    else if (v.length < 20 || v.length > 300) errors.push(`${prefix} description: довжина 20-300 (зараз ${v.length})`);
  }

  // url
  if ('url' in entry) {
    const v = entry.url;
    if (typeof v !== 'string') errors.push(`${prefix} url: має бути рядком`);
    else {
      if (!/^https?:\/\//.test(v)) errors.push(`${prefix} url: має починатися з http:// або https:// (значення: "${v}")`);
      try {
        const u = new URL(v);
        if (u.protocol !== 'https:') errors.push(`${prefix} url: протокол має бути https:`);
      } catch {
        errors.push(`${prefix} url: невалідний URI ("${v}")`);
      }
    }
  }

  // author
  if ('author' in entry) {
    const v = entry.author;
    if (typeof v !== 'string') errors.push(`${prefix} author: має бути рядком`);
    else if (v.trim().length < 2) errors.push(`${prefix} author: minLength 2 (зараз ${v.trim().length})`);
  }

  // category
  if ('category' in entry) {
    const v = entry.category;
    if (typeof v !== 'string') errors.push(`${prefix} category: має бути рядком`);
    else if (!CATEGORIES.has(v)) errors.push(`${prefix} category: має бути одним з [${[...CATEGORIES].join(', ')}] (значення: "${v}")`);
  }
}

if (errors.length) {
  for (const e of errors) fail(`  ✗ ${e}`);
  fail(`\n❌ Валідація провалена: ${errors.length} помилок`);
  process.exit(1);
}

if (checkUrl) {
  console.log('🔍 Перевірка доступності URL (HEAD)...');
  let urlErrors = 0;
  for (let i = 0; i < data.length; i++) {
    const url = data[i].url;
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (!res.ok) {
        fail(`  ✗ [${i}] ${url} → HTTP ${res.status}`);
        urlErrors++;
      } else {
        console.log(`  ✓ [${i}] ${url} → ${res.status}`);
      }
    } catch (e) {
      fail(`  ✗ [${i}] ${url} → fetch error: ${e.message}`);
      urlErrors++;
    }
  }
  if (urlErrors) {
    fail(`\n❌ URL перевірка провалена: ${urlErrors} помилок`);
    process.exit(1);
  }
}

console.log(`✅ OK — ${data.length} запис(ів) валідні`);
