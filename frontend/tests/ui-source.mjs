import { readFile as readRawFile } from "node:fs/promises";
import ts from "typescript";

/**
 * Source-contract tests inspect the original English catalogue keys. Remove
 * translation-call syntax only, so their action/order/domain assertions do
 * not depend on whether the same label is written as text or t("text").
 * Runtime locale behavior is covered separately by i18n and rendered tests.
 */
export function normalizeUiSource(source) {
  const tree = ts.createSourceFile("ui.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "t" && node.arguments.length === 1) {
      const argument = node.arguments[0];
      const parent = node.parent;
      if (ts.isJsxExpression(parent) && ts.isStringLiteral(argument)) {
        const attribute = parent.parent;
        if (ts.isJsxAttribute(attribute)) edits.push({ start: parent.getStart(tree), end: parent.getEnd(), value: argument.getText(tree) });
        else edits.push({ start: parent.getStart(tree), end: parent.getEnd(), value: argument.text });
      } else {
        edits.push({ start: node.getStart(tree), end: node.getEnd(), value: argument.getText(tree) });
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return edits.sort((left, right) => right.start - left.start).reduce((value, edit) => value.slice(0, edit.start) + edit.value + value.slice(edit.end), source);
}

export async function readFile(path, options) {
  const source = await readRawFile(path, options);
  return typeof source === "string" && String(path).endsWith(".tsx") ? normalizeUiSource(source) : source;
}
