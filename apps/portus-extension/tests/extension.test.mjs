import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createBrokerNamedPipeServer } from "@portus/broker";
import { encodeNativeMessage, tryReadNativeMessageFrame } from "@portus/native-messaging";
import { DEFAULT_COMMAND_POLICY } from "@portus/protocol";
import { deserializeTransportFrame, serializeTransportFrame } from "@portus/transport";
import { createNativeHostRelay } from "@portus/native-host";
import { createPortusExtensionBridge, detectBrowserName } from "../dist/index.js";

const TEST_BROKER_TOKEN = "test-broker-token";

test("packages an action popup for bridge visibility controls", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  const sidepanelHtml = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  const popupSource = await readFile(new URL("../src/popup.tsx", import.meta.url), "utf8");
  const sidepanelSource = await readFile(new URL("../src/sidepanel.tsx", import.meta.url), "utf8");

  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(manifest.permissions.includes("debugger"));
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.match(popupHtml, /id="root"/);
  assert.match(popupHtml, /dist\/gui\.css/);
  assert.match(popupHtml, /dist\/popup\.js/);
  assert.doesNotMatch(popupHtml, /popup\.css/);
  assert.match(sidepanelHtml, /id="root"/);
  assert.match(sidepanelHtml, /dist\/gui\.css/);
  assert.match(sidepanelHtml, /dist\/sidepanel\.js/);
  assert.match(sidepanelHtml, /dist\/sidepanel\.css/);
  assert.doesNotMatch(sidepanelHtml, /href="sidepanel\.css"/);
  assert.match(popupSource, /Connect/);
  assert.match(popupSource, /Open Panel/);
  assert.match(popupSource, /Close Panel/);
  assert.match(popupSource, /Current Origin/);
  assert.match(sidepanelSource, /NativeRadioGroupField/);
  assert.match(sidepanelSource, /TooltipProvider/);
  assert.match(sidepanelSource, /TooltipTrigger/);
  assert.match(sidepanelSource, /Open Settings/);
  assert.match(sidepanelSource, /Open Terminal/);
  assert.match(sidepanelSource, /Rename/);
  assert.match(sidepanelSource, /Delete/);
  assert.doesNotMatch(popupSource, /Rename/);
  assert.doesNotMatch(popupSource, /Delete Profile/);
  assert.match(sidepanelSource, /Enable Policies/);
  assert.match(sidepanelSource, /Clear URLs/);
  assert.match(sidepanelSource, /TabsList/);
  assert.doesNotMatch(sidepanelSource, /<h1[^>]*>Portus Browser<\/h1>/);
  assert.match(sidepanelSource, /Default View/);
  assert.match(sidepanelSource, /Extension Icon/);
  assert.match(sidepanelSource, /CLI Commands/);
  assert.match(sidepanelSource, /Import \/ Export/);
  assert.match(sidepanelSource, /Terminal/);
  assert.match(sidepanelSource, /Enable Terminal/);
  assert.match(sidepanelSource, /Default Terminal/);
  assert.match(sidepanelSource, /parseOriginInput/);
  assert.match(sidepanelSource, /<FieldLabel htmlFor="origin-input">Origins<\/FieldLabel>/);
  assert.match(sidepanelSource, /rows=\{4\}/);
  assert.doesNotMatch(sidepanelSource, /command\.label\} \(\{command\.type\}\)/);
});

test("detects Chromium browser family for registration", () => {
  assert.equal(detectBrowserName({
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36"
  }), "Chrome");
  assert.equal(detectBrowserName({
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0"
  }), "Edge");
  assert.equal(detectBrowserName({
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
    navigator: { brave: {} }
  }), "Brave");
});

test("connects bridge through native messaging only when requested", async () => {
  const fixture = createChromeFixture();
  const timers = createTimerFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z"),
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  });

  assert.equal(fixture.ports.length, 0);

  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length > 0);
  const port = fixture.ports[0];
  assert.ok(port);
  assert.equal(port.messages[0].type, "bridge.register");
  assert.equal(port.messages[0].payload.browserName, "Chrome");
  assert.deepEqual(port.messages[0].payload.capabilities, ["tabs", "windows", "screenshots", "snapshots", "actions", "advanced-debugger", "permissions", "events"]);
  assert.deepEqual(port.messages[0].payload.policyPreferences, {
    originPolicyEnabled: true,
    policyMode: "blocklist",
    allowedOrigins: [],
    blockedOrigins: [],
    commandPolicy: DEFAULT_COMMAND_POLICY,
    advancedBackendEnabled: false,
    sessionStepRetentionLimit: 10
  });

  port.emitMessage(response(port.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));

  const status = await connectPromise;
  assert.equal(status.bridgeState, "connected");
  assert.equal(status.browserId, "br_000001");
});

test("times out native requests and ignores late responses", async () => {
  const fixture = createChromeFixture();
  const requestTimers = createTimeoutFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    setTimeout: requestTimers.setTimeout,
    clearTimeout: requestTimers.clearTimeout,
    nativeRequestTimeoutMs: 5
  });

  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length > 0);
  const port = fixture.ports[0];
  assert.equal(port.messages[0].type, "bridge.register");
  assert.equal(requestTimers.callbacks.length, 1);

  requestTimers.callbacks[0]();
  await assert.rejects(connectPromise, { code: "COMMAND_TIMEOUT" });

  port.emitMessage(response(port.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));
  assert.equal(bridge.browserId, null);
});

test("clears native request timeouts when native host disconnects", async () => {
  const fixture = createChromeFixture();
  const requestTimers = createTimeoutFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    setTimeout: requestTimers.setTimeout,
    clearTimeout: requestTimers.clearTimeout,
    nativeRequestTimeoutMs: 5
  });

  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length > 0);
  fixture.ports[0].disconnect();

  await assert.rejects(connectPromise, { code: "NATIVE_HOST_UNAVAILABLE" });
  assert.equal(requestTimers.callbacks.length, 0);
});

test("initializes bridge connected by default on first run", async () => {
  const fixture = createChromeFixture();
  const timers = createTimerFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z"),
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  });

  const initializePromise = bridge.initializeBridge();
  await waitFor(() => fixture.ports.length > 0);
  const port = fixture.ports[0];
  assert.equal(port.messages[0].type, "bridge.register");
  port.emitMessage(response(port.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));

  const status = await initializePromise;
  assert.equal(status.bridgeState, "connected");
  assert.equal(fixture.storage["portus.bridgePreference"], true);
  assert.equal(timers.callbacks.length, 1);
});

test("does not auto-reconnect after user leaves bridge disconnected", async () => {
  const fixture = createChromeFixture({
    storage: {
      "portus.bridgePreference": false
    }
  });
  const bridge = createPortusExtensionBridge(fixture.chrome);

  const status = await bridge.initializeBridge();

  assert.equal(status.bridgeState, "disconnected");
  assert.equal(fixture.ports.length, 0);
});

test("retries auto-connect while bridge preference remains connected", async () => {
  let attempts = 0;
  const fixture = createChromeFixture({
    connectNative() {
      attempts += 1;
      if (attempts === 1) throw new Error("native host not ready");
      const port = createMockNativePort();
      fixture.ports.push(port);
      return port;
    }
  });
  const timers = createTimerFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  });

  const failedStatus = await bridge.initializeBridge();
  assert.equal(failedStatus.bridgeState, "error");
  assert.equal(timers.callbacks.length, 1);

  timers.callbacks[0]();
  await waitFor(() => fixture.ports.length > 0);
  const port = fixture.ports[0];
  port.emitMessage(response(port.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await bridge.getStatus()).bridgeState, "connected");
});

test("sends heartbeats while bridge is connected", async () => {
  const fixture = createChromeFixture();
  const timers = createTimerFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z"),
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  });

  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length > 0);
  const port = fixture.ports[0];
  port.emitMessage(response(port.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));
  await connectPromise;

  assert.equal(timers.callbacks.length, 1);
  timers.callbacks[0]();
  assert.equal(port.messages[1].type, "bridge.heartbeat");
  assert.equal(port.messages[1].payload.browserId, "br_000001");
  assert.equal(port.messages[1].payload.bridgeStatus, "connected");
});

