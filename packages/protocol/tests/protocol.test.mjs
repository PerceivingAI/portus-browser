import assert from "node:assert/strict";
import test from "node:test";
import {
  ActionRequestSchema,
  BrowserSessionSchema,
  CommandTypeSchema,
  DEFAULT_COMMAND_POLICY,
  ErrorCodeSchema,
  RegistrationResultSchema,
  SessionStepSchema,
  PolicyPreferencesSchema,
  RequestEnvelopeSchema,
  safeParseProtocolMessage,
  ResponseEnvelopeSchema,
  SnapshotFilterSchema,
  SnapshotSchema
} from "../dist/index.js";

const now = "2026-04-28T00:00:00.000Z";

test("validates request envelopes", () => {
  const request = RequestEnvelopeSchema.parse({
    protocolVersion: "1",
    requestId: "req_001",
    kind: "request",
    type: "browser.list",
    payload: {},
    auth: { brokerToken: "test-token" }
  });

  assert.equal(request.protocolVersion, "1");
  assert.equal(request.auth.brokerToken, "test-token");
  assert.throws(() => RequestEnvelopeSchema.parse({ ...request, protocolVersion: "2" }));
  assert.throws(() => RequestEnvelopeSchema.parse({ ...request, auth: { brokerToken: "test-token", extra: true } }));
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
    protocolVersion: "2",
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
    protocolVersion: "1",
    requestId: "req_001",
    kind: "response",
    ok: true,
    result: {}
  }).ok, true);

  assert.equal(ResponseEnvelopeSchema.parse({
    protocolVersion: "1",
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
  assert.ok(ErrorCodeSchema.options.includes("PERMISSION_REQUIRED"));
  assert.ok(ErrorCodeSchema.options.includes("ORIGIN_BLOCKED"));
  assert.ok(ErrorCodeSchema.options.includes("COMMAND_DISABLED_BY_POLICY"));
  assert.ok(ErrorCodeSchema.options.includes("DISMISS_TARGET_NOT_FOUND"));
  assert.ok(ErrorCodeSchema.options.includes("TERMINAL_UNAVAILABLE"));
});

test("validates Portus policy preferences", () => {
  const policy = PolicyPreferencesSchema.parse({
    allowedOrigins: [{
      origin: "https://example.com",
      source: "extension",
      updatedAt: now
    }],
    blockedOrigins: [{
      origin: "*.blocked.example",
      source: "cli",
      updatedAt: now,
      reason: "manual block"
    }],
    sessionStepRetentionLimit: 25
  });

  assert.equal(policy.allowedOrigins[0].origin, "https://example.com");
  assert.equal(policy.blockedOrigins[0].origin, "*.blocked.example");
  assert.equal(policy.blockedOrigins[0].source, "cli");
  assert.equal(policy.originPolicyEnabled, true);
  assert.equal(policy.policyMode, "blocklist");
  assert.equal(policy.commandPolicy["policy.allow.add"], false);
  assert.equal(policy.commandPolicy["event.subscribe"], true);
  assert.equal(policy.commandPolicy["events.recent"], true);
  assert.equal(policy.commandPolicy["session.steps"], true);
  assert.equal(policy.commandPolicy["bridge.disconnect"], false);
  assert.equal(policy.advancedBackendEnabled, false);
  assert.equal(policy.sessionStepRetentionLimit, 25);
  assert.throws(() => PolicyPreferencesSchema.parse({
    allowedOrigins: [{ origin: "chrome://newtab", source: "extension" }],
    blockedOrigins: [],
    sessionStepRetentionLimit: 10
  }));
  assert.throws(() => PolicyPreferencesSchema.parse({
    allowedOrigins: [{ origin: "*", source: "extension" }],
    blockedOrigins: [],
    sessionStepRetentionLimit: 10
  }));
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
