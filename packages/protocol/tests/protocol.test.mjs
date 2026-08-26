import assert from "node:assert/strict";
import test from "node:test";
import {
  ActionRequestSchema,
  BrowserSessionSchema,
  CommandTypeSchema,
  DEFAULT_COMMAND_POLICY,
  DEFAULT_TERMINAL_PROFILE_ID,
  ErrorCodeSchema,
  RegistrationResultSchema,
  SessionStepSchema,
  PolicyPreferencesSchema,
  migrateLegacyPolicyPreferences,
  migrateLegacySettingsProfileCatalog,
  migrateLegacyTerminalPreferences,
  navigationPolicyAllowsUrl,
  normalizeNavigationRulePattern,
  RequestEnvelopeSchema,
  safeParseProtocolMessage,
  ResponseEnvelopeSchema,
  SnapshotFilterSchema,
  SnapshotSchema,
  TerminalProfileIdSchema
} from "../dist/index.js";

const now = "2026-04-28T00:00:00.000Z";

test("validates request envelopes", () => {
  const request = RequestEnvelopeSchema.parse({
    protocolVersion: "2",
    requestId: "req_001",
    kind: "request",
    type: "browser.list",
    payload: {},
    auth: { brokerToken: "test-token" }
  });

  assert.equal(request.protocolVersion, "2");
  assert.equal(request.auth.brokerToken, "test-token");
  assert.throws(() => RequestEnvelopeSchema.parse({ ...request, protocolVersion: "1" }));
  assert.throws(() => RequestEnvelopeSchema.parse({ ...request, auth: { brokerToken: "test-token", extra: true } }));
});

test("defines the canonical terminal profile id contract", () => {
  assert.equal(DEFAULT_TERMINAL_PROFILE_ID, "auto");
  for (const profileId of ["auto", "powershell", "pwsh", "wsl-default", "wsl:ubuntu-24.04", "my_terminal"]) {
    assert.equal(TerminalProfileIdSchema.safeParse(profileId).success, true, profileId);
  }
  for (const profileId of ["", "PowerShell 7", "my/profile", "terminal name", ":terminal"]) {
    assert.equal(TerminalProfileIdSchema.safeParse(profileId).success, false, profileId);
  }
});

test("validates bridge registration results with profile state", () => {
  const result = RegistrationResultSchema.parse({
    browserId: "br_001",
    heartbeatIntervalMs: 5000,
    settingsProfiles: {
      profiles: [
        { profileId: "profile_default", name: "Default_Profile", builtIn: true, readOnly: true },
        { profileId: "profile_1", name: "Profile_1", builtIn: false, readOnly: false }
      ],
      activeProfileId: "profile_1",
      activeProfileName: "Profile_1",
      activeProfileReadOnly: false,
      dirty: false,
      autoSave: true,
      canCreateProfile: true,
      maxCustomProfiles: 10,
      content: {
        policyPreferences: {},
        uxPreferences: {},
        terminalPreferences: {},
        autoSave: true
      }
    }
  });

  assert.equal(result.settingsProfiles.activeProfileName, "Profile_1");
  assert.equal(RegistrationResultSchema.parse({
    browserId: "br_001",
    heartbeatIntervalMs: 5000
  }).heartbeatIntervalMs, 5000);
});

test("includes existing-tab navigation in default command policy", () => {
  assert.equal(DEFAULT_COMMAND_POLICY["tab.navigate"], true);
  assert.equal(DEFAULT_COMMAND_POLICY["tab.history.back"], true);
  assert.equal(DEFAULT_COMMAND_POLICY["tab.history.forward"], true);
  assert.equal(DEFAULT_COMMAND_POLICY["tab.wait"], true);
  assert.equal(DEFAULT_COMMAND_POLICY["page.wait"], true);
  assert.equal(DEFAULT_COMMAND_POLICY["action.hover"], true);
  assert.equal(DEFAULT_COMMAND_POLICY["action.drag"], true);
  assert.equal(DEFAULT_COMMAND_POLICY["action.fillForm"], true);
  assert.equal(DEFAULT_COMMAND_POLICY["dialog.dismiss"], false);
  assert.equal(DEFAULT_COMMAND_POLICY["console.list"], false);
  assert.equal(DEFAULT_COMMAND_POLICY["network.list"], false);
  assert.equal("recipe.run" in DEFAULT_COMMAND_POLICY, false);
  assert.throws(() => CommandTypeSchema.parse("recipe.run"));
  const policy = PolicyPreferencesSchema.parse({
    commandPolicy: {
      "tab.navigate": false,
      "tab.history.back": false,
      "page.wait": false,
      "action.hover": false,
      "action.fillForm": false,
      "network.list": true
    }
  });
  assert.equal(policy.commandPolicy["tab.navigate"], false);
  assert.equal(policy.commandPolicy["tab.history.back"], false);
  assert.equal(policy.commandPolicy["page.wait"], false);
  assert.equal(policy.commandPolicy["action.hover"], false);
  assert.equal(policy.commandPolicy["action.fillForm"], false);
  assert.equal(policy.commandPolicy["network.list"], true);
  assert.equal(policy.advancedBackendEnabled, false);
});