test("broker heartbeat failure keeps terminal native host connected for reconnect", async () => {
  const fixture = createChromeFixture();
  const timers = createTimerFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z"),
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  });

  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length === 1);
  const bridgePort = fixture.ports[0];
  bridgePort.emitMessage(response(bridgePort.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));
  await connectPromise;

  const terminalPromise = bridge.sendTerminalClientMessage({
    type: "terminal.sessions.list",
    requestId: "treq_heartbeat",
    payload: {}
  });
  await waitFor(() => fixture.ports.length === 2);
  const terminalPort = fixture.ports[1];
  terminalPort.emitMessage({
    type: "terminal.sessions",
    requestId: "treq_heartbeat",
    payload: { sessions: [], activeTerminalId: null }
  });
  await terminalPromise;

  timers.callbacks[0]();
  const heartbeatRequest = bridgePort.messages.find((message) => message.type === "bridge.heartbeat");
  bridgePort.emitMessage({
    protocolVersion: "1",
    requestId: heartbeatRequest.requestId,
    kind: "response",
    ok: false,
    error: {
      code: "BROKER_UNAVAILABLE",
      message: "Portus Broker is unavailable.",
      retryable: true
    }
  });

  await waitFor(async () => (await bridge.getStatus()).bridgeState === "error");
  assert.equal(terminalPort.disconnected, false);
  assert.equal((await bridge.getStatus()).terminalNativeHostState, "connected");
});

test("publishes Chrome tab lifecycle events while bridge is connected", async () => {
  const fixture = createChromeFixture();
  const timers = createTimerFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z"),
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  });

  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length > 0);
  const port = fixture.ports[0];
  port.emitMessage(response(port.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));
  await connectPromise;

  fixture.tabEvents.onUpdated.emit(7, { status: "complete", url: "https://example.com/done" }, chromeTab(7, "https://example.com/done", true));
  await waitFor(() => port.messages.some((message) => message.type === "event.publish" && message.payload.type === "tab.updated"));
  const updated = port.messages.find((message) => message.type === "event.publish" && message.payload.type === "tab.updated");

  assert.equal(updated.payload.browserId, "br_000001");
  assert.equal(updated.payload.tabId, 7);
  assert.equal(updated.payload.payload.status, "complete");
  assert.equal(updated.payload.payload.tab.url, "https://example.com/done");

  fixture.tabEvents.onActivated.emit({ tabId: 7, windowId: 11 });
  await waitFor(() => port.messages.some((message) => message.type === "event.publish" && message.payload.type === "tab.activated"));
  fixture.tabEvents.onRemoved.emit(7, { windowId: 11, isWindowClosing: false });
  await waitFor(() => port.messages.some((message) => message.type === "event.publish" && message.payload.type === "tab.closed"));
});

test("disconnects bridge and clears local availability state", async () => {
  const fixture = createChromeFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z")
  });

  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length > 0);
  const port = fixture.ports[0];
  port.emitMessage(response(port.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));
  await connectPromise;

  const disconnectPromise = bridge.disconnectBridge();
  await waitFor(() => port.messages.length > 1);
  assert.equal(port.messages[1].type, "bridge.disconnect");
  port.emitMessage(response(port.messages[1].requestId, { disconnected: true }));
  const status = await disconnectPromise;

  assert.equal(port.disconnected, true);
  assert.equal(status.bridgeState, "disconnected");
  assert.equal(status.browserId, null);
  assert.equal(fixture.storage["portus.bridgePreference"], false);
});

test("handles routed tab commands from broker", async () => {
  const fixture = createChromeFixture();
  const timers = createTimerFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  });

  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length > 0);
  const port = fixture.ports[0];
  port.emitMessage(response(port.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));
  await connectPromise;

  port.emitMessage(request("req_101", "tab.list"));
  await waitFor(() => port.messages.at(-1)?.requestId === "req_101");
  assert.equal(port.messages.at(-1).ok, true);
  assert.equal(port.messages.at(-1).result.tabs.length, 2);

  port.emitMessage(request("req_102", "tab.open", { url: "https://example.com", active: true }));
  await waitFor(() => port.messages.at(-1)?.requestId === "req_102");
  assert.equal(port.messages.at(-1).result.tab.url, "https://example.com");

  port.emitMessage(request("req_103", "tab.navigate", { tabId: 2, url: "https://docs.example.com" }));
  await waitFor(() => port.messages.at(-1)?.requestId === "req_103");
  assert.equal(port.messages.at(-1).result.tab.url, "https://docs.example.com");

  port.emitMessage(request("req_104", "tab.history.back", { tabId: 2 }));
  await waitFor(() => port.messages.at(-1)?.requestId === "req_104");
  assert.equal(fixture.actions.at(-1), "back");

  port.emitMessage(request("req_105", "tab.history.forward", { tabId: 2 }));
  await waitFor(() => port.messages.at(-1)?.requestId === "req_105");
  assert.equal(fixture.actions.at(-1), "forward");

  port.emitMessage(request("req_106", "tab.activate", { tabId: 2 }));
  await waitFor(() => port.messages.at(-1)?.requestId === "req_106");
  assert.equal(fixture.windowFocused, 11);
  assert.equal(port.messages.at(-1).result.tab.active, true);

  port.emitMessage(request("req_107", "tab.close", { tabId: 2 }));
  await waitFor(() => port.messages.at(-1)?.requestId === "req_107");
  assert.equal(fixture.closedTabId, 2);
  assert.deepEqual(port.messages.at(-1).result, { closed: true, tabId: 2 });
});

test("requests and revokes optional origin permission", async () => {
  const fixture = createChromeFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z")
  });

  const record = await bridge.requestOriginPermission("https://example.com", "snapshot");
  assert.equal(record.origin, "https://example.com");
  assert.equal(record.granted, true);
  assert.deepEqual(fixture.permissionRequests, ["https://example.com/*"]);

  const status = await bridge.getStatus();
  assert.equal(status.allowlist.length, 1);

  const revoke = await bridge.revokeOriginPermission("https://example.com");
  assert.deepEqual(revoke, { revoked: true, origin: "https://example.com" });
  assert.deepEqual(fixture.permissionRemovals, ["https://example.com/*"]);
  assert.equal((await bridge.getStatus()).allowlist.length, 0);
});

test("reports active origin permission state separately from bridge visibility", async () => {
  const fixture = createChromeFixture({ permissionContains: false });
  const bridge = createConnectedBridge(fixture);

  const status = await bridge.getStatus();

  assert.equal(status.bridgeState, "connected");
  assert.equal(status.activeTabOrigin, "https://example.com");
  assert.equal(status.permissionState, "missing");
  assert.equal(status.allowlist.length, 0);
});

test("runtime permission request and revoke update active origin status", async () => {
  const fixture = createChromeFixture({ permissionContains: false });
  const bridge = createConnectedBridge(fixture);

  const requestResult = await bridge.handleRuntimeMessage({
    type: "portus.permission.request",
    origin: "https://example.com",
    reason: "manual test"
  });
  assert.equal(requestResult.permission.origin, "https://example.com");
  assert.equal(requestResult.status.permissionState, "granted");
  assert.deepEqual(fixture.permissionRequests, ["https://example.com/*"]);
  assert.equal((await bridge.getStatus()).permissionState, "granted");

  const revokeResult = await bridge.handleRuntimeMessage({
    type: "portus.permission.revoke",
    origin: "https://example.com"
  });
  assert.equal(revokeResult.revoked, true);
  assert.equal(revokeResult.origin, "https://example.com");
  assert.equal(revokeResult.status.permissionState, "missing");
  assert.deepEqual(fixture.permissionRemovals, ["https://example.com/*"]);
  assert.equal((await bridge.getStatus()).permissionState, "missing");
  assert.equal((await bridge.getStatus()).bridgeState, "connected");
});

test("runtime policy origin mutations include refreshed status for side panel controls", async () => {
  const fixture = createChromeFixture({
    queryTabs() {
      return Promise.resolve([chromeTab(1, "https://www.google.com/search?q=portus", true)]);
    }
  });
  const bridge = createConnectedBridge(fixture);

  const result = await bridge.handleRuntimeMessage({
    type: "portus.policy.allow.add",
    origin: "https://www.google.com",
    reason: "manual test"
  });

  assert.equal(result.policy.allowedOrigins[0].origin, "https://www.google.com");
  assert.equal(result.status.activeTabOrigin, "https://www.google.com");
  assert.equal(result.status.policyPreferences.allowedOrigins[0].origin, "https://www.google.com");
});

