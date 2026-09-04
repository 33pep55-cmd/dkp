// Собирает .docx "Заявление о совершении регистрационных действий" (форма
// Госавтоинспекции) на основе уже собранных данных о покупателе (новом
// собственнике) и транспортном средстве — тех же, что используются для ДКП.
// Автоматически заполняется то, что уже известно из отсканированных
// документов; номер телефона, e-mail, ИНН, СНИЛС, наименование подразделения
// Госавтоинспекции, дата и подпись оставлены пустыми — это заполняется от
// руки непосредственно при подаче заявления.
//
// Оборотная сторона (стр. 2-3 бланка) — служебная часть, которую заполняет
// сотрудник Госавтоинспекции при приёме. Она включена в файл для полноты
// бланка (чтобы распечатать одним документом), данные о ТС, которые уже
// известны, вписаны заранее, остальное оставлено пустым как в оригинале.

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, PageBreak,
} = require("docx");

const LABEL_W = 5600;
const VALUE_W = 4300;
const TABLE_W = LABEL_W + VALUE_W;

const CELL_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
};

function cellText(text, opts = {}) {
  const { bold } = opts;
  return new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: text || "", bold, size: 20, font: "Times New Roman" })],
  });
}

function row(label, value) {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: LABEL_W, type: WidthType.DXA },
        borders: CELL_BORDER,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [cellText(label)],
      }),
      new TableCell({
        width: { size: VALUE_W, type: WidthType.DXA },
        borders: CELL_BORDER,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [cellText(value)],
      }),
    ],
  });
}

function table(rows) {
  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: [LABEL_W, VALUE_W],
    rows,
  });
}

function heading(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 220, after: 140 },
    children: [new TextRun({ text, bold: true, size: 20, font: "Times New Roman" })],
  });
}

function p(text, opts = {}) {
  const { spacingAfter = 120 } = opts;
  return new Paragraph({
    spacing: { after: spacingAfter, line: 280 },
    children: [new TextRun({ text, size: 22, font: "Times New Roman" })],
  });
}

function initials(fio) {
  const parts = (fio || "").trim().split(/\s+/);
  if (parts.length < 2) return fio || "";
  return parts[0] + " " + parts.slice(1).map((w) => w[0] + ".").join(" ");
}

