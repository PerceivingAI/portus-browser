import assert from "node:assert/strict";
import test from "node:test";
import { runPortusBrowserCli } from "../dist/index.js";
import { CLI_SURFACE_BASELINE } from "../dist/cli-surface.js";

const EXPECTED_CANONICAL_INVOCATIONS = [
  "browsers",
  "tabs",
  "tab",
  "open",
  "navigate",
  "back",
  "forward",
  "activate-tab",
  "close-tab",
  "screenshot",
  "snapshot",
  "click",
  "hover",
  "drag",
  "fill-form",
  "type",
  "press",
  "scroll",
  "dismiss",
  "wait",
  "watch",
  "dialog accept",
  "dialog dismiss",
  "console list",
  "console clear",
  "network list",
  "network get",
  "events recent",
  "session steps",
  "bridge disconnect",
  "broker status",
  "broker stop",
  "policy allow list",
  "policy allow add",
  "policy allow remove",
  "policy block list",
  "policy block add",
  "policy block remove",
  "policy retention get",
  "policy retention set",
  "recipes list",
  "recipes create",
  "recipes show",
  "recipes search",
  "recipes use",
  "recipes resolve",
  "recipes update",
  "recipes rename",
  "recipes delete",
  "recipes validate",
  "recipes import",
  "recipes export",
  "recipes duplicate"
];

const EXPECTED_ALIASES = ["console", "network", "recipes"];

test("CLI-0 locks the pre-declarative canonical invocation surface", () => {
  const actual = CLI_SURFACE_BASELINE.map((entry) => entry.path.join(" "));
  assert.equal(actual.length, 53);
  assert.deepEqual(actual, EXPECTED_CANONICAL_INVOCATIONS);
  assert.equal(new Set(actual).size, actual.length);
});

test("CLI-0 locks implicit list aliases", () => {
  const aliases = CLI_SURFACE_BASELINE.flatMap((entry) => (entry.aliases ?? []).map((alias) => alias.join(" ")));
  assert.deepEqual(aliases, EXPECTED_ALIASES);
  assert.equal(new Set(aliases).size, aliases.length);
  for (const alias of aliases) {
    assert.equal(EXPECTED_CANONICAL_INVOCATIONS.includes(alias), false);
  }
});

test("every CLI-0 baseline invocation is recognized by the current dispatcher", async () => {
  const invocations = CLI_SURFACE_BASELINE.flatMap((entry) => [entry.path, ...(entry.aliases ?? [])]);
  for (const invocation of invocations) {
    const result = await runPortusBrowserCli([...invocation], { brokerClient: createProbeBroker() });
    const message = result.stderr;
    assert.doesNotMatch(message, /Unknown command:/, invocation.join(" "));
    assert.doesNotMatch(message, /Unknown .* subcommand:/, invocation.join(" "));
    assert.doesNotMatch(message, /Unknown policy (?:area|allow action|block action|retention action):/, invocation.join(" "));
    assert.doesNotMatch(message, /dialog requires accept or dismiss\./, invocation.join(" "));
  }
});

function createProbeBroker() {
  const unavailable = {
    code: "BROKER_UNAVAILABLE",
    message: "CLI-0 surface probe reached a broker-backed handler."
  };
  return {
    async request() {
      throw unavailable;
    },
    async subscribeEvents() {
      throw unavailable;
    },
    async close() {}
  };
}