test("routes permission list to extension allowlist", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.requestOriginPermission("https://example.com", "manual test");

  const result = await bridge.dispatchNativeRequest(request("req_permissions", "permission.list"));

  assert.equal(result.permissions.length, 1);
  assert.equal(result.permissions[0].origin, "https://example.com");
  assert.equal(result.permissions[0].granted, true);
});

test("persists policy preferences and routes policy commands", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("policy.block.add", true, false);

  const blocked = await bridge.dispatchNativeRequest(request("req_policy_block", "policy.block.add", {
    origin: "https://blocked.example",
    reason: "manual test"
  }));
  assert.equal(blocked.policy.blockedOrigins[0].origin, "https://blocked.example");
  assert.equal(blocked.policy.blockedOrigins[0].source, "cli");
  assert.equal(fixture.storage["portus.policyPreferences"].blockedOrigins.length, 1);

  const retention = await bridge.handleRuntimeMessage({
    type: "portus.policy.retention.set",
    limit: 25
  });
  assert.equal(retention.policy.sessionStepRetentionLimit, 25);

  const listed = await bridge.dispatchNativeRequest(request("req_policy_get", "policy.get"));
  assert.equal(listed.policy.blockedOrigins[0].origin, "https://blocked.example");
  assert.equal(listed.policy.sessionStepRetentionLimit, 25);
});

test("blocks native commands disabled by user policy before browser work", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("screenshot.capture", false, false);

  await assert.rejects(() => bridge.dispatchNativeRequest(request("req_screenshot", "screenshot.capture", {
    tabId: 1
  })), { code: "COMMAND_DISABLED_BY_POLICY" });
  assert.deepEqual(fixture.capturedWindows, []);

  await bridge.setCommandPolicyEnabled("screenshot.capture", true, false);
  const result = await bridge.dispatchNativeRequest(request("req_screenshot_allowed", "screenshot.capture", {
    tabId: 1
  }));
  assert.equal(result.screenshot.tabId, 1);
});

test("syncs popup policy changes to broker while bridge is connected", async () => {
  const fixture = createChromeFixture();
  const timers = createTimerFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z"),
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  });
  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length > 0);
  const port = fixture.ports[0];
  port.emitMessage(response(port.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));
  await connectPromise;

  await bridge.handleRuntimeMessage({
    type: "portus.policy.block.add",
    origin: "https://example.com",
    reason: "manual block"
  });

  await waitFor(() => port.messages.some((message) => message.type === "policy.sync"));
  const sync = port.messages.find((message) => message.type === "policy.sync");
  assert.equal(sync.payload.browserId, "br_000001");
  assert.equal(sync.payload.policyPreferences.blockedOrigins[0].origin, "https://example.com");
  port.emitMessage(response(sync.requestId, { policy: sync.payload.policyPreferences }));
});

test("applies Broker settings profile state on registration", async () => {
  const fixture = createChromeFixture();
  const timers = createTimerFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  });
  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length > 0);
  const port = fixture.ports[0];

  port.emitMessage(response(port.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000,
    settingsProfiles: settingsProfileState({
      activeProfileId: "profile_work",
      activeProfileName: "Work_Profile",
      autoSave: false,
      content: {
        policyPreferences: { sessionStepRetentionLimit: 77 },
        uxPreferences: { defaultPanelView: "settings", iconClickBehavior: "side-panel" },
        terminalPreferences: terminalSettingsFixture(),
        autoSave: false
      }
    })
  }));

  const status = await connectPromise;
  assert.equal(status.settingsProfiles.activeProfileName, "Work_Profile");
  assert.equal(status.settingsProfiles.autoSave, false);
  assert.equal(status.policyPreferences.sessionStepRetentionLimit, 77);
  assert.equal(status.uxPreferences.defaultPanelView, "settings");
});

test("keeps auto-save-off profile edits local until Save", async () => {
  const fixture = createChromeFixture();
  const timers = createTimerFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  });
  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length > 0);
  const port = fixture.ports[0];
  port.emitMessage(response(port.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000,
    settingsProfiles: settingsProfileState({
      autoSave: false,
      content: {
        policyPreferences: {},
        uxPreferences: {},
        terminalPreferences: terminalSettingsFixture(),
        autoSave: false
      }
    })
  }));
  await connectPromise;

  await bridge.handleRuntimeMessage({
    type: "portus.policy.block.add",
    origin: "https://local.example",
    reason: "manual block"
  });

  assert.ok(port.messages.some((message) => message.type === "policy.sync"));
  assert.equal(port.messages.some((message) => message.type === "settings.profile.save"), false);
  const status = await bridge.getStatus();
  assert.equal(status.settingsProfiles.dirty, true);
  assert.equal(status.settingsProfiles.content.policyPreferences.blockedOrigins[0].origin, "https://local.example");
});

test("profile metadata updates preserve local unsaved settings", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.dispatchNativeRequest(request("req_profile_apply", "settings.profile.apply-selection", {
    settingsProfiles: settingsProfileState({
      autoSave: false,
      content: {
        policyPreferences: { sessionStepRetentionLimit: 10 },
        uxPreferences: {},
        terminalPreferences: terminalSettingsFixture(),
        autoSave: false
      }
    })
  }));
  await bridge.setSessionStepRetentionLimit(44);

  await bridge.dispatchNativeRequest(request("req_profile_metadata", "settings.profile.apply-metadata", {
    settingsProfiles: settingsProfileState({
      activeProfileName: "Work_Profile",
      autoSave: false,
      content: {
        policyPreferences: { sessionStepRetentionLimit: 10 },
        uxPreferences: {},
        terminalPreferences: terminalSettingsFixture(),
        autoSave: false
      }
    })
  }));

  const status = await bridge.getStatus();
  assert.equal(status.settingsProfiles.activeProfileName, "Work_Profile");
  assert.equal(status.settingsProfiles.dirty, true);
  assert.equal(status.policyPreferences.sessionStepRetentionLimit, 44);
  assert.equal(status.settingsProfiles.content.policyPreferences.sessionStepRetentionLimit, 44);
});

test("blocks screenshot, snapshot, and actions on blocked origins", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.addPolicyOrigin("block", "https://example.com", "extension");

  await assert.rejects(() => bridge.captureScreenshot(1), {
    code: "ORIGIN_BLOCKED"
  });
  await assert.rejects(() => bridge.captureSnapshot(1), {
    code: "ORIGIN_BLOCKED"
  });
  await assert.rejects(() => bridge.performAction("click", {
    tabId: 1,
    elementId: "el_000001"
  }), {
    code: "ORIGIN_BLOCKED"
  });
});

test("matches wildcard policy origins across apex and subdomain pages", async () => {
  const fixture = createChromeFixture({
    getTab(tabId) {
      if (tabId === 1) return Promise.resolve(chromeTab(1, "https://tripadvisor.com/Hotels", true));
      return Promise.resolve(chromeTab(2, "https://www.tripadvisor.com/Hotels", false));
    }
  });
  const bridge = createConnectedBridge(fixture);
  await bridge.addPolicyOrigin("block", "*.tripadvisor.com", "extension");

  await assert.rejects(() => bridge.captureScreenshot(1), {
    code: "ORIGIN_BLOCKED"
  });
  await assert.rejects(() => bridge.captureScreenshot(2), {
    code: "ORIGIN_BLOCKED"
  });

  const status = await bridge.getStatus();
  assert.equal(status.policyPreferences.blockedOrigins[0].origin, "*.tripadvisor.com");
});

test("matches wildcard policy origins in allowlist mode", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.addPolicyOrigin("allow", "https://*.tripadvisor.com", "extension");
  await bridge.setPolicyMode("allowlist");

  const allowed = await bridge.openTab("https://www.tripadvisor.com/Hotels");
  assert.equal(allowed.url, "https://www.tripadvisor.com/Hotels");
  await assert.rejects(() => bridge.openTab("https://www.example.com/"), {
    code: "ORIGIN_BLOCKED"
  });
});

