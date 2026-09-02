const http = require("http");
const fs = require("fs");
const path = require("path");
const { extractFields } = require("./lib/claude");
const {
  sendMessage, sendDocument, sendAnimation, downloadLargestPhoto, setWebhook,
  answerCallbackQuery, editMessageReplyMarkup, setMyCommands, setChatMenuButton,
} = require("./lib/telegram");
const { buildDkp } = require("./lib/dkpTemplate");
const { buildGibddForm } = require("./lib/gibddTemplate");
const { formatSnils, parseSnilsInnText } = require("./lib/snils");
const {
  newEngine: newBankruptcyEngine,
  renderCurrentStep: renderBankruptcyStep,
  handleAction: handleBankruptcyAction,
} = require("./lib/bankruptcy-bot-handler");

// Отдельная карта сессий для сценария банкротства — не пересекается
// с сессиями ДКП выше, у каждого чата может быть активна только
// одна из двух (или ни одной).
const bankruptcySessions = new Map();
const bankruptcyDeps = { sendMessage, sendDocument, downloadLargestPhoto };

// ---- простая машина состояний, по одной сессии на чат ----
// (хранится в памяти процесса — при перезапуске сервера сбрасывается,
//  для личного использования этого достаточно на первое время)
const sessions = new Map();

const ASSETS_DIR = path.join(__dirname, "assets");

// Схематичные (не настоящие!) анимированные подсказки — какую часть
// документа нужно сфотографировать. Один и тот же файл переиспользуется для
// продавца и покупателя, т.к. тип документа один и тот же.
const STEP_ASSETS = {
  passport_main: "guide_passport_main.gif",
  passport_registration: "guide_passport_reg.gif",
  vehicle_doc: "guide_vehicle_doc.gif",
  inn: "guide_inn.gif",
  snils: "guide_snils.gif",
};

const INTRO =
  "🚗📄 <b>Договор купли-продажи автомобиля</b>\n\n" +
  "Пришлите по очереди фото документов — я сам распознаю данные и соберу черновик ДКП, а по желанию — ещё и заявление в ГИБДД для постановки на учёт. Печатать вручную не нужно, но готовые файлы обязательно проверьте перед подписанием и подачей.\n\n" +
  "К каждому шагу я буду присылать короткую подсказку-картинку, какую часть документа фотографировать.\n\n";

const STEPS = [
  { key: "seller_main", docType: "passport_main", target: "seller", prompt: "📄 <b>Шаг 1 из 9</b>\nПришлите фото разворота паспорта <b>ПРОДАВЦА</b> с фотографией (там же ФИО и дата рождения)." },
  { key: "seller_reg", docType: "passport_registration", target: "seller", prompt: "📍 <b>Шаг 2 из 9</b>\nТеперь пришлите разворот паспорта <b>ПРОДАВЦА</b> со штампом регистрации (пропиской)." },
  { key: "buyer_main", docType: "passport_main", target: "buyer", prompt: "📄 <b>Шаг 3 из 9</b>\nПришлите фото разворота паспорта <b>ПОКУПАТЕЛЯ</b> с фотографией." },
  { key: "buyer_reg", docType: "passport_registration", target: "buyer", prompt: "📍 <b>Шаг 4 из 9</b>\nТеперь пришлите разворот паспорта <b>ПОКУПАТЕЛЯ</b> со штампом регистрации." },
  { key: "vehicle", docType: "vehicle_doc", target: "vehicle", prompt: "🚗 <b>Шаг 5 из 9</b>\nИ последнее фото — СТС или ПТС на автомобиль." },
];
const SELLER_PHONE_PROMPT = "📞 <b>Шаг 6 из 9</b>\nНапишите номер телефона <b>ПРОДАВЦА</b>, например: <i>+7 900 123-45-67</i>";
const BUYER_PHONE_PROMPT = "📞 <b>Шаг 7 из 9</b>\nТеперь напишите номер телефона <b>ПОКУПАТЕЛЯ</b> — именно он будет ставить автомобиль на учёт, поэтому этот номер также попадёт в заявление в ГИБДД.";
const PRICE_PROMPT = "💰 <b>Шаг 8 из 9</b>\nНапишите сумму сделки в рублях — только цифры, например: <i>850000</i>";
const CITY_PROMPT = "🏙️ <b>Шаг 9 из 9</b>\nТеперь напишите город, где составляется договор, например: <i>Челябинск</i>";

