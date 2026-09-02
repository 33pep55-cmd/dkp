{
  "flowId": "bankruptcy",
  "title": "Заявление о банкротстве физического лица",
  "start": "passport",
  "nodes": {

    "passport": {
      "type": "upload",
      "title": "Загрузите паспорт (разворот с фото)",
      "docType": "passport_main",
      "next": "snils"
    },
    "snils": {
      "type": "upload",
      "title": "Загрузите СНИЛС",
      "docType": "snils",
      "next": "inn"
    },
    "inn": {
      "type": "upload",
      "title": "Загрузите ИНН",
      "docType": "inn",
      "next": "ip_question"
    },

    "ip_question": {
      "type": "question",
      "title": "У вас есть действующее ИП?",
      "options": ["да", "нет"],
      "next": { "да": "ip_closure_offer", "нет": "ip_status_cert" }
    },
    "ip_closure_offer": {
      "type": "question",
      "title": "Для банкротства ИП нужно закрыть. Подготовить заявление на закрытие ИП (форма Р26001) прямо сейчас?",
      "options": ["да, подготовить", "закрою сам"],
      "next": { "да, подготовить": "ip_closure_generate", "закрою сам": "ip_status_cert" }
    },
    "ip_closure_generate": {
      "type": "generate",
      "title": "Заявление на закрытие ИП (форма Р26001)",
      "template": "ip_closure_p26001",
      "sourceFields": "*",
      "next": "ip_status_cert"
    },
    "ip_status_cert": {
      "type": "upload",
      "title": "Загрузите справку из ФНС о (не)наличии статуса ИП (действительна 5 дней)",
      "docType": "ip_status_certificate",
      "next": "married_question"
    },

    "married_question": {
      "type": "question",
      "title": "Вы состоите в браке?",
      "options": ["да", "нет", "вдовец/вдова"],
      "next": { "да": "marriage_cert", "нет": "children_question", "вдовец/вдова": "death_cert" }
    },
    "marriage_cert": {
      "type": "upload",
      "title": "Загрузите свидетельство о заключении брака",
      "docType": "marriage_certificate",
      "next": "marriage_contract_question"
    },
    "marriage_contract_question": {
      "type": "question",
      "title": "Есть ли брачный договор?",
      "options": ["да", "нет"],
      "next": { "да": "marriage_contract_upload", "нет": "divorce_3y_question" }
    },
    "marriage_contract_upload": {
      "type": "upload",
      "title": "Загрузите брачный договор",
      "docType": "marriage_contract",
      "next": "divorce_3y_question"
    },
    "divorce_3y_question": {
      "type": "question",
      "title": "Был ли развод в последние 3 года?",
      "options": ["да", "нет"],
      "next": { "да": "divorce_cert", "нет": "children_question" }
    },
    "divorce_cert": {
      "type": "upload",
      "title": "Загрузите свидетельство о расторжении брака",
      "docType": "divorce_certificate",
      "next": "children_question"
    },
    "death_cert": {
      "type": "upload",
      "title": "Загрузите свидетельство о смерти супруга(и)",
      "docType": "death_certificate",
      "next": "children_question"
    },

    "children_question": {
      "type": "question",
      "title": "Есть ли у вас несовершеннолетние дети?",
      "options": ["да", "нет"],
      "next": { "да": "children_collection", "нет": "realty_question" }
    },
    "children_collection": {
      "type": "collection",
      "title": "Дети",
      "collectionKey": "children",
      "itemPrompt": "Загрузите свидетельство о рождении ребёнка — либо введите данные вручную, либо пропустите.",
      "itemDocType": "birth_certificate",
      "addMorePrompt": "Есть ещё один ребёнок?",
      "next": "realty_question"
    },

    "realty_question": {
      "type": "question",
      "title": "Есть ли у вас в собственности недвижимость?",
      "options": ["да", "нет"],
      "next": { "да": "realty_collection", "нет": "realty_negative" }
    },
    "realty_collection": {
      "type": "collection",
      "title": "Объекты недвижимости",
      "collectionKey": "realty",
      "itemPrompt": "Загрузите выписку из ЕГРН на объект — либо введите данные вручную.",
      "itemDocType": "egrn_extract",
      "addMorePrompt": "Есть ещё один объект недвижимости?",
      "next": "mortgage_question"
    },
    "realty_negative": {
      "type": "upload",
      "title": "Загрузите отрицательную выписку ЕГРН (подтверждение отсутствия недвижимости)",
      "docType": "egrn_negative",
      "next": "vehicle_question"
    },

    "mortgage_question": {
      "type": "question",
      "title": "Есть ли ипотека на одном из объектов?",
      "options": ["да", "нет"],
      "next": { "да": "mortgage_docs_upload", "нет": "vehicle_question" }
    },
    "mortgage_docs_upload": {
      "type": "upload",
      "title": "Загрузите ипотечный договор и справку об остатке долга",
      "docType": "mortgage_documents",
      "next": "mortgage_settlement_offer"
    },
    "mortgage_settlement_offer": {
      "type": "question",
      "title": "Подготовить ходатайство об инициировании мирового соглашения с банком (для сохранения ипотечной квартиры)? Итоговые условия согласовываются с банком отдельно.",
      "options": ["да, подготовить", "пропустить"],
      "next": { "да, подготовить": "mortgage_settlement_generate", "пропустить": "vehicle_question" }
    },
    "mortgage_settlement_generate": {
      "type": "generate",
      "title": "Ходатайство об инициировании мирового соглашения с залоговым кредитором",
      "template": "mortgage_settlement_petition",
      "sourceFields": "*",
      "next": "vehicle_question"
    },

    "vehicle_question": {
      "type": "question",
      "title": "Есть ли у вас в собственности автомобиль?",
      "options": ["да", "нет"],
      "next": { "да": "vehicle_collection", "нет": "income_question" }
    },
    "vehicle_collection": {
      "type": "collection",
      "title": "Автомобили в собственности",
      "collectionKey": "vehicles",
      "itemPrompt": "Загрузите СТС или ПТС на автомобиль.",
      "itemDocType": "vehicle_doc",
      "addMorePrompt": "Есть ещё один автомобиль?",
      "next": "income_question"
    },

    "income_question": {
      "type": "question",
      "title": "Есть ли у вас официальный доход?",
      "options": ["да", "нет"],
      "next": { "да": "income_upload", "нет": "realty_check" }
    },
    "income_upload": {
      "type": "upload",
      "title": "Загрузите справку 2-НДФЛ / о доходах / о пенсии",
      "docType": "income_certificate",
      "next": "realty_check"
    },

    "realty_check": {
      "type": "condition",
      "key": "realty",
      "check": "isEmpty",
      "next": { "true": "rent_exclusion_offer", "false": "deals_question" }
    },
    "rent_exclusion_offer": {
      "type": "question",
      "title": "У вас нет своей недвижимости — подготовить ходатайство об исключении из конкурсной массы денег на аренду жилья?",
      "options": ["да, нужно", "не нужно"],
      "next": { "да, нужно": "rent_exclusion_details", "не нужно": "deals_question" }
    },
    "rent_exclusion_details": {
      "type": "upload",
      "title": "Загрузите договор аренды и паспорт собственника жилья",
      "docType": "rent_agreement",
      "next": "rent_exclusion_generate"
    },
    "rent_exclusion_generate": {
      "type": "generate",
      "title": "Ходатайство об исключении из конкурсной массы денежных средств на аренду жилья",
      "template": "rent_exclusion_petition",
      "sourceFields": "*",
      "next": "deals_question"
    },

    "deals_question": {
      "type": "question",
      "title": "Были ли у вас за последние 3 года сделки с имуществом (недвижимость, автомобиль, доли, ценные бумаги) на сумму свыше 300 000 ₽?",
      "options": ["да", "нет"],
      "next": { "да": "deals_collection", "нет": "credit_reports_intro" }
    },
    "deals_collection": {
      "type": "collection",
      "title": "Сделки за 3 года",
      "collectionKey": "deals",
      "itemPrompt": "Выберите тип сделки, затем загрузите договор — либо введите данные вручную.",
      "itemTypeOptions": ["недвижимость", "автомобиль", "доли и ценные бумаги", "иное"],
      "addMorePrompt": "Была ещё одна сделка?",
      "next": "credit_reports_intro"
    },

    "credit_reports_intro": {
      "type": "message",
      "title": "Кредитные отчёты",
      "body": "Подготовьте заранее два бесплатных отчёта:\n1) ОКБ («Кредистория») — credistory.ru\n2) Скоринг Бюро — scoring.ru\nОба через вход по Госуслугам, готовятся за пару минут.",
      "next": "report_okb"
    },
    "report_okb": {
      "type": "upload",
      "title": "Загрузите отчёт из ОКБ («Кредистория»)",
      "docType": "credit_report",
      "collectionKey": "creditors",
      "next": "report_scoring"
    },
    "report_scoring": {
      "type": "upload",
      "title": "Загрузите отчёт из Скоринг Бюро (scoring.ru)",
      "docType": "credit_report",
      "collectionKey": "creditors",
      "next": "creditors_extra_collection"
    },
    "creditors_extra_collection": {
      "type": "collection",
      "title": "Остальные кредиторы",
      "collectionKey": "creditors",
      "itemPrompt": "Есть кредиторы, которых не было ни в одном отчёте (расписки, ЖКХ)? Добавьте, либо нажмите «Готово».",
      "addMorePrompt": "Добавить ещё одного кредитора вручную?",
      "next": "sro_question"
    },

    "sro_question": {
      "type": "question",
      "title": "Выберите СРО арбитражных управляющих",
      "options": ["САМРО «Ассоциация антикризисных управляющих»", "другое (ввести вручную)"],
      "next": {
        "САМРО «Ассоциация антикризисных управляющих»": "final_generate",
        "другое (ввести вручную)": "sro_manual_input"
      }
    },
    "sro_manual_input": {
      "type": "manual_input",
      "title": "Введите данные СРО вручную",
      "fields": ["sroName", "sroInn", "sroOgrn", "sroAddress"],
      "next": "final_generate"
    },

    "final_generate": {
      "type": "generate",
      "title": "Заявление гражданина о признании его несостоятельным (банкротом)",
      "template": "bankruptcy_application",
      "sourceFields": "*",
      "next": null
    }
  }
}