test("enforces only the active origin policy list without deleting inactive lists", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.addPolicyOrigin("block", "https://blocked.example", "extension");
  await bridge.addPolicyOrigin("allow", "https://allowed.example", "extension");
  await bridge.setPolicyMode("allowlist");

  await assert.rejects(() => bridge.openTab("https://example.com/a"), {
    code: "ORIGIN_BLOCKED"
  });

  const status = await bridge.getStatus();
  assert.equal(status.policyPreferences.policyMode, "allowlist");
  assert.equal(status.policyPreferences.allowedOrigins[0].origin, "https://allowed.example");
  assert.equal(status.policyPreferences.blockedOrigins[0].origin, "https://blocked.example");

  const allowedDespiteInactiveBlock = await bridge.openTab("https://allowed.example/a");
  assert.equal(allowedDespiteInactiveBlock.url, "https://allowed.example/a");

  await bridge.addPolicyOrigin("allow", "https://blocked.example", "extension");
  const inactiveBlockIgnored = await bridge.openTab("https://blocked.example/a");
  assert.equal(inactiveBlockIgnored.url, "https://blocked.example/a");

  await bridge.setPolicyMode("blocklist");
  await assert.rejects(() => bridge.openTab("https://blocked.example/a"), {
    code: "ORIGIN_BLOCKED"
  });
});

test("can disable origin policies without deleting URLs or disabling command policy", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.addPolicyOrigin("block", "https://blocked.example", "extension");

  await assert.rejects(() => bridge.openTab("https://blocked.example/a"), {
    code: "ORIGIN_BLOCKED"
  });

  const disabled = await bridge.handleRuntimeMessage({ type: "portus.policy.enabled.set", enabled: false });
  assert.equal(disabled.policy.originPolicyEnabled, false);
  assert.equal(disabled.policy.blockedOrigins[0].origin, "https://blocked.example");

  const opened = await bridge.openTab("https://blocked.example/a");
  assert.equal(opened.url, "https://blocked.example/a");

  await bridge.setCommandPolicyEnabled("tab.open", false);
  await assert.rejects(() => bridge.dispatchNativeRequest(request("req_tab_open_disabled", "tab.open", {
    url: "https://another.example/a"
  })), {
    code: "COMMAND_DISABLED_BY_POLICY"
  });
});

test("clears only the requested origin policy URL list", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.addPolicyOrigin("allow", "https://allowed.example", "extension");
  await bridge.addPolicyOrigin("block", "https://blocked.example", "extension");
  await bridge.setPolicyMode("allowlist");

  const clearedAllow = await bridge.handleRuntimeMessage({ type: "portus.policy.allow.clear" });
  assert.equal(clearedAllow.policy.policyMode, "allowlist");
  assert.equal(clearedAllow.policy.allowedOrigins.length, 0);
  assert.equal(clearedAllow.policy.blockedOrigins[0].origin, "https://blocked.example");

  await bridge.setPolicyMode("blocklist");
  const clearedBlock = await bridge.handleRuntimeMessage({ type: "portus.policy.block.clear" });
  assert.equal(clearedBlock.policy.policyMode, "blocklist");
  assert.equal(clearedBlock.policy.allowedOrigins.length, 0);
  assert.equal(clearedBlock.policy.blockedOrigins.length, 0);
});

test("restores policy preferences from extension local storage", async () => {
  const fixture = createChromeFixture({
    storage: {
      "portus.policyPreferences": {
        allowedOrigins: [{
          origin: "https://example.com",
          source: "extension",
          updatedAt: "2026-04-28T00:00:00.000Z"
        }],
        blockedOrigins: [],
        sessionStepRetentionLimit: 15
      }
    }
  });
  const bridge = createPortusExtensionBridge(fixture.chrome);

  const status = await bridge.getStatus();

  assert.equal(status.policyPreferences.allowedOrigins[0].origin, "https://example.com");
  assert.equal(status.policyPreferences.sessionStepRetentionLimit, 15);
});

test("uses popup action behavior by default and stores side panel preference in active profile state", async () => {
  const fixture = createChromeFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome);

  bridge.installSidePanelBehavior();
  await waitFor(() => fixture.sidePanelBehaviors.length > 0);
  assert.deepEqual(fixture.sidePanelBehaviors.at(-1), { openPanelOnActionClick: false });

  const ux = await bridge.setIconClickBehavior("side-panel");
  assert.equal(ux.iconClickBehavior, "side-panel");
  assert.deepEqual(fixture.sidePanelBehaviors.at(-1), { openPanelOnActionClick: true });
  assert.equal((await bridge.getStatus()).settingsProfiles.content.uxPreferences.iconClickBehavior, "side-panel");
  assert.equal(fixture.storage["portus.uxPreferences"], undefined);
});

test("tracks side panel open state and closes the panel through runtime commands", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);

  assert.equal((await bridge.getStatus()).sidePanelOpen, false);

  const opened = await bridge.handleRuntimeMessage({ type: "portus.sidepanel.open" });
  assert.deepEqual(opened, { opened: true });
  assert.deepEqual(fixture.sidePanelOpens, [{ windowId: 11 }]);
  assert.equal((await bridge.getStatus()).sidePanelOpen, true);

  const closed = await bridge.handleRuntimeMessage({ type: "portus.sidepanel.close" });
  assert.deepEqual(closed, { closed: true });
  assert.deepEqual(fixture.sidePanelCloses, [{ windowId: 11 }]);
  assert.equal((await bridge.getStatus()).sidePanelOpen, false);
});

test("exports, imports, and resets policy, UX, and terminal settings together", async () => {
  const fixture = createChromeFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome);
  const terminalPreferences = {
    enabled: false,
    defaultProfileId: "powershell",
    manualTerminalPath: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    startupCommand: "codex",
    defaultWorkingDirectory: "Downloads/portus-session",
    fontSize: 16,
    maxSessions: 5,
    idleTimeoutMs: 1800000
  };

  const imported = await bridge.handleRuntimeMessage({
    type: "portus.settings.import",
    policyPreferences: { sessionStepRetentionLimit: 25 },
    uxPreferences: { defaultPanelView: "settings", iconClickBehavior: "side-panel" },
    terminalPreferences
  });

  assert.equal(imported.policy.sessionStepRetentionLimit, 25);
  assert.equal(imported.ux.defaultPanelView, "settings");
  assert.equal(imported.ux.iconClickBehavior, "side-panel");
  assert.deepEqual(imported.terminal, terminalPreferences);
  let status = await bridge.getStatus();
  assert.equal(status.settingsProfiles.content.policyPreferences.sessionStepRetentionLimit, 25);
  assert.equal(status.settingsProfiles.content.uxPreferences.defaultPanelView, "settings");
  assert.deepEqual(status.settingsProfiles.content.terminalPreferences, terminalPreferences);
  assert.equal(fixture.storage["portus.terminalPreferences"], undefined);

  const exported = await bridge.handleRuntimeMessage({ type: "portus.settings.export" });
  assert.equal(exported.settings.kind, "portus.settingsProfiles");
  const activeExportedProfile = exported.settings.catalog.profiles.find((profile) => profile.profileId === exported.settings.catalog.activeProfileByBrowserType.Chrome);
  assert.equal(activeExportedProfile.content.policyPreferences.sessionStepRetentionLimit, 25);
  assert.equal(activeExportedProfile.content.uxPreferences.defaultPanelView, "settings");
  assert.deepEqual(activeExportedProfile.content.terminalPreferences, terminalPreferences);
  assert.equal(Object.prototype.hasOwnProperty.call(exported.settings, "terminalId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exported.settings, "sessions"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exported.settings, "output"), false);

  const reset = await bridge.handleRuntimeMessage({ type: "portus.settings.reset" });
  assert.equal(reset.policy.sessionStepRetentionLimit, 10);
  assert.equal(reset.ux.defaultPanelView, "terminal");
  assert.equal(reset.ux.iconClickBehavior, "popup");
  assert.equal(reset.terminal.enabled, true);
  assert.equal(reset.terminal.defaultWorkingDirectory, "Downloads/portus-session");
  assert.equal(reset.terminal.startupCommand, null);
  assert.equal(reset.terminal.manualTerminalPath, null);
  status = await bridge.getStatus();
  assert.equal(status.settingsProfiles.content.policyPreferences.sessionStepRetentionLimit, 10);
});

test("rejects invalid imported terminal preferences", async () => {
  const fixture = createChromeFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome);

  await assert.rejects(
    bridge.handleRuntimeMessage({
      type: "portus.settings.import",
      terminalPreferences: {
        enabled: true,
        defaultProfileId: "powershell",
        manualTerminalPath: null,
        startupCommand: "",
        defaultWorkingDirectory: "",
        fontSize: 16,
        maxSessions: 0,
        idleTimeoutMs: 1800000
      }
    }),
    /CONFIG_INVALID|INVALID_MESSAGE|Too small|must/i
  );
});

