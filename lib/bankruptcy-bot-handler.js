// ============================================================
// Универсальный обработчик сценария банкротства для Telegram-бота.
// В отличие от server.js (жёсткий список STEPS для ДКП), этот модуль
// читает bankruptcy-full.json через WizardEngine и сам решает, что
// показать пользователю на основе типа текущего узла схемы.
//
// Интеграция в server.js:
//   const { handleBankruptcyStart, handleBankruptcyUpdate } = require("./lib/bankruptcy-bot-handler");
//   const bankruptcySessions = new Map();
//   ...в handleUpdate добавить проверку bankruptcySessions.has(chatId)
//   и маршрутизацию туда, аналогично dkpSessions.
// ============================================================

const fs = require("fs");
const path = require("path");
const WizardEngine = require("../engine/wizard-engine.js");
const realExtractFields = require("./claude.js").extractFields;
const { generateBankruptcyApplication } = require("./bankruptcy-docx-builder.js");

const FLOW_PATH = path.join(__dirname, "..", "flows", "bankruptcy-full.json");

// Документы, для которых пока нет отдельного генератора — заглушка,
// чтобы сценарий не падал, пока не дойдём до их доработки на практике.
const STUB_TEMPLATES = new Set(["ip_closure_p26001", "mortgage_settlement_petition", "rent_exclusion_petition"]);

// Те же самые картинки-подсказки, что уже работают в сценарии ДКП —
// документы совпадают (паспорт, СНИЛС, ИНН, СТС/ПТС), так что отдельно
// рисовать ничего не нужно, только переиспользовать по docType.
const GUIDE_ASSETS = {
  passport_main: "guide_passport_main.gif",
  passport_registration: "guide_passport_reg.gif",
  inn: "guide_inn.gif",
  snils: "guide_snils.gif",
  vehicle_doc: "guide_vehicle_doc.gif",
  birth_certificate: "guide_birth_cert.gif",
};

// Явная подсказка про скрепку — иначе взгляд тянется только к видимой
// кнопке "Пропустить", а как прикрепить сам файл, не всегда очевидно.
const ATTACH_HINT =
  "\n\nНажмите на значок скрепки 📎 рядом с полем ввода и прикрепите фото документа.\n" +
  "Если документа нет под рукой — нажмите «Пропустить» ниже.";
const ATTACH_HINT_COLLECTION =
  "\n\nНажмите на значок скрепки 📎 рядом с полем ввода, чтобы прикрепить фото.\n" +
  "Если добавлять больше нечего — нажмите «Готово» ниже.";

function newEngine() {
  return new WizardEngine(FLOW_PATH);
}

