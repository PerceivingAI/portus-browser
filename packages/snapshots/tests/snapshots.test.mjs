import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot, createElementId, createSnapshotId, filterSnapshot, findSnapshotElement, isSnapshotForTarget } from "../dist/index.js";

test("builds shallow snapshots with scoped element ids", () => {
  const screenshot = {
    browserId: "br_000001",
    tabId: 7,
    capturedAt: "2026-04-28T00:00:00.000Z",
    mimeType: "image/png",
    data: "data:image/png;base64,abc",
    activatedTabBeforeCapture: false
  };
  const snapshot = buildSnapshot({
    snapshotId: "snap_000123",
    browserId: "br_000001",
    tabId: 7,
    url: "https://example.com/",
    title: "Example",
    viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
    screenshot,
    visibleText: "Submit Email",
    capturedAt: "2026-04-28T00:00:00.000Z",
    elements: [
      {
        role: "button",
        label: "Submit",
        text: "Submit",
        selectorHint: "button:nth-of-type(1)",
        tagName: "button",
        bounds: { x: 10, y: 20, width: 100, height: 30 },
        state: { disabled: false }
      }
    ]
  });

  assert.equal(snapshot.snapshotId, "snap_000123");
  assert.equal(snapshot.elements[0].elementId, "el_000001");
  assert.equal(findSnapshotElement(snapshot, "el_000001").label, "Submit");
  assert.equal(isSnapshotForTarget(snapshot, "br_000001", 7), true);
});

test("creates deterministic snapshot and element ids", () => {
  assert.equal(createSnapshotId(3), "snap_000003");
  assert.equal(createElementId(12), "el_000012");
  assert.throws(() => createSnapshotId(0), /positive integer/);
});

test("filters snapshots without changing ids", () => {
  const screenshot = {
    browserId: "br_000001",
    tabId: 7,
    capturedAt: "2026-04-28T00:00:00.000Z",
    mimeType: "image/png",
    data: "data:image/png;base64,abc",
    activatedTabBeforeCapture: false
  };
  const snapshot = buildSnapshot({
    snapshotId: "snap_000123",
    browserId: "br_000001",
    tabId: 7,
    url: "https://example.com/",
    title: "Example",
    viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
    screenshot,
    visibleText: "Reviews Book now Search",
    capturedAt: "2026-04-28T00:00:00.000Z",
    elements: [
      {
        role: "link",
        label: "Latest reviews",
        text: "Read reviews",
        href: "https://example.com/reviews",
        tagName: "a",
        bounds: { x: 10, y: 20, width: 100, height: 30 }
      },
      {
        role: "button",
        label: "Book now",
        text: "Book now",
        tagName: "button",
        bounds: { x: 10, y: 60, width: 100, height: 30 }
      },
      {
        role: "generic",
        label: "Reviews summary",
        text: "Reviews summary",
        bounds: { x: 10, y: 100, width: 100, height: 30 }
      }
    ]
  });

  const filtered = filterSnapshot(snapshot, {
    query: "reviews",
    role: "link",
    interactiveOnly: true,
    maxElements: 10
  });

  assert.equal(filtered.snapshotId, "snap_000123");
  assert.equal(filtered.filtered, true);
  assert.deepEqual(filtered.filter, {
    query: "reviews",
    role: "link",
    interactiveOnly: true,
    maxElements: 10
  });
  assert.deepEqual(filtered.elements.map((element) => element.elementId), ["el_000001"]);
});
