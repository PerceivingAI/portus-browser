import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  collectPortusComposedDomElements,
  installPortusComposedDomRuntime,
  selectorForPortusComposedElement
} from "../dist/composed-dom.js";

test("packages the composed-DOM runtime as a self-contained classic script", async () => {
  const source = await readFile(new URL("../dist/composed-dom-runtime.js", import.meta.url), "utf8");

  assert.match(source, /__portusComposedDom/);
  assert.doesNotMatch(source, /\bimport\s/);
  assert.doesNotMatch(source, /\bexport\s/);
});

test("walks nested open shadow roots in deterministic order and records host chains", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="light-before"></div>
    <app-shell id="app"><span id="light-child"></span></app-shell>
    <div id="light-after"></div>
  </body></html>`);
  const document = dom.window.document;
  const app = document.querySelector("#app");
  const appRoot = app.attachShadow({ mode: "open" });
  appRoot.innerHTML = `<button id="shadow-button">Shadow</button><nested-panel id="nested"></nested-panel>`;
  const nested = appRoot.querySelector("#nested");
  const nestedRoot = nested.attachShadow({ mode: "open" });
  nestedRoot.innerHTML = `<input id="nested-input" />`;

  const entries = collectPortusComposedDomElements(document);
  const byId = new Map(entries.filter((entry) => entry.element.id).map((entry) => [entry.element.id, entry]));
  const idOrder = entries.map((entry) => entry.element.id).filter(Boolean);

  assert.deepEqual(idOrder, [
    "light-before",
    "app",
    "shadow-button",
    "nested",
    "nested-input",
    "light-child",
    "light-after"
  ]);
  assert.equal(new Set(entries.map((entry) => entry.element)).size, entries.length);
  assert.equal(byId.get("light-child").shadowPath, undefined);
  assert.equal(byId.get("shadow-button").selectorHint, "#shadow-button");
  assert.deepEqual(byId.get("shadow-button").shadowPath, [
    { hostSelectorHint: "#app", rootType: "open" }
  ]);
  assert.deepEqual(byId.get("nested-input").shadowPath, [
    { hostSelectorHint: "#app", rootType: "open" },
    { hostSelectorHint: "#nested", rootType: "open" }
  ]);
  assert.equal(byId.get("nested-input").root, nestedRoot);
});

test("builds selectors relative to the current document or shadow root", () => {
  const dom = new JSDOM(`<!doctype html><html><body><section><x-host></x-host><x-host></x-host></section></body></html>`);
  const document = dom.window.document;
  const host = document.querySelectorAll("x-host")[1];
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<div><button></button><button></button></div>`;
  const target = root.querySelectorAll("button")[1];

  assert.equal(selectorForPortusComposedElement(host, document), "html:nth-of-type(1) > body:nth-of-type(1) > section:nth-of-type(1) > x-host:nth-of-type(2)");
  assert.equal(selectorForPortusComposedElement(target, root), "div:nth-of-type(1) > button:nth-of-type(2)");
  assert.throws(() => selectorForPortusComposedElement(target, document), /does not belong/);
});

test("installs one reusable composed-DOM runtime on the target global", () => {
  const dom = new JSDOM(`<!doctype html><html><body><x-host id="host"></x-host></body></html>`);
  const document = dom.window.document;
  const host = document.querySelector("#host");
  host.attachShadow({ mode: "open" }).innerHTML = `<button id="inside">Inside</button>`;
  const target = {};

  const runtime = installPortusComposedDomRuntime(target);

  assert.equal(target.__portusComposedDom, runtime);
  const inside = runtime.collect(document).find((entry) => entry.element.id === "inside");
  assert.deepEqual(inside.shadowPath, [{ hostSelectorHint: "#host", rootType: "open" }]);
});
