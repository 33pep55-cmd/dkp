// Число прописью (для суммы в рублях). Копейки в договоре ДКП всегда "00",
// поэтому дробную часть не считаем — только целые рубли.

const UNITS_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const UNITS_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

function pluralForm(n, forms) {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function threeDigitWords(n, feminine) {
  const words = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) words.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) {
    words.push(TEENS[rest - 10]);
  } else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    if (t) words.push(TENS[t]);
    if (u) words.push((feminine ? UNITS_F : UNITS_M)[u]);
  }
  return words;
}

// Сумма прописью, с заглавной буквы, без слова "рубль" (его удобнее
// добавлять в шаблоне договора рядом с суммой цифрами).
function numberToWordsRu(amount) {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  if (n === 0) return "Ноль";

  const billions = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const thousands = Math.floor((n % 1e6) / 1e3);
  const rest = n % 1000;

  const parts = [];
  if (billions) {
    parts.push(...threeDigitWords(billions, false));
    parts.push(pluralForm(billions, ["миллиард", "миллиарда", "миллиардов"]));
  }
  if (millions) {
    parts.push(...threeDigitWords(millions, false));
    parts.push(pluralForm(millions, ["миллион", "миллиона", "миллионов"]));
  }
  if (thousands) {
    parts.push(...threeDigitWords(thousands, true));
    parts.push(pluralForm(thousands, ["тысяча", "тысячи", "тысяч"]));
  }
  if (rest || parts.length === 0) {
    parts.push(...threeDigitWords(rest, false));
  }

  const text = parts.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Готовая фраза для договора: "850 000 (Восемьсот пятьдесят тысяч) рублей 00 копеек"
function formatPriceRu(amount) {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  const digits = n.toLocaleString("ru-RU");
  const words = numberToWordsRu(n);
  const rubForm = pluralForm(n, ["рубль", "рубля", "рублей"]);
  return `${digits} (${words}) ${rubForm} 00 копеек`;
}

module.exports = { numberToWordsRu, formatPriceRu };
