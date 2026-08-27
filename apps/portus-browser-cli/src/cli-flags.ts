export type CliFlagKind = "boolean" | "string" | "integer" | "number";

export interface CliFlagSpec {
  name: string;
  kind: CliFlagKind;
  repeatable: boolean;
  positive?: boolean;
  min?: number;
  max?: number;
}

/**
 * Canonical primitive flag registry.
 *
 * Each CLI flag spelling is defined exactly once here. Declarative invocation
 * specs reference these definitions for legality, primitive validation,
 * repeatability, and generated usage.
 */
export const CLI_FLAGS = {
  output: { name: "output", kind: "string", repeatable: false },
  browser: { name: "browser", kind: "string", repeatable: false },
  timeout: { name: "timeout", kind: "integer", repeatable: false, positive: true },
  tabId: { name: "tab-id", kind: "integer", repeatable: false },
  index: { name: "index", kind: "integer", repeatable: false, positive: true },
  element: { name: "element", kind: "string", repeatable: false },
  snapshot: { name: "snapshot", kind: "string", repeatable: false },
  from: { name: "from", kind: "string", repeatable: false },
  to: { name: "to", kind: "string", repeatable: false },
  fields: { name: "fields", kind: "string", repeatable: false },
  jsonFields: { name: "json-fields", kind: "string", repeatable: false },
  field: { name: "field", kind: "string", repeatable: true },
  x: { name: "x", kind: "number", repeatable: false },
  y: { name: "y", kind: "number", repeatable: false },
  reason: { name: "reason", kind: "string", repeatable: false },
  scheme: { name: "scheme", kind: "string", repeatable: false },
  authority: { name: "authority", kind: "string", repeatable: false },
  hostWildcard: { name: "host-wildcard", kind: "string", repeatable: false },
  urlExact: { name: "url-exact", kind: "string", repeatable: false },
  urlPrefix: { name: "url-prefix", kind: "string", repeatable: false },
  type: { name: "type", kind: "string", repeatable: false },
  limit: { name: "limit", kind: "integer", repeatable: false, positive: true },
  kind: { name: "kind", kind: "string", repeatable: false },
  strategy: { name: "strategy", kind: "string", repeatable: false },
  query: { name: "query", kind: "string", repeatable: false },
  role: { name: "role", kind: "string", repeatable: false },
  maxElements: { name: "max-elements", kind: "integer", repeatable: false, positive: true, max: 10000 },
  state: { name: "state", kind: "string", repeatable: false },
  elementState: { name: "element-state", kind: "string", repeatable: false },
  urlContains: { name: "url-contains", kind: "string", repeatable: false },
  filenameContains: { name: "filename-contains", kind: "string", repeatable: false },
  text: { name: "text", kind: "string", repeatable: false },
  elementQuery: { name: "element-query", kind: "string", repeatable: false },
  value: { name: "value", kind: "string", repeatable: false },
  directory: { name: "directory", kind: "string", repeatable: false },
  file: { name: "file", kind: "string", repeatable: false },
  jsonInput: { name: "json-input", kind: "string", repeatable: false },
  content: { name: "content", kind: "string", repeatable: false },
  description: { name: "description", kind: "string", repeatable: false },
  name: { name: "name", kind: "string", repeatable: false },
  id: { name: "id", kind: "string", repeatable: false },
  background: { name: "background", kind: "boolean", repeatable: false },
  debugger: { name: "debugger", kind: "boolean", repeatable: false },
  includeScreenshot: { name: "screenshot", kind: "boolean", repeatable: false },
  json: { name: "json", kind: "boolean", repeatable: false },
  partial: { name: "partial", kind: "boolean", repeatable: false },
  dryRun: { name: "dry-run", kind: "boolean", repeatable: false },
  force: { name: "force", kind: "boolean", repeatable: false },
  yes: { name: "yes", kind: "boolean", repeatable: false },
  interactiveOnly: { name: "interactive-only", kind: "boolean", repeatable: false },
  quiet: { name: "quiet", kind: "boolean", repeatable: false }
} as const satisfies Record<string, CliFlagSpec>;

export const CLI_FLAG_SPECS: readonly CliFlagSpec[] = Object.values(CLI_FLAGS);

/**
 * CLI-2 presentation contract.
 *
 * Only --json and --quiet are true presentation globals. They have the same
 * meaning for every invocation and can therefore be inherited by every
 * declarative command specification.
 *
 * --output is intentionally NOT global: for normal command invocations it
 * selects the renderer, while `recipes export --output` names the destination
 * file. The exact invocation must bind that spelling to its meaning.
 *
 * --timeout is also intentionally NOT global. Only invocations that actually
 * perform a timeout-aware Broker/native operation should opt into it.
 */
export const CLI_GLOBAL_PRESENTATION_FLAGS = [
  CLI_FLAGS.json,
  CLI_FLAGS.quiet
] as const;

export const CLI_OUTPUT_FLAG = CLI_FLAGS.output;
export const CLI_TIMEOUT_FLAG = CLI_FLAGS.timeout;

export const CLI_GLOBAL_PRESENTATION_FLAG_NAMES = new Set<string>(
  CLI_GLOBAL_PRESENTATION_FLAGS.map((spec) => spec.name)
);

export function isCliGlobalPresentationFlag(name: string): boolean {
  return CLI_GLOBAL_PRESENTATION_FLAG_NAMES.has(name);
}

const CLI_FLAG_SPEC_BY_NAME = new Map(CLI_FLAG_SPECS.map((spec) => [spec.name, spec] as const));

export function getCliFlagSpec(name: string): CliFlagSpec | undefined {
  return CLI_FLAG_SPEC_BY_NAME.get(name);
}

export function cliFlagTakesValue(spec: CliFlagSpec): boolean {
  return spec.kind !== "boolean";
}
