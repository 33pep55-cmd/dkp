// ============================================================
// Генератор заявления о банкротстве физлица — та же логика, что
// generate-contract.js для ДКП, только под гораздо более крупный
// документ. Принимает collectedData из WizardEngine (bankruptcy-full.json)
// и собирает готовый .docx по структуре реального образца.
// ============================================================

const {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle,
} = require("docx");

const R = (text, opts = {}) => new TextRun({ text, ...opts });
const P = (children, opts = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });

function formatMoney(value) {
  const num = typeof value === "string" ? parseFloat(value.replace(/[^\d.,]/g, "").replace(",", ".")) : value;
  if (!Number.isFinite(num)) return "0,00";
  return num.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fullName(data) {
  return [data.surname, data.firstName, data.patronymic].filter(Boolean).join(" ");
}

// ---- Текстовые блоки, которые меняются в зависимости от собранных данных ----

function employmentText(data) {
  const hasIncome = !!data.monthlyIncome;
  return hasIncome
    ? "Должник осуществляет трудовую деятельность, что подтверждается прилагаемой справкой о доходах."
    : "Должник не осуществляет трудовую деятельность, электронная трудовая книжка приложена.";
}

function realtyText(data) {
  const realty = data.realty || [];
  if (realty.length === 0) {
    return "На момент подачи настоящего заявления у Должника в собственности не имеется недвижимое имущество.";
  }
  const items = realty
    .map(r => `${r.propertyType || "Объект недвижимости"}, площадью ${r.propertyArea || "—"} кв.м, адрес: ${r.propertyAddress || "—"}${r.restrictionNote ? ` (обременение: ${r.restrictionNote})` : ""}.`)
    .join("\n");
  return `На момент подачи настоящего заявления у Должника в собственности имеется следующее недвижимое имущество:\n${items}`;
}

function vehiclesText(data) {
  const vehicles = data.vehicles || [];
  if (vehicles.length === 0) {
    return "На момент подачи настоящего заявления у Должника в собственности не имеется движимое имущество.";
  }
  const items = vehicles
    .map(v => `${v.model || "Транспортное средство"}, VIN: ${v.vin || "—"}.`)
    .join("\n");
  return `На момент подачи настоящего заявления у Должника в собственности имеется следующее движимое имущество:\n${items}`;
}

function marriageText(data) {
  const status = data.maritalStatus || "не в браке"; // "в браке" | "не в браке" | "вдовец/вдова"
  if (status === "в браке") {
    const contractLine = data.hasMarriageContract
      ? "Брачный договор заключён."
      : "Брачный договор не заключался.";
    return `Должник состоит в зарегистрированном браке с ${data.spouseName || "супругом(ой)"}. ${contractLine} Соглашение/судебный акт о разделе общего имущества супругов не заключалось/не принимался.`;
  }
  if (status === "вдовец/вдова") {
    return `Брак прекращён в связи со смертью супруга(и) ${data.spouseName || ""}.`.trim();
  }
  return "Должник не состоит в зарегистрированном браке. Брачный договор не заключался. В течение трёх лет до даты подачи заявления брак не расторгался.";
}

function childrenText(data) {
  const children = data.children || [];
  if (children.length === 0) {
    return "На иждивении у должника не имеется несовершеннолетних детей.";
  }
  const names = children.map(c => `${c.childFio} (${c.childBirthDate} г.р.)`).join(", ");
  return `На иждивении у должника имеется ${children.length} несовершеннолетн${children.length === 1 ? "ий ребёнок" : "их детей"}: ${names}.`;
}

function ipText(data) {
  return data.ipWasClosed
    ? "Акционером (участником) юридического лица не является. Ранее была зарегистрирована в качестве индивидуального предпринимателя; статус ИП прекращён в установленном порядке до подачи настоящего заявления."
    : "Акционером (участником) юридического лица не является, в качестве индивидуального предпринимателя не зарегистрирован(а).";
}

// ---- Список приложений — генерируется по факту того, что реально собрано ----

function buildAttachmentsList(data) {
  const items = ["Паспорт РФ должника", "СНИЛС", "ИНН"];
  if (data.ipWasClosed) items.push("Заявление о государственной регистрации прекращения деятельности ИП (форма Р26001)");
  items.push("Справка о состоянии индивидуального лицевого счёта застрахованного лица");
  if (data.maritalStatus === "в браке") items.push("Свидетельство о заключении брака");
  if (data.hasMarriageContract) items.push("Брачный договор");
  if (data.maritalStatus === "вдовец/вдова") items.push("Свидетельство о смерти супруга");
  if ((data.children || []).length > 0) items.push("Свидетельства о рождении детей");
  if ((data.realty || []).length > 0) items.push("Выписки ЕГРН на объекты недвижимости");
  else items.push("Отрицательная выписка ЕГРН");
  if (data.mortgageBalance) items.push("Ипотечный договор и справка об остатке долга");
  if ((data.deals || []).length > 0) items.push("Документы по сделкам за последние 3 года");
  items.push("Кредитная история («Кредистория», Скоринг Бюро)");
  items.push("Список кредиторов и должников гражданина");
  items.push("Опись имущества гражданина");
  if (data.monthlyIncome) items.push("Справка о доходах (2-НДФЛ)");
  return items;
}

// ---- Основная функция ----

async function generateBankruptcyApplication(data) {
  const name = fullName(data);
  const creditors = data.creditors || [];
  const totalDebt = creditors.reduce((sum, c) => {
    const val = typeof c.totalDebt === "string" ? parseFloat(c.totalDebt.replace(/[^\d.,]/g, "").replace(",", ".")) : c.totalDebt;
    return sum + (Number.isFinite(val) ? val : 0);
  }, 0);

  const sro = data.sroName
    ? { name: data.sroName, inn: data.sroInn || "—", ogrn: data.sroOgrn || "—", address: data.sroAddress || "—", email: data.sroEmail || "—" }
    : {
        name: "Саморегулируемая межрегиональная общественная организация «Ассоциация антикризисных управляющих» (сокращённое название САМРО «Ассоциация антикризисных управляющих»)",
        inn: "6315944042", ogrn: "1026300003751",
        address: "443072, Самарская область, город Самара, тер. 18 км Московского шоссе",
        email: "samro@bk.ru",
      };

  const today = new Date().toLocaleDateString("ru-RU");

  const creditorRows = creditors.map((c, i) => new TableRow({
    children: [
      cell(`1.${i + 1}`), cell("Кредитор"), cell(c.creditorName || "—"),
      cell(c.creditorAddress || "не установлено"),
      cell(c.creditorBasis || (c.creditorKind === "МФО" ? "Согласно кредитной истории" : "Согласно кредитной истории «Кредистория»")),
      cell(formatMoney(c.totalDebt)), cell(formatMoney(c.overdueDebt || c.totalDebt)), cell("-"),
    ],
  }));

  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 } } },
      children: [
        P([R(data.courtName || "В Арбитражный суд", { bold: true })], { spacing: { after: 100 } }),
        P([R(data.courtAddress || "", { bold: true })], { spacing: { after: 300 } }),

        P([R(`Должник: ${name}`, { bold: true })], { spacing: { after: 100 } }),
        P([R(`Дата рождения: ${data.birthDate || "—"}`)], { spacing: { after: 50 } }),
        P([R(`Место рождения: ${data.birthPlace || "—"}`)], { spacing: { after: 50 } }),
        P([R(`СНИЛС ${data.snils || "—"}`)], { spacing: { after: 50 } }),
        P([R(`ИНН ${data.inn || "—"}`)], { spacing: { after: 50 } }),
        P([R(`Паспорт серия: ${data.passportSeries || "—"} № ${data.passportNumber || "—"}`)], { spacing: { after: 50 } }),
        P([R(`выдан ${data.passportIssuedDate || "—"}, ${data.passportIssuedBy || "—"}, код подразделения ${data.passportDeptCode || "—"}`)], { spacing: { after: 50 } }),
        P([R(`Адрес регистрации: ${data.regAddress || "—"}`)], { spacing: { after: 300 } }),

        P([R("Кредиторы:", { bold: true })], { spacing: { after: 100 } }),
        ...creditors.map((c, i) => P([R(`${i + 1}. ${c.creditorName || "—"}`)], { spacing: { after: 30 } })),
        P([R(`Сумма задолженности ${formatMoney(totalDebt)} руб.`, { bold: true })], { spacing: { after: 400 } }),

        P([R("ЗАЯВЛЕНИЕ", { bold: true, size: 28 })], { alignment: AlignmentType.CENTER, spacing: { after: 50 } }),
        P([R("гражданина о признании его несостоятельным (банкротом)", { bold: true })], { alignment: AlignmentType.CENTER, spacing: { after: 300 } }),

        P([R(`${name} (дата рождения: ${data.birthDate || "—"} г.р., место рождения: ${data.birthPlace || "—"}, СНИЛС ${data.snils || "—"}, ИНН ${data.inn || "—"}, паспорт: ${data.passportSeries || "—"} ${data.passportNumber || "—"}, выдан ${data.passportIssuedDate || "—"}, ${data.passportIssuedBy || "—"}, код подразделения ${data.passportDeptCode || "—"}, адрес регистрации: ${data.regAddress || "—"}, обращается в арбитражный суд с настоящим заявлением в порядке ст. 213.4 Федерального закона от 26.10.2002 г. № 127-ФЗ «О несостоятельности (банкротстве)», что обусловлено его(её) неплатёжеспособностью и неспособностью погасить кредиторскую задолженность в полном объёме.`)], { spacing: { after: 300 } }),

        P([R("Сведения о кредиторской задолженности.")], { spacing: { after: 100 } }),
        P([R(`Общая сумма кредиторской задолженности составляет: ${formatMoney(totalDebt)} рублей, из них:`)], { spacing: { after: 200 } }),

        new Table({
          width: { size: 9638, type: WidthType.DXA },
          rows: [
            new TableRow({ children: [
              cell("№ п/п", true), cell("Содержание обязательства", true), cell("Кредитор", true),
              cell("Место нахождения кредитора", true), cell("Основание возникновения", true),
              cell("Всего", true), cell("В т.ч. задолженность", true), cell("Санкции", true),
            ]}),
            ...creditorRows,
          ],
        }),

        P([R("")], { spacing: { after: 200 } }),
        P([R(employmentText(data))], { spacing: { after: 200 } }),
        P([R(realtyText(data))], { spacing: { after: 200 } }),
        P([R(vehiclesText(data))], { spacing: { after: 200 } }),
        P([R(marriageText(data))], { spacing: { after: 200 } }),
        P([R(childrenText(data))], { spacing: { after: 200 } }),
        P([R(ipText(data))], { spacing: { after: 300 } }),

        P([R("Должник не в состоянии исполнить денежные обязательства в установленный срок. Удовлетворение требований одного из кредиторов (или нескольких кредиторов) приведёт к невозможности исполнения должником денежных обязательств в полном объёме перед другими кредиторами.")], { spacing: { after: 300 } }),

        P([R(`На основании п. 4 ст. 213.4 Федерального закона от 26.10.2002 № 127-ФЗ «О несостоятельности (банкротстве)», финансового управляющего прошу утвердить из членов следующей саморегулируемой организации (СРО): ${sro.name}, ИНН ${sro.inn}, ОГРН ${sro.ogrn}, адрес: ${sro.address}, e-mail: ${sro.email}.`)], { spacing: { after: 300 } }),

        P([R("ПРОШУ:", { bold: true })], { spacing: { after: 150 } }),
        P([R(`1) Признать гражданина Российской Федерации ${name} несостоятельным (банкротом);`)], { spacing: { after: 100 } }),
        P([R("2) Ввести в отношении должника процедуру реализации имущества;")], { spacing: { after: 100 } }),
        P([R("3) Предоставить должнику отсрочку внесения денежных средств на выплату вознаграждения финансовому управляющему сроком до даты судебного заседания по рассмотрению обоснованности заявления;")], { spacing: { after: 100 } }),
        P([R(`4) Утвердить финансового управляющего из числа членов ${sro.name}, ИНН ${sro.inn}, ОГРН ${sro.ogrn};`)], { spacing: { after: 100 } }),
        P([R("5) Истребовать недостающие документы на основании ст. 66 АПК РФ самостоятельно.")], { spacing: { after: 300 } }),

        P([R("Приложения:", { bold: true })], { spacing: { after: 100 } }),
        ...buildAttachmentsList(data).map(item => P([R(`— ${item}`)], { spacing: { after: 30 } })),

        P([R("")], { spacing: { after: 300 } }),
        P([R(`«____» _____________ ${new Date().getFullYear()} г.`)], { spacing: { after: 200 } }),
        P([R(`_________________ / ${name} /`)]),
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

function cell(text, header = false) {
  return new TableCell({
    children: [P([R(text, { bold: header, size: header ? 16 : 18 })])],
    width: { size: 1200, type: WidthType.DXA },
  });
}

module.exports = { generateBankruptcyApplication };