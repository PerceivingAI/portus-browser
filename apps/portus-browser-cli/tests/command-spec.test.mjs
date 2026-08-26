import assert from "node:assert/strict";
import test from "node:test";
import { CLI_FLAG_SPECS, CLI_FLAGS } from "../dist/cli-flags.js";
import {
  CLI_INHERITED_GLOBAL_FLAGS,
  CLI_INVOCATIONS,
  cliInvocationPath,
  renderCliHelp,
  renderCliInvocationUsage,
  resolveCliInvocation,
  validateCliInvocationFlags,
  validateCliInvocationPositionals,
  validateCliInvocationPrimitiveValues,
  validateCliInvocationRepeatability
} from "../dist/command-spec.js";
import { CLI_SURFACE_BASELINE } from "../dist/cli-surface.js";
import { CLI_HANDLER_PATHS, runPortusBrowserCli } from "../dist/index.js";

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

test("CLI-3 registry records positional shapes for declarative validation", () => {
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

test("CLI-6 enforces repeatability after exact invocation resolution", () => {
  const browsers = resolveCliInvocation("browsers", []);
  assert.equal(browsers.ok, true);
  assert.equal(
    validateCliInvocationRepeatability(browsers.invocation, new Map([["json", ["true", "true"]]])),
    "--json may only be provided once."
  );

  const open = resolveCliInvocation("open", ["example.com"]);
  assert.equal(open.ok, true);
  assert.equal(
    validateCliInvocationRepeatability(open.invocation, new Map([["browser", ["1", "2"]]])),
    "--browser may only be provided once."
  );

  const fillForm = resolveCliInvocation("fill-form", []);
  assert.equal(fillForm.ok, true);
  assert.equal(
    validateCliInvocationRepeatability(fillForm.invocation, new Map([["field", ["el_1=a", "el_2=b"]]])),
    undefined
  );
});

test("CLI-6 rejects duplicate non-repeatable flags before Broker dispatch", async () => {
  for (const argv of [
    ["browsers", "--json", "--json"],
    ["open", "example.com", "--browser", "1", "--browser", "2", "--json"]
  ]) {
    const broker = createRecordingBroker({});
    const result = await runPortusBrowserCli(argv, { brokerClient: broker });
    assert.equal(result.exitCode, 2, argv.join(" "));
    assert.match(JSON.parse(result.stderr).error.message, /may only be provided once/, argv.join(" "));
    assert.deepEqual(broker.requests, [], argv.join(" "));
  }
});

test("CLI-7 validates required optional variadic and zero-positional contracts", () => {
  const openMissing = resolveCliInvocation("open", []);
  assert.equal(openMissing.ok, true);
  assert.equal(validateCliInvocationPositionals(openMissing.invocation), "open requires <url>.");

  const browsersExtra = resolveCliInvocation("browsers", ["stray"]);
  assert.equal(browsersExtra.ok, true);
  assert.equal(validateCliInvocationPositionals(browsersExtra.invocation), "browsers does not accept positional arguments.");

  const createRequiredOnly = resolveCliInvocation("recipes", ["create", "recipe-1"]);
  assert.equal(createRequiredOnly.ok, true);
  assert.equal(validateCliInvocationPositionals(createRequiredOnly.invocation), undefined);

  const createWithOptional = resolveCliInvocation("recipes", ["create", "recipe-1", "Display Name"]);
  assert.equal(createWithOptional.ok, true);
  assert.equal(validateCliInvocationPositionals(createWithOptional.invocation), undefined);

  const createExtra = resolveCliInvocation("recipes", ["create", "recipe-1", "Display Name", "extra"]);
  assert.equal(createExtra.ok, true);
  assert.equal(
    validateCliInvocationPositionals(createExtra.invocation),
    "recipes create accepts only <recipe-id> [<name>]."
  );

  const searchMissing = resolveCliInvocation("recipes", ["search"]);
  assert.equal(searchMissing.ok, true);
  assert.equal(validateCliInvocationPositionals(searchMissing.invocation), "recipes search requires <query>.");

  const searchMany = resolveCliInvocation("recipes", ["search", "latest", "AI", "news"]);
  assert.equal(searchMany.ok, true);
  assert.equal(validateCliInvocationPositionals(searchMany.invocation), undefined);
});

test("CLI-7 rejects positional misuse before Broker or filesystem side effects", async () => {
  for (const argv of [
    ["open", "--json"],
    ["browsers", "stray", "--json"],
    ["network", "get", "--browser", "br_000001", "--tab-id", "11", "--json"]
  ]) {
    const broker = createRecordingBroker({});
    const result = await runPortusBrowserCli(argv, { brokerClient: broker });
    assert.equal(result.exitCode, 2, argv.join(" "));
    assert.deepEqual(broker.requests, [], argv.join(" "));
  }

  const { mkdtemp, readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "portus-cli7-no-side-effect-"));
  const broker = createRecordingBroker({});
  const local = await runPortusBrowserCli([
    "recipes", "create", "recipe-1", "Name", "extra", "--content", "must not be written", "--directory", directory, "--json"
  ], { brokerClient: broker });

  assert.equal(local.exitCode, 2);
  assert.match(JSON.parse(local.stderr).error.message, /recipes create accepts only/);
  assert.deepEqual(await readdir(directory), []);
  assert.deepEqual(broker.requests, []);
});

test("CLI-8 validates primitive numeric and enum values from the declarative specs", () => {
  const tab = resolveCliInvocation("tab", []);
  assert.equal(tab.ok, true);
  assert.equal(validateCliInvocationPrimitiveValues(tab.invocation, new Map([["tab-id", "12"]])), undefined);
  assert.equal(validateCliInvocationPrimitiveValues(tab.invocation, new Map([["tab-id", "1.5"]])), "--tab-id must be an integer.");
  assert.equal(validateCliInvocationPrimitiveValues(tab.invocation, new Map([["index", "0"]])), "--index must be a positive integer.");

  const scroll = resolveCliInvocation("scroll", []);
  assert.equal(scroll.ok, true);
  assert.equal(validateCliInvocationPrimitiveValues(scroll.invocation, new Map([["x", "12.5"], ["y", "-3"]])), undefined);
  assert.equal(validateCliInvocationPrimitiveValues(scroll.invocation, new Map([["x", "NaN"]])), "--x must be a number.");

  const wait = resolveCliInvocation("wait", []);
  assert.equal(wait.ok, true);
  assert.equal(validateCliInvocationPrimitiveValues(wait.invocation, new Map([["state", "complete"]])), undefined);
  assert.equal(validateCliInvocationPrimitiveValues(wait.invocation, new Map([["state", "ready"]])), "--state must be loading or complete.");

  const dismiss = resolveCliInvocation("dismiss", []);
  assert.equal(dismiss.ok, true);
  assert.equal(validateCliInvocationPrimitiveValues(dismiss.invocation, new Map([["kind", "cookie"], ["strategy", "accept"]])), undefined);
  assert.equal(validateCliInvocationPrimitiveValues(dismiss.invocation, new Map([["kind", "modal"]])), "--kind must be any, popup, or cookie.");
  assert.equal(validateCliInvocationPrimitiveValues(dismiss.invocation, new Map([["strategy", "aggressive"]])), "--strategy must be conservative or accept.");

  const retention = resolveCliInvocation("policy", ["retention", "set", "1001"]);
  assert.equal(retention.ok, true);
  assert.equal(validateCliInvocationPrimitiveValues(retention.invocation, new Map()), "Retention limit must be an integer from 0 to 1000.");
});

test("CLI-8 rejects invalid primitives before Broker dispatch", async () => {
  const invalidInvocations = [
    ["tabs", "--browser", "br_000001", "--timeout", "0", "--json"],
    ["tab", "--browser", "br_000001", "--tab-id", "1.5", "--json"],
    ["tab", "--browser", "br_000001", "--index", "0", "--json"],
    ["snapshot", "--browser", "br_000001", "--max-elements", "10001", "--json"],
    ["scroll", "--browser", "br_000001", "--tab-id", "11", "--x", "NaN", "--json"],
    ["wait", "--browser", "br_000001", "--tab-id", "11", "--state", "ready", "--json"],
    ["dismiss", "--browser", "br_000001", "--tab-id", "11", "--kind", "modal", "--json"],
    ["policy", "retention", "set", "1001", "--browser", "br_000001", "--json"]
  ];

  for (const argv of invalidInvocations) {
    const broker = createRecordingBroker({});
    const result = await runPortusBrowserCli(argv, { brokerClient: broker });
    assert.equal(result.exitCode, 2, argv.join(" "));
    assert.deepEqual(broker.requests, [], argv.join(" "));
  }
});

test("CLI-8 keeps overloaded recipe --kind outside dismiss enum semantics", async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "portus-cli8-kind-"));
  const broker = createRecordingBroker({});
  const result = await runPortusBrowserCli([
    "recipes", "create", "custom-kind", "--content", "example", "--kind", "user-defined", "--directory", directory, "--json"
  ], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).recipe.kind, "user-defined");
  assert.deepEqual(broker.requests, []);
});

