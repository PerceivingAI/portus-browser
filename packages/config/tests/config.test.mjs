import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import {
  DEFAULT_PORTUS_CONFIG,
  PortusConfigSchema,
  applyEnvironmentOverrides,
  getBrokerTokenPath,
  getSettingsProfilesPath,
  loadOrCreateBrokerToken,
  mergeConfig,
  parseConfig,
  validateConfig
} from "../dist/index.js";

test("default config contains only production-backed settings", () => {
  assert.deepEqual(DEFAULT_PORTUS_CONFIG.broker, {
    transport: "local",
    pipeName: "portus-browser-broker",
    heartbeatIntervalMs: 5000,
    sessionTimeoutMs: 20000
  });
  assert.deepEqual(DEFAULT_PORTUS_CONFIG.cli, { output: "table" });
  assert.deepEqual(DEFAULT_PORTUS_CONFIG.sessions, { defaultTargetStrategy: "oldest" });
  assert.deepEqual(DEFAULT_PORTUS_CONFIG.commands, { timeoutMs: 15000, normalizeUrls: true });
  assert.deepEqual(DEFAULT_PORTUS_CONFIG.security.allowedUploadRoots, []);
  assert.deepEqual(DEFAULT_PORTUS_CONFIG.events, { retentionLimit: 1000 });
  assert.deepEqual(DEFAULT_PORTUS_CONFIG.logging, { redactUrls: false, redactTitles: false });
  assert.equal("extension" in DEFAULT_PORTUS_CONFIG, false);
  assert.equal("tabs" in DEFAULT_PORTUS_CONFIG, false);
  assert.equal(DEFAULT_PORTUS_CONFIG.terminal.enabled, true);
  assert.equal(DEFAULT_PORTUS_CONFIG.terminal.defaultProfileId, "auto");
  assert.equal(DEFAULT_PORTUS_CONFIG.terminal.manualTerminalPath, null);
  assert.equal(DEFAULT_PORTUS_CONFIG.terminal.startupCommand, null);
  assert.equal(DEFAULT_PORTUS_CONFIG.terminal.defaultWorkingDirectory, "Downloads/portus-session");
  assert.equal(DEFAULT_PORTUS_CONFIG.terminal.fontSize, 16);
  assert.equal(DEFAULT_PORTUS_CONFIG.policy.defaultPolicyMode, "blocklist");
  assert.deepEqual(DEFAULT_PORTUS_CONFIG.policy.defaultBlockedNavigationRules, []);
  assert.equal(DEFAULT_PORTUS_CONFIG.policy.defaultCommandPolicy["screenshot.capture"], true);
  assert.equal(DEFAULT_PORTUS_CONFIG.policy.defaultCommandPolicy["snapshot.capture"], true);
  assert.equal(DEFAULT_PORTUS_CONFIG.policy.defaultCommandPolicy["action.click"], true);
  assert.equal(DEFAULT_PORTUS_CONFIG.policy.defaultCommandPolicy["tab.open"], true);
  assert.equal(DEFAULT_PORTUS_CONFIG.policy.sessionStepRetentionLimit, 10);
});

test("partial config merges over defaults", () => {
  const merged = mergeConfig(DEFAULT_PORTUS_CONFIG, {
    cli: { output: "json" },
    logging: { redactUrls: true }
  });
  const parsed = parseConfig(merged);
  assert.equal(parsed.cli.output, "json");
  assert.equal(parsed.logging.redactUrls, true);
  assert.equal(parsed.logging.redactTitles, false);
});

test("arrays replace instead of concatenate", () => {
  const merged = mergeConfig(DEFAULT_PORTUS_CONFIG, {
    policy: {
      defaultAllowedNavigationRules: [{ match: "scheme", value: "file:" }],
      defaultBlockedNavigationRules: [{ match: "authority", value: "https://blocked.example" }],
      sessionStepRetentionLimit: 25
    }
  });
  const parsed = parseConfig(merged);
  assert.deepEqual(parsed.policy.defaultAllowedNavigationRules, [{ match: "scheme", value: "file:" }]);
  assert.deepEqual(parsed.policy.defaultBlockedNavigationRules, [{ match: "authority", value: "https://blocked.example" }]);
  assert.equal(parsed.policy.sessionStepRetentionLimit, 25);
});