test("maps invalid protocol messages to typed Portus errors", () => {
  const missingVersion = safeParseProtocolMessage(RequestEnvelopeSchema, {
    requestId: "req_001",
    kind: "request",
    type: "browser.list",
    payload: {}
  });
  assert.equal(missingVersion.ok, false);
  assert.equal(missingVersion.error.code, "INVALID_MESSAGE");

  const unsupported = safeParseProtocolMessage(RequestEnvelopeSchema, {
    protocolVersion: "1",
    requestId: "req_001",
    kind: "request",
    type: "browser.list",
    payload: {}
  });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, "UNSUPPORTED_PROTOCOL_VERSION");
});

test("validates success and error response envelopes", () => {
  assert.equal(ResponseEnvelopeSchema.parse({
    protocolVersion: "2",
    requestId: "req_001",
    kind: "response",
    ok: true,
    result: {}
  }).ok, true);

  assert.equal(ResponseEnvelopeSchema.parse({
    protocolVersion: "2",
    requestId: "req_001",
    kind: "response",
    ok: false,
    error: {
      code: "BROWSER_SESSION_UNAVAILABLE",
      message: "No browser is available.",
      retryable: true
    }
  }).ok, false);
});

test("exports all documented error codes", () => {
  assert.equal(ErrorCodeSchema.options.length, 23);
  assert.ok(ErrorCodeSchema.options.includes("BROWSER_ACCESS_DENIED"));
  assert.ok(ErrorCodeSchema.options.includes("NAVIGATION_BLOCKED"));
  assert.ok(ErrorCodeSchema.options.includes("COMMAND_DISABLED_BY_POLICY"));
  assert.ok(ErrorCodeSchema.options.includes("DISMISS_TARGET_NOT_FOUND"));
  assert.ok(ErrorCodeSchema.options.includes("TERMINAL_UNAVAILABLE"));
});

test("validates and evaluates navigation policy preferences", () => {
  const policy = PolicyPreferencesSchema.parse({
    allowedNavigationRules: [{
      match: "authority",
      value: "https://example.com",
      source: "extension",
      updatedAt: now
    }],
    blockedNavigationRules: [{
      match: "scheme",
      value: "file:",
      source: "cli",
      updatedAt: now,
      reason: "manual block"
    }, {
      match: "host-wildcard",
      value: "*.blocked.example",
      source: "cli"
    }, {
      match: "url-exact",
      value: "chrome://settings/",
      source: "extension"
    }, {
      match: "url-prefix",
      value: "file:///C:/Projects/",
      source: "extension"
    }],
    sessionStepRetentionLimit: 25
  });

  assert.equal(policy.allowedNavigationRules[0].value, "https://example.com");
  assert.equal(policy.blockedNavigationRules[0].value, "file:");
  assert.equal(policy.blockedNavigationRules[0].source, "cli");
  assert.equal(policy.navigationPolicyEnabled, true);
  assert.equal(policy.policyMode, "blocklist");
  assert.equal(policy.commandPolicy["policy.allow.add"], false);
  assert.equal(policy.commandPolicy["event.subscribe"], true);
  assert.equal(policy.commandPolicy["events.recent"], true);
  assert.equal(policy.commandPolicy["session.steps"], true);
  assert.equal(policy.commandPolicy["bridge.disconnect"], false);
  assert.equal(policy.advancedBackendEnabled, false);
  assert.equal(policy.sessionStepRetentionLimit, 25);
  assert.equal(navigationPolicyAllowsUrl("file:///C:/private.txt", policy), false);
  assert.equal(navigationPolicyAllowsUrl("https://sub.blocked.example/a", policy), false);
  assert.equal(navigationPolicyAllowsUrl("chrome://settings/", policy), false);
  assert.equal(navigationPolicyAllowsUrl("https://example.com/a", policy), true);
  assert.deepEqual(normalizeNavigationRulePattern("authority", "HTTPS://Example.COM/path"), {
    match: "authority",
    value: "https://example.com"
  });
  assert.throws(() => PolicyPreferencesSchema.parse({
    blockedNavigationRules: [{ match: "scheme", value: "FILE:", source: "extension" }]
  }));
});

