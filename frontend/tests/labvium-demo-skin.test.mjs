import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("LabVium web build loads the modern skin after shared styles and bundles its local font", async () => {
  const main = await read("../demo/main.tsx");
  const order = ["./fonts/pretendard/pretendardvariable-dynamic-subset.css", "../app/globals.css", "./style.css", "../app/lib/continuity/continuity.css", "./skin.css", "./home.css"].map((path) => main.indexOf(`import "${path}";`));
  assert.ok(order.every((index) => index >= 0), "every stylesheet is imported");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "skin and landing styles load last");
  const font = await read("../demo/fonts/pretendard/pretendardvariable-dynamic-subset.css");
  assert.match(font, /font-display: swap/);
  assert.doesNotMatch(font, /url\((?:https?:)?\/\//, "font files stay same-origin");
  assert.match(await read("../demo/fonts/pretendard/LICENSE.txt"), /SIL Open Font License/);
});

test("skin motion is opt-in, entrance-only and leaves no lingering transform", async () => {
  for (const file of ["../demo/skin.css", "../demo/home.css"]) {
    const css = postcss.parse(await read(file));
    css.walkDecls(/^animation$/, (declaration) => {
      let parent = declaration.parent, gated = false;
      while (parent) {
        if (parent.type === "atrule" && parent.name === "media" && parent.params.includes("prefers-reduced-motion: no-preference")) gated = true;
        parent = parent.parent;
      }
      assert.ok(gated || declaration.value === "none", `${file}: ${declaration.parent.selector} animates outside the motion opt-in`);
      if (/\blv-(rise|route-in|dialog-in|drawer-in|drawer-in-left|hero-rise)\b/.test(declaration.value)) {
        assert.match(declaration.value, /\bbackwards\b/, `${declaration.parent.selector} must not keep its final transform`);
      }
    });
    css.walkRules((rule) => {
      if (rule.parent?.type === "atrule" && rule.parent.name === "keyframes") return;
      assert.match(rule.selector, /\[data-bandal-demo="true"\]/, `${file}: ${rule.selector} is scoped to the web build`);
    });
  }
  const skin = await read("../demo/skin.css");
  assert.match(skin, /\.page-stack:not\(\.reader-page-stack\) > \*/, "the Reader workspace is excluded from content entrances");
});

test("landing decoration stays hidden from assistive technology", async () => {
  const home = await read("../app/views/HomeView.tsx");
  assert.match(home, /<div className="lv-hero-aura" aria-hidden="true">/);
  assert.match(home, /<span className="lv-kicker-dot" aria-hidden="true" \/>/);
  assert.match(home, /<span className="lv-workflow-icon" aria-hidden="true">/);
});
