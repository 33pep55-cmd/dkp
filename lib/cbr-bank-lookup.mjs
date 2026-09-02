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

let normalizedIndex = null;
function buildNormalizedIndex() {
  if (normalizedIndex) return normalizedIndex;
  normalizedIndex = new Map();
  const addAll = (source, kind) => {
    for (const [ogrn, org] of Object.entries(source)) {
      const key = normalizeName(org.name);
      if (normalizedIndex.has(key)) {
        normalizedIndex.set(key, "AMBIGUOUS");
      } else {
        normalizedIndex.set(key, { ogrn, name: org.name, address: org.address, kind });
      }
    }
  };
  addAll(banks, "банк");
  addAll(mfos, "МФО");
  return normalizedIndex;
}

function findByName(name) {
  const index = buildNormalizedIndex();
  const match = index.get(normalizeName(name));
  if (!match || match === "AMBIGUOUS") return null;
  return { name: match.name, address: match.address, kind: match.kind };
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

export { findByOgrn, findByName, findByInn, enrichCreditorsWithAddresses };
