
Server · JS
const http = require("http");
const { extractFields } = require("./lib/claude");
const { sendMessage, sendDocument, downloadLargestPhoto, setWebhook } = require("./lib/telegram");
const { buildDkp } = require("./lib/dkpTemplate");
 
// ---- простая машина состояний, по одной сессии на чат ----
// (хранится в памяти процесса — при перезапуске сервера сбрасывается,
//  для личного использования этого достаточно на первое время)
const sessions = new Map();
 
const STEPS = [
  { key: "seller_main", docType: "passport_main", target: "seller", prompt: "Шаг 1 из 6. Пришлите фото разворота паспорта ПРОДАВЦА с фотографией (там же ФИО и дата рождения)." },
  { key: "seller_reg", docType: "passport_registration", target: "seller", prompt: "Шаг 2 из 6. Теперь пришлите разворот паспорта ПРОДАВЦА со штампом регистрации (пропиской)." },
  { key: "buyer_main", docType: "passport_main", target: "buyer", prompt: "Шаг 3 из 6. Пришлите фото разворота паспорта ПОКУПАТЕЛЯ с фотографией." },
  { key: "buyer_reg", docType: "passport_registration", target: "buyer", prompt: "Шаг 4 из 6. Теперь пришлите разворот паспорта ПОКУПАТЕЛЯ со штампом регистрации." },
  { key: "vehicle", docType: "vehicle_doc", target: "vehicle", prompt: "Шаг 5 из 6. И последнее фото — СТС или ПТС на автомобиль." },
];
const TEXT_STEP_PROMPT = "Шаг 6 из 6. Напишите одним сообщением город и сумму сделки через запятую, например: Челябинск, 850000";
 
function newSession() {
  return { stepIndex: 0, seller: {}, buyer: {}, vehicle: {}, awaitingText: false };
}
 
async function handlePhoto(chatId, session, photoArray) {
  const step = STEPS[session.stepIndex];
  if (!step) {
    await sendMessage(chatId, "Все фото уже собраны — напишите /new, чтобы начать новую сделку.");
    return;
  }
 
  await sendMessage(chatId, "Распознаю фото, минутку...");
  try {
    const { base64, mimeType } = await downloadLargestPhoto(photoArray);
    const fields = await extractFields(step.docType, base64, mimeType);
    Object.assign(session[step.target], fields);
 
    session.stepIndex += 1;
    const next = STEPS[session.stepIndex];
    if (next) {
      await sendMessage(chatId, `Готово. ${next.prompt}`);
    } else {
      session.awaitingText = true;
      await sendMessage(chatId, `Готово, все документы распознаны. ${TEXT_STEP_PROMPT}`);
    }
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "Не получилось распознать фото — попробуйте переснять чуть чётче и прислать ещё раз.");
  }
}
 
async function handleText(chatId, session, text) {
  const [cityRaw, priceRaw] = text.split(",");
  const city = (cityRaw || "").trim() || "____________";
  const price = (priceRaw || "").trim() || "____________";
  const date = new Date().toLocaleDateString("ru-RU");
 
  await sendMessage(chatId, "Собираю договор...");
  try {
    const buffer = await buildDkp({
      city, date, price,
      seller: session.seller,
      buyer: session.buyer,
      vehicle: session.vehicle,
    });
    await sendDocument(chatId, buffer, "dkp.docx", "Черновик договора — проверьте все поля перед подписанием.");
    sessions.delete(chatId);
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "Не получилось собрать документ. Напишите /new, чтобы попробовать заново.");
  }
}
 
async function handleUpdate(body) {
  const msg = body?.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
 
  if (text === "/start" || text === "/new") {
    sessions.set(chatId, newSession());
    await sendMessage(chatId, "Начинаем новую сделку по ДКП.\n\n" + STEPS[0].prompt);
    return;
  }
  if (text === "/reset") {
    sessions.delete(chatId);
    await sendMessage(chatId, "Сброшено. Напишите /new, чтобы начать заново.");
    return;
  }
 
  let session = sessions.get(chatId);
  if (!session) {
    await sendMessage(chatId, "Напишите /new, чтобы начать сбор документов для договора.");
    return;
  }
 
  if (msg.photo) {
    await handlePhoto(chatId, session, msg.photo);
  } else if (session.awaitingText && text) {
    await handleText(chatId, session, text);
  } else {
    await sendMessage(chatId, "Пришлите, пожалуйста, фото документа (или текст на шаге 6).");
  }
}
 
const PORT = process.env.PORT || 3000;
 
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("dkp-bot is running");
    return;
  }
 
  if (req.method === "POST" && req.url === "/webhook") {
    let chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(200); // отвечаем Telegram сразу
      res.end();
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        handleUpdate(body).catch((e) => console.error("handleUpdate error:", e));
      } catch (e) {
        console.error("bad webhook payload:", e);
      }
    });
    return;
  }
 
  res.writeHead(404);
  res.end();
});
 
server.listen(PORT, async () => {
  console.log(`Listening on ${PORT}`);
  const externalUrl = process.env.RENDER_EXTERNAL_URL;
  if (externalUrl) {
    const result = await setWebhook(`${externalUrl}/webhook`);
    console.log("setWebhook result:", result);
  } else {
    console.log("RENDER_EXTERNAL_URL не задан — вебхук не регистрирую автоматически.");
  }
});
 


