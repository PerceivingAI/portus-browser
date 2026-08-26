import assert from "node:assert/strict";
import test from "node:test";
import { CLI_FLAG_SPECS, CLI_FLAGS } from "../dist/cli-flags.js";
import {
  CLI_INHERITED_GLOBAL_FLAGS,
  CLI_INVOCATIONS,
  cliInvocationPath,
  resolveCliInvocation,
  validateCliInvocationFlags
} from "../dist/command-spec.js";
import { CLI_SURFACE_BASELINE } from "../dist/cli-surface.js";
import { runPortusBrowserCli } from "../dist/index.js";

test("CLI-3 registry exactly covers the CLI-0 canonical surface and aliases", () => {
  const actualPaths = CLI_INVOCATIONS.map(cliInvocationPath);
  const baselinePaths = CLI_SURFACE_BASELINE.map((entry) => entry.path.join(" "));
  assert.deepEqual(actualPaths, baselinePaths);
  assert.equal(new Set(actualPaths).size, actualPaths.length);

  const actualAliases = CLI_INVOCATIONS.flatMap((entry) => (entry.aliases ?? []).map((alias) => alias.join(" ")));
  const baselineAliases = CLI_SURFACE_BASELINE.flatMap((entry) => (entry.aliases ?? []).map((alias) => alias.join(" ")));
  assert.deepEqual(actualAliases, baselineAliases);
  assert.equal(new Set(actualAliases).size, actualAliases.length);
});

test("CLI-3 registry references canonical flag definitions and keeps globals inherited", () => {
  const canonicalFlags = new Set(CLI_FLAG_SPECS);
  assert.deepEqual(CLI_INHERITED_GLOBAL_FLAGS.map((flag) => flag.name), ["json", "quiet"]);

  for (const invocation of CLI_INVOCATIONS) {
    const names = invocation.flags.map((flag) => flag.name);
    assert.equal(new Set(names).size, names.length, cliInvocationPath(invocation));
    for (const flag of invocation.flags) {
      assert.equal(canonicalFlags.has(flag), true, `${cliInvocationPath(invocation)} --${flag.name}`);
      assert.equal(CLI_INHERITED_GLOBAL_FLAGS.includes(flag), false, `${cliInvocationPath(invocation)} duplicates global --${flag.name}`);
    }
  }

  const open = CLI_INVOCATIONS.find((entry) => cliInvocationPath(entry) === "open");
  assert.deepEqual(open.flags.map((flag) => flag.name), ["output", "timeout", "browser", "background"]);

  const create = CLI_INVOCATIONS.find((entry) => cliInvocationPath(entry) === "recipes create");
  assert.equal(create.flags.includes(CLI_FLAGS.timeout), false);
  assert.equal(create.flags.includes(CLI_FLAGS.output), true);

  const exportRecipe = CLI_INVOCATIONS.find((entry) => cliInvocationPath(entry) === "recipes export");
  assert.deepEqual(exportRecipe.flags.map((flag) => flag.name), ["output", "directory", "force"]);
});

test("CLI-3 records positional shapes without enforcing them yet", () => {
  const byPath = (path) => CLI_INVOCATIONS.find((entry) => cliInvocationPath(entry) === path);
  assert.deepEqual(byPath("open").positionals, [{ name: "url", required: true, variadic: false }]);
  assert.deepEqual(byPath("recipes create").positionals, [
    { name: "recipe-id", required: true, variadic: false },
    { name: "name", required: false, variadic: false }
  ]);
  assert.deepEqual(byPath("recipes search").positionals, [
    { name: "query", required: true, variadic: true }
  ]);
});

test("CLI-4 resolves canonical, nested, aliased, and positional invocations", () => {
  const open = resolveCliInvocation("open", ["example.com"]);
  assert.equal(open.ok, true);
  assert.equal(cliInvocationPath(open.invocation.spec), "open");
  assert.deepEqual(open.invocation.argumentPositionals, ["example.com"]);

  const networkGet = resolveCliInvocation("network", ["get", "req_1"]);
  assert.equal(networkGet.ok, true);
  assert.equal(cliInvocationPath(networkGet.invocation.spec), "network get");
  assert.equal(networkGet.invocation.consumedPositionals, 1);
  assert.deepEqual(networkGet.invocation.argumentPositionals, ["req_1"]);

  const policySet = resolveCliInvocation("policy", ["retention", "set", "50"]);
  assert.equal(policySet.ok, true);
  assert.equal(cliInvocationPath(policySet.invocation.spec), "policy retention set");
  assert.equal(policySet.invocation.consumedPositionals, 2);
  assert.deepEqual(policySet.invocation.argumentPositionals, ["50"]);

  const recipesAlias = resolveCliInvocation("recipes", []);
  assert.equal(recipesAlias.ok, true);
  assert.equal(cliInvocationPath(recipesAlias.invocation.spec), "recipes list");
  assert.deepEqual(recipesAlias.invocation.matchedPath, ["recipes"]);
});

