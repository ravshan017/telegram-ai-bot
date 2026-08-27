// Регистрирует webhook в Telegram, чтобы он слал сообщения в /api/webhook.
//   TELEGRAM_BOT_TOKEN=xxx WEBHOOK_SECRET=yyy node set-webhook.mjs https://app.vercel.app
import process from "node:process";

const token = process.env.TELEGRAM_BOT_TOKEN;
const base = process.argv[2]?.replace(/\/+$/, "");
const secret = process.env.WEBHOOK_SECRET || "";

if (!token || !base) {
  console.log(
    "Usage: TELEGRAM_BOT_TOKEN=xxx WEBHOOK_SECRET=yyy node set-webhook.mjs https://app.vercel.app",
  );
  process.exit(1);
}

const params = new URLSearchParams({ url: `${base}/api/webhook` });
if (secret) params.set("secret_token", secret);

const r = await fetch(
  `https://api.telegram.org/bot${token}/setWebhook?${params.toString()}`,
);
console.log(await r.json());
