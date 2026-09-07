// ============================================================
// Возражения относительно исполнения судебного приказа
// (заявление об отмене судебного приказа).
// Основание: ст. 128, 129 ГПК РФ. Срок — 10 дней с даты получения
// копии приказа. По закону и Постановлению Пленума ВС РФ №62
// от 27.12.2016 заявитель НЕ обязан обосновывать причины несогласия —
// достаточно самого факта несогласия.
// ============================================================

const { Document, Packer, Paragraph, TextRun, AlignmentType } = require("docx");

const R = (text, opts = {}) => new TextRun({ text, ...opts });
const P = (children, opts = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });

function splitPassport(passport) {
  const match = (passport || "").match(/(\d{2}\s?\d{2})\D*(\d{6})/);
  return match ? { series: match[1], number: match[2] } : { series: "—", number: "—" };
}

async function generateCancelCourtOrderApplication(data) {
  const name = data.fio || "—";
  const passportParts = splitPassport(data.passport);

  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 } } },
      children: [
        P([R(`${data.courtName || "Мировому судье судебного участка №___"}`)], { alignment: AlignmentType.RIGHT }),
        P([R(`от должника: ${name},`)], { alignment: AlignmentType.RIGHT }),
        P([R(`адрес регистрации: ${data.address || "—"},`)], { alignment: AlignmentType.RIGHT }),
        P([R(`паспорт: ${passportParts.series} ${passportParts.number}`)], { alignment: AlignmentType.RIGHT, spacing: { after: 100 } }),
        P([R(`Взыскатель: ${data.creditorName || "—"}`)], { alignment: AlignmentType.RIGHT, spacing: { after: 400 } }),

        P([R("ВОЗРАЖЕНИЯ", { bold: true, size: 28 })], { alignment: AlignmentType.CENTER, spacing: { after: 50 } }),
        P([R("относительно исполнения судебного приказа", { bold: true })], { alignment: AlignmentType.CENTER, spacing: { after: 400 } }),

        P([R(`${data.courtName || "Мировым судьёй указанного судебного участка"} вынесен судебный приказ ${data.orderNumber || "№ ___ от ___"} о взыскании с меня, ${name}, задолженности в пользу ${data.creditorName || "взыскателя"}.`)], { spacing: { after: 200 } }),

        P([R(`Копию судебного приказа я получил(а) ${data.receivedDate || "—"}.`)], { spacing: { after: 200 } }),

        P([R("В соответствии со ст. 128, 129 Гражданского процессуального кодекса Российской Федерации я возражаю относительно исполнения указанного судебного приказа. Согласно ст. 129 ГПК РФ и п. 31 Постановления Пленума Верховного Суда РФ от 27.12.2016 № 62 обязанность обосновывать причины несогласия с исполнением судебного приказа на должника не возлагается.")], { spacing: { after: 300 } }),

        P([R("На основании изложенного, руководствуясь ст. 128, 129 ГПК РФ,", { bold: true })], { spacing: { after: 150 } }),
        P([R("ПРОШУ:", { bold: true })], { spacing: { after: 150 } }),
        P([R(`Отменить судебный приказ ${data.orderNumber || "№ ___ от ___"}.`)], { spacing: { after: 400 } }),

        P([R("Приложения:", { bold: true })], { spacing: { after: 100 } }),
        P([R("— копия паспорта;")], { spacing: { after: 30 } }),
        P([R("— копия судебного приказа (при наличии);")], { spacing: { after: 30 } }),
        P([R("— настоящие возражения в двух экземплярах.")], { spacing: { after: 300 } }),

        P([R(`«____» _____________ ${new Date().getFullYear()} г.`)], { spacing: { after: 200 } }),
        P([R(`_________________ / ${name} /`)]),
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { generateCancelCourtOrderApplication };
