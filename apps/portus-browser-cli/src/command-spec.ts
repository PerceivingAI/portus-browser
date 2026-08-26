import {
  CLI_FLAGS,
  CLI_GLOBAL_PRESENTATION_FLAGS,
  CLI_OUTPUT_FLAG,
  CLI_TIMEOUT_FLAG,
  type CliFlagSpec
} from "./cli-flags.js";

export type CliPositionalKind = "string" | "integer" | "number";

export interface CliPositionalSpec {
  name: string;
  required: boolean;
  variadic: boolean;
  kind?: CliPositionalKind;
  min?: number;
  max?: number;
  minLength?: number;
  validationMessage?: string;
}

export interface CliFlagEnumConstraint {
  flag: CliFlagSpec;
  values: readonly string[];
  validationMessage: string;
}

export interface CliInvocationSpec {
  path: readonly string[];
  aliases?: readonly (readonly string[])[];
  flags: readonly CliFlagSpec[];
  positionals: readonly CliPositionalSpec[];
  flagEnums?: readonly CliFlagEnumConstraint[];
  outputFlagRole?: "file";
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
const arg = (
  name: string,
  required = true,
  variadic = false,
  primitive: Pick<CliPositionalSpec, "kind" | "min" | "max" | "minLength" | "validationMessage"> = {}
): CliPositionalSpec => ({ name, required, variadic, ...primitive });
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
 * Authoritative declarative invocation registry.
 *
 * This is the single source of truth for canonical command/subcommand paths,
 * aliases, invocation-scoped flags, positional shape, primitive constraints,
 * and invocation-specific output semantics. Global presentation flags are
 * inherited and therefore are not repeated in each `flags` array.
 *
 * Resolution, validation, dispatch integrity, and generated usage/help all
 * consume this registry.
 */
export const CLI_INVOCATIONS = [
  { path: ["browsers"], flags: brokerFlags(), positionals: noArgs },
  { path: ["tabs"], flags: brokerFlags(CLI_FLAGS.browser), positionals: noArgs },
  { path: ["tab"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.index), positionals: noArgs },
  {
    path: ["open"],
    flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.background),
    positionals: [arg("url", true, false, { minLength: 1, validationMessage: "open requires <url>." })]
  },
  {
    path: ["navigate"],
    flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId),
    positionals: [arg("url", true, false, { minLength: 1, validationMessage: "navigate requires <url>." })]
  },
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
  { path: ["press"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.snapshot, CLI_FLAGS.element), positionals: [arg("key")] },
  { path: ["scroll"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.snapshot, CLI_FLAGS.element, CLI_FLAGS.x, CLI_FLAGS.y), positionals: noArgs },
  {
    path: ["dismiss"],
    flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.kind, CLI_FLAGS.strategy, CLI_FLAGS.dryRun),
    positionals: noArgs,
    flagEnums: [
      { flag: CLI_FLAGS.kind, values: ["any", "popup", "cookie"], validationMessage: "--kind must be any, popup, or cookie." },
      { flag: CLI_FLAGS.strategy, values: ["conservative", "accept"], validationMessage: "--strategy must be conservative or accept." }
    ]
  },
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
    positionals: noArgs,
    flagEnums: [
      { flag: CLI_FLAGS.state, values: ["loading", "complete"], validationMessage: "--state must be loading or complete." }
    ]
  },
  { path: ["watch"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.type), positionals: noArgs },

  { path: ["dialog", "accept"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.text), positionals: noArgs },
  { path: ["dialog", "dismiss"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId), positionals: noArgs },

  { path: ["console", "list"], aliases: [["console"]], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.limit), positionals: noArgs },
  { path: ["console", "clear"], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId), positionals: noArgs },

  { path: ["network", "list"], aliases: [["network"]], flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId, CLI_FLAGS.limit), positionals: noArgs },
  {
    path: ["network", "get"],
    flags: brokerFlags(CLI_FLAGS.browser, CLI_FLAGS.tabId),
    positionals: [arg("request-id", true, false, { minLength: 1, validationMessage: "network get requires <request-id>." })]
  },

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
  {
    path: ["policy", "retention", "set"],
    flags: brokerFlags(CLI_FLAGS.browser),
    positionals: [arg("limit", true, false, {
      kind: "integer",
      min: 0,
      max: 1000,
      minLength: 1,
      validationMessage: "Retention limit must be an integer from 0 to 1000."
    })]
  },

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
  {
    path: ["recipes", "search"],
    flags: brokerFlags(CLI_FLAGS.directory),
    positionals: [arg("query", true, true, { minLength: 1, validationMessage: "recipes search requires <query>." })]
  },
  {
    path: ["recipes", "use"],
    flags: brokerFlags(CLI_FLAGS.directory),
    positionals: [arg("query", true, true, { minLength: 1, validationMessage: "recipes use requires <query>." })]
  },
  {
    path: ["recipes", "resolve"],
    flags: brokerFlags(CLI_FLAGS.directory),
    positionals: [arg("query", true, true, { minLength: 1, validationMessage: "recipes resolve requires <query>." })]
  },
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
    positionals: [arg("recipe-id")],
    outputFlagRole: "file"
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

