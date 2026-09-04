const fs = require("fs");

class WizardEngine {
  constructor(flowPath) {
    this.flow = JSON.parse(fs.readFileSync(flowPath, "utf-8"));
    this.currentNodeId = this.flow.start;
    this.collectedData = {};
    this.generatedDocuments = [];
    this.history = [];
    this.collectionState = null;
    this.returnStack = [];
    this.revisiting = false;
  }

  currentNode() {
    return this.flow.nodes[this.currentNodeId];
  }

  isFinished() {
    return this.currentNodeId === null;
  }

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

  submitUpload(extractedFields) {
    const node = this.currentNode();
    if (node.type !== "upload") {
      throw new Error(`Шаг ${this.currentNodeId} не является загрузкой документа`);
    }
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

  submitAnswer(answer) {
    const node = this.currentNode();
    if (node.type !== "question") {
      throw new Error(`Шаг ${this.currentNodeId} не является вопросом`);
    }
    this.history.push({ step: this.currentNodeId, type: "question", answer });
    this.advance(node.next[answer]);
  }

  submitManualInput(fields) {
    const node = this.currentNode();
    if (node.type !== "manual_input") {
      throw new Error(`Шаг ${this.currentNodeId} не является ручным вводом`);
    }
    Object.assign(this.collectedData, fields);
    this.history.push({ step: this.currentNodeId, type: "manual_input", data: fields });
    this.advance(node.next);
  }

  acknowledgeMessage() {
    const node = this.currentNode();
    if (node.type !== "message") {
      throw new Error(`Шаг ${this.currentNodeId} не является информационным сообщением`);
    }
    this.history.push({ step: this.currentNodeId, type: "message_ack" });
    this.advance(node.next);
  }

  collectionAwaiting() {
    const node = this.currentNode();
    if (!node || node.type !== "collection") return null;
    return this.collectionState?.awaiting || "item";
  }

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

  advance(nextId) {
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
      this.collectionState = { awaiting: "item" };
      return;
    }

    if (node.type === "condition") {
      const value = this.collectedData[node.key];
      const isEmpty = !Array.isArray(value) || value.length === 0;
      const result = node.check === "isEmpty" ? isEmpty : !isEmpty;
      this.history.push({ step: this.currentNodeId, type: "condition", key: node.key, result });
      this.advance(node.next[result ? "true" : "false"]);
    }
  }
}

module.exports = WizardEngine;
