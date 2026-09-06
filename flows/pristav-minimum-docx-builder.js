// ============================================================
// Заявление судебному приставу-исполнителю о сохранении
// прожиточного минимума при обращении взыскания на доходы должника.
// Основание: п. 6 ст. 8, ч. 5.1 ст. 69, ст. 99 ФЗ от 02.10.2007
// № 229-ФЗ «Об исполнительном производстве».
// ============================================================

const { Document, Packer, Paragraph, TextRun, AlignmentType } = require("docx");

const R = (text, opts = {}) => new TextRun({ text, ...opts });
const P = (children, opts = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });

function splitPassport(passport) {
  const match = (passport || "").match(/(\d{2}\s?\d{2})\D*(\d{6})/);
  return match ? { series: match[1], number: match[2] } : { series: "—", number: "—" };
}

async function generatePristavMinimumApplication(data) {
  const name = data.fio || "—";
  const passportParts = splitPassport(data.passport);
  const dependentsLine = data.hasDependents
    ? `На моём иждивении находятся: ${data.dependentsInfo || "—"}. Прошу учесть это при определении сохраняемой суммы.`
    : "";

  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 } } },
      children: [
        P([R(`Судебному приставу-исполнителю`)], { alignment: AlignmentType.RIGHT }),
        P([R(`${data.ospName || "___________________________"}`)], { alignment: AlignmentType.RIGHT, spacing: { after: 100 } }),
        P([R(`от ${name},`)], { alignment: AlignmentType.RIGHT }),
        P([R(`адрес регистрации: ${data.address || "—"},`)], { alignment: AlignmentType.RIGHT }),
        P([R(`паспорт: ${passportParts.series} ${passportParts.number}`)], { alignment: AlignmentType.RIGHT, spacing: { after: 400 } }),

        P([R("ЗАЯВЛЕНИЕ", { bold: true, size: 28 })], { alignment: AlignmentType.CENTER, spacing: { after: 50 } }),
        P([R("о сохранении заработной платы и иных доходов должника", { bold: true })], { alignment: AlignmentType.CENTER }),
        P([R("ежемесячно в размере прожиточного минимума", { bold: true })], { alignment: AlignmentType.CENTER, spacing: { after: 400 } }),

        P([R(`В производстве ${data.ospName || "указанного отдела судебных приставов"} находится исполнительное производство ${data.caseNumber && data.caseNumber.toLowerCase() !== "не знаю" ? `№ ${data.caseNumber}` : "(номер уточняется)"}, в рамках которого производится обращение взыскания на мои доходы.`)], { spacing: { after: 200 } }),

        P([R("В соответствии с п. 6 ст. 8, ч. 5.1 и 5.2 ст. 69, ст. 99 Федерального закона от 02.10.2007 № 229-ФЗ «Об исполнительном производстве» должник-гражданин вправе обратиться с заявлением о сохранении ему заработной платы и иных доходов ежемесячно в размере прожиточного минимума трудоспособного населения в целом по Российской Федерации (либо по субъекту Российской Федерации по месту его жительства).")], { spacing: { after: 200 } }),

        dependentsLine ? P([R(dependentsLine)], { spacing: { after: 200 } }) : P([R("")]),

        P([R(`Доход поступает на следующий счёт/карту: ${data.accountDetails || "—"}.`)], { spacing: { after: 300 } }),

        P([R("На основании изложенного", { bold: true })], { spacing: { after: 150 } }),
        P([R("ПРОШУ:", { bold: true })], { spacing: { after: 150 } }),
        P([R("Сохранять мне ежемесячно заработную плату и иные доходы в размере прожиточного минимума трудоспособного населения в целом по Российской Федерации (с учётом лиц, находящихся на моём иждивении, при наличии) при обращении взыскания по указанному исполнительному производству.")], { spacing: { after: 400 } }),

        P([R("Приложения:", { bold: true })], { spacing: { after: 100 } }),
        P([R("— копия паспорта;")], { spacing: { after: 30 } }),
        ...(data.hasDependents ? [P([R("— документы, подтверждающие нахождение иждивенцев на содержании (свидетельства о рождении и т.п.);")], { spacing: { after: 30 } })] : []),

        P([R("")], { spacing: { after: 300 } }),
        P([R(`«____» _____________ ${new Date().getFullYear()} г.`)], { spacing: { after: 200 } }),
        P([R(`_________________ / ${name} /`)]),
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { generatePristavMinimumApplication };
