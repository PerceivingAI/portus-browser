export interface CliSurfaceBaselineEntry {
  path: readonly string[];
  aliases?: readonly (readonly string[])[];
}

/**
 * CLI-0 migration baseline.
 *
 * This is an inventory of the command/subcommand surface accepted before the
 * declarative CLI parser cutover. It is intentionally not used for parsing or
 * dispatch yet; later phases can migrate against this fixed baseline without
 * changing current CLI behavior during CLI-0.
 */
export const CLI_SURFACE_BASELINE = [
  { path: ["browsers"] },
  { path: ["tabs"] },
  { path: ["tab"] },
  { path: ["open"] },
  { path: ["navigate"] },
  { path: ["back"] },
  { path: ["forward"] },
  { path: ["activate-tab"] },
  { path: ["close-tab"] },
  { path: ["screenshot"] },
  { path: ["snapshot"] },
  { path: ["click"] },
  { path: ["hover"] },
  { path: ["drag"] },
  { path: ["fill-form"] },
  { path: ["type"] },
  { path: ["press"] },
  { path: ["scroll"] },
  { path: ["dismiss"] },
  { path: ["wait"] },
  { path: ["watch"] },

  { path: ["dialog", "accept"] },
  { path: ["dialog", "dismiss"] },

  { path: ["console", "list"], aliases: [["console"]] },
  { path: ["console", "clear"] },

  { path: ["network", "list"], aliases: [["network"]] },
  { path: ["network", "get"] },

  { path: ["events", "recent"] },
  { path: ["session", "steps"] },
  { path: ["bridge", "disconnect"] },
  { path: ["broker", "status"] },
  { path: ["broker", "stop"] },

  { path: ["policy", "allow", "list"] },
  { path: ["policy", "allow", "add"] },
  { path: ["policy", "allow", "remove"] },
  { path: ["policy", "block", "list"] },
  { path: ["policy", "block", "add"] },
  { path: ["policy", "block", "remove"] },
  { path: ["policy", "retention", "get"] },
  { path: ["policy", "retention", "set"] },

  { path: ["recipes", "list"], aliases: [["recipes"]] },
  { path: ["recipes", "create"] },
  { path: ["recipes", "show"] },
  { path: ["recipes", "search"] },
  { path: ["recipes", "use"] },
  { path: ["recipes", "resolve"] },
  { path: ["recipes", "update"] },
  { path: ["recipes", "rename"] },
  { path: ["recipes", "delete"] },
  { path: ["recipes", "validate"] },
  { path: ["recipes", "import"] },
  { path: ["recipes", "export"] },
  { path: ["recipes", "duplicate"] }
] as const satisfies readonly CliSurfaceBaselineEntry[];
