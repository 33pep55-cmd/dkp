// Отправляет фото документа модели Claude (через сервис Polza.ai — он даёт
// доступ к Claude по российской карте, когда прямой ключ Anthropic
// недоступен) и просит вернуть строго JSON с нужными полями. Один и тот же
// принцип для любого типа документа — меняется только список полей и
// подсказка, что это за документ.

const POLZA_API_URL = "https://polza.ai/api/v1/chat/completions";
const MODEL = process.env.ANTHROPIC_MODEL || "anthropic/claude-sonnet-4.5";

const PROMPTS = {
  passport_main: {
    label: "разворот паспорта с фото",
    fields: `{
  "fio": "Фамилия Имя Отчество полностью",
  "dob": "дата рождения в формате ДД.ММ.ГГГГ",
  "pob": "место рождения, как написано в паспорте",
  "passport": "серия и номер паспорта в формате XX XX XXXXXX",
  "issuedBy": "кем выдан паспорт",
  "issuedDate": "дата выдачи в формате ДД.ММ.ГГГГ",
  "deptCode": "код подразделения в формате XXX-XXX"
}`,
  },
  passport_registration: {
    label: "разворот паспорта со штампом(ами) регистрации по месту жительства",
    fields: `{ "address": "адрес регистрации в компактном виде: город/населённый пункт, улица, дом, квартира" }`,
    extra: "Штамп регистрации обычно содержит несколько строк: почтовый индекс, регион/область, район, город/населённый пункт, улицу, дом (иногда корпус/строение), квартиру. В поле \"address\" верни ТОЛЬКО: населённый пункт, улицу, дом (и корпус/строение, если есть в штампе) и квартиру — по образцу «г. Челябинск, ул. Кирова, д. 10, кв. 25». НЕ включай в ответ почтовый индекс, область/край/республику, район, слово «зарегистрирован(а)» и дату регистрации — их в адрес добавлять не нужно, даже если они есть на штампе. Название населённого пункта и улицы прочитай полностью, без сокращений (кроме стандартных «г.», «ул.», «д.», «кв.»). Если штампов регистрации несколько — используй самый последний (актуальный) по дате.",
  },
  vehicle_doc: {
    label: "СТС или ПТС автомобиля",
    fields: `{
  "model": "марка и модель автомобиля",
  "year": "год выпуска",
  "vin": "VIN, 17 символов",
  "plate": "гос. регистрационный знак, если виден на документе, иначе пустая строка",
  "color": "цвет кузова, если указан, иначе пустая строка",
  "pts": "серия и номер ПТС, если это ПТС, иначе пустая строка",
  "sts": "серия и номер СТС, если это СТС, иначе пустая строка"
}`,
  },
};

async function extractFields(docType, imageBase64, mimeType) {
  const spec = PROMPTS[docType];
  if (!spec) throw new Error(`Unknown docType: ${docType}`);

  const prompt = `Это фото документа: ${spec.label}. Прочитай видимый текст и верни ТОЛЬКО JSON (без markdown, без пояснений, без обратных кавычек) строго такой формы:\n${spec.fields}\n${spec.extra ? spec.extra + "\n" : ""}Если какое-то поле прочитать не удаётся — поставь пустую строку "" вместо него, не выдумывай значения.`;

  const res = await fetch(POLZA_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${process.env.POLZA_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Polza API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || "";

  // На случай если модель всё же обернёт ответ в ```json ... ```
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Не удалось разобрать ответ модели как JSON: ${cleaned}`);
  }
}

module.exports = { extractFields };