// data: { buyer, vehicle, city }
function buildGibddForm(data) {
  const { buyer = {}, vehicle = {} } = data;

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: "ЗАЯВЛЕНИЕ", bold: true, size: 28, font: "Times New Roman" })],
        }),
        p("В Госавтоинспекцию ____________________________________________ (наименование подразделения — вписать при подаче)."),
        p(`Я, ${buyer.fio || ""}, представляя нижеследующие документы, прошу:`),
        p("Предоставить: государственную регистрацию транспортного средства в связи с изменением собственника (владельца)."),
        p("С выдачей / без выдачи государственных регистрационных знаков (нужное подчеркнуть при подаче)."),

        heading("СВЕДЕНИЯ О ВЛАДЕЛЬЦЕ ТРАНСПОРТНОГО СРЕДСТВА (НОВЫЙ СОБСТВЕННИК)"),
        table([
          row("Собственник (ФИО)", buyer.fio),
          row("Дата и место рождения", `${buyer.dob || ""} г., место рождения: ${buyer.pob || ""}`),
          row("Документ, удостоверяющий личность", `паспорт РФ ${buyer.passport || ""}, выдан ${buyer.issuedBy || ""} ${buyer.issuedDate || ""}, код подразделения ${buyer.deptCode || ""}`),
          row("Адрес регистрации по месту жительства", buyer.address),
          row("Номер телефона", ""),
          row("Электронная почта (при наличии)", ""),
          row("Гражданство", "Российская Федерация"),
          row("Пол", ""),
          row("ИНН (при наличии)", ""),
          row("СНИЛС (по желанию)", ""),
        ]),

        heading("ПРЕДСТАВИТЕЛЬ ВЛАДЕЛЬЦА ТРАНСПОРТНОГО СРЕДСТВА"),
        p("(заполняется только если заявление подаёт представитель по доверенности; если Собственник обращается лично — раздел не заполняется)", { spacingAfter: 100 }),
        table([
          row("ФИО представителя", ""),
          row("Дата рождения", ""),
          row("Документ, удостоверяющий личность", ""),
          row("Адрес регистрации", ""),
          row("Номер телефона", ""),
          row("Доверенность (в случае необходимости)", ""),
        ]),

        p(" ", { spacingAfter: 260 }),
        p(`Дата подачи заявления: _________________        Подпись: _________________        (${initials(buyer.fio)})`),

        new Paragraph({ children: [new PageBreak()] }),

        heading("СВЕДЕНИЯ О ТРАНСПОРТНОМ СРЕДСТВЕ (оборотная сторона — заполняется сотрудником Госавтоинспекции)"),
        table([
          row("Государственный регистрационный номер", vehicle.plate),
          row("Идентификационный номер (VIN)", vehicle.vin),
          row("Модель, марка", vehicle.model),
          row("Тип транспортного средства", ""),
          row("Цвет", vehicle.color),
          row("Категория (A, B, C, D, прицеп – E)", ""),
          row("Год выпуска", vehicle.year),
          row("Шасси (рама) №", ""),
          row("Регистрационный документ ТС", [vehicle.pts && `ПТС ${vehicle.pts}`, vehicle.sts && `СТС ${vehicle.sts}`].filter(Boolean).join("; ")),
          row("Кузов (кабина, прицеп) №", ""),
          row("Тип привода", ""),
          row("Тип двигателя", ""),
          row("Тип трансмиссии", ""),
          row("Рулевое расположение", ""),
          row("Двигатель №", ""),
          row("Результат осмотра", ""),
        ]),
        p("_____________________        _____________________        _____________________", { spacingAfter: 40 }),
        p("(время, дата осмотра)                (подпись)                (фамилия, инициалы сотрудника)", { spacingAfter: 260 }),

        heading("ВНЕСЁННЫЕ В КОНСТРУКЦИЮ ТРАНСПОРТНОГО СРЕДСТВА ИЗМЕНЕНИЯ"),
        p("_______________________________________________________________________", { spacingAfter: 260 }),

        heading("ПРОВЕРКИ ПО АВТОМАТИЗИРОВАННЫМ УЧЁТАМ, МЕЖВЕДОМСТВЕННЫЕ ЗАПРОСЫ"),
        p("_______________________________________________________________________", { spacingAfter: 260 }),

        heading("РЕШЕНИЕ ПО ЗАЯВЛЕНИЮ"),
        p("_______________________________________________________________________", { spacingAfter: 260 }),

        heading("РЕШЕНИЕ О ВОЗМОЖНОСТИ НАНЕСЕНИЯ ДОПОЛНИТЕЛЬНОЙ МАРКИРОВКИ"),
        p("_______________________________________________________________________", { spacingAfter: 260 }),

        new Paragraph({ children: [new PageBreak()] }),

        heading("ПРИНЯТЫ ОТ ЗАЯВИТЕЛЯ"),
        table([
          row("Государственные регистрационные знаки", ""),
          row("Паспорт транспортного средства (серия, №)", vehicle.pts),
          row("Документ, удостоверяющий право собственности", "Договор купли-продажи транспортного средства"),
          row("Страховой полис (№, когда и кем выдан)", ""),
          row("Иные документы, представленные заявителем", ""),
          row("Квитанции № (при наличии)", ""),
        ]),

        heading("ВЫДАНЫ ЗАЯВИТЕЛЮ (ПРИСВОЕНЫ ТРАНСПОРТНОМУ СРЕДСТВУ)"),
        table([
          row("Свидетельство о регистрации (серия, №)", ""),
          row("Регистрационные знаки или \"ТРАНЗИТ\"", ""),
          row("Паспорт транспортного средства (серия, №)", ""),
          row("Иные документы", ""),
        ]),
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildGibddForm };