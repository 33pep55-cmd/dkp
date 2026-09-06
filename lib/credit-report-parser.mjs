import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "fs";

// ============================================================
// Единая точка входа для разбора кредитных отчётов.
// Разные бюро кредитных историй оформляют отчёт по-разному —
// этот модуль сначала определяет, с каким форматом имеем дело,
// а затем вызывает нужный парсер. Добавление нового формата в
// будущем — это просто ещё одна ветка в detectFormat() и ещё
// одна функция-парсер, остальной код не меняется.
// ============================================================

const FORMAT_MARKERS = {
  okb: "Объединенного Кредитного Бюро",       // «Кредистория» и похожие отчёты АО «ОКБ»
  formatB: "Рейтинг и портрет заёмщика",       // второе встреченное нами бюро
};

async function loadFirstPageText(doc) {
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  // Некоторые генераторы PDF (например wkhtmltopdf, как у Скоринг Бюро)
  // вставляют между словами отдельные "пустые" текстовые элементы —
  // без очистки они превращаются в мусорные строки и ломают любое
  // точное сравнение текста ниже.
  return content.items.map(it => it.str.trim()).filter(Boolean).join("\n");
}

function detectFormat(firstPageText) {
  for (const [format, marker] of Object.entries(FORMAT_MARKERS)) {
    if (firstPageText.includes(marker)) return format;
  }
  return "unknown";
}

// ---- Формат ОКБ / «Кредистория» ----
async function parseOkbFormat(doc) {
  let sectionText = "";
  let found = false;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(it => it.str.trim()).filter(Boolean).join("\n");
    if (!found && text.includes("ДЕЙСТВУЮЩИЕ КРЕДИТНЫЕ ДОГОВОРЫ") && text.includes("№")) found = true;
    if (found) {
      sectionText += text + "\n";
      // Останавливаемся только на начале СЛЕДУЮЩЕГО раздела — карточки
      // с подробностями (включая ИНН/ОГРН) идут ПОСЛЕ сводной таблицы
      // и могут занимать ещё много страниц.
      if (text.includes("ЗАКРЫТЫЕ КРЕДИТНЫЕ ДОГОВОРЫ")) break;
    }
  }
  if (!found) return [];

  const start = sectionText.indexOf("Статус платежа");
  const end = sectionText.indexOf("Внимательно проверьте кредитора");
  const tableText = sectionText.slice(start, end === -1 ? undefined : end);
  const rows = tableText.split(/\n(?=\d{1,3}\n)/).slice(1);

  const creditors = [];
  for (const row of rows) {
    const lines = row.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 5) continue;

    const number = lines[0];
    const creditorName = lines[1];
    const moneyLines = lines.filter(l => /^[\d\s]+(,\d+)?\s*р\.$/.test(l));
    const [, totalDebt, overdueDebt] = moneyLines;
    const nameIdx = lines.indexOf(creditorName);
    const firstMoneyIdx = lines.findIndex(l => /^[\d\s]+(,\d+)?\s*р\.$/.test(l));
    const obligationType = lines.slice(nameIdx + 1, firstMoneyIdx).join(" ");
    const lastMoneyIdx = lines.lastIndexOf(overdueDebt);
    const status = lines.slice(lastMoneyIdx + 1).join(" ");

    creditors.push({
      number, creditorName, obligationType,
      totalDebt: totalDebt || null,
      overdueDebt: overdueDebt || null,
      status,
      creditorInn: null, // заполним ниже из подробных карточек, если найдём
    });
  }

  // Подробные карточки идут после сводной таблицы, каждая в чётком месте
  // отмечена заголовком "Сведения об источнике" — этот маркер встречается
  // РОВНО один раз на кредитора, поэтому это надёжная граница карточки
  // (в отличие от номера п/п, который в тексте не всегда идёт с точкой
  // и легко перепутывается с другими цифрами на странице).
  const detailsText = sectionText.slice(end);
  const cardChunks = detailsText.split("Сведения об источнике");
  // cardChunks[0] — текст до первой карточки (содержит хвост сводной
  // таблицы + номер/название первого кредитора). cardChunks[i] для i>=1 —
  // содержимое i-й карточки, а в его хвосте — номер/название СЛЕДУЮЩЕГО
  // кредитора (т.к. следующий разрез идёт по его же "Сведения об источнике").

  creditors.forEach((creditor, i) => {
    const chunk = cardChunks[i + 1]; // +1, т.к. chunks[0] это "до первой карточки"
    if (!chunk) return;
    const innMatch = chunk.match(/ИНН[\s³²¹]*(\d{10,12})/);
    const ogrnMatch = chunk.match(/ОГРН[\s³²¹]*(\d{13,15})/);
    if (innMatch) creditor.creditorInn = innMatch[1];
    if (ogrnMatch) creditor.creditorOgrn = ogrnMatch[1];
  });

  // Защитная проверка на всякий случай: даже с надёжной границей карточки
  // не помешает подстраховаться — если один и тот же кредитор (по названию)
  // получил разные ИНН, для юридического документа безопаснее оставить
  // поле пустым для проверки человеком, чем рискнуть неверным номером.
  const byName = {};
  for (const c of creditors) {
    if (!c.creditorInn) continue;
    (byName[c.creditorName] ||= new Set()).add(c.creditorInn);
  }
  for (const c of creditors) {
    if (byName[c.creditorName]?.size > 1) {
      c.creditorInn = null;
      c.creditorOgrn = null;
      c.innUncertain = true;
    }
  }

  return creditors;
}

