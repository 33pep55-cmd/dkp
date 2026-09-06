const path = require("path");
const WizardEngine = require("../engine/wizard-engine.js");
const realExtractFields = require("./claude.js").extractFields;
const { generateRentalAgreement } = require("./rental-agreement-docx-builder.js");

const FLOW_PATH = path.join(__dirname, "..", "flows", "rental-agreement.json");

const GUIDE_ASSETS = {
  passport_main: "guide_passport_main.gif",
  passport_registration: "guide_passport_reg.gif",
};

function newEngine() {
  return new WizardEngine(FLOW_PATH);
}

async function renderCurrentStep(chatId, engine, deps) {
  try {
    if (engine.isFinished()) {
      const buffer = await generateRentalAgreement(engine.collectedData);
      await deps.sendDocument(chatId, buffer, "dogovor_arendy.docx",
        "📄 Черновик договора аренды готов. Обязательно проверьте все данные перед подписанием.");
      return;
    }

    const node = engine.currentNode();

    if (node.type === "upload") {
      const caption = `📎 ${node.title}\n\nНажмите на значок скрепки 📎 и прикрепите фото документа.`;
      const asset = GUIDE_ASSETS[node.docType];
      if (asset && deps.sendGuideAnimation) {
        await deps.sendGuideAnimation(chatId, asset, caption);
      } else {
        await deps.sendMessage(chatId, caption);
      }
      return;
    }

    if (node.type === "text_input") {
      await deps.sendMessage(chatId, `✍️ ${node.title}`);
      return;
    }

    throw new Error(`Неизвестный тип узла: ${node.type}`);
  } catch (e) {
    console.error("Ошибка на шаге договора аренды", engine.currentNodeId, ":", e);
    await deps.sendMessage(chatId, "⚠️ Что-то пошло не так — попробуйте написать /rent ещё раз.");
  }
}

async function handleAction(chatId, engine, action, deps) {
  const node = engine.currentNode();

  try {
    if (node.type === "upload" && action.type === "photo") {
      const { base64, mimeType } = await deps.downloadLargestPhoto(action.payload);
      const fields = await (deps.extractFields || realExtractFields)(node.docType, base64, mimeType);
      engine.submitUpload(fields);
    } else if (node.type === "text_input" && action.type === "text") {
      engine.submitTextInput(action.payload);
    }
  } catch (e) {
    console.error("Ошибка при обработке шага", engine.currentNodeId, ":", e);
    await deps.sendMessage(chatId, "⚠️ Не получилось обработать это — попробуйте ещё раз.");
    return;
  }

  await renderCurrentStep(chatId, engine, deps);
}

module.exports = { newEngine, renderCurrentStep, handleAction };
