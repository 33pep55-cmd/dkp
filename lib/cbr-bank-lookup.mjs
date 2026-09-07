import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const banks = JSON.parse(fs.readFileSync(path.join(__dirname, "cbr_banks.json"), "utf-8"));
const mfos = JSON.parse(fs.readFileSync(path.join(__dirname, "cbr_mfo.json"), "utf-8"));

// Поиск по ОГРН среди банков и МФО — точный, надёжный (ОГРН уникален)
function findByOgrn(ogrn) {
  if (!ogrn) return null;
  const key = String(ogrn);
  if (banks[key]) return { name: banks[key].name, address: banks[key].address, kind: "банк" };
  if (mfos[key]) return { name: mfos[key].name, address: mfos[key].address, kind: "МФО" };
  return null;
}

// Запасной поиск по названию — для случаев, когда ОГРН не удалось
// извлечь (например, кредиторы из второго формата отчёта, где ОГРН
// не публикуется вовсе). Менее надёжен, чем поиск по ОГРН: названия в
// отчётах пишутся непоследовательно ("ПАО СБЕРБАНК" / "Сбербанк" и т.п.),
// поэтому здесь используется упрощённое нормализованное сравнение —
// без организационно-правовой формы, регистра и кавычек.
function normalizeName(name) {
  return (name || "")
    .replace(/\(ранее[^)]*\)/gi, "") // "(ранее - ООО МФК «...»)" — отбрасываем, это старое название
    .toUpperCase()
    .replace(/[«»"']/g, "")
    .replace(/\b(ПАО|АО|ОАО|ЗАО|ООО|НПАО|НКО)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Извлекает старое название из "(ранее - АО Тинькофф Банк)" — это
// отдельно от normalizeName(), которая, наоборот, ВЫРЕЗАЕТ эту часть
// из основного названия. Нужно, чтобы старое (привычное человеку)
// название банка тоже можно было найти, а не только текущее.
function extractOldName(name) {
  const match = (name || "").match(/\(ранее[^)]*?[-—]\s*([^)]+)\)/i);
  return match ? match[1].trim() : null;
}

// Официальный реестр ЦБ содержит только ТЕКУЩЕЕ юридическое название —
// разговорные/маркетинговые названия после ребрендинга там не хранятся
// вообще (это не пробел в наших данных, а особенность самого реестра).
// Самые известные случаи держим отдельным небольшим списком вручную.
const KNOWN_ALIASES = {
  "ТИНЬКОФФ": "1027739642281",   // ныне АО «ТБанк»
  "ТИНЬКОФФ БАНК": "1027739642281",
};

let normalizedIndex = null;
function buildNormalizedIndex() {
  if (normalizedIndex) return normalizedIndex;
  normalizedIndex = new Map();
  const addKey = (key, record) => {
    if (!key) return;
    if (normalizedIndex.has(key) && normalizedIndex.get(key) !== record) {
      normalizedIndex.set(key, "AMBIGUOUS");
    } else {
      normalizedIndex.set(key, record);
    }
  };
  const addAll = (source, kind) => {
    for (const [ogrn, org] of Object.entries(source)) {
      const record = { ogrn, name: org.name, address: org.address, kind };
      addKey(normalizeName(org.name), record);
      const oldName = extractOldName(org.name);
      if (oldName) addKey(normalizeName(oldName), record); // например, "Тинькофф Банк" -> запись АО "ТБанк"
    }
  };
  addAll(banks, "банк");
  addAll(mfos, "МФО");
  for (const [alias, ogrn] of Object.entries(KNOWN_ALIASES)) {
    const target = banks[ogrn] || mfos[ogrn];
    if (target) addKey(normalizeName(alias), { ogrn, name: target.name, address: target.address, kind: banks[ogrn] ? "банк" : "МФО" });
  }
  return normalizedIndex;
}

function findByName(name) {
  const index = buildNormalizedIndex();
  const match = index.get(normalizeName(name));
  if (!match || match === "AMBIGUOUS") return null;
  return { name: match.name, address: match.address, kind: match.kind };
}

// Настоящий поиск с вариантами — в отличие от findByName (только точное
// совпадение), здесь ищем по вхождению подстроки в обе стороны и
// возвращаем несколько кандидатов, чтобы показать их человеку кнопками.
// Именно этого не хватало: раньше бот либо молча находил точное
// совпадение, либо молча сдавался — выбора вообще не было.
function searchByName(query, limit = 5) {
  const q = normalizeName(query);
  if (!q || q.length < 3) return []; // слишком короткий запрос — толку не будет
  const index = buildNormalizedIndex();
  const results = [];
  for (const [key, val] of index.entries()) {
    if (val === "AMBIGUOUS") continue;
    // Короткие названия в базе (аббревиатуры вроде "РБ") иначе будут
    // случайно "находиться" просто потому, что эти буквы случайно
    // встретились подряд внутри более длинного запроса.
    if (key.length < 4) {
      if (key === q) results.push(val);
      continue;
    }
    if (key.includes(q) || q.includes(key)) {
      results.push(val);
    }
  }
  // Короче совпадения — вероятнее всего точнее (например, "СБЕРБАНК"
  // ближе к запросу "сбербанк", чем длинное составное название).
  results.sort((a, b) => a.name.length - b.name.length);
  const seen = new Set();
  const unique = results.filter(m => (seen.has(m.ogrn) ? false : (seen.add(m.ogrn), true)));
  return unique.slice(0, limit).map(m => ({ name: m.name, address: m.address, kind: m.kind }));
}

// Поиск по ИНН — работает только для МФО (у банков в справочнике ЦБ
// ИНН не публикуется, только ОГРН — см. cbr-lookup module notes).
let innIndex = null;
function findByInn(inn) {
  if (!inn) return null;
  if (!innIndex) {
    innIndex = new Map();
    for (const org of Object.values(mfos)) {
      if (org.inn) innIndex.set(org.inn, org);
    }
  }
  const match = innIndex.get(String(inn));
  return match ? { name: match.name, address: match.address, kind: "МФО" } : null;
}

// Обогащает список кредиторов адресами — сначала пробует точный поиск
// по ОГРН, потом по ИНН (работает для МФО), если ничего нет — по названию.
// Кредиторы, для которых ничего не нашлось (СФО, частные лица, либо
// организация не найдена ни в одном из справочников) остаются без
// адреса — для ручного заполнения.
function enrichCreditorsWithAddresses(creditors) {
  for (const creditor of creditors) {
    let match = findByOgrn(creditor.creditorOgrn);
    if (!match) match = findByInn(creditor.creditorInn);
    if (!match) match = findByName(creditor.creditorName);
    if (match) {
      creditor.creditorAddress = match.address;
      creditor.creditorKind = match.kind; // банк / МФО — можно показать пользователю
      creditor.addressSource = "cbr";
    }
  }
  return creditors;
}

export { findByOgrn, findByName, searchByName, findByInn, enrichCreditorsWithAddresses };