// ---- Второй формат (другое БКИ) ----
async function parseFormatB(doc) {
  let fullText = "";
  let foundStart = false;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(it => it.str.trim()).filter(Boolean).join("\n");
    if (!foundStart && text.includes("№") && text.includes("Источник (кредитор)")) foundStart = true;
    if (foundStart) {
      fullText += text + "\n";
      if (text.includes("Итого")) break;
    }
  }
  if (!foundStart) return [];

  const headerIdx = fullText.indexOf("№\nИсточник (кредитор)");
  const totalIdx = fullText.indexOf("\nИтого");
  let tableText = fullText.slice(
    headerIdx + "№\nИсточник (кредитор) / Вид\nобязательства\nДата начала\nобязательства\nСумма / лимит\nобязательства\nСрочный основной\nдолг\nТекущая просрочка\n(осн.долг, %,\nпени...)\n".length,
    totalIdx
  );
  tableText = tableText.replace(/Действующие кредиты, займы, карты \/ Отчёт от [^\n]*\n\d+\n\s*из\s*\n\d+\n/g, "");
  tableText = tableText.replace(/Нет данных[\s\S]*?Расшифровка своевременности платежей по договорам\n/g, "");
  tableText = tableText.replace(/^(Необеспеченный микрозаем|Иной необеспеченный заем|Кредитная линия\/карта|Ипотека|Автокредит)\n/gm, "");

  const rows = tableText.split(/\n(?=\d{1,2}\n[^\d])/).filter(r => /^\d{1,2}\n/.test(r));

  const creditors = [];
  for (const row of rows) {
    const lines = row.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 4) continue;

    const number = lines[0];
    const dateIdx = lines.findIndex(l => /^\d{2}\.\d{2}\.\d{4}$/.test(l));
    if (dateIdx === -1) continue;

    let creditorName = lines.slice(1, dateIdx).join(" ");

    // Три значения идут строго по порядку сразу после даты: "Сумма/лимит",
    // "Срочный основной долг", "Текущая просрочка". Раньше это искалось
    // по символу "₽" как отдельному кусочку текста — но в файлах, которые
    // делает wkhtmltopdf (как у Скоринг Бюро), знак рубля прилипает прямо
    // к числу ("1 034 705.00 ₽" одним куском), и такой поиск ничего не
    // находил. Берём значения по позиции — это не зависит от того, как
    // именно PDF-генератор разбивает текст на кусочки.
    const values = lines.slice(dateIdx + 1);
    const sumLimit = values[0] || "";
    const srochnyDolg = values[1] || "";
    const prosrochka = values[2] || "";

    const isMoney = v => /\d/.test(v) && !/отсутствует/i.test(v);
    const totalDebt = isMoney(srochnyDolg) ? srochnyDolg : (isMoney(sumLimit) ? sumLimit : "0 ₽");
    const overdueDebt = isMoney(prosrochka) ? prosrochka : "0 ₽";

    let creditorCategory = null;

    // В этом формате перед названием часто стоит категория источника —
    // "Банк: ПАО Сбербанк", "МФО: ООО МКК «...»" и т.п. Для сопоставления
    // со справочником банков нужно чистое название — категорию убираем
    // в отдельное поле, а не отбрасываем совсем (может пригодиться).
    const categoryMatch = creditorName.match(/^([^:]{1,60}):\s*(.+)$/);
    if (categoryMatch) {
      creditorCategory = categoryMatch[1].trim();
      creditorName = categoryMatch[2].trim();
    }

    creditors.push({
      number, creditorName, creditorCategory,
      obligationType: null, // этот формат не даёт отдельного текстового описания вида обязательства в таблице
      totalDebt: totalDebt,     // нормализовано к общему имени поля (было "срочный основной долг")
      overdueDebt: overdueDebt, // нормализовано к общему имени поля (было "текущая просрочка")
      status: null,
    });
  }
  return creditors;
}

// ---- Единая точка входа ----
async function parseCreditReport(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;

  const firstPageText = await loadFirstPageText(doc);
  const format = detectFormat(firstPageText);

  let creditors = [];
  if (format === "okb") creditors = await parseOkbFormat(doc);
  else if (format === "formatB") creditors = await parseFormatB(doc);

  return { format, creditors };
}

export { parseCreditReport };

// Тестовый запуск на обоих реальных отчётах
if (process.argv[1]?.endsWith("credit-report-parser.mjs")) {
  for (const path of ["/home/claude/credistory.pdf", "/home/claude/report2.pdf"]) {
    const result = await parseCreditReport(path);
    console.log(`\n=== ${path} ===`);
    console.log(`Определён формат: ${result.format}`);
    console.log(`Кредиторов найдено: ${result.creditors.length}`);
    result.creditors.forEach(c => console.log(`  ${c.number}. ${c.creditorName} — долг: ${c.totalDebt}`));
  }
}