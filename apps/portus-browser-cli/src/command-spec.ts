import {
  CLI_FLAGS,
  CLI_GLOBAL_PRESENTATION_FLAGS,
  CLI_OUTPUT_FLAG,
  CLI_TIMEOUT_FLAG,
  type CliFlagSpec
} from "./cli-flags.js";

export interface CliPositionalSpec {
  name: string;
  required: boolean;
  variadic: boolean;
}

export interface CliInvocationSpec {
  path: readonly string[];
  aliases?: readonly (readonly string[])[];
  flags: readonly CliFlagSpec[];
  positionals: readonly CliPositionalSpec[];
}

export interface ResolvedCliInvocation {
  spec: CliInvocationSpec;
  matchedPath: readonly string[];
  consumedPositionals: number;
  argumentPositionals: readonly string[];
}

export type CliInvocationResolution =
  | { ok: true; invocation: ResolvedCliInvocation }
  | { ok: false; message: string };

const noArgs = [] as const;
const arg = (name: string, required = true, variadic = false): CliPositionalSpec => ({ name, required, variadic });
const brokerFlags = (...flags: CliFlagSpec[]): readonly CliFlagSpec[] => [CLI_OUTPUT_FLAG, CLI_TIMEOUT_FLAG, ...flags];
const localFlags = (...flags: CliFlagSpec[]): readonly CliFlagSpec[] => [CLI_OUTPUT_FLAG, ...flags];

const navigationRuleFlags = [
  CLI_FLAGS.scheme,
  CLI_FLAGS.authority,
  CLI_FLAGS.hostWildcard,
  CLI_FLAGS.urlExact,
  CLI_FLAGS.urlPrefix
] as const;

/**
 * CLI-3 authoritative invocation registry.
 *
 * This registry describes the exact canonical command/subcommand surface,
 * aliases, invocation-scoped flags, and positional shape that the declarative
 * parser is migrating toward. CLI_GLOBAL_PRESENTATION_FLAGS are inherited by
 * every invocation and therefore are not repeated in each `flags` array.
 *
 * CLI-4 resolves invocations against this registry before dispatch. CLI-5 will
 * enforce the exact flag sets. CLI-7 will enforce the positional contracts.
 */
