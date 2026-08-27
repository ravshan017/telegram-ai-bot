const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// Модель Gemini. Бесплатный флаш-вариант. При желании поменяй на
// "gemini-2.5-flash" (если доступно в твоём регионе).
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

export default async function handler(req, res) {
  // Лёгкая защита: если задан WEBHOOK_SECRET — проверяем заголовок от Telegram.
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    return res.status(401).json({ ok: false });
  }

  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, bot: "online" });
  }

  try {
    const update = req.body || {};
    const msg = update.message;
    if (!msg?.text || !msg?.chat?.id) {
      return res.status(200).json({ ok: true });
    }

    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === "/start") {
      await sendTelegram(
        chatId,
        "Привет! Я ИИ-бот на Gemini. Пиши мне что угодно — отвечу.",
      );
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith("/")) {
      await sendTelegram(
        chatId,
        "Не знаю такой команды. Просто напиши сообщение — я отвечу через ИИ.",
      );
      return res.status(200).json({ ok: true });
    }

    const reply = await askGemini(text);
    await sendTelegram(chatId, reply);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("webhook error:", err);
    return res.status(200).json({ ok: false });
  }
}

async function sendTelegram(chatId, text) {
  // Telegram ограничивает длину сообщения ~4096 символов.
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