test("removed and unknown config keys fail validation", () => {
  assert.equal(PortusConfigSchema.safeParse({ unknown: true }).success, false);
  assert.equal(PortusConfigSchema.safeParse({ extension: {} }).success, false);
  assert.equal(PortusConfigSchema.safeParse({ tabs: {} }).success, false);
  assert.equal(PortusConfigSchema.safeParse({ broker: { host: "127.0.0.1" } }).success, false);
  assert.equal(PortusConfigSchema.safeParse({ nativeHost: { allowedExtensionOrigins: [] } }).success, false);
  assert.equal(PortusConfigSchema.safeParse({ cli: { color: "auto" } }).success, false);
  assert.equal(PortusConfigSchema.safeParse({ commands: { openUrlActiveByDefault: true } }).success, false);
  assert.equal(PortusConfigSchema.safeParse({ security: { allowPageScriptExecution: false } }).success, false);
  assert.equal(PortusConfigSchema.safeParse({ events: { enabled: true } }).success, false);
  assert.equal(PortusConfigSchema.safeParse({ logging: { level: "debug" } }).success, false);
  assert.equal(PortusConfigSchema.safeParse({ security: { allowedUploadRoots: ["relative/path"] } }).success, false);
});

test("invalid config maps to typed Portus error", () => {
  const result = validateConfig({ cli: { color: "auto" } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CONFIG_INVALID");
  assert.equal(result.error.details.issues[0].configPath, "cli");
});

test("environment overrides are parsed and validated", () => {
  const parsed = applyEnvironmentOverrides(DEFAULT_PORTUS_CONFIG, {
    PORTUS_CLI_OUTPUT: "ndjson",
    PORTUS_BROKER_PIPE_NAME: "custom-portus-pipe"
  });
  assert.equal(parsed.cli.output, "ndjson");
  assert.equal(parsed.broker.pipeName, "custom-portus-pipe");
  assert.equal(parsed.nativeHost.brokerPipeName, "custom-portus-pipe");
  const firstUploadRoot = join(tmpdir(), "portus-upload-one");
  const secondUploadRoot = join(tmpdir(), "portus-upload-two");
  const uploadConfig = applyEnvironmentOverrides(DEFAULT_PORTUS_CONFIG, {
    PORTUS_UPLOAD_ALLOWED_ROOTS: [firstUploadRoot, secondUploadRoot].join(delimiter)
  });
  assert.deepEqual(uploadConfig.security.allowedUploadRoots, [firstUploadRoot, secondUploadRoot]);
});


test("terminal profile ids use the canonical protocol grammar", () => {
  assert.equal(parseConfig({ terminal: { defaultProfileId: "wsl:ubuntu-24.04" } }).terminal.defaultProfileId, "wsl:ubuntu-24.04");
  const invalid = validateConfig({ terminal: { defaultProfileId: "PowerShell 7" } });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "CONFIG_INVALID");
  assert.equal(invalid.error.details.issues[0].configPath, "terminal.defaultProfileId");
});

test("terminal startup command normalizes empty input", () => {
  const parsed = parseConfig({ terminal: { startupCommand: "" } });
  assert.equal(parsed.terminal.startupCommand, null);
});

test("broker token storage creates and reuses a user config token", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "portus-token-test-"));
  const options = { env: { PORTUS_CONFIG_DIR: configDir } };

  const first = loadOrCreateBrokerToken(options);
  const second = loadOrCreateBrokerToken(options);
  const stored = await readFile(getBrokerTokenPath(options), "utf8");

  assert.equal(first, second);
  assert.equal(stored.trim(), first);
  assert.ok(first.length >= 32);
});

test("settings profiles path uses the user config directory", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "portus-settings-profiles-path-"));
  const options = { env: { PORTUS_CONFIG_DIR: configDir } };

  assert.equal(getSettingsProfilesPath(options), join(configDir, "settings-profiles.json"));
});
