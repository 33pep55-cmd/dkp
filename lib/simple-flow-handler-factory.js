// ============================================================
// Общая "фабрика" обработчика для несложных текстовых сценариев
// (договор аренды, заявление приставам, отмена судебного приказа) —
// у всех одна и та же форма: пара фото + серия текстовых вопросов +
// готовый документ. Чтобы не копировать один и тот же код три раза,
// собираем обработчик один раз здесь, передавая только то, чем
// конкретный сценарий отличается (файл схемы, генератор документа,
// имя итогового файла).
// ============================================================

const path = require("path");
const WizardEngine = require("../engine/wizard-engine.js");
const realExtractFields = require("./claude.js").extractFields;

const GUIDE_ASSETS = {
  passport_main: "guide_passport_main.gif",
  passport_registration: "guide_passport_reg.gif",
};

function createSimpleFlowHandler({ flowFile, generatorFn, outputFilename, caption, resumeCommand }) {
  const FLOW_PATH = path.join(__dirname, "..", "flows", flowFile);

  function newEngine() {
    return new WizardEngine(FLOW_PATH);
  }

  function optionsKeyboard(options) {
    const OPTION_STYLES = { "да": "success", "нет": "danger" };
    return { inline_keyboard: [options.map(o => {
      const btn = { text: o, callback_data: `opt:${o}` };
      if (OPTION_STYLES[o.toLowerCase()]) btn.style = OPTION_STYLES[o.toLowerCase()];
      return btn;
    })] };
  }

  async function renderCurrentStep(chatId, engine, deps) {
    try {
      if (engine.isFinished()) {
        const buffer = await generatorFn(engine.collectedData);
        await deps.sendDocument(chatId, buffer, outputFilename, caption);
        return;
      }

      const node = engine.currentNode();

      if (node.type === "upload") {
        const cap = `📎 ${node.title}\n\nНажмите на значок скрепки 📎 и прикрепите фото документа.`;
        const asset = GUIDE_ASSETS[node.docType];
        if (asset && deps.sendGuideAnimation) {
          await deps.sendGuideAnimation(chatId, asset, cap);
        } else {
          await deps.sendMessage(chatId, cap);
        }
        return;
      }

      if (node.type === "text_input") {
        await deps.sendMessage(chatId, `✍️ ${node.title}`);
        return;
      }

      if (node.type === "question") {
        await deps.sendMessage(chatId, `❓ ${node.title}`, optionsKeyboard(node.options));
        return;
      }

      throw new Error(`Неизвестный тип узла: ${node.type}`);
    } catch (e) {
      console.error(`Ошибка на шаге (${flowFile})`, engine.currentNodeId, ":", e);
      await deps.sendMessage(chatId, `⚠️ Что-то пошло не так — попробуйте написать /${resumeCommand} ещё раз.`);
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
      } else if (node.type === "question") {
        engine.submitAnswer(action.payload);
      }
    } catch (e) {
      console.error(`Ошибка при обработке шага (${flowFile})`, engine.currentNodeId, ":", e);
      await deps.sendMessage(chatId, "⚠️ Не получилось обработать это — попробуйте ещё раз.");
      return;
    }

    await renderCurrentStep(chatId, engine, deps);
  }

  return { newEngine, renderCurrentStep, handleAction };
}

module.exports = { createSimpleFlowHandler };
