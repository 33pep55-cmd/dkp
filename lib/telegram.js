// Тонкая обёртка над Telegram Bot API — без сторонних библиотек,
// чтобы было проще читать и чинить.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const FILE_API = `https://api.telegram.org/file/bot${TOKEN}`;
async function sendMessage(chatId, text, replyMarkup) {
  // HTML-разметка (жирный текст, эмодзи в тексте — эмодзи не требуют разметки)
  const body = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function sendDocument(chatId, buffer, filename, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  form.append("document", new Blob([buffer]), filename);
  await fetch(`${API}/sendDocument`, { method: "POST", body: form });
}
// Анимированная подсказка (GIF) — показывается как превью прямо в чате,
// в отличие от sendDocument, который Telegram показал бы как файл на скачивание.
async function sendAnimation(chatId, buffer, filename, caption, replyMarkup) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
  form.append("animation", new Blob([buffer]), filename);
  await fetch(`${API}/sendAnimation`, { method: "POST", body: form });
}
// Скачивает самое крупное фото из сообщения и возвращает { base64, mimeType }
async function downloadLargestPhoto(photoArray) {
  const largest = photoArray[photoArray.length - 1]; // Telegram отдаёт по возрастанию размера
  const fileInfoRes = await fetch(`${API}/getFile?file_id=${largest.file_id}`);
  const fileInfo = await fileInfoRes.json();
  const filePath = fileInfo.result.file_path;
  const fileRes = await fetch(`${FILE_API}/${filePath}`);
  const arrBuf = await fileRes.arrayBuffer();
  const base64 = Buffer.from(arrBuf).toString("base64");
  const mimeType = filePath.endsWith(".png") ? "image/png" : "image/jpeg";
  return { base64, mimeType };
}
async function setWebhook(url) {
  const res = await fetch(`${API}/setWebhook?url=${encodeURIComponent(url)}`);
  return res.json();
}
// Обязательно вызывается в ответ на нажатие inline-кнопки — убирает "часики"
// на кнопке у пользователя. Без этого вызова Telegram считает кнопку
// "зависшей", даже если бот на неё уже отреагировал.
async function answerCallbackQuery(callbackQueryId, text) {
  const body = { callback_query_id: callbackQueryId };
  if (text) body.text = text;
  await fetch(`${API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
// Убирает (или заменяет) inline-кнопки под уже отправленным сообщением —
// используем, чтобы кнопки "Да / Нет" исчезали сразу после нажатия и их
// нельзя было случайно нажать повторно.
async function editMessageReplyMarkup(chatId, messageId, replyMarkup) {
  await fetch(`${API}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: replyMarkup }),
  });
}
// Регистрирует список команд, которые видны через значок ☰ рядом с полем
// ввода — это подстраховка для человека, который только открыл чат и ещё
// не получил от бота ни одного сообщения с кнопками.
async function setMyCommands(commands) {
  const res = await fetch(`${API}/setMyCommands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  return res.json();
}
async function setChatMenuButton(menuButton) {
  const res = await fetch(`${API}/setChatMenuButton`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ menu_button: menuButton }),
  });
  return res.json();
}
module.exports = {
  sendMessage, sendDocument, sendAnimation, downloadLargestPhoto, setWebhook,
  answerCallbackQuery, editMessageReplyMarkup, setMyCommands, setChatMenuButton,
};