const GIBDD_QUESTION =
  "🚦 Договор готов. Сразу сформировать ещё и <b>заявление в ГИБДД</b>?\n\n" +
  "Оно понадобится вместе с договором купли-продажи, чтобы поставить автомобиль на учёт — основные данные я впишу сам, останется дописать пару строк от руки прямо в отделении.";
// Inline-кнопки показываются сразу под сообщением, без необходимости
// открывать отдельное меню — в отличие от обычной reply-клавиатуры,
// которая на некоторых устройствах прячется за малозаметной кнопкой.
const GIBDD_INLINE_KEYBOARD = {
  inline_keyboard: [[
    { text: "✅ Да, сформировать", callback_data: "gibdd_yes" },
    { text: "❌ Не нужно", callback_data: "gibdd_no" },
  ]],
};

const INN_PROMPT =
  "🪪 Пришлите фото документа с ИНН <b>покупателя</b> (свидетельство или справка ФНС) — либо выберите вариант ниже.";
const SNILS_PROMPT =
  "🪪 Теперь пришлите фото СНИЛС <b>покупателя</b> (зелёная карточка или справка СФР) — либо выберите вариант ниже.";

// Явные кнопки для шагов ИНН/СНИЛС: помимо присылки фото (это всегда
// можно сделать и без кнопки — просто отправив фото в чат), даём понятный
// способ ввести номер текстом или пропустить шаг, не полагаясь на то,
// что человек сам догадается написать "пропустить".
const INN_INLINE_KEYBOARD = {
  inline_keyboard: [[
    { text: "✍️ Ввести вручную", callback_data: "inn_manual" },
    { text: "⏭ Пропустить", callback_data: "inn_skip" },
  ]],
};
const SNILS_INLINE_KEYBOARD = {
  inline_keyboard: [[
    { text: "✍️ Ввести вручную", callback_data: "snils_manual" },
    { text: "⏭ Пропустить", callback_data: "snils_skip" },
  ]],
};

function newSession() {
  return {
    stepIndex: 0,
    seller: {}, buyer: {}, vehicle: {},
    awaitingSellerPhone: false, awaitingBuyerPhone: false,
    awaitingPrice: false, awaitingCity: false,
    awaitingGibddChoice: false, awaitingInn: false, awaitingSnils: false,
    price: null, city: "",
  };
}

// Отправляет гиф-иллюстрацию с текстом в подписи, либо — если файл
// иллюстрации почему-то недоступен — просто текстом, чтобы бот в любом
// случае не сломался.
async function sendGuideAnimation(chatId, assetName, caption, replyMarkup) {
  if (assetName) {
    try {
      const buffer = fs.readFileSync(path.join(ASSETS_DIR, assetName));
      await sendAnimation(chatId, buffer, assetName, caption, replyMarkup);
      return;
    } catch (e) {
      console.error("guide asset unavailable:", assetName, e.message);
    }
  }
  await sendMessage(chatId, caption, replyMarkup);
}

// Кнопка "Заполнить договор" — показывается, когда у чата нет активной
// сессии, вместо того чтобы просить человека вспомнить и напечатать
// команду /new через скрытое меню Telegram.
const START_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📄 Заполнить договор", callback_data: "menu_new" }],
    [{ text: "📋 Заявление на банкротство", callback_data: "menu_bankruptcy" }],
  ],
};
// Кнопка "Начать сначала" — прикрепляется к шагам сбора документов,
// чтобы можно было сбросить сделку и начать заново в любой момент,
// опять же без похода в меню команд.
const RESTART_KEYBOARD = {
  inline_keyboard: [[{ text: "🔄 Начать сначала", callback_data: "menu_reset" }]],
};
async function sendStepGuide(chatId, step, prefix = "") {
  const caption = `${prefix}${step.prompt}`;
  await sendGuideAnimation(chatId, STEP_ASSETS[step.docType], caption, RESTART_KEYBOARD);
}

