import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { z } from "zod";
import {
  CommandPolicySchema,
  DEFAULT_COMMAND_POLICY,
  DEFAULT_TERMINAL_PROFILE_ID,
  NavigationRulePatternSchema,
  PortusErrorSchema,
  TerminalProfileIdSchema,
  type PortusError
} from "@portus/protocol";


const PipeNameSchema = z.string().min(1).refine((value) => {
  return !/[\\/]/.test(value);
}, "must not contain path separators");

const AbsolutePathSchema = z.string().min(1).refine(isAbsolute, "must be an absolute path");

export const BrokerConfigSchema = z.object({
  transport: z.enum(["local", "named-pipe", "unix-socket"]).default("local"),
  pipeName: PipeNameSchema.default("portus-browser-broker"),
  heartbeatIntervalMs: z.number().int().positive().default(5000),
  sessionTimeoutMs: z.number().int().positive().default(20000)
}).strict().superRefine((value, context) => {
  if (value.heartbeatIntervalMs >= value.sessionTimeoutMs) {
    context.addIssue({
      code: "custom",
      path: ["heartbeatIntervalMs"],
      message: "heartbeatIntervalMs must be less than sessionTimeoutMs"
    });
  }
});

export const NativeHostConfigSchema = z.object({
  name: z.string().min(1).default("com.portus.browser"),
  brokerPipeName: PipeNameSchema.default("portus-browser-broker"),
  startBrokerIfMissing: z.boolean().default(true),
  connectTimeoutMs: z.number().int().positive().default(5000)
}).strict();

export const CliConfigSchema = z.object({
  output: z.enum(["table", "json", "ndjson", "quiet"]).default("table")
}).strict();

export const SessionConfigSchema = z.object({
  defaultTargetStrategy: z.enum(["oldest", "newest", "fail", "preferred"]).default("oldest")
}).strict();

export const CommandConfigSchema = z.object({
  timeoutMs: z.number().int().positive().default(15000),
  normalizeUrls: z.boolean().default(true)
}).strict();

export const SecurityConfigSchema = z.object({
  allowedUploadRoots: z.array(AbsolutePathSchema).max(100).default([]),
  requireBrokerToken: z.boolean().default(true)
}).strict();

export const PolicyConfigSchema = z.object({
  defaultPolicyMode: z.enum(["blocklist", "allowlist"]).default("blocklist"),
  defaultAllowedNavigationRules: z.array(NavigationRulePatternSchema).default([]),
  defaultBlockedNavigationRules: z.array(NavigationRulePatternSchema).default([]),
  defaultCommandPolicy: CommandPolicySchema.default(DEFAULT_COMMAND_POLICY).transform((policy) => ({
    ...DEFAULT_COMMAND_POLICY,
    ...policy
  })),
  sessionStepRetentionLimit: z.number().int().min(0).max(1000).default(10)
}).strict();

export const EventsConfigSchema = z.object({
  retentionLimit: z.number().int().nonnegative().default(1000)
}).strict();

export const LoggingConfigSchema = z.object({
  redactUrls: z.boolean().default(false),
  redactTitles: z.boolean().default(false)
}).strict();

const TerminalStartupCommandSchema = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}, z.string().min(1).nullable().default(null));

export const TerminalConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultProfileId: TerminalProfileIdSchema.default(DEFAULT_TERMINAL_PROFILE_ID),
  manualTerminalPath: z.string().min(1).nullable().default(null),
  startupCommand: TerminalStartupCommandSchema,
  defaultWorkingDirectory: z.string().min(1).default("Downloads/portus-session"),
  fontSize: z.number().int().min(10).max(24).default(16),
  maxSessions: z.number().int().positive().default(5),
  idleTimeoutMs: z.number().int().positive().default(1800000)
}).strict();

const DEFAULT_BROKER_CONFIG = BrokerConfigSchema.parse({});
const DEFAULT_NATIVE_HOST_CONFIG = NativeHostConfigSchema.parse({});
const DEFAULT_CLI_CONFIG = CliConfigSchema.parse({});
const DEFAULT_SESSION_CONFIG = SessionConfigSchema.parse({});
const DEFAULT_COMMAND_CONFIG = CommandConfigSchema.parse({});
const DEFAULT_SECURITY_CONFIG = SecurityConfigSchema.parse({});
const DEFAULT_POLICY_CONFIG = PolicyConfigSchema.parse({});
const DEFAULT_EVENTS_CONFIG = EventsConfigSchema.parse({});
const DEFAULT_LOGGING_CONFIG = LoggingConfigSchema.parse({});
const DEFAULT_TERMINAL_CONFIG = TerminalConfigSchema.parse({});

