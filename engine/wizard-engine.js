// ============================================================
// Универсальный движок визарда.
// Читает flow.json (dkp или bankruptcy) и ведёт пользователя
// по шагам: upload -> question (с ветвлением) -> generate.
// Не содержит специфики "банкротство" или "ДКП" — вся логика
// сценария лежит в JSON-конфиге, а не в этом файле.
// ============================================================

const fs = require("fs");

class WizardEngine {
  constructor(flowPath) {
    this.flow = JSON.parse(fs.readFileSync(flowPath, "utf-8"));
    this.currentNodeId = this.flow.start;
    this.collectedData = {};       // сюда стекаются все извлечённые/введённые поля
    this.generatedDocuments = [];  // список сгенерированных по пути документов
    this.history = [];             // для отображения пройденного пути
    this.collectionState = null;   // состояние текущего шага-коллекции (если на нём стоим)
    this.returnStack = [];         // "закладки" для revisitNode — куда вернуться после правки
    this.revisiting = false;       // true, пока мы временно отклонились на другой шаг
  }

  // ---- "Оглавление": заскочить на любой уже пройденный шаг, поправить
  // документ, и автоматически вернуться туда, где человек реально
  // остановился — без пересчёта веток и без потери прогресса.
  //
  // Рассчитан в первую очередь на простые шаги (upload) — например,
  // "забыл загрузить СНИЛС". Заходить так на "question"/"condition"
  // не стоит — там ответ определяет, какая ветка сценария вообще
  // была пройдена, и правка задним числом может расходиться с уже
  // собранными дальше данными.
  revisitNode(nodeId) {
    const node = this.flow.nodes[nodeId];
    if (!node) throw new Error(`Неизвестный узел: ${nodeId}`);
    if (node.type === "question" || node.type === "condition") {
      throw new Error(`Нельзя вернуться к шагу с веткой ("${nodeId}") — это может разойтись с уже собранными данными.`);
    }

    this.returnStack.push(this.currentNodeId);
    this.currentNodeId = nodeId;
    this.revisiting = true;

    if (node.type === "collection") {
      const hasItems = Array.isArray(this.collectedData[node.collectionKey]) && this.collectedData[node.collectionKey].length > 0;
      this.collectionState = { awaiting: hasItems ? "continue" : "item" };
    }
  }

  isRevisiting() {
    return this.revisiting;
  }

  currentNode() {
    return this.flow.nodes[this.currentNodeId];
  }

  // Вызывается, когда пользователь загрузил документ и OCR его распознал
  submitUpload(extractedFields) {
    const node = this.currentNode();
    if (node.type !== "upload") {
      throw new Error(`Шаг ${this.currentNodeId} не является загрузкой документа`);
    }

    // Некоторые загрузки дают не одно значение, а сразу массив пунктов
    // (например, отчёт "Кредистория" -> сразу несколько кредиторов).
    // Такой шаг помечен полем collectionKey — тогда результат
    // добавляется в общий список, а не сливается плоско в collectedData.
    if (node.collectionKey) {
      if (!Array.isArray(this.collectedData[node.collectionKey])) {
        this.collectedData[node.collectionKey] = [];
      }
      const items = Array.isArray(extractedFields) ? extractedFields : [extractedFields];
      this.collectedData[node.collectionKey].push(...items);
      this.history.push({ step: this.currentNodeId, type: "upload_collection", count: items.length });
      this.advance(node.next);
      return;
    }

    // Если у шага есть role (например "seller"/"buyer" в ДКП — два паспорта
    // с одинаковыми названиями полей), префиксуем ключи ролью,
    // чтобы данные продавца и покупателя не затирали друг друга.
    const keyed = node.role
      ? Object.fromEntries(
          Object.entries(extractedFields).map(([k, v]) => [
            node.role + k.charAt(0).toUpperCase() + k.slice(1),
            v,
          ])
        )
      : extractedFields;

    Object.assign(this.collectedData, keyed);
    this.history.push({ step: this.currentNodeId, type: "upload", data: keyed });
    this.advance(node.next);
  }

  // Вызывается, когда пользователь выбрал ответ на вопрос
  submitAnswer(answer) {
    const node = this.currentNode();
    if (node.type !== "question") {
      throw new Error(`Шаг ${this.currentNodeId} не является вопросом`);
    }
    this.history.push({ step: this.currentNodeId, type: "question", answer });
    const nextId = node.next[answer];
    if (!nextId) {
      throw new Error(`Неизвестный ответ "${answer}" для шага ${this.currentNodeId}`);
    }
    this.advance(nextId);
  }

  // Вызывается для шагов ручного ввода (например, цена в ДКП, данные СРО вручную)
  submitManualInput(fields) {
    const node = this.currentNode();
    if (node.type !== "manual_input") {
      throw new Error(`Шаг ${this.currentNodeId} не является ручным вводом`);
    }
    Object.assign(this.collectedData, fields);
    this.history.push({ step: this.currentNodeId, type: "manual_input", data: fields });
    this.advance(node.next);
  }

