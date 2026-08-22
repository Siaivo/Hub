#!/usr/bin/env node
/**
 * check-urls.mjs
 * Перевіряє кожен URL у base.json на доступність.
 * Якщо сервер повертає 404 — ставить dead: true.
 * Оновлює lastChecked для кожного запису.
 * Виводить звіт у stdout та створює .check-dead-changes.json якщо є зміни.
 */

import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_PATH = resolve(__dirname, "../data/base.json");
const CHANGES_PATH = resolve(__dirname, "../.check-dead-changes.json");

const CONCURRENCY = 5; // одночасних запитів
const TIMEOUT = 10; // секунд на кожен запит
const DELAY_MS = 200; // затримка між батчами (щоб не долати)

/**
 * Перевіряє URL через curl -I та повертає HTTP status code.
 * Повертає null якщо запит не вдався (timeout, DNS error тощо).
 */
function checkUrl(url) {
  try {
    const result = execSync(
      `curl -s -o /dev/null -w '%{http_code}' -I --max-time ${TIMEOUT} --connect-timeout 5 "${url}"`,
      { encoding: "utf-8", timeout: (TIMEOUT + 5) * 1000 }
    ).trim();
    const code = parseInt(result, 10);
    return isNaN(code) ? null : code;
  } catch {
    return null;
  }
}

/**
 * Розбиває масив на батчі.
 */
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  console.log("🔍 Читаю base.json...");
  const raw = await readFile(BASE_PATH, "utf-8");
  const entries = JSON.parse(raw);

  console.log(`📋 Знайдено ${entries.length} записів. Починаю перевірку...\n`);

  const now = new Date().toISOString();
  const changes = [];
  const batches = chunk(entries, CONCURRENCY);

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];

    // Паралельна перевірка в батчі
    const results = await Promise.all(
      batch.map(async (entry) => {
        const code = await Promise.resolve(checkUrl(entry.url));
        return { entry, code };
      })
    );

    for (const { entry, code } of results) {
      const wasDead = entry.dead === true;
      const is404 = code === 404;

      if (is404 && !wasDead) {
        entry.dead = true;
        changes.push({ id: entry.id, url: entry.url, action: "marked dead", code });
        console.log(`  💀 ${entry.id} — ${code} → dead: true`);
      } else if (!is404 && wasDead) {
        // Опціонально: якщо раніше був dead але зараз відповідає — воскресити?
        // Поки НЕ воскрешаємо автоматично, лише логуємо
        changes.push({ id: entry.id, url: entry.url, action: "was dead, now alive", code });
        console.log(`  🔄 ${entry.id} — ${code} (was dead, needs manual review)`);
      } else {
        const status = is404 ? "💀 404" : code ? `✅ ${code}` : "⚠️  timeout/error";
        console.log(`  ${status}  ${entry.id}`);
      }

      entry.lastChecked = now;
    }

    // Затримка між батчами
    if (bi < batches.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n📝 Записую оновлення у base.json...`);
  await writeFile(BASE_PATH, JSON.stringify(entries, null, 2) + "\n", "utf-8");

  if (changes.length > 0) {
    await writeFile(CHANGES_PATH, JSON.stringify(changes, null, 2) + "\n", "utf-8");
    console.log(
      `\n⚡ Зміни виявлено (${changes.length}). Деталі у .check-dead-changes.json`
    );
    // Вихідний код 1 сигналізує воркфлоу що є зміни для коміту
    process.exit(1);
  } else {
    console.log("\n✨ Змін немає — всі URL доступні (або статус не змінився).");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("❌ Помилка:", err.message);
  process.exit(2);
});