export type CliOutputFlagRole = "renderer" | "file" | "none";

export function cliInvocationOutputFlagRole(spec: CliInvocationSpec): CliOutputFlagRole {
  if (!spec.flags.some((flag) => flag.name === CLI_OUTPUT_FLAG.name)) return "none";
  return spec.outputFlagRole ?? "renderer";
}

/**
 * CLI-11 generated usage/help.
 *
 * Syntax is rendered directly from the declarative registry so command paths,
 * aliases, positionals, and allowed flags cannot drift from validation.
 */
export function renderCliInvocationUsage(spec: CliInvocationSpec): string {
  const positionals = spec.positionals.map(formatPositionalSpec);
  const usageParts = ["Usage: portus-browser", cliInvocationPath(spec), ...positionals];
  const lines = [usageParts.join(" ")];
  const aliases = spec.aliases ?? [];
  if (aliases.length > 0) lines.push(`Aliases: ${aliases.map((alias) => `portus-browser ${alias.join(" ")}`).join(", ")}`);

  const flags = cliInvocationAllowedFlags({
    spec,
    matchedPath: spec.path,
    consumedPositionals: spec.path.length - 1,
    argumentPositionals: []
  });
  if (flags.length > 0) lines.push(`Flags: ${flags.map((flag) => formatCliFlagUsage(spec, flag)).join(", ")}`);
  return lines.join("\n");
}

