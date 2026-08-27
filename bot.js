import { readFileSync, writeFileSync, existsSync } from "fs";
import { createInterface } from "readline";

// Загрузчик .env без зависимостей, чтобы бот запускался любым способом.
try {
  const raw = readFileSync(".env", "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {}

let TELEGRAM_API = "";

// Если ключей нет — спрашиваем один раз и сохраняем в .env.
async function ensureKeys() {
  const missing = [];
  if (!process.env.TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
  if (!process.env.GEMINI_API_KEY) missing.push("GEMINI_API_KEY");

  if (missing.length === 0) {
    TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));
  console.log("Ключи не найдены. Введи их один раз — сохраню в .env:");
  for (const key of missing) {
    const val = (await ask(`${key}: `)).trim();
    process.env[key] = val;
  }
  rl.close();

  const toSave = missing.map((k) => `${k}=${process.env[k]}`);
  if (existsSync(".env")) {
    const cur = readFileSync(".env", "utf8");
    const have = new Set(cur.split("\n").map((l) => l.split("=")[0].trim()));
    const add = toSave.filter((l) => !have.has(l.split("=")[0].trim()));
    if (add.length) writeFileSync(".env", cur.replace(/\s*$/, "") + "\n" + add.join("\n") + "\n");
  } else {
    writeFileSync(".env", toSave.join("\n") + "\n");
  }
  TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
}

const GEMINI_MODEL = "gemini-2.0-flash";
let offset = 0;

async function sendTelegram(chatId, text) {
  const safe = String(text).slice(0, 4000);
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: safe }),
  }).catch(() => {});
}

async function askGemini(prompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) {
    if (data?.error) console.error("Gemini error:", data.error);
    return "Не удалось получить ответ от ИИ.";
  }
  return out;
}

async function handle(text, chatId) {
  if (text === "/start") {
    return "Привет! Я ИИ-бот на Gemini. Пиши мне что угодно — отвечу.";
  }
  if (text.startsWith("/")) {
    return "Не знаю такой команды. Просто напиши сообщение — я отвечу через ИИ.";
  }
  return await askGemini(text);
}

async function poll() {
  try {
    const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=30`);
    const data = await res.json();
    if (!data.ok) {
      console.error("getUpdates error:", data);
      return;
    }
    for (const upd of data.result || []) {
      offset = upd.update_id + 1;
      const msg = upd.message;
      if (msg?.text && msg?.chat?.id) {
        const reply = await handle(msg.text, msg.chat.id);
        await sendTelegram(msg.chat.id, reply);
      }
    }
  } catch (e) {
    console.error("poll error:", e);
  }
}

async function main() {
  await ensureKeys();
  // Сбрасываем webhook, чтобы long polling (getUpdates) точно работал.
  try {
    await fetch(`${TELEGRAM_API}/deleteWebhook`);
  } catch {}

  console.log("Бот запущен (long polling). Ctrl+C — остановить.");
  poll();
  setInterval(poll, 1000);
}

main();
