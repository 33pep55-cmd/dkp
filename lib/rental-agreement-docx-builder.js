// ============================================================
// Генератор договора аренды квартиры — та же логика, что у ДКП и
// заявления о банкротстве, только под новый шаблон. Принимает
// collectedData из WizardEngine (rental-agreement.json).
// ============================================================

const { Document, Packer, Paragraph, TextRun, AlignmentType } = require("docx");

const R = (text, opts = {}) => new TextRun({ text, ...opts });
const P = (children, opts = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });

// OCR отдаёт паспорт одной строкой "45 12 678910" — договору нужны
// серия и номер раздельно.
function splitPassport(passport) {
  const match = (passport || "").match(/(\d{2}\s?\d{2})\D*(\d{6})/);
  return match ? { series: match[1], number: match[2] } : { series: "—", number: "—" };
}

function personBlock(data, role, label) {
  const passportParts = splitPassport(data[`${role}Passport`]);
  return `${label}: ${data[`${role}Fio`] || "—"}, дата рождения ${data[`${role}Dob`] || "—"}, ` +
    `паспорт ${passportParts.series} ${passportParts.number}, выдан ${data[`${role}IssuedDate`] || "—"}, ` +
    `${data[`${role}IssuedBy`] || "—"}, код подразделения ${data[`${role}DeptCode`] || "—"}, ` +
    `зарегистрирован(а) по адресу: ${data[`${role}Address`] || "—"}`;
}

function formatMoney(value) {
  const num = typeof value === "string" ? parseFloat(value.replace(/[^\d.,]/g, "").replace(",", ".")) : value;
  return Number.isFinite(num) ? num.toLocaleString("ru-RU") : (value || "—");
}

async function generateRentalAgreement(data) {
  const today = new Date().toLocaleDateString("ru-RU");

  const doc = new Document({
    sections: [{
      children: [
        P([R("ДОГОВОР АРЕНДЫ ЖИЛОГО ПОМЕЩЕНИЯ", { bold: true, size: 28 })], { alignment: AlignmentType.CENTER, spacing: { after: 100 } }),
        P([R(`г. _______________`)], { spacing: { after: 50 } }),
        P([R(`«___» _____________ ${new Date().getFullYear()} г.`)], { spacing: { after: 300 } }),

        P([R(personBlock(data, "landlord", "Арендодатель"))], { spacing: { after: 150 } }),
        P([R(personBlock(data, "tenant", "Арендатор"))], { spacing: { after: 300 } }),

        P([R("заключили настоящий договор о нижеследующем:")], { spacing: { after: 300 } }),

        P([R("1. Предмет договора", { bold: true })], { spacing: { after: 100 } }),
        P([R(`1.1. Арендодатель предоставляет Арендатору за плату во временное владение и пользование жилое помещение, расположенное по адресу: ${data.apartmentAddress || "—"}.`)], { spacing: { after: 100 } }),
        P([R(`1.2. Характеристики помещения: ${data.apartmentDetails || "—"}. Кадастровый номер: ${data.cadastralNumber || "не указан"}.`)], { spacing: { after: 300 } }),

        P([R("2. Срок действия договора", { bold: true })], { spacing: { after: 100 } }),
        P([R(`2.1. Договор действует ${data.leaseTerm || "—"}.`)], { spacing: { after: 100 } }),
        P([R(`2.2. Условия продления: ${data.renewalTerms || "—"}.`)], { spacing: { after: 300 } }),

        P([R("3. Размер и порядок внесения арендной платы", { bold: true })], { spacing: { after: 100 } }),
        P([R(`3.1. Размер арендной платы составляет ${formatMoney(data.rentAmount)} руб. в месяц.`)], { spacing: { after: 100 } }),
        P([R(`3.2. Порядок и сроки внесения платы: ${data.paymentTerms || "—"}.`)], { spacing: { after: 300 } }),

        P([R("4. Залог (депозит)", { bold: true })], { spacing: { after: 100 } }),
        P([R(`4.1. Арендатор передаёт Арендодателю обеспечительный платёж (депозит) в размере ${formatMoney(data.depositAmount)} руб.`)], { spacing: { after: 100 } }),
        P([R(`4.2. Порядок и условия возврата депозита: ${data.depositReturnTerms || "—"}.`)], { spacing: { after: 300 } }),

        P([R("5. Опись имущества и показания приборов учёта", { bold: true })], { spacing: { after: 100 } }),
        P([R(data.inventoryDescription || "—")], { spacing: { after: 300 } }),

        P([R("6. Прочие условия", { bold: true })], { spacing: { after: 100 } }),
        P([R("6.1. Арендатор обязуется использовать помещение по назначению, поддерживать его в надлежащем состоянии и своевременно вносить арендную плату и коммунальные платежи.")], { spacing: { after: 100 } }),
        P([R("6.2. Договор составлен в двух экземплярах, имеющих одинаковую юридическую силу, — по одному для каждой из сторон.")], { spacing: { after: 400 } }),

        P([R("Подписи сторон:", { bold: true })], { spacing: { after: 200 } }),
        P([R(`Арендодатель: _________________ / ${data.landlordFio || ""} /`)], { spacing: { after: 150 } }),
        P([R(`Арендатор: _________________ / ${data.tenantFio || ""} /`)]),
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { generateRentalAgreement };
