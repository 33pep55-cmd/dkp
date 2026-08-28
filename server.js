const http = require("http");
const { extractFields } = require("./lib/claude");
const { sendMessage, sendDocument, downloadLargestPhoto, setWebhook } = require("./lib/telegram");
const { buildDkp } = require("./lib/dkpTemplate");

// ---- простая машина состояний, по одной сессии на чат ----
// (хранится в памяти процесса — при перезапуске сервера сбрасывается,
//  для личного использования этого достаточно на первое время)
const sessions = new Map();

const STEPS = [
  { key: "seller_main", docType: "passport_main", target: "seller", prompt: "📄 <b>Шаг 1 из 7</b>\nПришлите фото разворота паспорта <b>ПРОДАВЦА</b> с фотографией (там же ФИО и дата рождения)." },
  { key: "seller_reg", docType: "passport_registration", target: "seller", prompt: "📍 <b>Шаг 2 из 7</b>\nТеперь пришлите разворот паспорта <b>ПРОДАВЦА</b> со штампом регистрации (пропиской)." },
  { key: "buyer_main", docType: "passport_main", target: "buyer", prompt: "📄 <b>Шаг 3 из 7</b>\nПришлите фото разворота паспорта <b>ПОКУПАТЕЛЯ</b> с фотографией." },
  { key: "buyer_reg", docType: "passport_registration", target: "buyer", prompt: "📍 <b>Шаг 4 из 7</b>\nТеперь пришлите разворот паспорта <b>ПОКУПАТЕЛЯ</b> со штампом регистрации." },
  { key: "vehicle", docType: "vehicle_doc", target: "vehicle", prompt: "🚗 <b>Шаг 5 из 7</b>\nИ последнее фото — СТС или ПТС на автомобиль." },
];
const PRICE_PROMPT = "💰 <b>Шаг 6 из 7</b>\nНапишите сумму сделки в рублях — только цифры, например: <i>850000</i>";
const CITY_PROMPT = "🏙️ <b>Шаг 7 из 7</b>\nТеперь напишите город, где составляется договор, например: <i>Челябинск</i>";

function newSession() {
  return {
    stepIndex: 0,
    seller: {}, buyer: {}, vehicle: {},
    awaitingPrice: false, awaitingCity: false,
    price: null, city: "",
  };
}

async function handlePhoto(chatId, session, photoArray) {
  const step = STEPS[session.stepIndex];
  if (!step) {
    await sendMessage(chatId, "Все фото уже собраны — напишите /new, чтобы начать новую сделку.");
    return;
  }

  await sendMessage(chatId, "🔍 Распознаю фото, минутку...");
  try {
    const { base64, mimeType } = await downloadLargestPhoto(photoArray);
    const fields = await extractFields(step.docType, base64, mimeType);
    Object.assign(session[step.target], fields);

    session.stepIndex += 1;
    const next = STEPS[session.stepIndex];
    if (next) {
      await sendMessage(chatId, `✅ Готово.\n\n${next.prompt}`);
    } else {
      session.awaitingPrice = true;
      await sendMessage(chatId, `✅ Все документы распознаны.\n\n${PRICE_PROMPT}`);
    }
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "⚠️ Не получилось распознать фото — попробуйте переснять чуть чётче (при дневном свете, без бликов) и прислать ещё раз.");
  }
}

async function handlePrice(chatId, session, text) {
  const digits = parseInt((text || "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(digits) || digits <= 0) {
    await sendMessage(chatId, "⚠️ Не получилось распознать сумму — пришлите, пожалуйста, только цифры, например: 850000");
    return;
  }
  session.price = digits;
  session.awaitingPrice = false;
  session.awaitingCity = true;
  await sendMessage(chatId, `✅ Принято: ${digits.toLocaleString("ru-RU")} ₽\n\n${CITY_PROMPT}`);
}

async function handleCity(chatId, session, text) {
  const city = (text || "").trim();
  if (!city) {
    await sendMessage(chatId, "⚠️ Напишите, пожалуйста, название города.");
    return;
  }
  session.city = city;
  session.awaitingCity = false;
  const date = new Date().toLocaleDateString("ru-RU");

  await sendMessage(chatId, "🧾 Собираю договор...");
  try {
    const buffer = await buildDkp({
      city: session.city, date, price: session.price,
      seller: session.seller,
      buyer: session.buyer,
      vehicle: session.vehicle,
    });
    await sendDocument(chatId, buffer, "dkp.docx", "📄 <b>Черновик договора готов</b>\nПроверьте все поля перед подписанием.");
    sessions.delete(chatId);
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "⚠️ Не получилось собрать документ. Напишите /new, чтобы попробовать заново.");
  }
}

async function handleUpdate(body) {
  const msg = body?.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (text === "/start" || text === "/new") {
    sessions.set(chatId, newSession());
    await sendMessage(
      chatId,
      "🚗📄 <b>Договор купли-продажи автомобиля</b>\n\n" +
        "Пришлите по очереди фото документов — я сам распознаю данные и соберу черновик ДКП, печатать вручную не нужно. Готовый файл обязательно проверьте перед подписанием.\n\n" +
        STEPS[0].prompt
    );
    return;
  }
  if (text === "/reset") {
    sessions.delete(chatId);
    await sendMessage(chatId, "🔄 Сброшено. Напишите /new, чтобы начать заново.");
    return;
  }

  let session = sessions.get(chatId);
  if (!session) {
    await sendMessage(chatId, "Напишите /new, чтобы начать сбор документов для договора.");
    return;
  }

  if (msg.photo) {
    await handlePhoto(chatId, session, msg.photo);
  } else if (session.awaitingPrice && text) {
    await handlePrice(chatId, session, text);
  } else if (session.awaitingCity && text) {
    await handleCity(chatId, session, text);
  } else {
    await sendMessage(chatId, "Пришлите, пожалуйста, фото документа (или сумму/город, если сейчас ожидается это).");
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
