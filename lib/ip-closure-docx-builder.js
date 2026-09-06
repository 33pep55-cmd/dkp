// ============================================================
// Генератор заявления на закрытие ИП — форма Р26001 (КНД 1112512),
// приложение №10 к приказу ФНС от 31.08.2020 №ЕД-7-14/617@.
// Лист 1 заполняет сам заявитель — это и генерируем. Лист 2 заполняет
// сотрудник ФНС/МФЦ/нотариус при приёме документов, его не трогаем.
// ============================================================

const { Document, Packer, Paragraph, TextRun, AlignmentType } = require("docx");

const R = (text, opts = {}) => new TextRun({ text, ...opts });
const P = (children, opts = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });

// ФИО обычно приходит одной строкой с OCR паспорта — форме нужны
// фамилия/имя/отчество раздельно.
function splitFio(fio) {
  const parts = (fio || "").trim().split(/\s+/);
  return {
    surname: parts[0] || "—",
    firstName: parts[1] || "—",
    patronymic: parts[2] || "",
  };
}

async function generateIpClosureApplication(data) {
  const { surname, firstName, patronymic } = splitFio(data.fio);

  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 } } },
      children: [
        P([R("Форма № Р26001", { size: 18 })], { alignment: AlignmentType.RIGHT, spacing: { after: 50 } }),
        P([R("КНД 1112512", { size: 18 })], { alignment: AlignmentType.RIGHT, spacing: { after: 300 } }),

        P([R("ЗАЯВЛЕНИЕ", { bold: true, size: 28 })], { alignment: AlignmentType.CENTER, spacing: { after: 50 } }),
        P([R("о государственной регистрации прекращения физическим лицом", { bold: true })], { alignment: AlignmentType.CENTER }),
        P([R("деятельности в качестве индивидуального предпринимателя", { bold: true })], { alignment: AlignmentType.CENTER, spacing: { after: 400 } }),

        P([R("1. Сведения об индивидуальном предпринимателе", { bold: true })], { spacing: { after: 150 } }),
        P([R(`1.1. ОГРНИП: ${data.ipOgrnip || "—"}`)], { spacing: { after: 100 } }),
        P([R(`1.2. Фамилия: ${surname}`)], { spacing: { after: 50 } }),
        P([R(`      Имя: ${firstName}`)], { spacing: { after: 50 } }),
        P([R(`      Отчество: ${patronymic || "—"}`)], { spacing: { after: 100 } }),
        P([R(`1.3. ИНН: ${data.inn || "—"}`)], { spacing: { after: 300 } }),

        P([R("2. Контактные данные заявителя", { bold: true })], { spacing: { after: 150 } }),
        P([R(`2.1. Номер контактного телефона: ${data.ipPhone || "—"}`)], { spacing: { after: 100 } }),
        P([R(`2.2. Адрес электронной почты: ${data.ipEmail || "—"}`)], { spacing: { after: 300 } }),

        P([R("3. Способ получения документа о результатах рассмотрения", { bold: true })], { spacing: { after: 150 } }),
        P([R("В соответствии с п. 3 ст. 11 Федерального закона от 08.08.2001 № 129-ФЗ документ, подтверждающий внесение записи в ЕГРИП, направляется регистрирующим органом в форме электронного документа по адресу электронной почты, указанному в настоящем заявлении.")], { spacing: { after: 300 } }),

        P([R("Я подтверждаю, что сведения, содержащиеся в заявлении, достоверны.")], { spacing: { after: 400 } }),

        P([R(`«____» _____________ ${new Date().getFullYear()} г.`)], { spacing: { after: 200 } }),
        P([R(`_________________ / ${surname} ${firstName} ${patronymic} /`.replace(/\s+\//, " /"))], { spacing: { after: 500 } }),

        P([R("Лист 2 настоящего заявления заполняется должностным лицом регистрирующего органа, многофункционального центра или нотариусом непосредственно при приёме документов — заполнять его самостоятельно не нужно.", { italics: true, size: 18 })]),
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { generateIpClosureApplication };