export const CLI_INVOCATIONS = [
  { path: ["browsers"], flags: brokerFlags(), positionals: noArgs },
  { path: ["tabs"], flags: brokerFlags(CLI_FLAGS.browser), positionals: noArgs },
  { path: ["tab"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.index), positionals: noArgs },
  { path: ["open"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.background), positionals: [arg("url")] },
  { path: ["navigate"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId), positionals: [arg("url")] },
  { path: ["back"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId), positionals: noArgs },
  { path: ["forward"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId), positionals: noArgs },
  { path: ["activate-tab"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId), positionals: noArgs },
  { path: ["close-tab"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId), positionals: noArgs },
  { path: ["screenshot"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.debugger), positionals: noArgs },
  {
    path: ["snapshot"],
    flags: brokerFlags(
      CLI_FLAGS.browser,
      CLI_FLAGS.tabId,
      CLI_FLAGS.debugger,
      CLI_FLAGS.query,
      CLI_FLAGS.role,
      CLI_FLAGS.interactiveOnly,
      CLI_FLAGS.maxElements
    ),
    positionals: noArgs
  },
  { path: ["click"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.snapshot, CLI_FLAGS.element), positionals: noArgs },
  { path: ["hover"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.snapshot, CLI_FLAGS.element), positionals: noArgs },
  { path: ["drag"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.snapshot, CLI_FLAGS.from, CLI_FLAGS.to), positionals: noArgs },
  {
    path: ["fill-form"],
    flags: brokerFlags(
      CLI_FLAGS.browser,
      CLI_FLAGS.tabId,
      CLI_FLAGS.snapshot,
      CLI_FLAGS.fields,
      CLI_FLAGS.jsonFields,
      CLI_FLAGS.field,
      CLI_FLAGS.partial
    ),
    positionals: noArgs
  },
  { path: ["type"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.snapshot, CLI_FLAGS.element), positionals: [arg("text")] },
  { path: ["press"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId), positionals: [arg("key")] },
  { path: ["scroll"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.x, CLI_FLAGS.y), positionals: noArgs },
  { path: ["dismiss"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.kind, CLI_FLAGS.strategy, CLI_FLAGS.dryRun), positionals: noArgs },
  {
    path: ["wait"],
    flags: brokerFlags(
      CLI_FLAGS.browser,
      CLI_FLAGS.tabId,
      CLI_FLAGS.state,
      CLI_FLAGS.urlContains,
      CLI_FLAGS.text,
      CLI_FLAGS.elementQuery,
      CLI_FLAGS.role
    ),
    positionals: noArgs
  },
  { path: ["watch"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.type), positionals: noArgs },

  { path: ["dialog", "accept"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.text), positionals: noArgs },
  { path: ["dialog", "dismiss"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId), positionals: noArgs },

  { path: ["console", "list"], aliases: [["console"]], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.limit), positionals: noArgs },
  { path: ["console", "clear"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId), positionals: noArgs },

  { path: ["network", "list"], aliases: [["network"]], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.limit), positionals: noArgs },
  { path: ["network", "get"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId), positionals: [arg("request-id")] },

  { path: ["events", "recent"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.type, CLI_FLAGS.limit), positionals: noArgs },
  { path: ["session", "steps"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.limit), positionals: noArgs },
  { path: ["bridge", "disconnect"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.reason), positionals: noArgs },
  { path: ["broker", "status"], flags: brokerFlags(), positionals: noArgs },
  { path: ["broker", "stop"], flags: brokerFlags(), positionals: noArgs },

  { path: ["policy", "allow", "list"], flags: brokerFlags(CLI_FLAGS.browser), positionals: noArgs },
  { path: ["policy", "allow", "add"], flags: brokerFlags(CLI_FLAGS.browser, ...navigationRuleFlags, CLI_FLAGS.reason), positionals: noArgs },
  { path: ["policy", "allow", "remove"], flags: brokerFlags(CLI_FLAGS.browser, ...navigationRuleFlags), positionals: noArgs },
  { path: ["policy", "block", "list"], flags: brokerFlags(CLI_FLAGS.browser), positionals: noArgs },
  { path: ["policy", "block", "add"], flags: brokerFlags(CLI_FLAGS.browser, ...navigationRuleFlags, CLI_FLAGS.reason), positionals: noArgs },
  { path: ["policy", "block", "remove"], flags: brokerFlags(CLI_FLAGS.browser, ...navigationRuleFlags), positionals: noArgs },
  { path: ["policy", "retention", "get"], flags: brokerFlags(CLI_FLAGS.browser), positionals: noArgs },
  { path: ["policy", "retention", "set"], flags: brokerFlags(CLI_FLAGS.browser), positionals: [arg("limit")] },

  { path: ["recipes", "list"], aliases: [["recipes"]], flags: brokerFlags(CLI_FLAGS.directory), positionals: noArgs },
  {
    path: ["recipes", "create"],
    flags: localFlags(
      CLI_FLAGS.directory,
      CLI_FLAGS.file,
      CLI_FLAGS.jsonInput,
      CLI_FLAGS.content,
      CLI_FLAGS.kind,
      CLI_FLAGS.description,
      CLI_FLAGS.name,
      CLI_FLAGS.force
    ),
    positionals: [arg("recipe-id"), arg("name", false)]
  },
  { path: ["recipes", "show"], flags: brokerFlags(CLI_FLAGS.directory), positionals: [arg("recipe-id")] },
  { path: ["recipes", "search"], flags: brokerFlags(CLI_FLAGS.directory), positionals: [arg("query", true, true)] },
  { path: ["recipes", "use"], flags: brokerFlags(CLI_FLAGS.directory), positionals: [arg("query", true, true)] },
  { path: ["recipes", "resolve"], flags: brokerFlags(CLI_FLAGS.directory), positionals: [arg("query", true, true)] },
  {
    path: ["recipes", "update"],
    flags: localFlags(
      CLI_FLAGS.directory,
      CLI_FLAGS.file,
      CLI_FLAGS.jsonInput,
      CLI_FLAGS.content,
      CLI_FLAGS.kind,
      CLI_FLAGS.description,
      CLI_FLAGS.name
    ),
    positionals: [arg("recipe-id")]
  },
  { path: ["recipes", "rename"], flags: localFlags(CLI_FLAGS.directory), positionals: [arg("recipe-id"), arg("new-name")] },
  { path: ["recipes", "delete"], flags: localFlags(CLI_FLAGS.directory, CLI_FLAGS.yes), positionals: [arg("recipe-id")] },
  { path: ["recipes", "validate"], flags: localFlags(CLI_FLAGS.directory), positionals: [arg("target")] },
  { path: ["recipes", "import"], flags: localFlags(CLI_FLAGS.directory, CLI_FLAGS.id, CLI_FLAGS.name, CLI_FLAGS.force), positionals: [arg("file-path")] },
  {
    path: ["recipes", "export"],
    flags: [CLI_OUTPUT_FLAG, CLI_FLAGS.directory, CLI_FLAGS.force],
    positionals: [arg("recipe-id")]
  },
  { path: ["recipes", "duplicate"], flags: localFlags(CLI_FLAGS.directory, CLI_FLAGS.name, CLI_FLAGS.force), positionals: [arg("source-id"), arg("new-id")] }
] as const satisfies readonly CliInvocationSpec[];