test("migrates persisted origin policies and settings catalogs", () => {
  const migratedPolicy = PolicyPreferencesSchema.parse(migrateLegacyPolicyPreferences({
    originPolicyEnabled: false,
    policyMode: "allowlist",
    allowedOrigins: [{ origin: "https://example.com", source: "extension" }],
    blockedOrigins: [{ origin: "*.blocked.example", source: "cli" }]
  }));
  assert.equal(migratedPolicy.navigationPolicyEnabled, false);
  assert.deepEqual(migratedPolicy.allowedNavigationRules[0], {
    match: "authority",
    value: "https://example.com",
    source: "extension"
  });
  assert.deepEqual(migratedPolicy.blockedNavigationRules[0], {
    match: "host-wildcard",
    value: "*.blocked.example",
    source: "cli"
  });

  const migratedCatalog = migrateLegacySettingsProfileCatalog({
    version: 1,
    profiles: [{
      content: {
        policyPreferences: {
          blockedOrigins: [{ origin: "https://blocked.example", source: "config" }]
        },
        terminalPreferences: {
          defaultProfileId: "PowerShell 7",
          fontSize: 18
        }
      }
    }]
  });
  assert.equal(migratedCatalog.version, 2);
  assert.equal(migratedCatalog.profiles[0].content.policyPreferences.blockedNavigationRules[0].value, "https://blocked.example");
  assert.equal(migratedCatalog.profiles[0].content.terminalPreferences.defaultProfileId, "auto");
  assert.equal(migratedCatalog.profiles[0].content.terminalPreferences.fontSize, 18);

  const terminalPreferences = { defaultProfileId: "PowerShell 7", fontSize: 20, startupCommand: "codex" };
  const migratedTerminal = migrateLegacyTerminalPreferences(terminalPreferences);
  assert.deepEqual(migratedTerminal, { defaultProfileId: "auto", fontSize: 20, startupCommand: "codex" });
  assert.notEqual(migratedTerminal, terminalPreferences);

  const healthyCatalog = {
    version: 2,
    profiles: [{ content: { terminalPreferences: { defaultProfileId: "wsl:ubuntu-24.04" } } }]
  };
  assert.equal(migrateLegacySettingsProfileCatalog(healthyCatalog), healthyCatalog);
});

test("validates session steps and Phase 14 command policy defaults", () => {
  assert.equal(DEFAULT_COMMAND_POLICY["event.subscribe"], true);
  assert.equal(DEFAULT_COMMAND_POLICY["events.recent"], true);
  assert.equal(DEFAULT_COMMAND_POLICY["session.steps"], true);
  assert.equal(DEFAULT_COMMAND_POLICY["bridge.disconnect"], false);
  assert.equal(DEFAULT_COMMAND_POLICY["page.dismiss"], true);

  const step = SessionStepSchema.parse({
    stepId: "step_001",
    browserId: "br_001",
    commandType: "action.type",
    status: "completed",
    createdAt: now,
    tabId: 1,
    args: {
      text: "[redacted-text]",
      textLength: 5
    }
  });
  assert.equal(step.args.text, "[redacted-text]");
});

test("validates browser session, snapshot, and action shapes", () => {
  const session = BrowserSessionSchema.parse({
    browserId: "br_001",
    browserName: "Chrome",
    extensionVersion: "0.1.0",
    connectedAt: now,
    lastHeartbeat: now,
    capabilities: ["tabs", "events", "advanced-debugger"],
    bridgeStatus: "connected",
    status: "available"
  });
  assert.equal(session.browserName, "Chrome");

  const screenshot = {
    browserId: "br_001",
    tabId: 1,
    capturedAt: now,
    mimeType: "image/png",
    data: "data",
    activatedTabBeforeCapture: false
  };

  const snapshot = SnapshotSchema.parse({
    snapshotId: "snap_001",
    browserId: "br_001",
    tabId: 1,
    url: "https://example.com",
    title: "Example",
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    screenshot,
    visibleText: "Example",
    elements: [{
      elementId: "el_001",
      role: "button",
      label: "Submit",
      text: "Submit",
      bounds: { x: 0, y: 0, width: 80, height: 30 },
      state: {}
    }],
    capturedAt: now,
    filtered: true,
    filter: {
      query: "submit",
      role: "button",
      interactiveOnly: true,
      maxElements: 10
    }
  });
  assert.equal(snapshot.elements[0].elementId, "el_001");
  assert.equal(snapshot.filtered, true);
  assert.equal(snapshot.filter.query, "submit");
  assert.deepEqual(SnapshotFilterSchema.parse({ query: "reviews", maxElements: 5 }), {
    query: "reviews",
    maxElements: 5
  });
  assert.throws(() => SnapshotFilterSchema.parse({ query: "", maxElements: 0 }));

  const action = ActionRequestSchema.parse({
    action: "click",
    browserId: "br_001",
    tabId: 1,
    elementId: "el_001"
  });
  assert.equal(action.action, "click");
});
