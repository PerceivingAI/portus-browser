import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI_FLAG_SPECS, CLI_GLOBAL_PRESENTATION_FLAGS } from "../dist/cli-flags.js";
import {
  CLI_INVOCATIONS,
  cliInvocationPath,
  renderCliInvocationUsage,
  resolveCliInvocation,
  validateCliInvocationFlags,
  validateCliInvocationRepeatability
} from "../dist/command-spec.js";
import { runPortusBrowserCli } from "../dist/index.js";

function resolveSpec(spec) {
  const resolution = resolveCliInvocation(spec.path[0], spec.path.slice(1));
  assert.equal(resolution.ok, true, cliInvocationPath(spec));
  return resolution.invocation;
}

function allowedFlags(spec) {
  return [...CLI_GLOBAL_PRESENTATION_FLAGS, ...spec.flags];
}

test("CLI-12 accepts every flag declared for its exact invocation", () => {
  for (const spec of CLI_INVOCATIONS) {
    const invocation = resolveSpec(spec);
    for (const flag of allowedFlags(spec)) {
      assert.equal(
        validateCliInvocationFlags(invocation, [flag.name]),
        undefined,
        `${cliInvocationPath(spec)} --${flag.name}`
      );
    }
  }
});

test("CLI-12 rejects every non-global flag outside its exact invocation", () => {
  const globalNames = new Set(CLI_GLOBAL_PRESENTATION_FLAGS.map((flag) => flag.name));

  for (const spec of CLI_INVOCATIONS) {
    const invocation = resolveSpec(spec);
    const allowedNames = new Set(allowedFlags(spec).map((flag) => flag.name));

    for (const flag of CLI_FLAG_SPECS) {
      if (globalNames.has(flag.name) || allowedNames.has(flag.name)) continue;
      assert.equal(
        validateCliInvocationFlags(invocation, [flag.name]),
        `--${flag.name} is not valid for ${cliInvocationPath(spec)}.`,
        `${cliInvocationPath(spec)} unexpectedly accepts --${flag.name}`
      );
    }
  }
});

test("CLI-12 repeatability matrix follows canonical flag metadata", () => {
  let repeatableCount = 0;

  for (const spec of CLI_INVOCATIONS) {
    const invocation = resolveSpec(spec);
    for (const flag of allowedFlags(spec)) {
      const error = validateCliInvocationRepeatability(invocation, new Map([[flag.name, ["first", "second"]]]));
      if (flag.repeatable) {
        repeatableCount += 1;
        assert.equal(error, undefined, `${cliInvocationPath(spec)} --${flag.name}`);
      } else {
        assert.equal(error, `--${flag.name} may only be provided once.`, `${cliInvocationPath(spec)} --${flag.name}`);
      }
    }
  }

  assert.equal(repeatableCount, 1, "only fill-form --field should currently be repeatable");
});

test("CLI-12 rejects the documented cross-command and nested-subcommand misuse matrix before Broker dispatch", async () => {
  const invalidInvocations = [
    ["browsers", "--background", "--json"],
    ["open", "example.com", "--limit", "5", "--json"],
    ["screenshot", "--browser", "br_000001", "--field", "x=y", "--json"],
    ["broker", "status", "--tab-id", "12", "--json"],
    ["console", "clear", "--browser", "br_000001", "--tab-id", "11", "--limit", "5", "--json"],
    ["network", "get", "req_1", "--browser", "br_000001", "--tab-id", "11", "--limit", "5", "--json"],
    ["dialog", "dismiss", "--browser", "br_000001", "--tab-id", "11", "--text", "unused", "--json"],
    ["policy", "allow", "list", "--browser", "br_000001", "--reason", "unused", "--json"],
    ["recipes", "list", "--content", "unused", "--json"],
    ["recipes", "export", "recipe-1", "--json-input", "{}", "--output", "out.json", "--json"],
    ["close-tab", "--browser", "br_000001", "--tab-id", "22", "--yes", "--json"]
  ];

  for (const argv of invalidInvocations) {
    const broker = createRecordingBroker();
    const result = await runPortusBrowserCli(argv, { brokerClient: broker });
    assert.equal(result.exitCode, 2, argv.join(" "));
    const error = JSON.parse(result.stderr).error;
    assert.match(error.message, /is not valid for/, argv.join(" "));
    assert.deepEqual(broker.requests, [], argv.join(" "));
    assert.match(error.details.usageText, /^Usage: portus-browser /, argv.join(" "));
  }
});

test("CLI-12 invalid local syntax cannot mutate the recipe filesystem", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-cli12-no-side-effect-"));
  const broker = createRecordingBroker();
  const spec = CLI_INVOCATIONS.find((entry) => cliInvocationPath(entry) === "recipes create");
  assert.ok(spec);

  const result = await runPortusBrowserCli([
    "recipes", "create", "blocked", "--content", "must not be written", "--directory", directory,
    "--timeout", "1", "--json"
  ], { brokerClient: broker });

  assert.equal(result.exitCode, 2);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.message, "--timeout is not valid for recipes create.");
  assert.equal(error.details.usageText, renderCliInvocationUsage(spec));
  assert.deepEqual(await readdir(directory), []);
  assert.deepEqual(broker.requests, []);
});

function createRecordingBroker() {
  return {
    requests: [],
    async request(type, payload, timeoutMs) {
      this.requests.push({ type, payload, timeoutMs });
      throw { code: "INTERNAL_ERROR", message: `Unexpected request: ${type}` };
    },
    async close() {}
  };
}
