import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

type ButtonAuditEntry = {
  line: number;
  text: string;
  type: string;
  className: string;
  testId: string;
  onClick: string;
  issue: string;
};

const sourcePath = path.join(process.cwd(), "src", "main.tsx");
const sourceText = await readFile(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const issues: ButtonAuditEntry[] = [];
let buttonCount = 0;

function lineOf(node: ts.Node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function attrValue(opening: ts.JsxOpeningLikeElement, name: string) {
  const attr = opening.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
  if (!attr?.initializer) return "";
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  return attr.initializer.getText(sourceFile);
}

function visibleText(node: ts.JsxElement) {
  const parts: string[] = [];
  function visit(child: ts.Node) {
    if (ts.isJsxText(child)) {
      parts.push(child.getText(sourceFile));
      return;
    }
    if (ts.isJsxExpression(child)) {
      if (child.expression && ts.isStringLiteralLike(child.expression)) parts.push(child.expression.text);
      return;
    }
    if (ts.isJsxElement(child)) {
      child.children.forEach(visit);
    }
  }
  node.children.forEach(visit);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function isSubmitButton(typeAttr: string) {
  return /^["']submit["']$/.test(typeAttr) || /{\s*["']submit["']\s*}/.test(typeAttr);
}

function auditButton(opening: ts.JsxOpeningLikeElement, node: ts.Node, text: string) {
  buttonCount += 1;
  const onClick = attrValue(opening, "onClick");
  const type = attrValue(opening, "type");
  const className = attrValue(opening, "className");
  const testId = attrValue(opening, "data-testid");
  const base = {
    line: lineOf(node),
    text,
    type,
    className,
    testId,
    onClick,
  };

  if (!onClick && !isSubmitButton(type)) {
    issues.push({ ...base, issue: "button has no onClick handler and is not an explicit submit button" });
    return;
  }

  const compact = onClick.replace(/\s+/g, " ");
  if (/^\{\s*\(\s*\)\s*=>\s*(?:undefined|null|false)\s*\}$/.test(compact) || /^\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}$/.test(compact)) {
    issues.push({ ...base, issue: "button onClick is an empty/no-op handler" });
  }
  if (/\b(?:alert|prompt|confirm)\s*\(/.test(onClick)) {
    issues.push({ ...base, issue: "button uses a native dialog directly instead of the app confirmation flow" });
  }
}

function visit(node: ts.Node) {
  if (ts.isJsxElement(node) && ts.isIdentifier(node.openingElement.tagName) && node.openingElement.tagName.text === "button") {
    auditButton(node.openingElement, node, visibleText(node));
  }
  if (ts.isJsxSelfClosingElement(node) && ts.isIdentifier(node.tagName) && node.tagName.text === "button") {
    auditButton(node, node, "");
  }
  ts.forEachChild(node, visit);
}

visit(sourceFile);

if (issues.length) {
  console.error(JSON.stringify({ ok: false, buttonCount, issues }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, buttonCount, issues: 0 }, null, 2));
