// Утилиты для СНИЛС и ИНН: форматирование распознанного номера
// и разбор текста, если пользователь предпочёл ввести номера руками,
// а не присылать фото.

// Приводит 11 цифр СНИЛС к стандартному виду "123-456-789 00"
function formatSnils(digits) {
  const d = (digits || "").replace(/\D/g, "");
  if (d.length !== 11) return d;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 9)} ${d.slice(9, 11)}`;
}

// Ищет в свободном тексте СНИЛС (11 цифр) и/или ИНН (10 или 12 цифр).
// Пример входа: "123-456-789 00, ИНН 500100200300"
function parseSnilsInnText(text) {
  const raw = text || "";
  let snils = "";
  let inn = "";

  // СНИЛС обычно записывают как XXX-XXX-XXX XX (с разделителями) —
  // ищем такой паттерн в первую очередь, чтобы не перепутать с ИНН.
  const snilsMatch = raw.match(/\d{3}[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{2}/);
  if (snilsMatch) {
    const digits = snilsMatch[0].replace(/\D/g, "");
    if (digits.length === 11) snils = formatSnils(digits);
  }

  // ИНН физлица — 12 цифр, у ИП — тоже 12, у юрлица — 10.
  // Ищем отдельно идущую последовательность из 10 или 12 цифр,
  // не пересекающуюся с уже найденным СНИЛС.
  const withoutSnils = snilsMatch ? raw.replace(snilsMatch[0], " ") : raw;
  const innMatch = withoutSnils.match(/\b\d{12}\b|\b\d{10}\b/);
  if (innMatch) {
    inn = innMatch[0];
  }

  return { snils, inn };
}

module.exports = { formatSnils, parseSnilsInnText };
