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
const os = require("os");
const path = require("path");
const WizardEngine = require("../engine/wizard-engine.js");
const realExtractFields = require("./claude.js").extractFields;
const { generateBankruptcyApplication } = require("./bankruptcy-docx-builder.js");
const { generateIpClosureApplication } = require("./ip-closure-docx-builder.js");

// Промежуточные документы (не итоговое заявление) — раньше движок их
// формировал внутри себя (generatedDocuments), но реально отправлял
// только самый последний файл. Теперь каждый шаблон из этого списка
// генерируется и отправляется человеку сразу же, как только становится
// доступен, отдельным файлом.
const INTERMEDIATE_GENERATORS = {
  ip_closure_p26001: { fn: generateIpClosureApplication, filename: "Заявление на закрытие ИП (форма Р26001).docx", caption: "📄 Заявление на закрытие ИП (форма Р26001) готово. Лист 2 при подаче заполнит сотрудник ФНС/МФЦ — самостоятельно его заполнять не нужно." },
};

async function sendIntermediateDocuments(chatId, engine, deps, beforeCount) {
  const newDocs = engine.generatedDocuments.slice(beforeCount);
  for (const doc of newDocs) {
    const gen = INTERMEDIATE_GENERATORS[doc.template];
    if (!gen) continue; // мировое соглашение / аренда — пока заглушки, для них отдельного файла ещё нет
    const buffer = await gen.fn(doc.dataSnapshot);
    await deps.sendDocument(chatId, buffer, gen.filename, gen.caption);
  }
}

const FLOW_PATH = path.join(__dirname, "..", "flows", "bankruptcy-full.json");

// Документы, для которых пока нет отдельного генератора — заглушка,
// чтобы сценарий не падал, пока не дойдём до их доработки на практике.
const STUB_TEMPLATES = new Set(["ip_closure_p26001", "mortgage_settlement_petition", "rent_exclusion_petition"]);

// Отчёты "Кредистория"/Скоринг Бюро — это PDF, не фото, и разбираются
// не через Claude Vision, а обычным чтением текста (см. credit-report-parser.mjs
// и cbr-bank-lookup.mjs — оба написаны как ES-модули, поэтому подключаем
// их динамическим import() из обычного CommonJS-файла).