export const PortusConfigSchema = z.object({
  broker: BrokerConfigSchema.optional().default(DEFAULT_BROKER_CONFIG),
  nativeHost: NativeHostConfigSchema.optional().default(DEFAULT_NATIVE_HOST_CONFIG),
  cli: CliConfigSchema.optional().default(DEFAULT_CLI_CONFIG),
  sessions: SessionConfigSchema.optional().default(DEFAULT_SESSION_CONFIG),
  commands: CommandConfigSchema.optional().default(DEFAULT_COMMAND_CONFIG),
  security: SecurityConfigSchema.optional().default(DEFAULT_SECURITY_CONFIG),
  policy: PolicyConfigSchema.optional().default(DEFAULT_POLICY_CONFIG),
  events: EventsConfigSchema.optional().default(DEFAULT_EVENTS_CONFIG),
  logging: LoggingConfigSchema.optional().default(DEFAULT_LOGGING_CONFIG),
  terminal: TerminalConfigSchema.optional().default(DEFAULT_TERMINAL_CONFIG)
}).strict().superRefine((value, context) => {
  if (value.broker.pipeName !== value.nativeHost.brokerPipeName) {
    context.addIssue({
      code: "custom",
      path: ["nativeHost", "brokerPipeName"],
      message: "nativeHost.brokerPipeName must match broker.pipeName"
    });
  }
});

export type BrokerConfig = z.infer<typeof BrokerConfigSchema>;
export type NativeHostConfig = z.infer<typeof NativeHostConfigSchema>;
export type CliConfig = z.infer<typeof CliConfigSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type CommandConfig = z.infer<typeof CommandConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
export type EventsConfig = z.infer<typeof EventsConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type TerminalConfig = z.infer<typeof TerminalConfigSchema>;
export type PortusConfig = z.infer<typeof PortusConfigSchema>;

export const DEFAULT_PORTUS_CONFIG = PortusConfigSchema.parse({});

const BROKER_TOKEN_BYTES = 32;

export interface BrokerTokenStorageOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

export function generateBrokerToken(): string {
  return randomBytes(BROKER_TOKEN_BYTES).toString("base64url");
}

export function getPortusUserConfigDirectory(options: BrokerTokenStorageOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (env.PORTUS_CONFIG_DIR) return env.PORTUS_CONFIG_DIR;
  if (platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Portus Browser");
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Portus Browser");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "portus-browser");
}

export function getBrokerTokenPath(options: BrokerTokenStorageOptions = {}): string {
  return join(getPortusUserConfigDirectory(options), "broker-token");
}

export function getSettingsProfilesPath(options: BrokerTokenStorageOptions = {}): string {
  return join(getPortusUserConfigDirectory(options), "settings-profiles.json");
}

export function loadOrCreateBrokerToken(options: BrokerTokenStorageOptions = {}): string {
  const tokenPath = getBrokerTokenPath(options);
  if (existsSync(tokenPath)) {
    const token = readFileSync(tokenPath, "utf8").trim();
    if (token.length > 0) return token;
  }

  const token = generateBrokerToken();
  mkdirSync(getPortusUserConfigDirectory(options), { recursive: true });
  writeFileSync(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return token;
}

export function mergeConfig<T extends Record<string, unknown>>(base: T, override: unknown): T {
  if (!isPlainObject(override)) return base;
  return deepMerge(base, override) as T;
}

export function parseConfig(input: unknown): PortusConfig {
  return PortusConfigSchema.parse(input);
}

export function safeParseConfig(input: unknown) {
  return PortusConfigSchema.safeParse(input);
}

export function validateConfig(input: unknown): { ok: true; config: PortusConfig } | { ok: false; error: PortusError } {
  const result = PortusConfigSchema.safeParse(input);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    error: createConfigInvalidError(result.error)
  };
}

export function createConfigInvalidError(error: z.ZodError): PortusError {
  return PortusErrorSchema.parse({
    code: "CONFIG_INVALID",
    message: "Invalid Portus configuration.",
    details: {
      issues: error.issues.map((issue) => ({
        configPath: issue.path.join("."),
        reason: issue.message
      }))
    }
  });
}

export function applyEnvironmentOverrides(config: PortusConfig, env: Record<string, string | undefined>): PortusConfig {
  const overrides: Record<string, unknown> = {};
  if (env.PORTUS_UPLOAD_ALLOWED_ROOTS !== undefined) {
    setPath(
      overrides,
      ["security", "allowedUploadRoots"],
      env.PORTUS_UPLOAD_ALLOWED_ROOTS.split(delimiter).map((value) => value.trim()).filter(Boolean)
    );
  }
  if (env.PORTUS_CLI_OUTPUT !== undefined) setPath(overrides, ["cli", "output"], env.PORTUS_CLI_OUTPUT);
  if (env.PORTUS_BROKER_PIPE_NAME !== undefined) {
    setPath(overrides, ["broker", "pipeName"], env.PORTUS_BROKER_PIPE_NAME);
    setPath(overrides, ["nativeHost", "brokerPipeName"], env.PORTUS_BROKER_PIPE_NAME);
  }
  return PortusConfigSchema.parse(deepMerge(config, overrides));
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      merged[key] = deepMerge(current, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    const next = cursor[segment];
    if (!isPlainObject(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[path[path.length - 1] as string] = value;
}