export const CLI_INHERITED_GLOBAL_FLAGS: readonly CliFlagSpec[] = CLI_GLOBAL_PRESENTATION_FLAGS;

const canonicalByKey = new Map<string, CliInvocationSpec>();
const aliasByKey = new Map<string, CliInvocationSpec>();
const topLevelCommands = new Set<string>();

for (const spec of CLI_INVOCATIONS) {
  canonicalByKey.set(pathKey(spec.path), spec);
  topLevelCommands.add(spec.path[0] as string);
  for (const alias of ("aliases" in spec ? spec.aliases : [])) aliasByKey.set(pathKey(alias), spec);
}

export function resolveCliInvocation(command: string | undefined, positionals: readonly string[]): CliInvocationResolution {
  if (!command) return { ok: false, message: "A command is required." };
  if (!topLevelCommands.has(command)) return { ok: false, message: `Unknown command: ${command}.` };

  const tokens = [command, ...positionals];
  const exactAlias = aliasByKey.get(pathKey(tokens));
  if (exactAlias) {
    return {
      ok: true,
      invocation: {
        spec: exactAlias,
        matchedPath: tokens,
        consumedPositionals: tokens.length - 1,
        argumentPositionals: []
      }
    };
  }

  const candidates = CLI_INVOCATIONS
    .filter((spec) => pathIsPrefix(spec.path, tokens))
    .sort((a, b) => b.path.length - a.path.length);
  const spec = candidates[0];
  if (spec) {
    const consumedPositionals = spec.path.length - 1;
    return {
      ok: true,
      invocation: {
        spec,
        matchedPath: spec.path,
        consumedPositionals,
        argumentPositionals: positionals.slice(consumedPositionals)
      }
    };
  }

  return { ok: false, message: unresolvedInvocationMessage(command, positionals) };
}

export function cliInvocationPath(spec: CliInvocationSpec): string {
  return spec.path.join(" ");
}

export function validateCliInvocationFlags(
  invocation: ResolvedCliInvocation,
  providedFlagNames: Iterable<string>
): string | undefined {
  const allowed = new Set(cliInvocationAllowedFlags(invocation).map((flag) => flag.name));
  const invocationPath = cliInvocationPath(invocation.spec);

  for (const name of providedFlagNames) {
    if (!allowed.has(name)) return `--${name} is not valid for ${invocationPath}.`;
  }
  return undefined;
}

