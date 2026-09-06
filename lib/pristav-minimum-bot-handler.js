const { createSimpleFlowHandler } = require("./simple-flow-handler-factory.js");
const { generatePristavMinimumApplication } = require("./pristav-minimum-docx-builder.js");

module.exports = createSimpleFlowHandler({
  flowFile: "pristav-minimum.json",
  generatorFn: generatePristavMinimumApplication,
  outputFilename: "Заявление приставам о сохранении прожиточного минимума.docx",
  caption: "📄 Заявление о сохранении прожиточного минимума готово. Подать можно лично приставу, по почте или через Госуслуги.",
  resumeCommand: "minimum",
});