test("CLI-4 preserves current command/subcommand error semantics", () => {
  assert.deepEqual(resolveCliInvocation(undefined, []), { ok: false, message: "A command is required." });
  assert.deepEqual(resolveCliInvocation("unknown", []), { ok: false, message: "Unknown command: unknown." });
  assert.deepEqual(resolveCliInvocation("events", []), { ok: false, message: "Event subcommand is required." });
  assert.deepEqual(resolveCliInvocation("events", ["wat"]), { ok: false, message: "Unknown event subcommand: wat." });
  assert.deepEqual(resolveCliInvocation("dialog", ["wat"]), { ok: false, message: "dialog requires accept or dismiss." });
  assert.deepEqual(resolveCliInvocation("recipes", ["wat"]), { ok: false, message: "Unknown recipes subcommand: wat." });
  assert.deepEqual(resolveCliInvocation("policy", ["allow", "wat"]), { ok: false, message: "Unknown policy allow action: wat." });
  assert.deepEqual(resolveCliInvocation("policy", ["other", "get"]), { ok: false, message: "Unknown policy area: other." });
});

test("CLI-4 rejects unknown nested invocations before Broker dispatch", async () => {
  for (const argv of [
    ["recipes", "wat", "--json"],
    ["policy", "allow", "wat", "--json"],
    ["broker", "wat", "--json"]
  ]) {
    const broker = createRecordingBroker({});
    const result = await runPortusBrowserCli(argv, { brokerClient: broker });
    assert.equal(result.exitCode, 2, argv.join(" "));
    assert.deepEqual(broker.requests, [], argv.join(" "));
  }
});

test("CLI-5 validates flags against the exact resolved invocation", () => {
  const browsers = resolveCliInvocation("browsers", []);
  assert.equal(browsers.ok, true);
  assert.equal(validateCliInvocationFlags(browsers.invocation, ["json"]), undefined);
  assert.equal(validateCliInvocationFlags(browsers.invocation, ["output", "timeout"]), undefined);
  assert.equal(
    validateCliInvocationFlags(browsers.invocation, ["background"]),
    "--background is not valid for browsers."
  );

  const networkGet = resolveCliInvocation("network", ["get", "req_1"]);
  assert.equal(networkGet.ok, true);
  assert.equal(validateCliInvocationFlags(networkGet.invocation, ["browser", "tab-id", "quiet"]), undefined);
  assert.equal(
    validateCliInvocationFlags(networkGet.invocation, ["limit"]),
    "--limit is not valid for network get."
  );
});

test("CLI-5 rejects cross-command flags before Broker dispatch", async () => {
  const invalidInvocations = [
    ["browsers", "--background", "--json"],
    ["open", "example.com", "--limit", "5", "--json"],
    ["screenshot", "--browser", "br_000001", "--limit", "5", "--json"],
    ["close-tab", "--browser", "br_000001", "--tab-id", "22", "--yes", "--json"],
    ["broker", "status", "--browser", "br_000001", "--json"],
    ["console", "clear", "--browser", "br_000001", "--tab-id", "11", "--limit", "5", "--json"],
    ["network", "get", "req_1", "--browser", "br_000001", "--tab-id", "11", "--limit", "5", "--json"],
    ["policy", "allow", "list", "--browser", "br_000001", "--reason", "unused", "--json"],
    ["recipes", "export", "recipe-1", "--content", "unused", "--output", "out.json", "--json"]
  ];

  for (const argv of invalidInvocations) {
    const broker = createRecordingBroker({});
    const result = await runPortusBrowserCli(argv, { brokerClient: broker });
    assert.equal(result.exitCode, 2, argv.join(" "));
    const error = JSON.parse(result.stderr).error;
    assert.match(error.message, /is not valid for/, argv.join(" "));
    assert.deepEqual(broker.requests, [], argv.join(" "));
  }
});

test("CLI-5 keeps global presentation flags valid across invocation types", async () => {
  const broker = createRecordingBroker({
    "browser.list": { browsers: [] }
  });
  const result = await runPortusBrowserCli(["browsers", "--quiet"], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.deepEqual(broker.requests.map((request) => request.type), ["browser.list"]);
});

test("CLI-5 rejects meaningless timeout on local recipe operations before filesystem work", async () => {
  const { mkdtemp, readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "portus-cli5-no-side-effect-"));
  const broker = createRecordingBroker({});

  const result = await runPortusBrowserCli([
    "recipes", "create", "blocked", "--content", "must not be written", "--directory", directory, "--timeout", "1", "--json"
  ], { brokerClient: broker });

  assert.equal(result.exitCode, 2);
  assert.match(JSON.parse(result.stderr).error.message, /--timeout is not valid for recipes create/);
  assert.deepEqual(await readdir(directory), []);
  assert.deepEqual(broker.requests, []);
});

function createRecordingBroker(results) {
  return {
    requests: [],
    async request(type, payload, timeoutMs) {
      this.requests.push({ type, payload, timeoutMs });
      if (!(type in results)) throw { code: "INTERNAL_ERROR", message: `Unexpected request: ${type}` };
      return results[type];
    },
    async close() {}
  };
}
