import { readFileSync, writeFileSync, existsSync, appendFileSync, unlinkSync } from "fs";
import { createInterface } from "readline";
import { spawnSync } from "child_process";

// --- Логирование и в консоль, и в файл bot.log (чтобы видеть ошибки даже при закрытом окне) ---
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
const fmt = (a) => a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
const stamp = () => `[${new Date().toISOString()}] `;
console.log = (...a) => { _origLog(...a); try { appendFileSync("bot.log", stamp() + fmt(a) + "\n"); } catch {} };
console.error = (...a) => { _origErr(...a); try { appendFileSync("bot.log", stamp() + fmt(a) + "\n"); } catch {} };

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

function isProcessRunning(pid) {
  try {
    const r = spawnSync("tasklist", ["/fi", `PID eq ${pid}`, "/nh"], { encoding: "utf8" });
    return r.stdout.includes(String(pid));
  } catch {
    return false;
  }
}

const LOCK_FILE = ".bot.lock";
function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const pid = parseInt(readFileSync(LOCK_FILE, "utf8").trim(), 10);
    if (pid && isProcessRunning(pid)) {
      console.error(
        `Бот уже запущен (PID ${pid}). Закрой ту копию или заверши node.exe в Диспетчере задач.`,
      );
      process.exit(1);
    }
  }
  writeFileSync(LOCK_FILE, String(process.pid));
  process.on("exit", () => {
    try {
      if (readFileSync(LOCK_FILE, "utf8").trim() === String(process.pid)) unlinkSync(LOCK_FILE);
    } catch {}
  });
}

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

const GEMINI_MODEL = "gemini-3.6-flash";
let offset = 0;
let last409Log = 0;

async function sendTelegram(chatId, text) {
  const safe = String(text).slice(0, 4000);
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: safe }),
  });
  if (!res.ok) console.error("sendMessage HTTP", res.status);
}

async function askGemini(prompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: "Отвечай на том же языке, на котором пишет пользователь. Если пользователь пишет по-русски — отвечай по-русски. Будь дружелюбным и кратким." }],
      },
      generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Gemini HTTP", res.status, JSON.stringify(data));
    return "Ошибка ИИ (HTTP " + res.status + "). Подробности в bot.log.";
  }
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) {
    console.error("Gemini raw response:", JSON.stringify(data));
    return "Не удалось получить ответ от ИИ. Подробности в bot.log.";
  }
  console.log("Gemini ответил:", out.slice(0, 120).replace(/\n/g, " "));
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
      if (data.error_code === 409) {
        const now = Date.now();
        if (now - last409Log > 10000) {
          last409Log = now;
          console.error(
            "409: конфликт getUpdates. Возможно, запущено несколько копий бота " +
              "или висит webhook. Пытаюсь снять webhook...",
          );
        }
        // Пытаемся снять возможный webhook и продолжаем.
        fetch(`${TELEGRAM_API}/deleteWebhook`).catch(() => {});
        return;
      }
      console.error("getUpdates error:", data);
      return;
    }
    for (const upd of data.result || []) {
      offset = upd.update_id + 1;
      const msg = upd.message;
      if (msg?.text && msg?.chat?.id) {
        console.log("Получено от", msg.chat.id, ":", msg.text);
        const reply = await handle(msg.text, msg.chat.id);
        await sendTelegram(msg.chat.id, reply);
      }
    }
  } catch (e) {
    console.error("poll error:", e);
  }
}

async function main() {
  acquireLock();
  await ensureKeys();
  const dw = await fetch(`${TELEGRAM_API}/deleteWebhook`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  console.log("deleteWebhook:", JSON.stringify(dw));

  console.log("Бот запущен (long polling). Ctrl+C — остановить.");
  poll();
  setInterval(poll, 1000);
}

main();