// Сделки за 3 года бывают разных типов, и у каждого свой способ
// распознавания (или его отсутствие). Раньше выбор типа сделки был
// только "для галочки" в схеме — сам код его никогда не спрашивал,
// из-за чего загрузка фото гарантированно падала с "неизвестный тип
// документа". Теперь тип реально спрашивается перед загрузкой.
const DEAL_TYPE_TO_DOCTYPE = {
  "недвижимость": "property_deal",
  "автомобиль": "vehicle_deal",
  // "доли и ценные бумаги" и "иное" — распознавания по фото нет,
  // для них принимаем только текстовое описание.
};
async function parseCreditReportDocument(buffer, fileName) {
  const tmpPath = path.join(os.tmpdir(), `report-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tmpPath, buffer);
  try {
    const { parseCreditReport } = await import("./credit-report-parser.mjs");
    const { enrichCreditorsWithAddresses } = await import("./cbr-bank-lookup.mjs");

    const result = await parseCreditReport(tmpPath);
    if (result.format === "unknown" || result.creditors.length === 0) {
      throw new Error(`Не удалось распознать формат отчёта в файле "${fileName}" — попробуйте другой файл или добавьте кредиторов вручную.`);
    }
    return enrichCreditorsWithAddresses(result.creditors);
  } finally {
    fs.unlinkSync(tmpPath); // не оставляем чужие финансовые документы на диске сервера
  }
}

// Показываем распознанных кредиторов отдельным сообщением сразу после
// разбора отчёта — чтобы человек мог сверить со своей реальной ситуацией
// ещё до того, как решать, кого добавлять вручную.
async function sendCreditorsSummary(chatId, creditors, deps) {
  if (creditors.length === 0) {
    await deps.sendMessage(chatId, "ℹ️ В этом отчёте кредиторов не найдено.");
    return;
  }
  const lines = creditors.map((c, i) => {
    const debt = c.totalDebt ? String(c.totalDebt).trim() : "сумма не указана";
    return `${i + 1}. ${c.creditorName || "—"} — ${debt}`;
  });
  await deps.sendMessage(chatId, `✅ Распознано кредиторов: ${creditors.length}\n\n${lines.join("\n")}\n\nПроверьте, всё ли совпадает с реальной ситуацией — недостающих можно будет добавить вручную на следующем шаге.`);
}

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
  death_certificate: "guide_death_cert.gif",
  divorce_certificate: "guide_divorce_cert.gif",
  marriage_certificate: "guide_marriage_cert.gif",
  egrn_extract: "guide_egrn_extract.gif",
  egrn_negative: "guide_egrn_negative.gif",
  marriage_contract: "guide_marriage_contract.gif",
  ip_status_certificate: "guide_ip_status_certificate.gif",
};

// Явная подсказка про скрепку — иначе взгляд тянется только к видимой
// кнопке "Пропустить", а как прикрепить сам файл, не всегда очевидно.
const ATTACH_HINT =
  "\n\nНажмите на значок скрепки 📎 рядом с полем ввода и прикрепите документ — подойдёт и фото/скриншот, и PDF-файл.\n" +
  "Если документа нет под рукой — нажмите «Пропустить» ниже.";
// Для документов, которые часто бывают на нескольких страницах (договор
// аренды и т.п.) — если есть PDF, лучше прислать именно его целиком
// (тогда прочитаются все страницы сразу), а не фото одной страницы.
const ATTACH_HINT_MULTIPAGE =
  "\n\nЕсли документ есть в виде PDF-файла — пришлите его через скрепку 📎 (выберите «Файл»): так прочитаются сразу все страницы.\n" +
  "Если PDF нет — сфотографируйте (или сделайте скриншот) ту страницу, где видны нужные данные (адрес и сторона по договору), этого достаточно.\n" +
  "Если документа нет под рукой — нажмите «Пропустить» ниже.";
const ATTACH_HINT_COLLECTION =
  "\n\nНажмите на значок скрепки 📎 рядом с полем ввода — подойдёт и фото/скриншот, и PDF-файл.\n" +
  "Если добавлять больше нечего — нажмите «Готово» ниже.";
// Отдельная подсказка для кредитных отчётов — это ВСЕГДА PDF-файл, там
// нет варианта прислать фото (обычно отчёт скачивается уже в PDF).
const ATTACH_HINT_FILE =
  "\n\nЭто PDF-файл. Нажмите на скрепку 📎 рядом с полем ввода, выберите «Файл» (не «Фото или видео») и прикрепите отчёт.\n" +
  "Если отчёта нет под рукой — нажмите «Пропустить» ниже.";

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
      await deps.sendMessage(chatId, `ℹ️ ${node.title}\n\n${node.body}`, withBack(ackKeyboard(node.ackLabel)));
      return;
    }

    if (node.type === "upload") {
      const isFileUpload = node.docType === "credit_report";
      const MULTIPAGE_DOCTYPES = new Set(["rent_agreement", "mortgage_documents", "marriage_contract"]);
      const hint = isFileUpload ? ATTACH_HINT_FILE : MULTIPAGE_DOCTYPES.has(node.docType) ? ATTACH_HINT_MULTIPAGE : ATTACH_HINT;
      const caption = `📎 ${node.title}${hint}`;
      const asset = GUIDE_ASSETS[node.docType];
      if (asset && deps.sendGuideAnimation) {
        await deps.sendGuideAnimation(chatId, asset, caption, withBack(skipKeyboard(node)));
      } else {
        await deps.sendMessage(chatId, caption, withBack(skipKeyboard(node)));
      }
      return;
    }

    if (node.type === "question") {
      await deps.sendMessage(chatId, `❓ ${node.title}`, withBack(optionsKeyboard(node.options)));
      return;
    }

    if (node.type === "collection") {
      const awaiting = engine.collectionAwaiting();
      if (awaiting === "item") {
        // Если у коллекции есть варианты типа пункта (сейчас — только
        // сделки за 3 года) и тип для текущего пункта ещё не выбран —
        // сначала спрашиваем именно это, до всякой загрузки.
        if (node.itemTypeOptions && !engine.collectionState?.dealType) {
          await deps.sendMessage(chatId, `❓ ${node.itemPrompt}`, withBack(dealTypeKeyboard(node.itemTypeOptions)));
          return;
        }

        const itemDocType = node.itemDocType || DEAL_TYPE_TO_DOCTYPE[engine.collectionState?.dealType];
        const isDealsWithoutOcr = node.itemTypeOptions && !itemDocType;
        const caption = isDealsWithoutOcr
          ? `✍️ Опишите сделку своими словами одним сообщением — этот тип не распознаётся по фото.\n\nЕсли добавлять больше нечего — нажмите «Готово» ниже.`
          : `📎 ${node.itemPrompt}${ATTACH_HINT_COLLECTION}`;
        const asset = GUIDE_ASSETS[itemDocType];
        if (asset && deps.sendGuideAnimation) {
          await deps.sendGuideAnimation(chatId, asset, caption, withBack(collectionItemKeyboard()));
        } else {
          await deps.sendMessage(chatId, caption, withBack(collectionItemKeyboard()));
        }
      } else {
        await deps.sendMessage(chatId, `❓ ${node.addMorePrompt}`, withBack(optionsKeyboard(["да", "нет"])));
      }
      return;
    }

    if (node.type === "creditors_review") {
      const creditors = engine.collectedData.creditors || [];
      if (creditors.length === 0) {
        // Нечего сверять — оба отчёта либо не загружались, либо не дали
        // ни одного кредитора. Пропускаем шаг молча, не показывая
        // пустой список для галочки.
        engine.advance(node.next);
        return renderCurrentStep(chatId, engine, deps);
      }
      // По умолчанию все найденные кредиторы отмечены — человек снимает
      // галочку с тех, что задвоились между двумя отчётами или лишние.
      creditors.forEach(c => { if (c.selected === undefined) c.selected = true; });
      const rows = creditors.map((c, i) => [{
        text: `${c.selected ? "✅" : "⬜️"} ${c.creditorName || "—"} — ${c.totalDebt || "?"}`,
        callback_data: `creditor_toggle:${i}`,
      }]);
      rows.push([{ text: "✅ Готово, отметил(а) всё", callback_data: "creditor_review_done", style: "success" }]);
      await deps.sendMessage(chatId, "🔎 Проверьте кредиторов, найденных в обоих отчётах — один и тот же кредит мог попасть в оба отчёта сразу. Снимите галочку с задвоившихся или лишних пунктов, затем нажмите «Готово».", withBack({ inline_keyboard: rows }));
      return;
    }

    if (node.type === "manual_input") {
      if (node.presetSource) {
        const presets = loadPresets(node.presetSource);
        await deps.sendMessage(chatId, `👤 ${node.title}`, withBack(presetKeyboard(presets)));
        return;
      }
      await deps.sendMessage(chatId, `✍️ ${node.title}\nПоля: ${node.fields.join(", ")}`, withBack({ inline_keyboard: [] }));
      return;
    }

    if (node.type === "text_input") {
      await deps.sendMessage(chatId, `✍️ ${node.title}`, withBack({ inline_keyboard: [] }));
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
  await deps.sendDocument(chatId, buffer, "Заявление о банкротстве физического лица.docx",
    "📄 Черновик заявления о банкротстве готов. Обязательно проверьте все данные перед подачей в суд.");

  // Отдельное предложение — специально после основного документа, а не
  // посреди сценария, чтобы не отвлекать от главной задачи.
  if (deps.offerRentalAgreement) {
    await deps.offerRentalAgreement(chatId);
  }
}

// ---- Обработка входящих действий пользователя ----
// action: { type: 'photo'|'text'|'skip'|'preset'|'callback', payload }

async function handleAction(chatId, engine, action, deps) {
  const node = engine.currentNode();
  const docsCountBefore = engine.generatedDocuments.length;

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
      } else if (action.type === "document" && node.docType === "credit_report") {
        const { buffer, fileName } = await deps.downloadDocument(action.payload);
        const creditors = await parseCreditReportDocument(buffer, fileName);
        engine.submitUpload(creditors); // node.collectionKey === "creditors" — массив уйдёт туда
        await sendCreditorsSummary(chatId, creditors, deps);
      } else if (action.type === "document") {
        // PDF для обычного документа (не отчёта) — раньше это отклонялось
        // с просьбой прислать именно фото, теперь распознаём напрямую,
        // тем же промптом, что и для фото, просто как PDF-документ.
        const { buffer } = await deps.downloadDocument(action.payload);
        const fields = await (deps.extractFields || realExtractFields)(node.docType, buffer.toString("base64"), "application/pdf");
        if (node.collectionKey) {
          engine.submitUpload(Array.isArray(fields) ? fields : [fields]);
        } else {
          engine.submitUpload(fields);
        }
      } else if (action.type === "skip") {
        // Для шагов с collectionKey (отчёты -> общий список кредиторов)
        // пропуск должен значить "ничего не добавляем", а не "добавить
        // один пустой объект" — иначе в списке появится мусорная запись.
        engine.submitUpload(node.collectionKey ? [] : {});
      }
    } else if (node.type === "question") {
      engine.submitAnswer(action.payload);
    } else if (node.type === "collection") {
      const awaiting = engine.collectionAwaiting();
      if (node.itemTypeOptions && awaiting === "item" && !engine.collectionState?.dealType && action.type === "dealtype") {
        // Просто запоминаем выбранный тип и перерисовываем шаг заново —
        // саму коллекцию это никак не продвигает.
        engine.collectionState.dealType = action.payload;
      } else if (awaiting === "item") {
        const itemDocType = node.itemDocType || DEAL_TYPE_TO_DOCTYPE[engine.collectionState?.dealType];
        if (action.type === "photo" || action.type === "document") {
          if (!itemDocType) {
            await deps.sendMessage(chatId, "✍️ Для этого типа сделки нужно текстовое описание, а не файл — опишите её одним сообщением.");
            return;
          }
          let base64, mimeType;
          if (action.type === "photo") {
            ({ base64, mimeType } = await deps.downloadLargestPhoto(action.payload));
          } else {
            const { buffer } = await deps.downloadDocument(action.payload);
            base64 = buffer.toString("base64");
            mimeType = "application/pdf";
          }
          const fields = await (deps.extractFields || realExtractFields)(itemDocType, base64, mimeType);
          const dealType = engine.collectionState?.dealType;
          engine.submitCollectionItem(dealType ? { ...fields, propertyType: dealType } : fields);
        } else if (action.type === "text") {
          const dealType = engine.collectionState?.dealType;
          if (node.collectionKey === "creditors") {
            const { name, amount } = parseManualCreditorText(action.payload);
            const { findByName } = await import("./cbr-bank-lookup.mjs");
            const found = findByName(name);
            engine.submitCollectionItem({
              creditorName: found ? found.name : name,
              creditorAddress: found ? found.address : undefined,
              totalDebt: amount ? `${amount} ₽` : undefined,
              enteredManually: true,
              raw: action.payload,
            });
            if (found) {
              await deps.sendMessage(chatId, `✅ Нашли в реестре: ${found.name}\nАдрес: ${found.address}`);
            } else {
              await deps.sendMessage(chatId, `ℹ️ «${name}» не нашёлся в реестре банков/МФО — добавлено как есть, адрес можно будет уточнить отдельно.`);
            }
          } else {
            engine.submitCollectionItem({ raw: action.payload, enteredManually: true, ...(dealType ? { propertyType: dealType } : {}) });
          }
        } else if (action.type === "skip") {
          engine.submitCollectionContinue(false);
        }
      } else {
        engine.submitCollectionContinue(action.payload === "да");
      }
    } else if (node.type === "creditors_review") {
      if (action.type === "toggle_creditor") {
        const creditors = engine.collectedData.creditors || [];
        const item = creditors[action.index];
        if (item) item.selected = !item.selected;
      } else if (action.type === "confirm_review") {
        // Оставляем только отмеченные, снимаем служебное поле selected —
        // дальше по коду (и в итоговом документе) оно не нужно.
        engine.collectedData.creditors = (engine.collectedData.creditors || [])
          .filter(c => c.selected !== false)
          .map(({ selected, ...rest }) => rest);
        engine.advance(node.next);
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
    } else if (node.type === "text_input" && action.type === "text") {
      engine.submitTextInput(action.payload);
    }
  } catch (e) {
    // Любая непредвиденная ошибка (сбой распознавания, недоступность
    // Claude API и т.п.) — сообщаем человеку прямо, вместо того чтобы
    // бот молча "завис" и не ответил вообще ничего.
    console.error("Ошибка на шаге", engine.currentNodeId, ":", e);
    // Наши собственные ошибки (например, "не удалось распознать формат
    // отчёта") уже сформулированы понятно для человека — показываем их
    // как есть. Для непредвиденных системных сбоев — общий совет.
    const isOwnMessage = e.message && !e.message.includes("fetch") && !e.message.startsWith("Error");
    const text = isOwnMessage
      ? `⚠️ ${e.message}`
      : "⚠️ Не получилось обработать это — попробуйте ещё раз, либо нажмите «Пропустить», если документа нет под рукой.";
    await deps.sendMessage(chatId, text, skipKeyboard());
    return;
  }

  await sendIntermediateDocuments(chatId, engine, deps, docsCountBefore);
  await renderCurrentStep(chatId, engine, deps);
}

// ---- Вспомогательные клавиатуры ----
// Цвет кнопки — появился только в Bot API 9.4 (февраль 2026): "primary"
// (синий), "success" (зелёный), "danger" (красный). Для остальных
// вариантов ответа цвет не задаём — пусть остаются нейтральными.
const OPTION_STYLES = { "да": "success", "нет": "danger" };

function optionsKeyboard(options) {
  return { inline_keyboard: [options.map(o => {
    const btn = { text: o, callback_data: `opt:${o}` };
    if (OPTION_STYLES[o.toLowerCase()]) btn.style = OPTION_STYLES[o.toLowerCase()];
    return btn;
  })] };
}
// Добавляет отдельной строкой кнопку "на шаг назад" к любой клавиатуре —
// позволяет вернуться к предыдущему шагу и исправить ответ, не начиная
// сценарий заново.
function withBack(keyboard) {
  return { inline_keyboard: [...keyboard.inline_keyboard, [{ text: "⬅️ Назад", callback_data: "back_bankrot", style: "primary" }]] };
}

function skipKeyboard() {
  return { inline_keyboard: [[{ text: "⏭ Пропустить (нет документа)", callback_data: "skip" }]] };
}
// Разбирает свободный текст вида "Тинькофф Банк, 50000" на название и
// сумму — сумма ищется как последнее число в сообщении, всё, что до
// него, считается названием кредитора.
function parseManualCreditorText(raw) {
  const match = raw.match(/(\d[\d\s]{0,12}\d|\d)\s*(?:руб\.?|₽)?\s*$/);
  if (!match) return { name: raw.trim(), amount: null };
  const amount = match[1].replace(/\s+/g, "");
  const name = raw.slice(0, match.index).replace(/[,;\s]+$/, "").trim();
  return { name: name || raw.trim(), amount };
}

function dealTypeKeyboard(options) {
  return { inline_keyboard: options.map(o => [{ text: o, callback_data: `dealtype:${o}` }]) };
}
function collectionItemKeyboard() {
  // Раньше здесь была ещё кнопка "Ввести вручную", но она вела в
  // недоработанный ручной ввод по нескольким полям и только путала —
  // убрали, пока не сделаем это по-настоящему. Один понятный вариант:
  // либо прислать документ, либо честно сказать, что его нет.
  return { inline_keyboard: [[{ text: "⏭ Пропустить (документа нет)", callback_data: "skip" }]] };
}
function ackKeyboard(label) {
  return { inline_keyboard: [[{ text: label || "Понятно, дальше", callback_data: "ack", style: "success" }]] };
}
function presetKeyboard(presets) {
  const rows = presets.map((p, i) => [{ text: p.label, callback_data: `preset:${i}` }]);
  rows.push([{ text: "✍️ Другое (ввести вручную)", callback_data: "preset:manual" }]);
  return { inline_keyboard: rows };
}

module.exports = { newEngine, renderCurrentStep, handleAction, STUB_TEMPLATES };