/**
 * CLI-6 repeatability validation.
 *
 * Lexical parsing preserves duplicate occurrences so repeatability is decided
 * only after the exact invocation has been resolved. This keeps duplicate
 * policy in the same declarative contract that owns per-invocation legality.
 */
export function validateCliInvocationRepeatability(
  invocation: ResolvedCliInvocation,
  providedFlags: ReadonlyMap<string, string | boolean | string[]>
): string | undefined {
  const allowedByName = new Map(cliInvocationAllowedFlags(invocation).map((flag) => [flag.name, flag] as const));

  for (const [name, value] of providedFlags) {
    if (!Array.isArray(value)) continue;
    const spec = allowedByName.get(name);
    if (spec && !spec.repeatable) return `--${name} may only be provided once.`;
  }
  return undefined;
}

/**
 * CLI-7 positional contract validation.
 *
 * Subcommand tokens have already been consumed by resolution, so only actual
 * positional arguments are validated here. Variadic specs consume the rest.
 */
export function validateCliInvocationPositionals(invocation: ResolvedCliInvocation): string | undefined {
  const specs = invocation.spec.positionals;
  const values = invocation.argumentPositionals;
  const invocationPath = cliInvocationPath(invocation.spec);
  let valueIndex = 0;

  for (const spec of specs) {
    if (spec.variadic) {
      if (spec.required && valueIndex >= values.length) {
        return `${invocationPath} requires <${spec.name}>.`;
      }
      return undefined;
    }

    if (valueIndex >= values.length) {
      if (spec.required) return `${invocationPath} requires <${spec.name}>.`;
      continue;
    }
    valueIndex += 1;
  }

  if (valueIndex < values.length) {
    if (specs.length === 0) return `${invocationPath} does not accept positional arguments.`;
    const expected = specs.map(formatPositionalSpec).join(" ");
    return `${invocationPath} accepts only ${expected}.`;
  }

  return undefined;
}

function cliInvocationAllowedFlags(invocation: ResolvedCliInvocation): readonly CliFlagSpec[] {
  return [...CLI_INHERITED_GLOBAL_FLAGS, ...invocation.spec.flags];
}

function formatPositionalSpec(spec: CliPositionalSpec): string {
  const value = spec.variadic ? `<${spec.name}...>` : `<${spec.name}>`;
  return spec.required ? value : `[${value}]`;
}

function unresolvedInvocationMessage(command: string, positionals: readonly string[]): string {
  const first = positionals[0];
  const second = positionals[1];

  if (command === "dialog") return "dialog requires accept or dismiss.";
  if (command === "events") return first === undefined ? "Event subcommand is required." : `Unknown event subcommand: ${first}.`;
  if (command === "session") return first === undefined ? "Session subcommand is required." : `Unknown session subcommand: ${first}.`;
  if (command === "bridge") return first === undefined ? "Bridge subcommand is required." : `Unknown bridge subcommand: ${first}.`;
  if (command === "broker") return first === undefined ? "Broker subcommand is required." : `Unknown broker subcommand: ${first}.`;
  if (command === "console") return `Unknown console subcommand: ${first ?? "list"}.`;
  if (command === "network") return `Unknown network subcommand: ${first ?? "list"}.`;
  if (command === "recipes") return `Unknown recipes subcommand: ${first ?? "list"}.`;

  if (command === "policy") {
    if (first === undefined) return "Policy area is required.";
    if (second === undefined) return "Policy action is required.";
    if (first === "allow" || first === "block") return `Unknown policy ${first} action: ${second}.`;
    if (first === "retention") return `Unknown policy retention action: ${second}.`;
    return `Unknown policy area: ${first}.`;
  }

  return `Unknown command: ${command}.`;
}

function pathIsPrefix(path: readonly string[], tokens: readonly string[]): boolean {
  if (path.length > tokens.length) return false;
  return path.every((part, index) => tokens[index] === part);
}

function pathKey(path: readonly string[]): string {
  return path.join("\u0000");
}
