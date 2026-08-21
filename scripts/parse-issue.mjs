/**
 * Парсер body issue, створеного через GitHub Issue Form.
 * Форма рендерить кожне поле як:  ### Label\nvalue
 */

const LABEL_MAP = {
  'назва плагіна': 'name',
  'назва': 'name',
  'name': 'name',
  'короткий опис': 'description',
  'опис': 'description',
  'description': 'description',
  'посилання на плагін': 'plugin_url',
  'посилання': 'plugin_url',
  'plugin_url': 'plugin_url',
  'url': 'plugin_url',
  'автор': 'author',
  'author': 'author',
  'категорія': 'category',
  'категория': 'category',
  'category': 'category',
};

export function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    // replace whitespace and underscores sequences with single hyphen
    .replace(/[\s_]+/g, '-')
    // remove anything not in allowed id charset
    .replace(/[^a-z0-9._-]/g, '')
    // collapse multiple hyphens/dots
    .replace(/-+/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^-+|-+$/g, '')
    .replace(/^\.+|\.+$/g, '');
}

function normalizeHeading(h) {
  return h.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Парсить markdown body issue форми.
 * @param {string} body - raw issue body
 * @returns {{ raw: Record<string,string>, name?:string, description?:string, plugin_url?:string, author?:string, category?:string }}
 */
export function parseIssueBody(body) {
  if (typeof body !== 'string') throw new TypeError('body must be string');
  const raw = {};

  // Split by headings ### ...
  const sections = [];
  const lines = body.split('\n');
  let currentHeading = null;
  let currentContent = [];

  function flush() {
    if (currentHeading !== null) {
      const key = normalizeHeading(currentHeading);
      const field = LABEL_MAP[key] || key;
      const value = currentContent.join('\n').trim();
      // take first non-empty; strip "_No response_" placeholder from Issue Forms
      const cleaned = value === '_No response_' ? '' : value;
      // keep first occurrence
      if (!(field in raw)) raw[field] = cleaned;
    }
  }

  for (const line of lines) {
    const m = line.match(/^###\s+(.*)\s*$/);
    if (m) {
      flush();
      currentHeading = m[1];
      currentContent = [];
    } else if (currentHeading !== null) {
      currentContent.push(line);
    }
  }
  flush();

  const result = { ...raw };

  // post-process category: extract first token if dropdown rendered with extra text
  if (result.category) {
    // GitHub dropdown renders just the value, but be safe
    result.category = result.category.trim().toLowerCase().split(/\s+/)[0];
  }
  if (result.plugin_url) result.plugin_url = result.plugin_url.trim().split(/\s+/)[0];

  return result;
}

/**
 * Будує запис для base.json з розпарсеного body.
 * @param {string} body
 * @returns {{id:string,name:string,description:string,url:string,author:string,category:string}}
 */
export function buildEntry(body) {
  const f = parseIssueBody(body);
  if (!f.name) throw new Error('Відсутнє поле: name');
  const id = slugify(f.name);
  return {
    id,
    name: (f.name || '').trim(),
    description: (f.description || '').trim(),
    url: (f.plugin_url || f.url || '').trim(),
    author: (f.author || '').trim(),
    category: (f.category || '').trim(),
  };
}

// CLI usage: echo "$BODY" | node scripts/parse-issue.mjs  OR  node scripts/parse-issue.mjs --body "### ..."
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let body = '';
  if (args.includes('--body')) {
    body = args[args.indexOf('--body') + 1] || '';
  } else if (!process.stdin.isTTY) {
    // read stdin
    let chunks = '';
    process.stdin.setEncoding('utf8');
    for await (const c of process.stdin) chunks += c;
    body = chunks;
  } else if (args.length) {
    body = args.join('\n');
  }

  if (!body) {
    console.error('Usage: node scripts/parse-issue.mjs --body "### Назва плагіна\\n..."');
    console.error('   or: echo "$ISSUE_BODY" | node scripts/parse-issue.mjs');
    process.exit(1);
  }

  try {
    const entry = buildEntry(body);
    console.log(JSON.stringify(entry, null, 2));
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}