test("updates extension action title and badge for bridge states", async () => {
  const fixture = createChromeFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z"),
    setInterval: () => 0,
    clearInterval: () => undefined
  });

  await bridge.getStatus();
  assert.equal(fixture.actionTitles.at(-1), "Portus: Disconnected");

  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length > 0);
  const port = fixture.ports[0];
  port.emitMessage(response(port.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));
  await connectPromise;

  assert.equal(fixture.actionTitles.at(-1), "Portus: Connected");
  assert.equal(fixture.actionBadgeTexts.at(-1), "ON");
});

test("captures screenshots and reports activation side effects", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);

  const screenshot = await bridge.captureScreenshot(2);

  assert.equal(screenshot.browserId, "br_000001");
  assert.equal(screenshot.tabId, 2);
  assert.equal(screenshot.activatedTabBeforeCapture, true);
  assert.equal(screenshot.previousActiveTabId, 1);
  assert.equal(fixture.windowFocused, 11);
  assert.deepEqual(fixture.capturedWindows, [11]);
});

test("captures snapshots with actionable elements", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);

  const snapshot = await bridge.captureSnapshot(1);

  assert.equal(snapshot.snapshotId, "snap_000001");
  assert.equal(snapshot.visibleText, "Submit Name");
  assert.equal(snapshot.elements[0].elementId, "el_000001");
  assert.equal(snapshot.elements[0].selectorHint, "button:nth-of-type(1)");
});

test("preserves enriched snapshot metadata for links and fields", async () => {
  const fixture = createChromeFixture({
    executeScript() {
      return Promise.resolve([{
        result: {
          url: "https://example.com/1",
          title: "Example",
          viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
          visibleText: "Amazon Search",
          elements: [
            {
              role: "link",
              label: "Cars For Sale | Amazon",
              text: "Cars For Sale | Amazon",
              bounds: { x: 100, y: 200, width: 180, height: 24 },
              state: {},
              selectorHint: "div:nth-of-type(1) > a:nth-of-type(1)",
              tagName: "a",
              href: "https://www.amazon.com/cars"
            },
            {
              role: "textbox",
              label: "Search",
              text: "cars",
              bounds: { x: 10, y: 20, width: 300, height: 40 },
              state: { value: "cars" },
              selectorHint: "input:nth-of-type(1)",
              tagName: "input",
              editable: true,
              inputType: "search",
              name: "q",
              placeholder: "Search"
            }
          ]
        }
      }]);
    }
  });
  const bridge = createConnectedBridge(fixture);

  const snapshot = await bridge.captureSnapshot(1);

  assert.equal(snapshot.elements[0].href, "https://www.amazon.com/cars");
  assert.equal(snapshot.elements[1].inputType, "search");
  assert.equal(snapshot.elements[1].name, "q");
  assert.equal(snapshot.elements[1].placeholder, "Search");
});

test("captures filtered snapshots and allows actions with returned element ids", async () => {
  const fixture = createChromeFixture({
    executeScript(injection, actions) {
      if (Array.isArray(injection.args) && injection.args.length > 0) {
        actions.push(injection.args[0]);
        return Promise.resolve([{
          result: {
            ok: true,
            details: {
              action: "click",
              targetValidated: true
            }
          }
        }]);
      }
      return Promise.resolve([{
        result: {
          url: "https://example.com/reviews",
          title: "Example Reviews",
          viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
          visibleText: "Reviews Book now",
          elements: [
            {
              role: "link",
              label: "Latest reviews",
              text: "Latest reviews",
              bounds: { x: 10, y: 20, width: 180, height: 24 },
              state: {},
              selectorHint: "a:nth-of-type(1)",
              tagName: "a",
              href: "https://example.com/reviews"
            },
            {
              role: "button",
              label: "Book now",
              text: "Book now",
              bounds: { x: 10, y: 60, width: 120, height: 40 },
              state: {},
              selectorHint: "button:nth-of-type(1)",
              tagName: "button"
            }
          ]
        }
      }]);
    }
  });
  const bridge = createConnectedBridge(fixture);

  const snapshot = await bridge.captureSnapshot(1, {
    query: "reviews",
    role: "link",
    interactiveOnly: true
  });

  assert.equal(snapshot.filtered, true);
  assert.equal(snapshot.snapshotId, "snap_000001");
  assert.deepEqual(snapshot.elements.map((element) => element.elementId), ["el_000001"]);
  assert.equal(snapshot.elements[0].href, "https://example.com/reviews");

  const action = await bridge.performAction("click", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  });

  assert.equal(action.backend, "content-script-dom");
  assert.equal(fixture.actions[0].target.elementId, "el_000001");
});

test("performs DOM actions and rejects stale snapshot ids", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  const snapshot = await bridge.captureSnapshot(1);

  const action = await bridge.performAction("click", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  });

  assert.equal(action.backend, "content-script-dom");
  assert.equal(action.snapshotInvalidated, true);
  assert.equal(fixture.actions[0].action, "click");
  assert.equal(fixture.actions[0].selectorHint, undefined);
  assert.equal(fixture.actions[0].target.elementId, "el_000001");
  assert.equal(fixture.actions[0].target.label, "Submit");
  assert.deepEqual(fixture.actions[0].target.bounds, { x: 10, y: 20, width: 100, height: 40 });

  await assert.rejects(() => bridge.performAction("click", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  }), { code: "SNAPSHOT_STALE" });
});

test("performs DOM hover actions", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  const snapshot = await bridge.captureSnapshot(1);

  const action = await bridge.performAction("hover", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  });

  assert.equal(action.backend, "content-script-dom");
  assert.equal(action.snapshotInvalidated, true);
  assert.equal(fixture.actions[0].action, "hover");
  assert.equal(fixture.actions[0].target.elementId, "el_000001");
});

test("waits for visible page text", async () => {
  const fixture = createChromeFixture({
    executeScript(injection) {
      if (Array.isArray(injection.args) && injection.args.length > 0 && injection.args[0].text === "Reviews") {
        return Promise.resolve([{ result: { matched: true, details: { match: "text", text: "Reviews" } } }]);
      }
      return defaultSnapshotScriptResult();
    }
  });
  const bridge = createConnectedBridge(fixture);

  const wait = await bridge.waitForPage({ tabId: 1, text: "Reviews", timeoutMs: 500 });

  assert.equal(wait.matched, true);
  assert.equal(wait.source, "page-script");
  assert.equal(wait.details.match, "text");
});

test("surfaces unsupported DOM action failures", async () => {
  const fixture = createChromeFixture({
    executeScript(injection, actions) {
      if (Array.isArray(injection.args) && injection.args.length > 0) {
        actions.push(injection.args[0]);
        return Promise.resolve([{
          result: {
            ok: false,
            error: {
              code: "ACTION_UNSUPPORTED",
              message: "Target is not editable."
            }
          }
        }]);
      }
      return defaultSnapshotScriptResult();
    }
  });
  const bridge = createConnectedBridge(fixture);
  const snapshot = await bridge.captureSnapshot(1);

  await assert.rejects(() => bridge.performAction("type", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId,
    text: "Ada"
  }), { code: "ACTION_UNSUPPORTED" });
});

test("keeps advanced debugger backend disabled until GUI preference enables it", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("dialog.dismiss", true, false);

  await assert.rejects(() => bridge.handleDialog("dismiss", { tabId: 1 }), {
    code: "CAPABILITY_UNAVAILABLE"
  });
  assert.equal(fixture.debuggerAttaches.length, 0);
});