test("CLI-10 handler map exactly matches the declarative invocation registry", () => {
  const registryPaths = CLI_INVOCATIONS.map(cliInvocationPath);
  assert.equal(CLI_HANDLER_PATHS.length, 53);
  assert.deepEqual(CLI_HANDLER_PATHS, registryPaths);
  assert.equal(new Set(CLI_HANDLER_PATHS).size, CLI_HANDLER_PATHS.length);

  const aliases = CLI_INVOCATIONS.flatMap((entry) => (entry.aliases ?? []).map((alias) => alias.join(" ")));
  for (const alias of aliases) assert.equal(CLI_HANDLER_PATHS.includes(alias), false, alias);
});

test("CLI-10 aliases resolve to canonical handler paths", () => {
  for (const [command, canonical] of [
    ["console", "console list"],
    ["network", "network list"],
    ["recipes", "recipes list"]
  ]) {
    const resolution = resolveCliInvocation(command, []);
    assert.equal(resolution.ok, true, command);
    const path = cliInvocationPath(resolution.invocation.spec);
    assert.equal(path, canonical, command);
    assert.equal(CLI_HANDLER_PATHS.includes(path), true, command);
  }
});

test("CLI-11 generates invocation usage directly from declarative specs", () => {
  const byPath = (path) => CLI_INVOCATIONS.find((entry) => cliInvocationPath(entry) === path);

  assert.equal(
    renderCliInvocationUsage(byPath("open")),
    [
      "Usage: portus-browser open <url>",
      "Flags: --json, --quiet, --output <string>, --timeout <integer>, --browser <string>, --background"
    ].join("\n")
  );

  assert.equal(
    renderCliInvocationUsage(byPath("recipes list")),
    [
      "Usage: portus-browser recipes list",
      "Aliases: portus-browser recipes",
      "Flags: --json, --quiet, --output <string>, --timeout <integer>, --directory <string>"
    ].join("\n")
  );

  const dismissUsage = renderCliInvocationUsage(byPath("dismiss"));
  assert.match(dismissUsage, /--kind <any\|popup\|cookie>/);
  assert.match(dismissUsage, /--strategy <conservative\|accept>/);

  const fillFormUsage = renderCliInvocationUsage(byPath("fill-form"));
  assert.match(fillFormUsage, /--field <string>\.\.\./);
});

