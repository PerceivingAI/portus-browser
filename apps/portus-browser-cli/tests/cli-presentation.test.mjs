import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CLI_FLAGS,
  CLI_GLOBAL_PRESENTATION_FLAGS,
  CLI_GLOBAL_PRESENTATION_FLAG_NAMES,
  CLI_OUTPUT_FLAG,
  CLI_TIMEOUT_FLAG,
  isCliGlobalPresentationFlag
} from "../dist/cli-flags.js";
import { runPortusBrowserCli } from "../dist/index.js";

test("CLI-2 defines only --json and --quiet as presentation globals", () => {
  assert.deepEqual(
    CLI_GLOBAL_PRESENTATION_FLAGS.map((spec) => spec.name),
    ["json", "quiet"]
  );
  assert.deepEqual([...CLI_GLOBAL_PRESENTATION_FLAG_NAMES], ["json", "quiet"]);
  assert.equal(isCliGlobalPresentationFlag("json"), true);
  assert.equal(isCliGlobalPresentationFlag("quiet"), true);
  assert.equal(isCliGlobalPresentationFlag("output"), false);
  assert.equal(isCliGlobalPresentationFlag("timeout"), false);
});

test("CLI-2 keeps --output and --timeout invocation-scoped", () => {
  assert.equal(CLI_OUTPUT_FLAG, CLI_FLAGS.output);
  assert.equal(CLI_TIMEOUT_FLAG, CLI_FLAGS.timeout);
  assert.equal(CLI_GLOBAL_PRESENTATION_FLAGS.includes(CLI_OUTPUT_FLAG), false);
  assert.equal(CLI_GLOBAL_PRESENTATION_FLAGS.includes(CLI_TIMEOUT_FLAG), false);
});

test("CLI-2 preserves recipes export --output as a destination path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-cli2-recipes-"));
  const broker = createRecordingBroker();
  const result = await runPortusBrowserCli([
    "recipes",
    "export",
    "missing-recipe",
    "--directory",
    directory,
    "--output",
    join(directory, "exported.json")
  ], { brokerClient: broker });

  assert.notEqual(result.exitCode, 2);
  assert.doesNotMatch(result.stderr, /--output must be table, json, ndjson, or quiet/);
  assert.deepEqual(broker.requests, []);
});

function createRecordingBroker() {
  return {
    requests: [],
    async request(type, payload, timeoutMs) {
      this.requests.push({ type, payload, timeoutMs });
      throw { code: "INTERNAL_ERROR", message: `Unexpected request: ${type}` };
    }
  };
}