function loadPresets(fileName) {
  const filePath = path.join(__dirname, fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// ---- Рендер текущего шага в сообщения Telegram ----
// deps — объект с функциями sendMessage/sendAnimation/downloadLargestPhoto
// и т.п., передаётся снаружи, чтобы этот модуль не был жёстко привязан
// к конкретной реализации lib/telegram.js (удобно для тестов).

async function renderCurrentStep(chatId, engine, deps) {
  try {
    if (engine.isFinished()) {
      await finalize(chatId, engine, deps);
      return;
    }

    const node = engine.currentNode();

    if (node.type === "message") {
      await deps.sendMessage(chatId, `ℹ️ ${node.title}\n\n${node.body}`, ackKeyboard());
      return;
    }

    if (node.type === "upload") {
      const caption = `📎 ${node.title}${ATTACH_HINT}`;
      const asset = GUIDE_ASSETS[node.docType];
      if (asset && deps.sendGuideAnimation) {
        await deps.sendGuideAnimation(chatId, asset, caption, skipKeyboard(node));
      } else {
        await deps.sendMessage(chatId, caption, skipKeyboard(node));
      }
      return;
    }

    if (node.type === "question") {
      await deps.sendMessage(chatId, `❓ ${node.title}`, optionsKeyboard(node.options));
      return;
    }

    if (node.type === "collection") {
      const awaiting = engine.collectionAwaiting();
      if (awaiting === "item") {
        const caption = `📎 ${node.itemPrompt}${ATTACH_HINT_COLLECTION}`;
        const asset = GUIDE_ASSETS[node.itemDocType];
        if (asset && deps.sendGuideAnimation) {
          await deps.sendGuideAnimation(chatId, asset, caption, collectionItemKeyboard());
        } else {
          await deps.sendMessage(chatId, caption, collectionItemKeyboard());
        }
      } else {
        await deps.sendMessage(chatId, `❓ ${node.addMorePrompt}`, optionsKeyboard(["да", "нет"]));
      }
      return;
    }

    if (node.type === "manual_input") {
      if (node.presetSource) {
        const presets = loadPresets(node.presetSource);
        await deps.sendMessage(chatId, `👤 ${node.title}`, presetKeyboard(presets));
        return;
      }
      await deps.sendMessage(chatId, `✍️ ${node.title}\nПоля: ${node.fields.join(", ")}`);
      return;
    }

    throw new Error(`Неизвестный тип узла: ${node.type}`);
  } catch (e) {
    console.error("Ошибка при показе шага", engine.currentNodeId, ":", e);
    await deps.sendMessage(chatId, "⚠️ Что-то пошло не так при подготовке следующего шага. Попробуйте написать /bankrot ещё раз — прогресс не потеряется благодаря сохранённой сессии, но если ошибка повторится, сообщите об этом моменте отдельно.");
  }
}

async function finalize(chatId, engine, deps) {
  const buffer = await generateBankruptcyApplication(engine.collectedData);
  await deps.sendDocument(chatId, buffer, "zayavlenie_bankrotstvo.docx",
    "📄 Черновик заявления о банкротстве готов. Обязательно проверьте все данные перед подачей в суд.");
}

// ---- Обработка входящих действий пользователя ----
// action: { type: 'photo'|'text'|'skip'|'preset'|'callback', payload }

async function handleAction(chatId, engine, action, deps) {
  const node = engine.currentNode();

  try {
    if (node.type === "message") {
      engine.acknowledgeMessage();
    } else if (node.type === "upload") {
      if (action.type === "photo") {
        const { base64, mimeType } = await deps.downloadLargestPhoto(action.payload);
        const fields = await (deps.extractFields || realExtractFields)(node.docType, base64, mimeType);
        if (node.collectionKey) {
          engine.submitUpload(Array.isArray(fields) ? fields : [fields]);
        } else {
          engine.submitUpload(fields);
        }
      } else if (action.type === "skip") {
        engine.submitUpload({});
      }
    } else if (node.type === "question") {
      engine.submitAnswer(action.payload);
    } else if (node.type === "collection") {
      const awaiting = engine.collectionAwaiting();
      if (awaiting === "item") {
        if (action.type === "photo") {
          const { base64, mimeType } = await deps.downloadLargestPhoto(action.payload);
          const fields = await (deps.extractFields || realExtractFields)(node.itemDocType, base64, mimeType);
          engine.submitCollectionItem(fields);
        } else if (action.type === "text") {
          engine.submitCollectionItem({ raw: action.payload, enteredManually: true });
        } else if (action.type === "skip") {
          engine.submitCollectionContinue(false);
        }
      } else {
        engine.submitCollectionContinue(action.payload === "да");
      }
    } else if (node.type === "manual_input") {
      if (node.presetSource && action.type === "preset") {
        if (action.payload === "manual") {
          await deps.sendMessage(chatId, "✍️ Ручной ввод нескольких полей ещё дорабатывается — пока, пожалуйста, выберите один из готовых вариантов выше.");
          return; // остаёмся на этом же шаге, ничего не отправляем в движок
        }
        const presets = loadPresets(node.presetSource);
        const chosen = presets[Number(action.payload)];
        if (!chosen) return; // устаревшее нажатие — такого пункта уже нет в списке
        const { label, ...fields } = chosen; // label — только для кнопки, в документ не идёт
        engine.submitManualInput(fields);
      } else if (!node.presetSource) {
        engine.submitManualInput(action.payload);
      }
    }
  } catch (e) {
    // Любая непредвиденная ошибка (сбой распознавания, недоступность
    // Claude API и т.п.) — сообщаем человеку прямо, вместо того чтобы
    // бот молча "завис" и не ответил вообще ничего.
    console.error("Ошибка на шаге", engine.currentNodeId, ":", e);
    await deps.sendMessage(chatId, "⚠️ Не получилось обработать это — попробуйте ещё раз, переснимите фото почётче, либо нажмите «Пропустить», если документа нет под рукой.");
    return;
  }

  await renderCurrentStep(chatId, engine, deps);
}

// ---- Вспомогательные клавиатуры ----
function optionsKeyboard(options) {
  return { inline_keyboard: [options.map(o => ({ text: o, callback_data: `opt:${o}` }))] };
}
function skipKeyboard() {
  return { inline_keyboard: [[{ text: "⏭ Пропустить (нет документа)", callback_data: "skip" }]] };
}
function collectionItemKeyboard() {
  return { inline_keyboard: [[
    { text: "✍️ Ввести вручную", callback_data: "manual" },
    { text: "✅ Готово (больше нет)", callback_data: "skip" },
  ]] };
}
function ackKeyboard() {
  return { inline_keyboard: [[{ text: "Понятно, дальше", callback_data: "ack" }]] };
}
function presetKeyboard(presets) {
  const rows = presets.map((p, i) => [{ text: p.label, callback_data: `preset:${i}` }]);
  rows.push([{ text: "✍️ Другое (ввести вручную)", callback_data: "preset:manual" }]);
  return { inline_keyboard: rows };
}

module.exports = { newEngine, renderCurrentStep, handleAction, STUB_TEMPLATES };
