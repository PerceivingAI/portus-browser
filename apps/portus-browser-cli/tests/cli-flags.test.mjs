import assert from "node:assert/strict";
import test from "node:test";
import { CLI_FLAGS, CLI_FLAG_SPECS, cliFlagTakesValue, getCliFlagSpec } from "../dist/cli-flags.js";
import { runPortusBrowserCli } from "../dist/index.js";

const LEGACY_FLAG_NAMES = [
  "output", "browser", "timeout", "tab-id", "index", "element", "snapshot", "from", "to", "fields", "json-fields", "field",
  "x", "y", "reason", "scheme", "authority", "host-wildcard", "url-exact", "url-prefix", "type", "limit", "kind", "strategy",
  "query", "role", "max-elements", "state", "url-contains", "text", "element-query", "directory", "file", "json-input", "content",
  "description", "name", "id", "background", "debugger", "screenshot", "json", "partial", "dry-run", "force", "yes", "interactive-only", "quiet"
].sort();

test("CLI-1 defines every pre-declarative flag exactly once", () => {
  const names = CLI_FLAG_SPECS.map((spec) => spec.name);
  assert.deepEqual([...names].sort(), LEGACY_FLAG_NAMES);
  assert.equal(new Set(names).size, names.length);
  for (const spec of CLI_FLAG_SPECS) assert.equal(getCliFlagSpec(spec.name), spec);
});

test("CLI-1 flag definitions encode primitive kind and repeatability", () => {
  assert.deepEqual(CLI_FLAGS.timeout, { name: "timeout", kind: "integer", repeatable: false, positive: true });
  assert.deepEqual(CLI_FLAGS.index, { name: "index", kind: "integer", repeatable: false, positive: true });
  assert.deepEqual(CLI_FLAGS.limit, { name: "limit", kind: "integer", repeatable: false, positive: true });
  assert.deepEqual(CLI_FLAGS.maxElements, { name: "max-elements", kind: "integer", repeatable: false, positive: true, max: 10000 });
  assert.deepEqual(CLI_FLAGS.x, { name: "x", kind: "number", repeatable: false });
  assert.deepEqual(CLI_FLAGS.background, { name: "background", kind: "boolean", repeatable: false });
  assert.deepEqual(CLI_FLAGS.field, { name: "field", kind: "string", repeatable: true });
  assert.equal(cliFlagTakesValue(CLI_FLAGS.background), false);
  assert.equal(cliFlagTakesValue(CLI_FLAGS.browser), true);
  assert.equal(getCliFlagSpec("does-not-exist"), undefined);
});

test("CLI-6 declarative validation rejects duplicate non-repeatable value flags before dispatch", async () => {
  const broker = createRecordingBroker();
  const result = await runPortusBrowserCli(["tabs", "--browser", "1", "--browser", "2", "--json"], { brokerClient: broker });

  assert.equal(result.exitCode, 2);
  assert.match(JSON.parse(result.stderr).error.message, /--browser may only be provided once/);
  assert.deepEqual(broker.requests, []);
});

test("CLI-6 declarative validation preserves intentionally repeatable --field values", async () => {
  const broker = createRecordingBroker({
    "action.fillForm": {
      fillForm: {
        backend: "content-script-dom",
        completedAt: "2026-04-28T00:00:00.000Z",
        snapshotInvalidated: true,
        fields: [
          { elementId: "el_000001", ok: true },
          { elementId: "el_000002", ok: true }
        ]
      }
    }
  });
  const result = await runPortusBrowserCli([
    "fill-form",
    "--browser", "br_000001",
    "--tab-id", "11",
    "--snapshot", "snap_000001",
    "--field", "el_000001=one",
    "--field", "el_000002=two",
    "--json"
  ], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(broker.requests[0].payload.fields, [
    { elementId: "el_000001", value: "one" },
    { elementId: "el_000002", value: "two" }
  ]);
});

function createRecordingBroker(results = {}) {
  return {
    requests: [],
    async request(type, payload, timeoutMs) {
      this.requests.push({ type, payload, timeoutMs });
      if (!(type in results)) throw { code: "INTERNAL_ERROR", message: `Unexpected request: ${type}` };
      return results[type];
    }
  };
}