  // Вызывается для шагов типа "message" — чисто информационный экран
  // (например, инструкция "заранее подготовьте два отчёта, вот ссылки").
  // Ничего не собирает, просто ждёт подтверждения "прочитал, дальше".
  acknowledgeMessage() {
    const node = this.currentNode();
    if (node.type !== "message") {
      throw new Error(`Шаг ${this.currentNodeId} не является информационным сообщением`);
    }
    this.history.push({ step: this.currentNodeId, type: "message_ack" });
    this.advance(node.next);
  }

  // ---- Шаги типа "collection" (переменное количество однотипных пунктов) ----
  //
  // Например: кредиторы, дети, сделки за 3 года — заранее неизвестно,
  // сколько их будет. Узел collection работает как цикл:
  //   загрузить/ввести пункт -> "добавить ещё?" -> да (снова пункт) / нет (дальше)
  //
  // Пока движок стоит на узле collection, он находится в одном из двух
  // внутренних состояний: ждёт очередной пункт, либо ждёт ответа
  // "добавить ещё?". Это отслеживается отдельно от узла (this.collectionState),
  // а не через currentNodeId, потому что сам узел не меняется, пока цикл идёт.

  // Что именно сейчас ожидает шаг collection: 'item' | 'continue' | null
  collectionAwaiting() {
    const node = this.currentNode();
    if (!node || node.type !== "collection") return null;
    return this.collectionState?.awaiting || "item";
  }

  // Добавляет один пункт коллекции (например, одного кредитора или одного
  // ребёнка). Данные ложатся в this.collectedData[node.collectionKey] —
  // это массив, а не плоские поля, в отличие от submitUpload.
  submitCollectionItem(itemData) {
    const node = this.currentNode();
    if (node.type !== "collection") {
      throw new Error(`Шаг ${this.currentNodeId} не является коллекцией`);
    }
    if (!Array.isArray(this.collectedData[node.collectionKey])) {
      this.collectedData[node.collectionKey] = [];
    }
    this.collectedData[node.collectionKey].push(itemData);
    this.history.push({ step: this.currentNodeId, type: "collection_item", data: itemData });
    this.collectionState = { awaiting: "continue" };
  }

  // Отвечает на вопрос "добавить ещё один пункт?" — true продолжает цикл
  // (снова ждём пункт), false переходит к следующему узлу схемы.
  submitCollectionContinue(addMore) {
    const node = this.currentNode();
    if (node.type !== "collection") {
      throw new Error(`Шаг ${this.currentNodeId} не является коллекцией`);
    }
    this.history.push({ step: this.currentNodeId, type: "collection_continue", answer: addMore });
    if (addMore) {
      this.collectionState = { awaiting: "item" };
    } else {
      this.collectionState = null;
      this.advance(node.next);
    }
  }

  // Шаги generate проходятся автоматически — движок сам сообщает,
  // что документ готов, и идёт дальше
  advance(nextId) {
    // Если мы сейчас "в гостях" (зашли поправить шаг через revisitNode) —
    // вместо обычного перехода по схеме возвращаемся туда, где человек
    // реально остановился. Само значение nextId в этом случае игнорируем.
    if (this.revisiting) {
      this.revisiting = false;
      this.currentNodeId = this.returnStack.pop();
      this.history.push({ step: this.currentNodeId, type: "revisit_return" });
      return;
    }

    this.currentNodeId = nextId;
    if (!nextId) return;

    const node = this.currentNode();

    if (node.type === "generate") {
      this.generatedDocuments.push({
        template: node.template,
        title: node.title,
        dataSnapshot: { ...this.collectedData },
      });
      this.history.push({ step: this.currentNodeId, type: "generate", template: node.template });
      this.advance(node.next);
      return;
    }

    if (node.type === "collection") {
      // Заходим на шаг-коллекцию впервые — ждём первый пункт.
      this.collectionState = { awaiting: "item" };
      return;
    }

    if (node.type === "condition") {
      // Автоматическая развилка по уже собранным данным — не требует
      // отдельного вопроса к человеку. Например: "если список
      // недвижимости пуст — предложить ходатайство про аренду".
      const value = this.collectedData[node.key];
      const isEmpty = !Array.isArray(value) || value.length === 0;
      const result = node.check === "isEmpty" ? isEmpty : !isEmpty;
      this.history.push({ step: this.currentNodeId, type: "condition", key: node.key, result });
      this.advance(node.next[result ? "true" : "false"]);
    }
  }

  isFinished() {
    return this.currentNodeId === null;
  }

  describeCurrentStep() {
    if (this.isFinished()) return "Сценарий завершён";
    const node = this.currentNode();
    return `[${node.type}] ${node.title}`;
  }
}

module.exports = WizardEngine;