test("handles browser dialogs through temporary debugger sessions when enabled", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("dialog.accept", true, false);
  await bridge.setAdvancedBackendEnabled(true, false);

  const result = await bridge.handleDialog("accept", { tabId: 1, text: "yes" });

  assert.equal(result.backend, "debugger-cdp");
  assert.equal(result.handled, true);
  assert.deepEqual(fixture.debuggerAttaches, [{ target: { tabId: 1 }, version: "1.3" }]);
  assert.deepEqual(fixture.debuggerDetaches, [{ target: { tabId: 1 } }]);
  assert.deepEqual(fixture.debuggerCommands.map((command) => command.method), [
    "Page.enable",
    "Page.handleJavaScriptDialog"
  ]);
  assert.deepEqual(fixture.debuggerCommands.at(-1).params, {
    accept: true,
    promptText: "yes"
  });
});

test("uses debugger input for drag when advanced backend is enabled", async () => {
  const fixture = createChromeFixture({
    executeScript() {
      return Promise.resolve([{
        result: {
          url: "https://example.com/drag",
          title: "Drag",
          viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
          visibleText: "Drag Drop",
          elements: [
            {
              role: "button",
              label: "Drag",
              text: "Drag",
              bounds: { x: 10, y: 20, width: 100, height: 40 },
              state: {},
              selectorHint: "button:nth-of-type(1)",
              tagName: "button"
            },
            {
              role: "region",
              label: "Drop",
              text: "Drop",
              bounds: { x: 300, y: 200, width: 150, height: 80 },
              state: {},
              selectorHint: "section:nth-of-type(1)",
              tagName: "section"
            }
          ]
        }
      }]);
    }
  });
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("action.drag", true, false);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);

  const result = await bridge.performAction("drag", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    sourceElementId: snapshot.elements[0].elementId,
    targetElementId: snapshot.elements[1].elementId
  });

  assert.equal(result.backend, "debugger-cdp");
  assert.equal(result.snapshotInvalidated, true);
  assert.deepEqual(fixture.debuggerCommands.map((command) => command.method), [
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent"
  ]);
  assert.equal(fixture.actions.length, 0);
  assert.deepEqual(fixture.debuggerDetaches, [{ target: { tabId: 1 } }]);
});

test("detaches debugger sessions when an advanced command fails after attach", async () => {
  const fixture = createChromeFixture({
    sendDebuggerCommand(_target, method) {
      if (method === "Page.handleJavaScriptDialog") {
        return Promise.reject(new Error("No dialog is showing"));
      }
      return Promise.resolve({});
    }
  });
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("dialog.dismiss", true, false);
  await bridge.setAdvancedBackendEnabled(true, false);

  await assert.rejects(() => bridge.handleDialog("dismiss", { tabId: 1 }), {
    code: "CAPABILITY_UNAVAILABLE"
  });
  assert.equal(fixture.debuggerAttaches.length, 1);
  assert.equal(fixture.debuggerDetaches.length, 1);
});

test("dismisses cookie banners conservatively and prefers reject controls", async () => {
  const fixture = createChromeFixture({
    executeScript(injection, actions) {
      if (Array.isArray(injection.args) && injection.args.length > 0) {
        actions.push(injection.args[0]);
        return Promise.resolve([{ result: { ok: true, details: { action: injection.args[0].action, targetValidated: true } } }]);
      }
      return Promise.resolve([{
        result: {
          url: "https://example.com/1",
          title: "Example",
          viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
          visibleText: "We use cookies Accept all Reject all",
          elements: [
            {
              role: "button",
              label: "Accept all cookies",
              text: "Accept all cookies",
              bounds: { x: 10, y: 20, width: 150, height: 40 },
              state: {},
              selectorHint: "button:nth-of-type(1)",
              tagName: "button"
            },
            {
              role: "button",
              label: "Reject all cookies",
              text: "Reject all cookies",
              bounds: { x: 170, y: 20, width: 150, height: 40 },
              state: {},
              selectorHint: "button:nth-of-type(2)",
              tagName: "button"
            }
          ]
        }
      }]);
    }
  });
  const bridge = createConnectedBridge(fixture);

  const result = await bridge.dismissPage({ tabId: 1, kind: "cookie" });

  assert.equal(result.dismissed, true);
  assert.equal(result.elementId, "el_000002");
  assert.equal(result.reason, "cookie-reject-control");
  assert.equal(fixture.actions[0].target.label, "Reject all cookies");
});

test("dry-run dismiss reports target without clicking", async () => {
  const fixture = createChromeFixture({
    executeScript() {
      return Promise.resolve([{
        result: {
          url: "https://example.com/1",
          title: "Example",
          viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
          visibleText: "No thanks",
          elements: [
            {
              role: "button",
              label: "No thanks",
              text: "No thanks",
              bounds: { x: 10, y: 20, width: 120, height: 40 },
              state: {},
              selectorHint: "button:nth-of-type(1)",
              tagName: "button"
            }
          ]
        }
      }]);
    }
  });
  const bridge = createConnectedBridge(fixture);

  const result = await bridge.dismissPage({ tabId: 1, dryRun: true });

  assert.equal(result.dismissed, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.elementId, "el_000001");
  assert.equal(fixture.actions.length, 0);
});

test("returns permission required before snapshot and action injection", async () => {
  const fixture = createChromeFixture({ permissionContains: false });
  const bridge = createConnectedBridge(fixture);

  await assert.rejects(() => bridge.captureSnapshot(1), { code: "PERMISSION_REQUIRED" });
  await assert.rejects(() => bridge.performAction("scroll", { tabId: 1 }), { code: "PERMISSION_REQUIRED" });
});

test("maps Chrome tab failures to TAB_NOT_FOUND", async () => {
  const fixture = createChromeFixture({
    getTab() {
      return Promise.reject(new Error("No tab with id: 404."));
    }
  });
  const bridge = createConnectedBridge(fixture);

  await assert.rejects(() => bridge.getTab(404), { code: "TAB_NOT_FOUND" });
  await assert.rejects(() => bridge.captureScreenshot(404), { code: "TAB_NOT_FOUND" });
});

test("maps Chrome capture and injection failures to PERMISSION_REQUIRED", async () => {
  const captureFixture = createChromeFixture({
    captureVisibleTab() {
      return Promise.reject(new Error("Cannot access contents of the page."));
    }
  });
  const captureBridge = createConnectedBridge(captureFixture);
  await assert.rejects(() => captureBridge.captureScreenshot(1), { code: "PERMISSION_REQUIRED" });

  const scriptFixture = createChromeFixture({
    executeScript() {
      return Promise.reject(new Error("Cannot access contents of url."));
    }
  });
  const scriptBridge = createConnectedBridge(scriptFixture);
  await assert.rejects(() => scriptBridge.captureSnapshot(1), { code: "PERMISSION_REQUIRED" });
});

