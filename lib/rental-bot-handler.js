const { createSimpleFlowHandler } = require("./simple-flow-handler-factory.js");
const { generateRentalAgreement } = require("./rental-agreement-docx-builder.js");

module.exports = createSimpleFlowHandler({
  flowFile: "rental-agreement.json",
  generatorFn: generateRentalAgreement,
  outputFilename: "Договор аренды квартиры.docx",
  caption: "📄 Черновик договора аренды готов. Обязательно проверьте все данные перед подписанием.",
  resumeCommand: "rent",
});
