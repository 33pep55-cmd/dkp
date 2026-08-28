
Telegram · JS
// Тонкая обёртка над Telegram Bot API — без сторонних библиотек,
// чтобы было проще читать и чинить.
 
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const FILE_API = `https://api.telegram.org/file/bot${TOKEN}`;
 
async function sendMessage(chatId, text) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
 
async function sendDocument(chatId, buffer, filename, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([buffer]), filename);
  await fetch(`${API}/sendDocument`, { method: "POST", body: form });
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
 
module.exports = { sendMessage, sendDocument, downloadLargestPhoto, setWebhook };
 

