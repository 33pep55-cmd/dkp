// Собирает .docx "Договор купли-продажи транспортного средства" из уже
// распознанных данных. Ничего не выдумывает — просто расставляет по местам
// то, что передали в data.
 
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
} = require("docx");
 
function p(text, opts = {}) {
  const { bold, italic, align, spacingAfter = 120 } = opts;
  return new Paragraph({
    alignment: align || AlignmentType.JUSTIFIED,
    spacing: { after: spacingAfter, line: 300 },
    children: [new TextRun({ text, bold, italics: italic, size: 22, font: "Times New Roman" })],
  });
}
 
function heading(text) {
  return new Paragraph({
    spacing: { after: 160, before: 260, line: 300 },
    children: [new TextRun({ text, bold: true, size: 22, font: "Times New Roman" })],
  });
}
 
function initials(fio) {
  const parts = (fio || "").trim().split(/\s+/);
  if (parts.length < 2) return fio || "";
  return parts[0] + " " + parts.slice(1).map((w) => w[0] + ".").join(" ");
}
 
// data ожидается в форме:
// {
//   city, date, price,
//   seller: { fio, dob, pob, passport, issuedBy, issuedDate, deptCode, address },
//   buyer:  { fio, dob, pob, passport, issuedBy, issuedDate, deptCode, address },
//   vehicle: { model, year, vin, plate, color, pts, sts }
// }
function buildDkp(data) {
  const { seller, buyer, vehicle, city, date, price } = data;
 
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 320 },
          children: [new TextRun({ text: "ДОГОВОР КУПЛИ-ПРОДАЖИ ТРАНСПОРТНОГО СРЕДСТВА", bold: true, size: 26, font: "Times New Roman" })],
        }),
        new Paragraph({
          spacing: { after: 360 },
          children: [
            new TextRun({ text: `г. ${city || "____________"}`, size: 22, font: "Times New Roman" }),
            new TextRun({ text: "                                                                            ", size: 22, font: "Times New Roman" }),
            new TextRun({ text: date || "____________", size: 22, font: "Times New Roman" }),
          ],
        }),
 
        p(`${seller.fio}, ${seller.dob} года рождения, место рождения: ${seller.pob}, паспорт гражданина РФ серия и номер ${seller.passport}, выдан ${seller.issuedBy} ${seller.issuedDate}, код подразделения ${seller.deptCode}, зарегистрированный(ая) по адресу: ${seller.address}, именуемый(ая) в дальнейшем «Продавец», с одной стороны, и`),
        p(`${buyer.fio}, ${buyer.dob} года рождения, место рождения: ${buyer.pob}, паспорт гражданина РФ серия и номер ${buyer.passport}, выдан ${buyer.issuedBy} ${buyer.issuedDate}, код подразделения ${buyer.deptCode}, зарегистрированный(ая) по адресу: ${buyer.address}, именуемый(ая) в дальнейшем «Покупатель», с другой стороны,`),
        p("совместно именуемые «Стороны», заключили настоящий договор о нижеследующем:"),
 
        heading("1. ПРЕДМЕТ ДОГОВОРА"),
        p(`1.1. Продавец передаёт в собственность, а Покупатель принимает и оплачивает транспортное средство: ${vehicle.model}, ${vehicle.year} года выпуска, идентификационный номер (VIN) ${vehicle.vin}, государственный регистрационный знак ${vehicle.plate}, цвет кузова: ${vehicle.color}.`),
        p(`1.2. Документы на транспортное средство: паспорт транспортного средства (ПТС) ${vehicle.pts}; свидетельство о регистрации транспортного средства (СТС) ${vehicle.sts}.`),
 
        heading("2. ЦЕНА ДОГОВОРА И ПОРЯДОК РАСЧЁТОВ"),
        p(`2.1. Стоимость транспортного средства составляет ${price} рублей.`),
        p("2.2. Расчёт между Сторонами произведён полностью до подписания настоящего договора. Претензий по оплате Стороны друг к другу не имеют."),
 
        heading("3. ПЕРЕДАЧА ТРАНСПОРТНОГО СРЕДСТВА"),
        p("3.1. Продавец передаёт Покупателю транспортное средство, комплект ключей и документы, указанные в п. 1.2, в момент подписания настоящего договора."),
        p("3.2. Настоящий договор одновременно является актом приёма-передачи транспортного средства и подтверждает отсутствие взаимных претензий Сторон по техническому состоянию и комплектности транспортного средства."),
 
        heading("4. ЗАВЕРЕНИЯ ПРОДАВЦА"),
        p("4.1. Продавец заверяет, что до заключения настоящего договора транспортное средство никому другому не продано, не заложено, в споре и под арестом (запрещением) не состоит, свободно от любых прав третьих лиц."),
 
        heading("5. ПРОЧИЕ УСЛОВИЯ"),
        p("5.1. Настоящий договор составлен в двух экземплярах, имеющих одинаковую юридическую силу, по одному экземпляру для каждой из Сторон."),
        p("5.2. Договор вступает в силу с момента подписания Сторонами и действует до полного исполнения Сторонами своих обязательств.", { spacingAfter: 420 }),
 
        heading("6. АДРЕСА И ПОДПИСИ СТОРОН"),
 
        p("ПРОДАВЕЦ:", { bold: true, spacingAfter: 60 }),
        p(seller.fio, { spacingAfter: 20 }),
        p(`Паспорт: ${seller.passport}, выдан ${seller.issuedBy} ${seller.issuedDate}, код подразделения ${seller.deptCode}`, { spacingAfter: 20 }),
        p(`Адрес регистрации: ${seller.address}`, { spacingAfter: 20 }),
        p(`Подпись: _________________________ / ${initials(seller.fio)} /`, { spacingAfter: 380 }),
 
        p("ПОКУПАТЕЛЬ:", { bold: true, spacingAfter: 60 }),
        p(buyer.fio, { spacingAfter: 20 }),
        p(`Паспорт: ${buyer.passport}, выдан ${buyer.issuedBy} ${buyer.issuedDate}, код подразделения ${buyer.deptCode}`, { spacingAfter: 20 }),
        p(`Адрес регистрации: ${buyer.address}`, { spacingAfter: 20 }),
        p(`Подпись: _________________________ / ${initials(buyer.fio)} /`, { spacingAfter: 20 }),
      ],
    }],
  });
 
  return Packer.toBuffer(doc);
}
 
module.exports = { buildDkp };
 