async function handlePhoto(chatId, session, photoArray) {
  const step = STEPS[session.stepIndex];
  if (!step) {
    await sendMessage(chatId, "Все фото уже собраны.", START_KEYBOARD);
    return;
  }

  await sendMessage(chatId, "🔍 Распознаю фото, минутку...");
  try {
    const { base64, mimeType } = await downloadLargestPhoto(photoArray);
    const fields = await extractFields(step.docType, base64, mimeType);

    // Адрес регистрации — обязательное поле для договора. Если модель не
    // смогла уверенно прочитать штамп, она честно вернула "" (см. lib/claude.js:
    // "не выдумывай значения") — вместо того, чтобы молча продолжать с пустым
    // адресом в договоре, просим переснять именно этот штамп.
    if (step.docType === "passport_registration" && !(fields.address || "").trim()) {
      await sendMessage(
        chatId,
        "⚠️ Не получилось разобрать адрес регистрации на этом фото. Переснимите штамп прописки покрупнее, при хорошем освещении и без бликов, и пришлите ещё раз."
      );
      return;
    }

    Object.assign(session[step.target], fields);

    session.stepIndex += 1;
    const next = STEPS[session.stepIndex];
    if (next) {
      await sendStepGuide(chatId, next, "✅ Готово.\n\n");
    } else {
      session.awaitingSellerPhone = true;
      await sendMessage(chatId, `✅ Все документы распознаны.\n\n${SELLER_PHONE_PROMPT}`);
    }
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "⚠️ Не получилось распознать фото — попробуйте переснять чуть чётче (при дневном свете, без бликов) и прислать ещё раз.");
  }
}

function extractPhone(text) {
  const trimmed = (text || "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10) return "";
  return trimmed;
}

async function handleSellerPhone(chatId, session, text) {
  const phone = extractPhone(text);
  if (!phone) {
    await sendMessage(chatId, "⚠️ Не получилось распознать номер телефона — пришлите, пожалуйста, номер продавца ещё раз, например: +7 900 123-45-67");
    return;
  }
  session.seller.phone = phone;
  session.awaitingSellerPhone = false;
  session.awaitingBuyerPhone = true;
  await sendMessage(chatId, `✅ Принято.\n\n${BUYER_PHONE_PROMPT}`);
}

async function handleBuyerPhone(chatId, session, text) {
  const phone = extractPhone(text);
  if (!phone) {
    await sendMessage(chatId, "⚠️ Не получилось распознать номер телефона — пришлите, пожалуйста, номер покупателя ещё раз, например: +7 900 123-45-67");
    return;
  }
  session.buyer.phone = phone;
  session.awaitingBuyerPhone = false;
  session.awaitingPrice = true;
  await sendMessage(chatId, `✅ Принято.\n\n${PRICE_PROMPT}`);
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
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "⚠️ Не получилось собрать договор. Напишите /new, чтобы попробовать заново.");
    return;
  }

  session.awaitingGibddChoice = true;
  await sendMessage(chatId, GIBDD_QUESTION, GIBDD_INLINE_KEYBOARD);
}

async function handleGibddChoice(chatId, session, text) {
  const answer = (text || "").trim().toLowerCase();
  const isYes = answer.includes("да");
  const isNo = answer.includes("нет") || answer.includes("не нужно");

  if (!isYes && !isNo) {
    await sendMessage(chatId, "Не совсем понял ответ — нажмите одну из кнопок под сообщением выше, либо напишите «да» или «нет».");
    return;
  }

  session.awaitingGibddChoice = false;

  if (isNo) {
    await sendMessage(chatId, "Хорошо, не формирую. Если понадобится позже — нажмите кнопку ниже.", START_KEYBOARD);
    sessions.delete(chatId);
    return;
  }

  session.awaitingInn = true;
  await sendGuideAnimation(chatId, STEP_ASSETS.inn, INN_PROMPT, INN_INLINE_KEYBOARD);
}