export function renderCliHelp(): string {
  const lines = [
    "Portus Browser CLI",
    "Usage: portus-browser <command> [arguments] [flags]",
    "",
    `Global flags: ${CLI_INHERITED_GLOBAL_FLAGS.map((flag) => formatCliFlagUsage(undefined, flag)).join(", ")}`,
    "",
    "Commands:"
  ];

  for (const spec of CLI_INVOCATIONS) {
    const positionalSyntax = spec.positionals.map(formatPositionalSpec).join(" ");
    const aliasSyntax = ("aliases" in spec ? spec.aliases : []).map((alias) => alias.join(" "));
    const suffix = aliasSyntax.length > 0 ? ` (alias: ${aliasSyntax.join(", ")})` : "";
    lines.push(`  ${cliInvocationPath(spec)}${positionalSyntax ? ` ${positionalSyntax}` : ""}${suffix}`);
    if (spec.flags.length > 0) {
      lines.push(`    Flags: ${spec.flags.map((flag) => formatCliFlagUsage(spec, flag)).join(", ")}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatCliFlagUsage(spec: CliInvocationSpec | undefined, flag: CliFlagSpec): string {
  if (flag.kind === "boolean") return `--${flag.name}`;
  const enumConstraint = spec?.flagEnums?.find((constraint) => constraint.flag.name === flag.name);
  const value = enumConstraint ? enumConstraint.values.join("|") : flag.kind;
  const repeatable = flag.repeatable ? "..." : "";
  return `--${flag.name} <${value}>${repeatable}`;
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

/**
 * CLI-8 primitive value validation.
 *
 * Universal primitive constraints live on the canonical flag definition.
 * Invocation-specific enum semantics live on the exact command spec so
 * overloaded spellings such as --kind remain context-sensitive.
 */
export function validateCliInvocationPrimitiveValues(
  invocation: ResolvedCliInvocation,
  providedFlags: ReadonlyMap<string, string | boolean | string[]>
): string | undefined {
  const allowedByName = new Map(cliInvocationAllowedFlags(invocation).map((flag) => [flag.name, flag] as const));

  for (const [name, rawValue] of providedFlags) {
    const flag = allowedByName.get(name);
    if (!flag) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      const error = validateCliFlagPrimitive(flag, value);
      if (error) return error;
    }
  }

  for (const constraint of invocation.spec.flagEnums ?? []) {
    const rawValue = providedFlags.get(constraint.flag.name);
    if (rawValue === undefined) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (typeof value !== "string" || !constraint.values.includes(value)) return constraint.validationMessage;
    }
  }

  for (let index = 0; index < invocation.spec.positionals.length; index += 1) {
    const spec = invocation.spec.positionals[index] as CliPositionalSpec;
    if ((!spec.kind || spec.kind === "string") && spec.minLength === undefined) continue;
    const values = spec.variadic
      ? invocation.argumentPositionals.slice(index)
      : invocation.argumentPositionals[index] === undefined
        ? []
        : [invocation.argumentPositionals[index] as string];
    if (spec.variadic && spec.minLength !== undefined && (!spec.kind || spec.kind === "string")) {
      const error = validateCliPositionalPrimitive(spec, values.join(" "));
      if (error) return error;
      continue;
    }
    for (const value of values) {
      const error = validateCliPositionalPrimitive(spec, value);
      if (error) return error;
    }
  }

  return undefined;
}

function validateCliFlagPrimitive(flag: CliFlagSpec, value: string | boolean): string | undefined {
  if (flag.kind === "boolean") return value === true ? undefined : `--${flag.name} does not take a value.`;
  if (typeof value !== "string" || value.length === 0) return `--${flag.name} requires a value.`;
  if (flag.kind === "string") return undefined;

  const parsedValue = Number(value);
  if (flag.kind === "integer") {
    if (flag.positive && (!Number.isInteger(parsedValue) || parsedValue <= 0)) {
      return `--${flag.name} must be a positive integer.`;
    }
    if (!Number.isInteger(parsedValue)) return `--${flag.name} must be an integer.`;
  } else if (!Number.isFinite(parsedValue)) {
    return `--${flag.name} must be a number.`;
  }

  if (flag.min !== undefined && parsedValue < flag.min) return `--${flag.name} must be at least ${flag.min}.`;
  if (flag.max !== undefined && parsedValue > flag.max) return `--${flag.name} must be at most ${flag.max}.`;
  return undefined;
}

function validateCliPositionalPrimitive(spec: CliPositionalSpec, value: string): string | undefined {
  if (spec.minLength !== undefined && value.trim().length < spec.minLength) {
    return spec.validationMessage ?? `<${spec.name}> must not be empty.`;
  }
  if (!spec.kind || spec.kind === "string") return undefined;

  const parsedValue = Number(value);
  const validKind = spec.kind === "integer" ? Number.isInteger(parsedValue) : Number.isFinite(parsedValue);
  const validMin = spec.min === undefined || parsedValue >= spec.min;
  const validMax = spec.max === undefined || parsedValue <= spec.max;
  if (validKind && validMin && validMax) return undefined;
  if (spec.validationMessage) return spec.validationMessage;
  return `<${spec.name}> must be ${spec.kind === "integer" ? "an integer" : "a number"}.`;
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
