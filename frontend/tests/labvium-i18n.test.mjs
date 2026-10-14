import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

function moduleUrl(path) {
  const source = readFileSync(path, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from "(\.\/[^".]+)"/g, (_match, dependency) => `from ${JSON.stringify(moduleUrl(resolve(dirname(path), `${dependency}.ts`)))}`);
  return `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
}

const catalogPath = fileURLToPath(new URL("../app/lib/i18n/catalog.ts", import.meta.url));
const { translate, PRODUCT_NAME } = await import(moduleUrl(catalogPath));

test("interface labels switch languages without inventing an English product name", () => {
  assert.equal(PRODUCT_NAME, "랩비움");
  assert.equal(translate("Library", "ko"), "논문 보관함");
  assert.equal(translate("Library", "en"), "Library");
  assert.equal(translate("Research assistant", "ko"), "연구 도우미");
  assert.equal(translate("Save failed", "ko"), "저장 실패");
});

test("user content passed into a UI template remains unchanged", () => {
  assert.equal(translate("Manage {tag}", "ko", { tag: "Library" }), "Library 수정");
  assert.equal(translate("My unchanged research title", "ko"), "My unchanged research title");
  assert.equal(translate("Select {path}", "ko", { path: "論文/CO₂_sample.pdf" }), "論文/CO₂_sample.pdf 선택");
});

test("stored English operation messages can be translated after a language change", () => {
  assert.equal(translate("3 Projects.", "ko"), "3개 프로젝트");
  assert.equal(translate("1 Project.", "ko"), "1개 프로젝트");
  assert.equal(translate("2 fields changed.", "ko"), "2개 항목을 수정했습니다.");
  assert.equal(translate("Inspect A paper with {braces}", "ko"), "A paper with {braces} 미리보기");
  assert.equal(translate("The local API returned HTTP 503.", "ko"), "요청을 처리하지 못했습니다. 오류 코드: 503");
});

test("reader labels and plural interpolation are available in the common catalogue", () => {
  assert.equal(translate("Fit width", "ko"), "폭 맞춤");
  assert.equal(translate("Highlights ({count})", "ko", { count: 4 }), "하이라이트 (4)");
  assert.equal(translate("Page {page}", "en", { page: 9 }), "Page 9");
});
