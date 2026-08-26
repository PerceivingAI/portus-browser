import assert from "node:assert/strict";
import test from "node:test";
import {
  CLI_FLAG_SPECS,
  CLI_GLOBAL_PRESENTATION_FLAGS,
  CLI_OUTPUT_FLAG,
  getCliFlagSpec
} from "../dist/cli-flags.js";
import {
  CLI_INHERITED_GLOBAL_FLAGS,
  CLI_INVOCATIONS,
  cliInvocationOutputFlagRole,
  cliInvocationPath,
  resolveCliInvocation
} from "../dist/command-spec.js";
import { CLI_HANDLER_PATHS } from "../dist/index.js";

test("CLI-13 canonical flag definitions are internally consistent", () => {
  const names = CLI_FLAG_SPECS.map((flag) => flag.name);
  assert.equal(new Set(names).size, names.length, "duplicate flag spelling");

  for (const flag of CLI_FLAG_SPECS) {
    assert.equal(getCliFlagSpec(flag.name), flag, `flag lookup identity: --${flag.name}`);
    if (flag.kind === "boolean" || flag.kind === "string") {
      assert.equal(flag.positive, undefined, `non-numeric --${flag.name} cannot be positive`);
      assert.equal(flag.min, undefined, `non-numeric --${flag.name} cannot have min`);
      assert.equal(flag.max, undefined, `non-numeric --${flag.name} cannot have max`);
    }
    if (flag.min !== undefined && flag.max !== undefined) {
      assert.ok(flag.min <= flag.max, `invalid range for --${flag.name}`);
    }
  }

  assert.deepEqual(CLI_FLAG_SPECS.filter((flag) => flag.repeatable).map((flag) => flag.name), ["field"]);
  assert.deepEqual(CLI_GLOBAL_PRESENTATION_FLAGS.map((flag) => flag.name), ["json", "quiet"]);
  assert.deepEqual(CLI_INHERITED_GLOBAL_FLAGS, CLI_GLOBAL_PRESENTATION_FLAGS);
  for (const flag of CLI_INHERITED_GLOBAL_FLAGS) assert.equal(flag.kind, "boolean", `global --${flag.name}`);
});

test("CLI-13 invocation paths aliases and flag references cannot collide", () => {
  const canonicalFlags = new Set(CLI_FLAG_SPECS);
  const canonicalPaths = CLI_INVOCATIONS.map(cliInvocationPath);
  assert.equal(new Set(canonicalPaths).size, canonicalPaths.length, "duplicate canonical invocation path");

  const canonicalPathSet = new Set(canonicalPaths);
  const aliases = [];
  for (const invocation of CLI_INVOCATIONS) {
    assert.ok(invocation.path.length > 0, "empty invocation path");
    assert.ok(invocation.path.every((part) => part.length > 0), `empty path token: ${cliInvocationPath(invocation)}`);

    const localFlagNames = invocation.flags.map((flag) => flag.name);
    assert.equal(new Set(localFlagNames).size, localFlagNames.length, `duplicate flag: ${cliInvocationPath(invocation)}`);
    for (const flag of invocation.flags) {
      assert.ok(canonicalFlags.has(flag), `non-canonical flag reference: ${cliInvocationPath(invocation)} --${flag.name}`);
      assert.equal(CLI_INHERITED_GLOBAL_FLAGS.includes(flag), false, `global duplicated locally: ${cliInvocationPath(invocation)} --${flag.name}`);
    }

    for (const alias of invocation.aliases ?? []) {
      const key = alias.join(" ");
      aliases.push(key);
      assert.equal(canonicalPathSet.has(key), false, `alias collides with canonical path: ${key}`);
      assert.ok(alias.length > 0 && alias.every((part) => part.length > 0), `invalid alias: ${key}`);
    }
  }

  assert.equal(new Set(aliases).size, aliases.length, "duplicate alias path");
});

test("CLI-13 enum and positional constraints are structurally valid", () => {
  for (const invocation of CLI_INVOCATIONS) {
    const path = cliInvocationPath(invocation);
    const allowedFlags = new Set([...CLI_INHERITED_GLOBAL_FLAGS, ...invocation.flags]);

    for (const constraint of invocation.flagEnums ?? []) {
      assert.ok(allowedFlags.has(constraint.flag), `${path}: enum references undeclared flag --${constraint.flag.name}`);
      assert.ok(constraint.values.length > 0, `${path}: empty enum for --${constraint.flag.name}`);
      assert.equal(new Set(constraint.values).size, constraint.values.length, `${path}: duplicate enum values for --${constraint.flag.name}`);
      assert.ok(constraint.validationMessage.length > 0, `${path}: missing enum validation message`);
    }

    const positionalNames = invocation.positionals.map((positional) => positional.name);
    assert.equal(new Set(positionalNames).size, positionalNames.length, `${path}: duplicate positional name`);
    let optionalSeen = false;
    invocation.positionals.forEach((positional, index) => {
      if (!positional.required) optionalSeen = true;
      if (optionalSeen) assert.equal(positional.required, false, `${path}: required positional follows optional positional`);
      if (positional.variadic) assert.equal(index, invocation.positionals.length - 1, `${path}: variadic positional must be last`);
      if (positional.min !== undefined && positional.max !== undefined) {
        assert.ok(positional.min <= positional.max, `${path}: invalid positional range for ${positional.name}`);
      }
      if (positional.kind === undefined || positional.kind === "string") {
        assert.equal(positional.min, undefined, `${path}: string positional cannot have min`);
        assert.equal(positional.max, undefined, `${path}: string positional cannot have max`);
      }
      if (positional.minLength !== undefined) {
        assert.ok(Number.isInteger(positional.minLength) && positional.minLength > 0, `${path}: minLength must be a positive integer`);
      }
    });
  }
});

test("CLI-13 output semantics are explicit and recipes export is the sole file-output invocation", () => {
  const fileOutputPaths = CLI_INVOCATIONS
    .filter((invocation) => cliInvocationOutputFlagRole(invocation) === "file")
    .map(cliInvocationPath);
  assert.deepEqual(fileOutputPaths, ["recipes export"]);

  for (const invocation of CLI_INVOCATIONS) {
    const role = cliInvocationOutputFlagRole(invocation);
    const hasOutputFlag = invocation.flags.some((flag) => flag === CLI_OUTPUT_FLAG);
    assert.equal(role === "none", !hasOutputFlag, cliInvocationPath(invocation));
    if (role === "file") assert.equal(invocation.outputFlagRole, "file", cliInvocationPath(invocation));
  }
});

test("CLI-13 registry handler and alias resolution remain one-to-one", () => {
  const registryPaths = CLI_INVOCATIONS.map(cliInvocationPath);
  assert.deepEqual(CLI_HANDLER_PATHS, registryPaths);
  assert.equal(new Set(CLI_HANDLER_PATHS).size, CLI_HANDLER_PATHS.length);

  for (const invocation of CLI_INVOCATIONS) {
    for (const alias of invocation.aliases ?? []) {
      const resolution = resolveCliInvocation(alias[0], alias.slice(1));
      assert.equal(resolution.ok, true, alias.join(" "));
      assert.equal(resolution.invocation.spec, invocation, alias.join(" "));
    }
  }
});
