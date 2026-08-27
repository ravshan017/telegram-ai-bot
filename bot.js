const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// Модель Gemini. Бесплатный флаш-вариант. При желании смени на
// "gemini-2.5-flash" (если доступно в твоём регионе).
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

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
  const res = await fetch(GEMINI_URL, {
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
    const res = await fetch(
      `${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=30`,
    );
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

console.log("Бот запущен (long polling). Ctrl+C — остановить.");
poll();
setInterval(poll, 1000);