test("integrates extension bridge with native host and broker visibility", async () => {
  const pipeName = `portus-extension-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const server = createBrokerNamedPipeServer({
    brokerToken: TEST_BROKER_TOKEN,
    settingsProfilesPath: null,
    config: {
      broker: { pipeName },
      nativeHost: { brokerPipeName: pipeName }
    },
    now: () => new Date("2026-04-28T00:00:00.000Z")
  });
  await server.start();

  const input = new PassThrough();
  const output = new PassThrough();
  const relay = createNativeHostRelay({
    brokerToken: TEST_BROKER_TOKEN,
    input,
    output,
    config: {
      broker: { pipeName },
      nativeHost: { brokerPipeName: pipeName }
    }
  });
  await relay.connectBroker();

  const fixture = createChromeFixture({
    connectNative() {
      return createNativeMessagingPort(input, output);
    }
  });
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z")
  });
  const cliSocket = createConnection(server.broker.pipePath);

  try {
    const initialList = await brokerRequest(cliSocket, request("req_001", "browser.list"));
    assert.deepEqual(initialList.message.result.browsers, []);

    await bridge.connectBridge();
    const connectedList = await brokerRequest(cliSocket, request("req_002", "browser.list"));
    assert.equal(connectedList.message.result.browsers.length, 1);
    assert.equal(connectedList.message.result.browsers[0].browserName, "Chrome");

    const disconnectPromise = bridge.disconnectBridge();
    await disconnectPromise;
    const disconnectedList = await brokerRequest(cliSocket, request("req_003", "browser.list"));
    assert.deepEqual(disconnectedList.message.result.browsers, []);
  } finally {
    cliSocket.end();
    await relay.stop();
    await server.stop();
  }
});

function request(requestId, type, payload = {}) {
  return {
    protocolVersion: "1",
    requestId,
    kind: "request",
    type,
    payload,
    auth: { brokerToken: TEST_BROKER_TOKEN }
  };
}

function response(requestId, result) {
  return {
    protocolVersion: "1",
    requestId,
    kind: "response",
    ok: true,
    result
  };
}

function terminalSettingsFixture(overrides = {}) {
  return {
    enabled: true,
    defaultProfileId: "powershell",
    manualTerminalPath: null,
    startupCommand: null,
    defaultWorkingDirectory: "Downloads/portus-session",
    fontSize: 16,
    maxSessions: 5,
    idleTimeoutMs: 1800000,
    ...overrides
  };
}

function settingsProfileState(overrides = {}) {
  const activeProfileId = overrides.activeProfileId ?? "profile_1";
  const activeProfileName = overrides.activeProfileName ?? "Profile_1";
  const autoSave = overrides.autoSave ?? true;
  const content = {
    policyPreferences: {
      originPolicyEnabled: true,
      policyMode: "blocklist",
      allowedOrigins: [],
      blockedOrigins: [],
      commandPolicy: DEFAULT_COMMAND_POLICY,
      advancedBackendEnabled: false,
      sessionStepRetentionLimit: 10,
      ...(overrides.content?.policyPreferences ?? {})
    },
    uxPreferences: {
      defaultPanelView: "terminal",
      iconClickBehavior: "popup",
      ...(overrides.content?.uxPreferences ?? {})
    },
    terminalPreferences: overrides.content?.terminalPreferences ?? terminalSettingsFixture(),
    autoSave: overrides.content?.autoSave ?? autoSave
  };
  return {
    profiles: [
      { profileId: "profile_default", name: "Default_Profile", builtIn: true, readOnly: true },
      { profileId: activeProfileId, name: activeProfileName, builtIn: false, readOnly: false }
    ],
    activeProfileId,
    activeProfileName,
    activeProfileReadOnly: false,
    dirty: false,
    autoSave,
    canCreateProfile: true,
    maxCustomProfiles: 10,
    content
  };
}

test("terminal settings do not mutate bridge, policy, UX, or permission state", async () => {
  const fixture = createChromeFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z")
  });
  const before = await bridge.getStatus();
  const settings = {
    ...before.terminalPreferences,
    enabled: false,
    startupCommand: "codex"
  };

  const result = await bridge.handleRuntimeMessage({ type: "portus.terminal.settings.set", settings });
  const after = await bridge.getStatus();

  assert.equal(result.terminal.startupCommand, "codex");
  assert.equal(after.bridgeState, before.bridgeState);
  assert.deepEqual(after.policyPreferences, before.policyPreferences);
  assert.deepEqual(after.uxPreferences, before.uxPreferences);
  assert.deepEqual(after.allowlist, before.allowlist);
  assert.equal(fixture.ports.length, 0);
});

test("uses a separate terminal native host channel", async () => {
  const fixture = createChromeFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z")
  });

  const terminalPromise = bridge.sendTerminalClientMessage({
    type: "terminal.sessions.list",
    requestId: "treq_001",
    payload: {}
  });
  await waitFor(() => fixture.ports.length === 1);
  const terminalPort = fixture.ports[0];

  assert.equal(fixture.connectedHostNames[0], "com.portus.browser.terminal");
  assert.equal(terminalPort.messages[0].type, "terminal.sessions.list");
  terminalPort.emitMessage({
    type: "terminal.sessions",
    requestId: "treq_001",
    payload: { sessions: [], activeTerminalId: null }
  });

  const response = await terminalPromise;
  assert.equal(response.type, "terminal.sessions");
  assert.equal((await bridge.getStatus()).terminalNativeHostState, "connected");
});

test("bridge disconnect leaves terminal native host connected", async () => {
  const fixture = createChromeFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z")
  });

  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length === 1);
  const bridgePort = fixture.ports[0];
  bridgePort.emitMessage(response(bridgePort.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));
  await connectPromise;

  const terminalPromise = bridge.sendTerminalClientMessage({
    type: "terminal.sessions.list",
    requestId: "treq_002",
    payload: {}
  });
  await waitFor(() => fixture.ports.length === 2);
  const terminalPort = fixture.ports[1];
  terminalPort.emitMessage({
    type: "terminal.sessions",
    requestId: "treq_002",
    payload: { sessions: [], activeTerminalId: null }
  });
  await terminalPromise;

  const disconnectPromise = bridge.disconnectBridge();
  await waitFor(() => bridgePort.messages.some((message) => message.type === "bridge.disconnect"));
  const disconnectRequest = bridgePort.messages.find((message) => message.type === "bridge.disconnect");
  bridgePort.emitMessage(response(disconnectRequest.requestId, { disconnected: true }));
  const status = await disconnectPromise;

  assert.equal(status.bridgeState, "disconnected");
  assert.equal(bridgePort.disconnected, true);
  assert.equal(terminalPort.disconnected, false);
  assert.equal((await bridge.getStatus()).terminalNativeHostState, "connected");
  assert.deepEqual(fixture.connectedHostNames, ["com.portus.browser", "com.portus.browser.terminal"]);
});


test("stores terminal preferences in active profile state without bridge settings", async () => {
  const fixture = createChromeFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z")
  });

  const settings = {
    enabled: false,
    defaultProfileId: "powershell",
    manualTerminalPath: null,
    startupCommand: "codex",
    defaultWorkingDirectory: "Downloads/portus-session",
    fontSize: 16,
    maxSessions: 5,
    idleTimeoutMs: 1800000
  };

  const result = await bridge.handleRuntimeMessage({ type: "portus.terminal.settings.set", settings });

  assert.deepEqual(result.terminal, settings);
  assert.deepEqual((await bridge.getStatus()).settingsProfiles.content.terminalPreferences, settings);
  assert.equal(fixture.storage["portus.terminalPreferences"], undefined);
  assert.equal(fixture.storage["portus.bridgePreference"], undefined);
  assert.equal((await bridge.getStatus()).terminalPreferences.startupCommand, "codex");
});

test("disabling terminal kills terminal transport without touching bridge", async () => {
  const fixture = createChromeFixture();
  const timers = createTimerFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z"),
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  });

  const connectPromise = bridge.connectBridge();
  await waitFor(() => fixture.ports.length === 1);
  const bridgePort = fixture.ports[0];
  bridgePort.emitMessage(response(bridgePort.messages[0].requestId, {
    browserId: "br_000001",
    heartbeatIntervalMs: 5000
  }));
  await connectPromise;

  const terminalPromise = bridge.sendTerminalClientMessage({ type: "terminal.sessions.list", requestId: "treq_disable", payload: {} });
  await waitFor(() => fixture.ports.length === 2);
  const terminalPort = fixture.ports[1];
  terminalPort.emitMessage({ type: "terminal.sessions", requestId: "treq_disable", payload: { sessions: [], activeTerminalId: null } });
  await terminalPromise;

  const settings = {
    enabled: false,
    defaultProfileId: "powershell",
    manualTerminalPath: null,
    startupCommand: null,
    defaultWorkingDirectory: "Downloads/portus-session",
    fontSize: 16,
    maxSessions: 5,
    idleTimeoutMs: 1800000
  };
  const disablePromise = bridge.handleRuntimeMessage({ type: "portus.terminal.settings.set", settings });
  await waitFor(() => terminalPort.messages.some((message) => message.type === "terminal.settings.set"));
  const settingsRequest = terminalPort.messages.find((message) => message.type === "terminal.settings.set");
  terminalPort.emitMessage({ type: "terminal.settings", requestId: settingsRequest.requestId, payload: { settings } });
  const result = await disablePromise;

  assert.deepEqual(result.terminal, settings);
  assert.equal(terminalPort.disconnected, true);
  assert.equal(bridgePort.disconnected, false);
  assert.equal((await bridge.getStatus()).bridgeState, "connected");
  assert.equal((await bridge.getStatus()).terminalNativeHostState, "disconnected");
});

function createChromeFixture(overrides = {}) {
  const ports = [];
  const connectedHostNames = [];
  const permissionRequests = [];
  const permissionRemovals = [];
  const capturedWindows = [];
  const actions = [];
  const actionTitles = [];
  const actionBadgeTexts = [];
  const actionBadgeColors = [];
  const sidePanelBehaviors = [];
  const sidePanelOpens = [];
  const sidePanelCloses = [];
  const debuggerAttaches = [];
  const debuggerDetaches = [];
  const debuggerCommands = [];
  const tabEvents = {
    onCreated: createEvent(),
    onUpdated: createEvent(),
    onActivated: createEvent(),
    onRemoved: createEvent()
  };
  const storage = { ...(overrides.storage ?? {}) };
  const fixture = {
    ports,
    connectedHostNames,
    permissionRequests,
    permissionRemovals,
    capturedWindows,
    actions,
    actionTitles,
    actionBadgeTexts,
    actionBadgeColors,
    sidePanelBehaviors,
    sidePanelOpens,
    sidePanelCloses,
    debuggerAttaches,
    debuggerDetaches,
    debuggerCommands,
    storage,
    closedTabId: null,
    windowFocused: null,
    chrome: {
      runtime: {
        id: "extension-test-id",
        connectNative: overrides.connectNative ?? ((hostName) => {
          connectedHostNames.push(hostName);
          const port = createMockNativePort();
          ports.push(port);
          return port;
        }),
        onConnect: createEvent(),
        onMessage: createEvent()
      },
      tabs: {
        query(queryInfo) {
          if (overrides.queryTabs) return overrides.queryTabs(queryInfo);
          return Promise.resolve([
            chromeTab(1, "https://example.com/a", true),
            chromeTab(2, "https://example.com/b", false)
          ]);
        },
        get(tabId) {
          if (overrides.getTab) return overrides.getTab(tabId);
          return Promise.resolve(chromeTab(tabId, `https://example.com/${tabId}`, tabId === 1));
        },
        create(properties) {
          return Promise.resolve(chromeTab(3, properties.url, properties.active ?? true));
        },
        update(tabId, properties) {
          return Promise.resolve(chromeTab(tabId, properties.url ?? `https://example.com/${tabId}`, properties.active ?? false));
        },
        remove(tabId) {
          fixture.closedTabId = tabId;
          return Promise.resolve();
        },
        captureVisibleTab(windowId) {
          if (overrides.captureVisibleTab) return overrides.captureVisibleTab(windowId);
          capturedWindows.push(windowId);
          return Promise.resolve("data:image/png;base64,abc");
        },
        ...tabEvents
      },
      scripting: {
        executeScript(injection) {
          if (overrides.executeScript) return overrides.executeScript(injection, actions);
          if (Array.isArray(injection.args) && injection.args.length > 0) {
            actions.push(injection.args[0]);
            return Promise.resolve([{ result: { ok: true, details: { action: injection.args[0].action } } }]);
          }
          return defaultSnapshotScriptResult();
        }
      },
      windows: {
        getAll() {
          return Promise.resolve([{ id: 11, focused: true, state: "normal", type: "normal", incognito: false }]);
        },
        update(windowId) {
          fixture.windowFocused = windowId;
          return Promise.resolve({ id: windowId, focused: true });
        }
      },
      permissions: {
        contains() {
          return Promise.resolve(overrides.permissionContains ?? true);
        },
        request(permissions) {
          permissionRequests.push(...(permissions.origins ?? []));
          return Promise.resolve(true);
        },
        remove(permissions) {
          permissionRemovals.push(...(permissions.origins ?? []));
          return Promise.resolve(true);
        }
      },
      storage: {
        local: {
          get(key) {
            return Promise.resolve({ [key]: storage[key] });
          },
          set(items) {
            Object.assign(storage, items);
            return Promise.resolve();
          }
        }
      },
      action: {
        setTitle(details) {
          actionTitles.push(details.title);
          return Promise.resolve();
        },
        setBadgeText(details) {
          actionBadgeTexts.push(details.text);
          return Promise.resolve();
        },
        setBadgeBackgroundColor(details) {
          actionBadgeColors.push(details.color);
          return Promise.resolve();
        }
      },
      sidePanel: {
        open(options) {
          sidePanelOpens.push(options);
          return Promise.resolve();
        },
        close(options) {
          sidePanelCloses.push(options);
          return Promise.resolve();
        },
        setPanelBehavior(options) {
          sidePanelBehaviors.push(options);
          return Promise.resolve();
        },
        onOpened: createEvent(),
        onClosed: createEvent()
      },
      debugger: overrides.debugger === false ? undefined : {
        attach(target, version) {
          debuggerAttaches.push({ target, version });
          if (overrides.attachDebugger) return overrides.attachDebugger(target, version);
          return Promise.resolve();
        },
        detach(target) {
          debuggerDetaches.push({ target });
          if (overrides.detachDebugger) return overrides.detachDebugger(target);
          return Promise.resolve();
        },
        sendCommand(target, method, params) {
          debuggerCommands.push({ target, method, params });
          if (overrides.sendDebuggerCommand) return overrides.sendDebuggerCommand(target, method, params);
          return Promise.resolve({});
        }
      }
    }
  };
  fixture.tabEvents = tabEvents;
  return fixture;
}