// Обрабатывает нажатие любой inline-кнопки в боте — сначала общие для
// всех кнопок действия (снять "часики", убрать кнопки под сообщением),
// затем разводит по конкретному действию через callback_data.
async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;

  await answerCallbackQuery(callbackQuery.id);
  await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });

  const session = sessions.get(chatId);

  if (data === "menu_new" || data === "menu_reset") {
    sessions.set(chatId, newSession());
    await sendStepGuide(chatId, STEPS[0], INTRO);
    return;
  }

  if (!session) return; // устаревшее нажатие — сессии уже нет

  if (data === "gibdd_yes" || data === "gibdd_no") {
    if (!session.awaitingGibddChoice) return;
    session.awaitingGibddChoice = false;
    if (data === "gibdd_no") {
      await sendMessage(chatId, "Хорошо, не формирую. Если понадобится позже — нажмите кнопку ниже.", START_KEYBOARD);
      sessions.delete(chatId);
      return;
    }
    session.awaitingInn = true;
    await sendGuideAnimation(chatId, STEP_ASSETS.inn, INN_PROMPT, INN_INLINE_KEYBOARD);
    return;
  }

  if (data === "inn_manual") {
    if (!session.awaitingInn) return;
    await sendMessage(chatId, "Напишите номер ИНН цифрами, например: 500100200300");
    return;
  }

  if (data === "inn_skip") {
    if (!session.awaitingInn) return;
    session.awaitingInn = false;
    session.awaitingSnils = true;
    await sendGuideAnimation(chatId, STEP_ASSETS.snils, SNILS_PROMPT, SNILS_INLINE_KEYBOARD);
    return;
  }

  if (data === "snils_manual") {
    if (!session.awaitingSnils) return;
    await sendMessage(chatId, "Напишите номер СНИЛС цифрами, например: 123-456-789 00");
    return;
  }

  if (data === "snils_skip") {
    if (!session.awaitingSnils) return;
    session.awaitingSnils = false;
    await finalizeGibddForm(chatId, session);
    return;
  }
}

async function finalizeGibddForm(chatId, session) {
  await sendMessage(chatId, "🚦 Собираю заявление...");
  try {
    const gibddBuffer = await buildGibddForm({
      buyer: session.buyer,
      vehicle: session.vehicle,
    });
    await sendDocument(
      chatId,
      gibddBuffer,
      "zayavlenie_gibdd.docx",
      "🚦 <b>Заявление в ГИБДД</b>\nОсновные данные заполнены автоматически. От руки впишите: наименование подразделения, при желании e-mail, а дату и подпись — прямо при подаче."
    );
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "⚠️ Заявление сформировать не получилось — можно заполнить его отдельно вручную.");
  }

  sessions.delete(chatId);
}

// ---- Шаг ИНН ----

async function handleInnPhoto(chatId, session, photoArray) {
  await sendMessage(chatId, "🔍 Распознаю фото, минутку...");
  try {
    const { base64, mimeType } = await downloadLargestPhoto(photoArray);
    const fields = await extractFields("inn", base64, mimeType);
    const innDigits = (fields.inn || "").replace(/\D/g, "");

    if (innDigits.length !== 10 && innDigits.length !== 12) {
      await sendMessage(
        chatId,
        "⚠️ Не получилось разобрать ИНН на этом фото. Попробуйте переснять чётче, введите номер текстом, либо напишите «пропустить»."
      );
      return;
    }

    session.buyer.inn = innDigits;
    session.awaitingInn = false;
    session.awaitingSnils = true;
    await sendGuideAnimation(chatId, STEP_ASSETS.snils, `✅ Принято.\n\n${SNILS_PROMPT}`, SNILS_INLINE_KEYBOARD);
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "⚠️ Не получилось распознать фото — попробуйте переснять чуть чётче и прислать ещё раз, введите номер текстом, либо напишите «пропустить».");
  }
}