test("CLI-11 full help covers every canonical registry invocation without a second command list", () => {
  const help = renderCliHelp();
  const lines = help.split("\n");

  assert.equal(lines[0], "Portus Browser CLI");
  assert.equal(lines[1], "Usage: portus-browser <command> [arguments] [flags]");
  assert.equal(lines[3], "Global flags: --json, --quiet");

  for (const spec of CLI_INVOCATIONS) {
    const prefix = `  ${cliInvocationPath(spec)}`;
    const matchingCommandLines = lines.filter((line) => line === prefix || line.startsWith(`${prefix} `));
    assert.equal(matchingCommandLines.length, 1, cliInvocationPath(spec));
  }

  assert.match(help, /  recipes list \(alias: recipes\)/);
  assert.match(help, /  policy retention set <limit>/);
  assert.match(help, /  recipes export <recipe-id>\n    Flags: --output <string>, --directory <string>, --force/);
});

test("CLI-11 resolved syntax errors carry generated usage before side effects", async () => {
  const broker = createRecordingBroker({});
  const openSpec = CLI_INVOCATIONS.find((entry) => cliInvocationPath(entry) === "open");
  const expectedUsage = renderCliInvocationUsage(openSpec);

  const jsonResult = await runPortusBrowserCli(["open", "--json"], { brokerClient: broker });
  assert.equal(jsonResult.exitCode, 2);
  assert.equal(JSON.parse(jsonResult.stderr).error.details.usageText, expectedUsage);
  assert.deepEqual(broker.requests, []);

  const textResult = await runPortusBrowserCli(["open"], { brokerClient: broker });
  assert.equal(textResult.exitCode, 2);
  assert.match(textResult.stderr, /open requires <url>\./);
  assert.match(textResult.stderr, /Usage: portus-browser open <url>/);
  assert.deepEqual(broker.requests, []);
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