function defaultSnapshotScriptResult() {
  return Promise.resolve([{
    result: {
      url: "https://example.com/1",
      title: "Example",
      viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
      visibleText: "Submit Name",
      elements: [
        {
          role: "button",
          label: "Submit",
          text: "Submit",
          bounds: { x: 10, y: 20, width: 100, height: 40 },
          state: {},
          selectorHint: "button:nth-of-type(1)",
          tagName: "button"
        }
      ]
    }
  }]);
}

function createConnectedBridge(fixture) {
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    now: () => new Date("2026-04-28T00:00:00.000Z"),
    setInterval: () => 0,
    clearInterval: () => undefined
  });
  bridge.browserId = "br_000001";
  bridge.bridgeState = "connected";
  bridge.nativeHostState = "connected";
  bridge.brokerState = "connected";
  return bridge;
}

function chromeTab(id, url, active) {
  return {
    id,
    windowId: 11,
    index: id - 1,
    active,
    pinned: false,
    discarded: false,
    title: `Tab ${id}`,
    url,
    status: "complete"
  };
}

function createMockNativePort() {
  return {
    messages: [],
    disconnected: false,
    onMessage: createEvent(),
    onDisconnect: createEvent(),
    postMessage(message) {
      this.messages.push(message);
    },
    disconnect() {
      this.disconnected = true;
      this.onDisconnect.emit();
    },
    emitMessage(message) {
      this.onMessage.emit(message);
    }
  };
}

function createNativeMessagingPort(input, output) {
  const port = createMockNativePort();
  port.postMessage = (message) => {
    port.messages.push(message);
    input.write(encodeNativeMessage(message));
  };
  let buffer = Buffer.alloc(0);
  output.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    let read = tryReadNativeMessageFrame(buffer);
    while (read) {
      buffer = read.remaining;
      port.emitMessage(read.payload);
      read = tryReadNativeMessageFrame(buffer);
    }
  });
  return port;
}

function createEvent() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    emit(...args) {
      for (const listener of listeners) listener(...args);
    }
  };
}

function createTimerFixture() {
  const callbacks = [];
  return {
    callbacks,
    setInterval(callback) {
      callbacks.push(callback);
      return callback;
    },
    clearInterval(callback) {
      const index = callbacks.indexOf(callback);
      if (index >= 0) callbacks.splice(index, 1);
    }
  };
}

function createTimeoutFixture() {
  const callbacks = [];
  return {
    callbacks,
    setTimeout(callback) {
      callbacks.push(callback);
      return callback;
    },
    clearTimeout(callback) {
      const index = callbacks.indexOf(callback);
      if (index >= 0) callbacks.splice(index, 1);
    }
  };
}

function brokerRequest(socket, message) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    socket.setEncoding("utf8");
    const onData = (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) return;
      socket.off("data", onData);
      socket.off("error", reject);
      resolve(deserializeTransportFrame(buffer.slice(0, newlineIndex)));
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.write(serializeTransportFrame(message));
  });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(predicate());
}
