const { createSimpleFlowHandler } = require("./simple-flow-handler-factory.js");
const { generateCancelCourtOrderApplication } = require("./cancel-court-order-docx-builder.js");

module.exports = createSimpleFlowHandler({
  flowFile: "cancel-court-order.json",
  generatorFn: generateCancelCourtOrderApplication,
  outputFilename: "Заявление об отмене судебного приказа.docx",
  caption: "📄 Возражения относительно исполнения судебного приказа готовы. Важно успеть подать их в течение 10 дней с даты получения приказа (ст. 128 ГПК РФ) — приложите этот файл и копию паспорта.",
  resumeCommand: "cancelorder",
});
