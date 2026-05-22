import assert from "node:assert/strict";
import test from "node:test";
import { createDomActionResult, markSnapshotsStaleForTab, resolveActionElement, validateActionRequest } from "../dist/index.js";

const snapshot = {
  snapshotId: "snap_000001",
  browserId: "br_000001",
  tabId: 9,
  url: "https://example.com/",
  title: "Example",
  viewport: { width: 1000, height: 700, deviceScaleFactor: 1 },
  screenshot: {
    browserId: "br_000001",
    tabId: 9,
    capturedAt: "2026-04-28T00:00:00.000Z",
    mimeType: "image/png",
    data: "data:image/png;base64,abc",
    activatedTabBeforeCapture: false
  },
  visibleText: "Name",
  capturedAt: "2026-04-28T00:00:00.000Z",
  elements: [
    {
      elementId: "el_000001",
      role: "textbox",
      label: "Name",
      text: "",
      bounds: { x: 1, y: 2, width: 200, height: 20 },
      state: {},
      selectorHint: "input:nth-of-type(1)",
      tagName: "input",
      editable: true
    }
  ]
};

test("validates action requests and resolves snapshot-scoped elements", () => {
  const request = validateActionRequest({
    action: "type",
    browserId: "br_000001",
    tabId: 9,
    snapshotId: "snap_000001",
    elementId: "el_000001",
    text: "Ada"
  });
  const store = new Map([["snap_000001", { snapshot, stale: false }]]);
  assert.equal(resolveActionElement(request, store).selectorHint, "input:nth-of-type(1)");
});

test("stale snapshots fail before DOM action", () => {
  const request = validateActionRequest({
    action: "click",
    browserId: "br_000001",
    tabId: 9,
    snapshotId: "snap_000001",
    elementId: "el_000001"
  });
  const store = new Map([["snap_000001", { snapshot, stale: true }]]);
  assert.throws(() => resolveActionElement(request, store), { code: "SNAPSHOT_STALE" });
});

test("marks all snapshots for a tab stale after an action", () => {
  const store = new Map([
    ["snap_000001", { snapshot, stale: false }],
    ["snap_000002", { snapshot: { ...snapshot, snapshotId: "snap_000002", tabId: 10 }, stale: false }]
  ]);
  assert.deepEqual(markSnapshotsStaleForTab(store, "br_000001", 9), ["snap_000001"]);
  assert.equal(store.get("snap_000001").stale, true);
  assert.equal(store.get("snap_000002").stale, false);
});

test("creates DOM action results", () => {
  const result = createDomActionResult("2026-04-28T00:00:00.000Z", { action: "click" });
  assert.equal(result.backend, "content-script-dom");
  assert.equal(result.snapshotInvalidated, true);
});