async function handleInnText(chatId, session, text) {
  const trimmed = (text || "").trim().toLowerCase();
  if (trimmed === "пропустить" || trimmed === "нет" || trimmed === "-") {
    session.awaitingInn = false;
    session.awaitingSnils = true;
    await sendGuideAnimation(chatId, STEP_ASSETS.snils, SNILS_PROMPT, SNILS_INLINE_KEYBOARD);
    return;
  }

  const { inn } = parseSnilsInnText(text);
  if (!inn) {
    await sendMessage(
      chatId,
      "⚠️ Не получилось распознать номер. Пришлите ИНН текстом (например: 500100200300), фото документа, либо напишите «пропустить»."
    );
    return;
  }

  session.buyer.inn = inn;
  session.awaitingInn = false;
  session.awaitingSnils = true;
  await sendGuideAnimation(chatId, STEP_ASSETS.snils, `✅ Принято.\n\n${SNILS_PROMPT}`, SNILS_INLINE_KEYBOARD);
}

// ---- Шаг СНИЛС ----

async function handleSnilsPhoto(chatId, session, photoArray) {
  await sendMessage(chatId, "🔍 Распознаю фото, минутку...");
  try {
    const { base64, mimeType } = await downloadLargestPhoto(photoArray);
    const fields = await extractFields("snils", base64, mimeType);
    const snilsDigits = (fields.snils || "").replace(/\D/g, "");

    if (snilsDigits.length !== 11) {
      await sendMessage(
        chatId,
        "⚠️ Не получилось разобрать СНИЛС на этом фото. Попробуйте переснять чётче, введите номер текстом, либо напишите «пропустить»."
      );
      return;
    }

    session.buyer.snils = formatSnils(snilsDigits);
    session.awaitingSnils = false;
    await finalizeGibddForm(chatId, session);
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "⚠️ Не получилось распознать фото — попробуйте переснять чуть чётче и прислать ещё раз, введите номер текстом, либо напишите «пропустить».");
  }
}

async function handleSnilsText(chatId, session, text) {
  const trimmed = (text || "").trim().toLowerCase();
  if (trimmed === "пропустить" || trimmed === "нет" || trimmed === "-") {
    session.awaitingSnils = false;
    await finalizeGibddForm(chatId, session);
    return;
  }

  const { snils } = parseSnilsInnText(text);
  if (!snils) {
    await sendMessage(
      chatId,
      "⚠️ Не получилось распознать номер. Пришлите СНИЛС текстом (например: 123-456-789 00), фото документа, либо напишите «пропустить»."
    );
    return;
  }

  session.buyer.snils = snils;
  session.awaitingSnils = false;
  await finalizeGibddForm(chatId, session);
}

