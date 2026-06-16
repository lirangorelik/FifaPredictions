import { env } from "../config/env.js";

const BASE_URL = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

async function postSendMessage(chatId: string, text: string, parseMode?: "MarkdownV2"): Promise<void> {
  const res = await fetch(`${BASE_URL}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed (${res.status} ${res.statusText}): ${body}`);
  }
}

/** Sends with retry/backoff for transient (5xx/network) failures; does not retry 4xx (formatting/config bugs). */
export async function sendTelegramMessage(chatId: string, text: string, parseMode?: "MarkdownV2"): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await postSendMessage(chatId, text, parseMode);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isClientError = /\(4\d\d /.test(message);
      if (isClientError || attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }
}

/** Best-effort notification to the admin chat when the alert pipeline fails; never throws. */
export async function notifyAdmin(message: string): Promise<void> {
  if (!env.TELEGRAM_ADMIN_CHAT_ID) return;
  try {
    await sendTelegramMessage(env.TELEGRAM_ADMIN_CHAT_ID, message);
  } catch (err) {
    console.error("Failed to notify admin via Telegram:", err);
  }
}