async function handleUpdate(body) {
  if (body?.callback_query) {
    const cq = body.callback_query;
    const chatId = cq.message.chat.id;

    // Запуск сценария банкротства — отдельная ветка, до общей обработки кнопок
    if (cq.data === "menu_bankruptcy") {
      await answerCallbackQuery(cq.id);
      await editMessageReplyMarkup(chatId, cq.message.message_id, { inline_keyboard: [] });
      const engine = newBankruptcyEngine();
      bankruptcySessions.set(chatId, engine);
      await renderBankruptcyStep(chatId, engine, bankruptcyDeps);
      return;
    }

    // Если у чата уже идёт сценарий банкротства — все остальные нажатия
    // (варианты ответа, "пропустить", "ввести вручную", "готово" и т.п.)
    // разбираем здесь же, отдельно от кнопок ДКП.
    if (bankruptcySessions.has(chatId)) {
      await answerCallbackQuery(cq.id);
      await editMessageReplyMarkup(chatId, cq.message.message_id, { inline_keyboard: [] });
      const engine = bankruptcySessions.get(chatId);
      const data = cq.data;

      if (data === "ack") {
        await handleBankruptcyAction(chatId, engine, { type: "ack" }, bankruptcyDeps);
      } else if (data === "skip") {
        await handleBankruptcyAction(chatId, engine, { type: "skip" }, bankruptcyDeps);
      } else if (data === "manual") {
        await sendMessage(chatId, "✍️ Напишите данные текстом одним сообщением.");
      } else if (data.startsWith("opt:")) {
        await handleBankruptcyAction(chatId, engine, { payload: data.slice(4) }, bankruptcyDeps);
      }

      if (engine.isFinished()) bankruptcySessions.delete(chatId);
      return;
    }

    await handleCallbackQuery(cq);
    return;
  }

  const msg = body?.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  // Сценарий банкротства — фото и текст, пока сессия активна
  if (bankruptcySessions.has(chatId)) {
    const engine = bankruptcySessions.get(chatId);
    const node = engine.currentNode();

    if (msg.photo) {
      await handleBankruptcyAction(chatId, engine, { type: "photo", payload: msg.photo }, bankruptcyDeps);
    } else if (text && node.type === "collection" && engine.collectionAwaiting() === "item") {
      await handleBankruptcyAction(chatId, engine, { type: "text", payload: text }, bankruptcyDeps);
    } else if (text) {
      // Ручной ввод нескольких полей (например, данные СРО) — пока
      // не разобран по отдельным полям, это ближайшее, что предстоит
      // доточить на практике.
      await sendMessage(chatId, "⚠️ Ручной ввод нескольких полей ещё дорабатывается — пока, пожалуйста, используйте кнопки или загрузите фото документа.");
    }

    if (engine.isFinished()) bankruptcySessions.delete(chatId);
    return;
  }

  if (text === "/start" || text === "/new") {
    sessions.set(chatId, newSession());
    await sendStepGuide(chatId, STEPS[0], INTRO);
    return;
  }
  if (text === "/bankrot") {
    const engine = newBankruptcyEngine();
    bankruptcySessions.set(chatId, engine);
    await renderBankruptcyStep(chatId, engine, bankruptcyDeps);
    return;
  }
  if (text === "/reset") {
    sessions.delete(chatId);
    bankruptcySessions.delete(chatId);
    await sendMessage(chatId, "🔄 Сброшено. Напишите /new, чтобы начать заново.");
    return;
  }

  let session = sessions.get(chatId);
  if (!session) {
    await sendMessage(chatId, "Нажмите кнопку ниже, чтобы начать сбор документов для договора.", START_KEYBOARD);
    return;
  }

  if (session.awaitingInn && msg.photo) {
    await handleInnPhoto(chatId, session, msg.photo);
  } else if (session.awaitingInn && text) {
    await handleInnText(chatId, session, text);
  } else if (session.awaitingSnils && msg.photo) {
    await handleSnilsPhoto(chatId, session, msg.photo);
  } else if (session.awaitingSnils && text) {
    await handleSnilsText(chatId, session, text);
  } else if (msg.photo) {
    await handlePhoto(chatId, session, msg.photo);
  } else if (session.awaitingSellerPhone && text) {
    await handleSellerPhone(chatId, session, text);
  } else if (session.awaitingBuyerPhone && text) {
    await handleBuyerPhone(chatId, session, text);
  } else if (session.awaitingPrice && text) {
    await handlePrice(chatId, session, text);
  } else if (session.awaitingCity && text) {
    await handleCity(chatId, session, text);
  } else if (session.awaitingGibddChoice && text) {
    await handleGibddChoice(chatId, session, text);
  } else {
    await sendMessage(chatId, "Пришлите, пожалуйста, фото документа (или ответ, если сейчас ожидается телефон/сумма/город/выбор по заявлению).");
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

  // Настраиваем понятные подписи для меню команд (значок ☰) — это
  // подстраховка для человека, который только открыл чат и ещё не получил
  // от бота ни одного сообщения с кнопками, и поэтому иначе не знал бы,
  // с чего начать.
  try {
    const cmdResult = await setMyCommands([
      { command: "start", description: "📄 Заполнить договор" },
      { command: "new", description: "🔄 Начать сначала" },
      { command: "bankrot", description: "📋 Заявление на банкротство" },
    ]);
    console.log("setMyCommands result:", cmdResult);
    const menuResult = await setChatMenuButton({ type: "commands" });
    console.log("setChatMenuButton result:", menuResult);
  } catch (e) {
    console.error("Не удалось настроить меню команд:", e.message);
  }
});
