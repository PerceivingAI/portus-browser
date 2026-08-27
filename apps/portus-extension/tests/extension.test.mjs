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
import { capturePortusSnapshotPayload, createPortusExtensionBridge, detectBrowserName, evaluatePortusPageWait, performPortusDomAction } from "../dist/index.js";
import { installPortusComposedDomRuntime } from "../dist/composed-dom.js";
import { JSDOM } from "jsdom";

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
  assert.equal("optional_host_permissions" in manifest, false);
  assert.equal(manifest.permissions.includes("activeTab"), false);
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
  assert.match(popupSource, /Current URL/);
  assert.match(sidepanelSource, /NativeRadioGroupField/);
  assert.match(sidepanelSource, /TooltipProvider/);
  assert.match(sidepanelSource, /TooltipTrigger/);
  assert.match(sidepanelSource, /Open Settings/);
  assert.match(sidepanelSource, /Open Terminal/);
  assert.match(sidepanelSource, /Rename/);
  assert.match(sidepanelSource, /Delete/);
  assert.doesNotMatch(popupSource, /Rename/);
  assert.doesNotMatch(popupSource, /Delete Profile/);
  assert.match(sidepanelSource, /Enable Policy/);
  assert.match(sidepanelSource, /Clear Rules/);
  assert.match(sidepanelSource, /TabsList/);
  assert.doesNotMatch(sidepanelSource, /<h1[^>]*>Portus Browser<\/h1>/);
  assert.match(sidepanelSource, /Default View/);
  assert.match(sidepanelSource, /Extension Icon/);
  assert.match(sidepanelSource, /CLI Commands/);
  assert.match(sidepanelSource, /Import \/ Export/);
  assert.match(sidepanelSource, /Terminal/);
  assert.match(sidepanelSource, /Enable Terminal/);
  assert.match(sidepanelSource, /Default Terminal/);
  assert.match(sidepanelSource, /navigationRuleKey/);
  assert.match(sidepanelSource, /<FieldLabel htmlFor="navigation-rule-match">Match<\/FieldLabel>/);
  assert.match(sidepanelSource, /<FieldLabel htmlFor="navigation-rule-value">Value<\/FieldLabel>/);
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
  assert.deepEqual(port.messages[0].payload.capabilities, ["tabs", "windows", "screenshots", "snapshots", "actions", "advanced-debugger", "policy", "events"]);
  assert.deepEqual(port.messages[0].payload.policyPreferences, {
    navigationPolicyEnabled: true,
    policyMode: "blocklist",
    allowedNavigationRules: [],
    blockedNavigationRules: [],
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
    protocolVersion: "2",
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

test("snapshot lifecycle invalidates on top-level loading but preserves same-document updates", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);

  const first = await bridge.captureSnapshot(1);
  assert.equal(bridge.snapshots.get(first.snapshotId).mainDocumentId, first.elements[0].documentId);
  fixture.tabEvents.onUpdated.emit(1, { url: "https://example.com/spa" }, chromeTab(1, "https://example.com/spa", true));
  const firstAction = await bridge.performAction("click", {
    tabId: 1,
    snapshotId: first.snapshotId,
    elementId: first.elements[0].elementId
  });
  assert.equal(firstAction.backend, "content-script-dom");

  const second = await bridge.captureSnapshot(1);
  fixture.tabEvents.onUpdated.emit(1, { status: "complete" }, chromeTab(1, "https://example.com/1", true));
  const secondAction = await bridge.performAction("click", {
    tabId: 1,
    snapshotId: second.snapshotId,
    elementId: second.elements[0].elementId
  });
  assert.equal(secondAction.backend, "content-script-dom");

  await bridge.setAdvancedBackendEnabled(true, false);
  const third = await bridge.captureSnapshot(1);
  const debuggerCommandCount = fixture.debuggerCommands.length;
  fixture.tabEvents.onUpdated.emit(1, { status: "loading" }, chromeTab(1, "https://example.com/new", true));

  await assert.rejects(() => bridge.performAction("click", {
    tabId: 1,
    snapshotId: third.snapshotId,
    elementId: third.elements[0].elementId
  }), { code: "SNAPSHOT_STALE" });

  assert.equal(bridge.snapshots.get(third.snapshotId).stale, true);
  assert.equal(fixture.debuggerCommands.length, debuggerCommandCount);
});

test("closing a tab removes its structural and pierced snapshot state", async () => {
  const fixture = createPiercedCoreActionFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1, { query: "secret input" });

  assert.equal(bridge.snapshots.has(snapshot.snapshotId), true);
  assert.equal(bridge.debuggerSnapshotTargets.has(snapshot.snapshotId), true);

  fixture.tabEvents.onRemoved.emit(1, { windowId: 11, isWindowClosing: false });

  assert.equal(bridge.snapshots.has(snapshot.snapshotId), false);
  assert.equal(bridge.debuggerSnapshotTargets.has(snapshot.snapshotId), false);
  await assert.rejects(() => bridge.performAction("type", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId,
    text: "Ada"
  }), { code: "SNAPSHOT_STALE" });
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
  assert.equal(port.messages.at(-1).result.tab.url, "https://example.com/");

  port.emitMessage(request("req_103", "tab.navigate", { tabId: 2, url: "https://docs.example.com" }));
  await waitFor(() => port.messages.at(-1)?.requestId === "req_103");
  assert.equal(port.messages.at(-1).result.tab.url, "https://docs.example.com/");

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

test("status exposes policy without a separate Chrome permission state", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);

  const status = await bridge.getStatus();

  assert.equal(status.bridgeState, "connected");
  assert.equal(status.activeTabUrl, "https://example.com/a");
  assert.equal(status.policyPreferences.policyMode, "blocklist");
  assert.equal("permissionState" in status, false);
  assert.equal("allowlist" in status, false);
  assert.equal("permissions" in fixture.chrome, false);
});

test("rejects removed permission runtime messages", async () => {
  const bridge = createConnectedBridge(createChromeFixture());

  await assert.rejects(() => bridge.handleRuntimeMessage({
    type: "portus.permission.request",
    origin: "https://example.com"
  }), { code: "INVALID_MESSAGE" });
  await assert.rejects(() => bridge.handleRuntimeMessage({
    type: "portus.permission.revoke",
    origin: "https://example.com"
  }), { code: "INVALID_MESSAGE" });
});

test("runtime navigation rule mutations include refreshed status for side panel controls", async () => {
  const fixture = createChromeFixture({
    queryTabs() {
      return Promise.resolve([chromeTab(1, "https://www.google.com/search?q=portus", true)]);
    }
  });
  const bridge = createConnectedBridge(fixture);

  const result = await bridge.handleRuntimeMessage({
    type: "portus.policy.allow.add",
    match: "authority",
    value: "https://www.google.com",
    reason: "manual test"
  });

  assert.equal(result.policy.allowedNavigationRules[0].value, "https://www.google.com");
  assert.equal(result.status.activeTabUrl, "https://www.google.com/search?q=portus");
  assert.equal(result.status.policyPreferences.allowedNavigationRules[0].value, "https://www.google.com");
});


test("persists policy preferences and routes policy commands", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("policy.block.add", true, false);

  const blocked = await bridge.dispatchNativeRequest(request("req_policy_block", "policy.block.add", {
    match: "scheme",
    value: "file:",
    reason: "manual test"
  }));
  assert.equal(blocked.policy.blockedNavigationRules[0].value, "file:");
  assert.equal(blocked.policy.blockedNavigationRules[0].source, "cli");
  assert.equal(fixture.storage["portus.policyPreferences"].blockedNavigationRules.length, 1);

  const retention = await bridge.handleRuntimeMessage({
    type: "portus.policy.retention.set",
    limit: 25
  });
  assert.equal(retention.policy.sessionStepRetentionLimit, 25);

  const listed = await bridge.dispatchNativeRequest(request("req_policy_get", "policy.get"));
  assert.equal(listed.policy.blockedNavigationRules[0].value, "file:");
  assert.equal(listed.policy.sessionStepRetentionLimit, 25);
});

test("blocks native commands disabled by user policy before browser work", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("screenshot.capture", false, false);

  await assert.rejects(() => bridge.dispatchNativeRequest(request("req_screenshot", "screenshot.capture", {
    tabId: 1
  })), { code: "COMMAND_DISABLED_BY_POLICY" });
  await assert.rejects(() => bridge.dispatchNativeRequest(request("req_snapshot_screenshot", "snapshot.capture", {
    tabId: 1,
    includeScreenshot: true
  })), { code: "COMMAND_DISABLED_BY_POLICY" });
  assert.deepEqual(fixture.capturedWindows, []);

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
    match: "authority",
    value: "https://example.com",
    reason: "manual block"
  });

  await waitFor(() => port.messages.some((message) => message.type === "policy.sync"));
  const sync = port.messages.find((message) => message.type === "policy.sync");
  assert.equal(sync.payload.browserId, "br_000001");
  assert.equal(sync.payload.policyPreferences.blockedNavigationRules[0].value, "https://example.com");
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
    match: "authority",
    value: "https://local.example",
    reason: "manual block"
  });

  assert.ok(port.messages.some((message) => message.type === "policy.sync"));
  assert.equal(port.messages.some((message) => message.type === "settings.profile.save"), false);
  const status = await bridge.getStatus();
  assert.equal(status.settingsProfiles.dirty, true);
  assert.equal(status.settingsProfiles.content.policyPreferences.blockedNavigationRules[0].value, "https://local.example");
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
  await bridge.addNavigationRule("block", "authority", "https://example.com", "extension");

  await assert.rejects(() => bridge.captureScreenshot(1), {
    code: "NAVIGATION_BLOCKED"
  });
  await assert.rejects(() => bridge.captureSnapshot(1), {
    code: "NAVIGATION_BLOCKED"
  });
  await assert.rejects(() => bridge.performAction("click", {
    tabId: 1,
    elementId: "el_000001"
  }), {
    code: "NAVIGATION_BLOCKED"
  });
});

test("matches wildcard navigation rules across apex and subdomain pages", async () => {
  const fixture = createChromeFixture({
    getTab(tabId) {
      if (tabId === 1) return Promise.resolve(chromeTab(1, "https://tripadvisor.com/Hotels", true));
      return Promise.resolve(chromeTab(2, "https://www.tripadvisor.com/Hotels", false));
    }
  });
  const bridge = createConnectedBridge(fixture);
  await bridge.addNavigationRule("block", "host-wildcard", "*.tripadvisor.com", "extension");

  await assert.rejects(() => bridge.captureScreenshot(1), {
    code: "NAVIGATION_BLOCKED"
  });
  await assert.rejects(() => bridge.captureScreenshot(2), {
    code: "NAVIGATION_BLOCKED"
  });

  const status = await bridge.getStatus();
  assert.equal(status.policyPreferences.blockedNavigationRules[0].value, "*.tripadvisor.com");
});

test("matches wildcard navigation rules in allowlist mode", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.addNavigationRule("allow", "host-wildcard", "https://*.tripadvisor.com", "extension");
  await bridge.setPolicyMode("allowlist");

  const allowed = await bridge.openTab("https://www.tripadvisor.com/Hotels");
  assert.equal(allowed.url, "https://www.tripadvisor.com/Hotels");
  await assert.rejects(() => bridge.openTab("https://www.example.com/"), {
    code: "NAVIGATION_BLOCKED"
  });
});

test("allows a browser-supported non-web URL when a user scheme rule permits it", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.addNavigationRule("allow", "scheme", "file:", "extension");
  await bridge.setPolicyMode("allowlist");

  const allowed = await bridge.openTab("file:///C:/Projects/example.txt");
  assert.equal(allowed.url, "file:///C:/Projects/example.txt");
});

test("enforces only the active navigation policy list without deleting inactive rules", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.addNavigationRule("block", "authority", "https://blocked.example", "extension");
  await bridge.addNavigationRule("allow", "authority", "https://allowed.example", "extension");
  await bridge.setPolicyMode("allowlist");

  await assert.rejects(() => bridge.openTab("https://example.com/a"), {
    code: "NAVIGATION_BLOCKED"
  });

  const status = await bridge.getStatus();
  assert.equal(status.policyPreferences.policyMode, "allowlist");
  assert.equal(status.policyPreferences.allowedNavigationRules[0].value, "https://allowed.example");
  assert.equal(status.policyPreferences.blockedNavigationRules[0].value, "https://blocked.example");

  const allowedDespiteInactiveBlock = await bridge.openTab("https://allowed.example/a");
  assert.equal(allowedDespiteInactiveBlock.url, "https://allowed.example/a");

  await bridge.addNavigationRule("allow", "authority", "https://blocked.example", "extension");
  const inactiveBlockIgnored = await bridge.openTab("https://blocked.example/a");
  assert.equal(inactiveBlockIgnored.url, "https://blocked.example/a");

  await bridge.setPolicyMode("blocklist");
  await assert.rejects(() => bridge.openTab("https://blocked.example/a"), {
    code: "NAVIGATION_BLOCKED"
  });
});

test("can disable navigation policy without deleting rules or disabling command policy", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.addNavigationRule("block", "authority", "https://blocked.example", "extension");

  await assert.rejects(() => bridge.openTab("https://blocked.example/a"), {
    code: "NAVIGATION_BLOCKED"
  });

  const disabled = await bridge.handleRuntimeMessage({ type: "portus.policy.enabled.set", enabled: false });
  assert.equal(disabled.policy.navigationPolicyEnabled, false);
  assert.equal(disabled.policy.blockedNavigationRules[0].value, "https://blocked.example");

  const opened = await bridge.openTab("https://blocked.example/a");
  assert.equal(opened.url, "https://blocked.example/a");

  await bridge.setCommandPolicyEnabled("tab.open", false);
  await assert.rejects(() => bridge.dispatchNativeRequest(request("req_tab_open_disabled", "tab.open", {
    url: "https://another.example/a"
  })), {
    code: "COMMAND_DISABLED_BY_POLICY"
  });
});

test("clears only the requested navigation policy rule list", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.addNavigationRule("allow", "authority", "https://allowed.example", "extension");
  await bridge.addNavigationRule("block", "authority", "https://blocked.example", "extension");
  await bridge.setPolicyMode("allowlist");

  const clearedAllow = await bridge.handleRuntimeMessage({ type: "portus.policy.allow.clear" });
  assert.equal(clearedAllow.policy.policyMode, "allowlist");
  assert.equal(clearedAllow.policy.allowedNavigationRules.length, 0);
  assert.equal(clearedAllow.policy.blockedNavigationRules[0].value, "https://blocked.example");

  await bridge.setPolicyMode("blocklist");
  const clearedBlock = await bridge.handleRuntimeMessage({ type: "portus.policy.block.clear" });
  assert.equal(clearedBlock.policy.policyMode, "blocklist");
  assert.equal(clearedBlock.policy.allowedNavigationRules.length, 0);
  assert.equal(clearedBlock.policy.blockedNavigationRules.length, 0);
});

test("migrates legacy terminal profile ids from extension local storage", async () => {
  const fixture = createChromeFixture({
    storage: {
      "portus.terminalPreferences": terminalSettingsFixture({
        defaultProfileId: "PowerShell 7",
        fontSize: 19,
        startupCommand: "codex"
      })
    }
  });
  const bridge = createPortusExtensionBridge(fixture.chrome);

  const status = await bridge.getStatus();

  assert.equal(status.terminalPreferences.defaultProfileId, "auto");
  assert.equal(status.terminalPreferences.fontSize, 19);
  assert.equal(status.terminalPreferences.startupCommand, "codex");
  assert.equal(fixture.storage["portus.terminalPreferences"].defaultProfileId, "auto");
  assert.equal(fixture.storage["portus.terminalPreferences"].fontSize, 19);
});

test("migrates legacy origin preferences from extension local storage", async () => {
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

  assert.equal(status.policyPreferences.allowedNavigationRules[0].value, "https://example.com");
  assert.equal(status.policyPreferences.sessionStepRetentionLimit, 15);
  assert.equal(fixture.storage["portus.policyPreferences"].allowedNavigationRules[0].match, "authority");
  assert.equal(fixture.storage["portus.policyPreferences"].allowedNavigationRules[0].value, "https://example.com");
  assert.equal("allowedOrigins" in fixture.storage["portus.policyPreferences"], false);
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

test("migrates legacy invalid terminal profile ids in direct settings imports", async () => {
  const fixture = createChromeFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome);
  const imported = await bridge.handleRuntimeMessage({
    type: "portus.settings.import",
    terminalPreferences: terminalSettingsFixture({
      defaultProfileId: "PowerShell 7",
      fontSize: 18,
      startupCommand: "codex"
    })
  });

  assert.equal(imported.terminal.defaultProfileId, "auto");
  assert.equal(imported.terminal.fontSize, 18);
  assert.equal(imported.terminal.startupCommand, "codex");
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

test("captures inactive-tab screenshots without focusing the window and restores the previous tab", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);

  const screenshot = await bridge.captureScreenshot(2);

  assert.equal(screenshot.browserId, "br_000001");
  assert.equal(screenshot.tabId, 2);
  assert.equal(screenshot.activatedTabBeforeCapture, true);
  assert.equal(screenshot.previousActiveTabId, 1);
  assert.equal(screenshot.restoredPreviousActiveTab, true);
  assert.equal(fixture.windowFocused, null);
  assert.equal(fixture.activeTabId(), 1);
  assert.deepEqual(fixture.tabUpdates, [
    { tabId: 2, properties: { active: true } },
    { tabId: 1, properties: { active: true } }
  ]);
  assert.deepEqual(fixture.capturedWindows, [11]);
});

test("restores the previous active tab when normal screenshot capture fails", async () => {
  const fixture = createChromeFixture({
    captureVisibleTab() {
      return Promise.reject(new Error("capture failed"));
    }
  });
  const bridge = createConnectedBridge(fixture);

  await assert.rejects(() => bridge.captureScreenshot(2));

  assert.equal(fixture.activeTabId(), 1);
  assert.equal(fixture.windowFocused, null);
  assert.deepEqual(fixture.tabUpdates, [
    { tabId: 2, properties: { active: true } },
    { tabId: 1, properties: { active: true } }
  ]);
});

test("does not overwrite a newer user tab selection while restoring screenshot state", async () => {
  let activeTabId = 1;
  const fixture = createChromeFixture({
    queryTabs(queryInfo) {
      const tabs = [1, 2, 3].map((id) => chromeTab(id, `https://example.com/${id}`, activeTabId === id));
      return Promise.resolve(queryInfo.active === true ? tabs.filter((tab) => tab.active) : tabs);
    },
    getTab(tabId) {
      return Promise.resolve(chromeTab(tabId, `https://example.com/${tabId}`, activeTabId === tabId));
    },
    updateTab(tabId, properties) {
      if (properties.active === true) activeTabId = tabId;
      return Promise.resolve(chromeTab(tabId, `https://example.com/${tabId}`, activeTabId === tabId));
    },
    captureVisibleTab() {
      activeTabId = 3;
      return Promise.resolve("data:image/png;base64,user-race");
    }
  });
  const bridge = createConnectedBridge(fixture);

  const screenshot = await bridge.captureScreenshot(2);

  assert.equal(screenshot.restoredPreviousActiveTab, false);
  assert.equal(activeTabId, 3);
  assert.deepEqual(fixture.tabUpdates, [{ tabId: 2, properties: { active: true } }]);
  assert.equal(fixture.windowFocused, null);
});

test("honors explicit debugger screenshots without the automatic backend preference", async () => {
  const fixture = createChromeFixture({
    sendDebuggerCommand(_target, method) {
      if (method === "Page.captureScreenshot") return Promise.resolve({ data: "debugger-image" });
      return Promise.resolve({});
    }
  });
  const bridge = createConnectedBridge(fixture);

  const screenshot = await bridge.captureScreenshot(1, true);

  assert.equal(screenshot.data, "data:image/png;base64,debugger-image");
  assert.equal(screenshot.activatedTabBeforeCapture, false);
  assert.deepEqual(fixture.tabUpdates, []);
  assert.equal(fixture.windowFocused, null);
  assert.deepEqual(fixture.capturedWindows, []);
  assert.deepEqual(fixture.debuggerCommands.map((command) => command.method), ["Page.captureScreenshot"]);
  assert.deepEqual(fixture.debuggerAttaches, [{ target: { tabId: 1 }, version: "1.3" }]);
  assert.deepEqual(fixture.debuggerDetaches, [{ target: { tabId: 1 } }]);
});

test("captures snapshots with actionable elements", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);

  const snapshot = await bridge.captureSnapshot(1);

  assert.equal(snapshot.snapshotId, "snap_000001");
  assert.equal(snapshot.visibleText, "Submit Name");
  assert.deepEqual(fixture.scriptInjections[0].files, ["dist/composed-dom-runtime.js"]);
  assert.equal(fixture.scriptInjections[0].target.allFrames, true);
  assert.equal(typeof fixture.scriptInjections[1].func, "function");
  assert.equal(fixture.scriptInjections[1].target.allFrames, true);
  assert.equal(snapshot.elements[0].elementId, "el_000001");
  assert.equal(snapshot.elements[0].selectorHint, "button:nth-of-type(1)");
});

test("structural snapshots do not capture images or mutate tab/window state", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);

  const snapshot = await bridge.captureSnapshot(2);

  assert.equal("screenshot" in snapshot, false);
  assert.deepEqual(fixture.capturedWindows, []);
  assert.deepEqual(fixture.tabUpdates, []);
  assert.equal(fixture.windowFocused, null);
  assert.equal(fixture.activeTabId(), 1);
});

test("snapshots include screenshots only when explicitly requested", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);

  const snapshot = await bridge.captureSnapshot(2, undefined, { includeScreenshot: true });

  assert.equal(snapshot.screenshot?.tabId, 2);
  assert.equal(snapshot.screenshot?.restoredPreviousActiveTab, true);
  assert.deepEqual(fixture.capturedWindows, [11]);
  assert.equal(fixture.activeTabId(), 1);
  assert.equal(fixture.windowFocused, null);
});

test("snapshot screenshot failures surface instead of fabricating a placeholder image", async () => {
  const fixture = createChromeFixture({
    captureVisibleTab() {
      return Promise.reject(new Error("capture unavailable"));
    }
  });
  const bridge = createConnectedBridge(fixture);

  await assert.rejects(() => bridge.captureSnapshot(2, undefined, { includeScreenshot: true }));

  assert.equal(fixture.activeTabId(), 1);
  assert.deepEqual(fixture.scriptInjections, []);
});

test("snapshot debugger mode requires and captures an explicit screenshot without activation", async () => {
  const fixture = createChromeFixture({
    sendDebuggerCommand(_target, method) {
      if (method === "Page.captureScreenshot") return Promise.resolve({ data: "snapshot-debugger-image" });
      return Promise.resolve({});
    }
  });
  const bridge = createConnectedBridge(fixture);

  await assert.rejects(
    () => bridge.captureSnapshot(2, undefined, { useDebugger: true }),
    { code: "INVALID_MESSAGE" }
  );

  const snapshot = await bridge.captureSnapshot(2, undefined, { includeScreenshot: true, useDebugger: true });
  assert.equal(snapshot.screenshot?.data, "data:image/png;base64,snapshot-debugger-image");
  assert.deepEqual(fixture.tabUpdates, []);
  assert.equal(fixture.windowFocused, null);
  assert.deepEqual(fixture.capturedWindows, []);
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
      if (isActionInjection(injection)) {
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
              shadowPath: [
                { hostSelectorHint: "app-shell:nth-of-type(1)", rootType: "open" }
              ],
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
  assert.deepEqual(snapshot.elements[0].shadowPath, [
    { hostSelectorHint: "app-shell:nth-of-type(1)", rootType: "open" }
  ]);


  const action = await bridge.performAction("click", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  });

  assert.deepEqual(fixture.actions[0].target.shadowPath, [
    { hostSelectorHint: "app-shell:nth-of-type(1)", rootType: "open" }
  ]);
  assert.equal(action.backend, "content-script-dom");
  assert.equal(fixture.actions[0].target.elementId, "el_000001");
});

test("captures iframe elements and routes actions to the originating document", async () => {
  const fixture = createChromeFixture({
    executeScript(injection, actions) {
      if (isActionInjection(injection)) {
        actions.push(injection.args[0]);
        assert.deepEqual(injection.target.documentIds, ["doc_child"]);
        return Promise.resolve([{
          frameId: 7,
          documentId: "doc_child",
          result: { ok: true, details: { action: "click", targetValidated: true } }
        }]);
      }
      return Promise.resolve([
        {
          frameId: 0,
          documentId: "doc_main",
          result: {
            url: "https://example.com/",
            title: "Main",
            viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
            visibleText: "Main frame",
            candidateCount: 0,
            matchedElementCount: 0,
            truncated: false,
            elements: []
          }
        },
        {
          frameId: 7,
          documentId: "doc_child",
          result: {
            url: "https://child.example.com/",
            title: "Child",
            viewport: { width: 600, height: 400, deviceScaleFactor: 1 },
            visibleText: "Child action",
            candidateCount: 1,
            matchedElementCount: 1,
            truncated: false,
            elements: [{
              role: "button",
              label: "Child action",
              text: "Child action",
              bounds: { x: 20, y: 30, width: 120, height: 40 },
              state: {},
              selectorHint: "#child-action",
              shadowPath: [
                { hostSelectorHint: "#child-shell", rootType: "open" }
              ],
              tagName: "button"
            }]
          }
        }
      ]);
    }
  });
  const bridge = createConnectedBridge(fixture);

  const snapshot = await bridge.captureSnapshot(1);

  assert.equal(fixture.scriptInjections[0].target.allFrames, true);
  assert.equal(snapshot.visibleText, "Main frame\nChild action");
  assert.equal(snapshot.elements.length, 1);
  assert.equal(snapshot.elements[0].frameId, 7);
  assert.equal(snapshot.elements[0].documentId, "doc_child");
  assert.deepEqual(snapshot.elements[0].shadowPath, [
    { hostSelectorHint: "#child-shell", rootType: "open" }
  ]);

  await bridge.performAction("click", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  });

  assert.deepEqual(fixture.scriptInjections.at(-1).target, { tabId: 1, documentIds: ["doc_child"] });
});

test("document-targeted actions fail stale after the captured iframe document disappears", async () => {
  const fixture = createChromeFixture({
    executeScript(injection) {
      if (isActionInjection(injection)) return Promise.reject(new Error("No document with id doc_child"));
      return Promise.resolve([
        {
          frameId: 0,
          documentId: "doc_main",
          result: {
            url: "https://example.com/",
            title: "Main",
            viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
            visibleText: "",
            elements: []
          }
        },
        {
          frameId: 7,
          documentId: "doc_child",
          result: {
            url: "https://child.example.com/",
            title: "Child",
            viewport: { width: 600, height: 400, deviceScaleFactor: 1 },
            visibleText: "Save",
            elements: [{
              role: "button",
              label: "Save",
              text: "Save",
              bounds: { x: 10, y: 10, width: 80, height: 30 },
              state: {},
              tagName: "button"
            }]
          }
        }
      ]);
    }
  });
  const bridge = createConnectedBridge(fixture);
  const snapshot = await bridge.captureSnapshot(1);

  await assert.rejects(() => bridge.performAction("click", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  }), { code: "SNAPSHOT_STALE" });
});

test("page wait preserves Shadow DOM diagnostics inside child frames", async () => {
  const fixture = createChromeFixture({
    executeScript(injection) {
      assert.equal(injection.target.allFrames, true);
      if (Array.isArray(injection.files)) {
        assert.deepEqual(injection.files, ["dist/composed-dom-runtime.js"]);
        return Promise.resolve([
          { frameId: 0, documentId: "doc_main" },
          { frameId: 11, documentId: "doc_wait_child" }
        ]);
      }
      assert.equal(typeof injection.func, "function");
      return Promise.resolve([
        { frameId: 0, documentId: "doc_main", result: { matched: false } },
        {
          frameId: 11,
          documentId: "doc_wait_child",
          result: {
            matched: true,
            details: {
              match: "element",
              label: "Inside frame shadow",
              shadowDepth: 1,
              shadowPath: [{ hostSelectorHint: "#child-shell", rootType: "open" }]
            }
          }
        }
      ]);
    }
  });
  const bridge = createConnectedBridge(fixture);

  const wait = await bridge.waitForPage({ tabId: 1, elementQuery: "Inside frame shadow", timeoutMs: 500 });

  assert.equal(wait.matched, true);
  assert.equal(wait.details.frameId, 11);
  assert.equal(wait.details.documentId, "doc_wait_child");
  assert.equal(wait.details.shadowDepth, 1);
  assert.deepEqual(wait.details.shadowPath, [
    { hostSelectorHint: "#child-shell", rootType: "open" }
  ]);
  assert.deepEqual(fixture.scriptInjections[0].files, ["dist/composed-dom-runtime.js"]);
  assert.equal(typeof fixture.scriptInjections[1].func, "function");
});

test("page wait aggregates inverse element states across every scriptable frame", async () => {
  let frameResults = [
    {
      frameId: 0,
      documentId: "doc_main",
      result: {
        matched: true,
        targetCount: 0,
        applicableCount: 0,
        satisfiedCount: 0,
        details: { match: "element-state", state: "absent", targetCount: 0, applicableCount: 0, satisfiedCount: 0 }
      }
    },
    {
      frameId: 11,
      documentId: "doc_child",
      result: {
        matched: false,
        targetCount: 1,
        applicableCount: 1,
        satisfiedCount: 0,
        details: { match: "element-state", state: "absent", targetCount: 1, applicableCount: 1, satisfiedCount: 0 }
      }
    }
  ];
  const fixture = createChromeFixture({
    executeScript(injection) {
      if (Array.isArray(injection.files)) {
        return Promise.resolve(frameResults.map(({ frameId, documentId }) => ({ frameId, documentId })));
      }
      return Promise.resolve(frameResults);
    }
  });
  const bridge = createConnectedBridge(fixture);

  const presentInChild = await bridge.executePageWaitScript(1, {
    elementQuery: "Loading",
    elementState: "absent"
  });
  assert.equal(presentInChild.matched, false);
  assert.equal(presentInChild.details.targetCount, 1);

  frameResults = frameResults.map((entry) => ({
    ...entry,
    result: {
      matched: true,
      targetCount: 0,
      applicableCount: 0,
      satisfiedCount: 0,
      details: { match: "element-state", state: "absent", targetCount: 0, applicableCount: 0, satisfiedCount: 0 }
    }
  }));
  const absentEverywhere = await bridge.executePageWaitScript(1, {
    elementQuery: "Loading",
    elementState: "absent"
  });
  assert.equal(absentEverywhere.matched, true);
  assert.equal(absentEverywhere.details.targetCount, 0);

  frameResults = [
    {
      frameId: 0,
      documentId: "doc_main",
      result: {
        matched: true,
        targetCount: 1,
        applicableCount: 1,
        satisfiedCount: 1,
        details: { match: "element-state", state: "hidden", targetCount: 1, applicableCount: 1, satisfiedCount: 1 }
      }
    },
    {
      frameId: 11,
      documentId: "doc_child",
      result: {
        matched: false,
        targetCount: 1,
        applicableCount: 1,
        satisfiedCount: 0,
        details: { match: "element-state", state: "hidden", targetCount: 1, applicableCount: 1, satisfiedCount: 0 }
      }
    }
  ];
  const visibleInChild = await bridge.executePageWaitScript(1, {
    elementQuery: "Loading",
    elementState: "hidden"
  });
  assert.equal(visibleInChild.matched, false);
  assert.equal(visibleInChild.details.applicableCount, 2);
  assert.equal(visibleInChild.details.satisfiedCount, 1);
});

test("page wait returns tab metadata from the matched document state", async () => {
  let tabReadCount = 0;
  const fixture = createChromeFixture({
    getTab(tabId) {
      tabReadCount += 1;
      return Promise.resolve({
        ...chromeTab(
          tabId,
          tabReadCount === 1 ? "https://example.com/before" : "https://example.com/after",
          true
        ),
        title: tabReadCount === 1 ? "Before" : "After"
      });
    },
    executeScript(injection) {
      if (Array.isArray(injection.files)) return Promise.resolve([{ frameId: 0, documentId: "doc_main" }]);
      return Promise.resolve([{
        frameId: 0,
        documentId: "doc_main",
        result: { matched: true, details: { match: "text", text: "Ready" } }
      }]);
    }
  });
  const bridge = createConnectedBridge(fixture);

  const wait = await bridge.waitForPage({ tabId: 1, text: "Ready", timeoutMs: 500 });

  assert.equal(wait.url, "https://example.com/after");
  assert.equal(wait.title, "After");
  assert.equal(tabReadCount, 2);
});

test("page wait evaluator matches text and elements inside nested Shadow DOM", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div>Light content</div>
    <app-shell id="app"></app-shell>
  </body></html>`, { url: "https://example.com/" });
  const document = dom.window.document;
  const app = document.querySelector("#app");
  const appRoot = app.attachShadow({ mode: "open" });
  appRoot.innerHTML = `<span>Shadow text marker</span><nested-panel id="nested"></nested-panel>`;
  const nested = appRoot.querySelector("#nested");
  const nestedRoot = nested.attachShadow({ mode: "open" });
  nestedRoot.innerHTML = `<button id="deep-action" aria-label="Deep shadow action">Go</button>`;

  const descriptors = new Map();
  const globals = {
    window: dom.window,
    document,
    ShadowRoot: dom.window.ShadowRoot,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLOptionElement: dom.window.HTMLOptionElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  descriptors.set("__portusComposedDom", Object.getOwnPropertyDescriptor(globalThis, "__portusComposedDom"));
  installPortusComposedDomRuntime(globalThis);
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 100,
    bottom: 24,
    width: 100,
    height: 24,
    toJSON() { return this; }
  });

  try {
    assert.doesNotMatch(document.body.textContent, /Shadow text marker/);

    const textWait = evaluatePortusPageWait({ text: "shadow text marker" });
    assert.equal(textWait.matched, true);
    assert.equal(textWait.details.match, "text");
    assert.equal(textWait.details.shadowDepth, 1);
    assert.deepEqual(shadowPathShape(textWait.details.shadowPath), [
      { hostSelectorHint: "#app", rootType: "open" }
    ]);
    assert.match(textWait.details.shadowPath[0].hostInstanceId, /^sh_\d{6}$/);

    const elementWait = evaluatePortusPageWait({ elementQuery: "deep shadow action", role: "button" });
    assert.equal(elementWait.matched, true);
    assert.equal(elementWait.details.match, "element");
    assert.equal(elementWait.details.label, "Deep shadow action");
    assert.equal(elementWait.details.selectorHint, "#deep-action");
    assert.equal(elementWait.details.shadowDepth, 2);
    assert.deepEqual(shadowPathShape(elementWait.details.shadowPath), [
      { hostSelectorHint: "#app", rootType: "open" },
      { hostSelectorHint: "#nested", rootType: "open" }
    ]);
    assert.equal(elementWait.details.shadowPath[0].hostInstanceId, textWait.details.shadowPath[0].hostInstanceId);
    assert.match(elementWait.details.shadowPath[1].hostInstanceId, /^sh_\d{6}$/);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

test("page wait evaluator reports presence visibility control state selection and exact value", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="submit" aria-label="Submit order" disabled>Submit</button>
    <input id="terms" type="checkbox" aria-label="Terms accepted" checked>
    <select id="country" aria-label="Country"><option value="us" selected>United States</option><option value="ca">Canada</option></select>
    <input id="status" aria-label="Status" value="ready">
    <div id="hidden-spinner" aria-label="Loading results" style="display:none"></div>
    <div id="visible-spinner" aria-label="Loading results"></div>
  </body></html>`, { url: "https://example.com/" });
  const document = dom.window.document;
  const descriptors = new Map();
  const globals = {
    window: dom.window,
    document,
    ShadowRoot: dom.window.ShadowRoot,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLOptionElement: dom.window.HTMLOptionElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  descriptors.set("__portusComposedDom", Object.getOwnPropertyDescriptor(globalThis, "__portusComposedDom"));
  installPortusComposedDomRuntime(globalThis);
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 24, width: 100, height: 24,
    toJSON() { return this; }
  });

  try {
    assert.equal(evaluatePortusPageWait({ elementQuery: "Submit order", elementState: "present" }).matched, true);
    assert.equal(evaluatePortusPageWait({ elementQuery: "Missing control", elementState: "absent" }).matched, true);
    assert.equal(evaluatePortusPageWait({ elementQuery: "Submit order", elementState: "disabled" }).matched, true);
    assert.equal(evaluatePortusPageWait({ elementQuery: "Submit order", elementState: "enabled" }).matched, false);
    document.querySelector("#submit").disabled = false;
    assert.equal(evaluatePortusPageWait({ elementQuery: "Submit order", elementState: "enabled" }).matched, true);

    const mixedVisibility = evaluatePortusPageWait({ elementQuery: "Loading results", elementState: "hidden" });
    assert.equal(mixedVisibility.matched, false);
    assert.equal(mixedVisibility.targetCount, 2);
    document.querySelector("#visible-spinner").style.display = "none";
    assert.equal(evaluatePortusPageWait({ elementQuery: "Loading results", elementState: "hidden" }).matched, true);

    assert.equal(evaluatePortusPageWait({ role: "checkbox", elementState: "checked" }).matched, true);
    document.querySelector("#terms").checked = false;
    assert.equal(evaluatePortusPageWait({ role: "checkbox", elementState: "unchecked" }).matched, true);
    assert.equal(evaluatePortusPageWait({ elementQuery: "United States", role: "option", elementState: "selected" }).matched, true);
    document.querySelectorAll("#country option")[1].selected = true;
    assert.equal(evaluatePortusPageWait({ elementQuery: "United States", role: "option", elementState: "unselected" }).matched, true);

    assert.equal(evaluatePortusPageWait({ elementQuery: "Status", value: "ready" }).matched, true);
    assert.equal(evaluatePortusPageWait({ elementQuery: "Status", value: "pending" }).matched, false);
    assert.equal(evaluatePortusPageWait({ role: "textbox" }).matched, true);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

test("partial fill-form spans frame documents while atomic mode rejects cross-document fills", async () => {
  const fixture = createChromeFixture({
    executeScript(injection, actions) {
      if (isActionInjection(injection)) {
        const payload = injection.args[0];
        actions.push({ target: injection.target, payload });
        const documentId = injection.target.documentIds[0];
        const frameId = documentId === "doc_main" ? 0 : 5;
        return Promise.resolve([{
          frameId,
          documentId,
          result: {
            ok: true,
            details: {
              action: "fillForm",
              partial: true,
              fields: payload.fields.map((field) => ({ elementId: field.elementId, ok: true }))
            }
          }
        }]);
      }
      return Promise.resolve([
        {
          frameId: 0,
          documentId: "doc_main",
          result: {
            url: "https://example.com/",
            title: "Main form",
            viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
            visibleText: "First name",
            elements: [{
              role: "textbox",
              label: "First name",
              text: "",
              bounds: { x: 10, y: 20, width: 180, height: 32 },
              state: { value: "" },
              tagName: "input",
              editable: true,
              inputType: "text",
              name: "firstName"
            }]
          }
        },
        {
          frameId: 5,
          documentId: "doc_child",
          result: {
            url: "https://child.example.com/form",
            title: "Child form",
            viewport: { width: 600, height: 400, deviceScaleFactor: 1 },
            visibleText: "Last name",
            elements: [{
              role: "textbox",
              label: "Last name",
              text: "",
              bounds: { x: 10, y: 20, width: 180, height: 32 },
              state: { value: "" },
              tagName: "input",
              editable: true,
              inputType: "text",
              name: "lastName"
            }]
          }
        }
      ]);
    }
  });
  const bridge = createConnectedBridge(fixture);
  const snapshot = await bridge.captureSnapshot(1);

  await assert.rejects(() => bridge.fillForm({
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    fields: [
      { elementId: snapshot.elements[0].elementId, value: "Ada" },
      { elementId: snapshot.elements[1].elementId, value: "Lovelace" }
    ]
  }), { code: "ACTION_UNSUPPORTED" });
  assert.equal(fixture.actions.length, 0);

  const result = await bridge.fillForm({
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    partial: true,
    fields: [
      { elementId: snapshot.elements[0].elementId, value: "Ada" },
      { elementId: snapshot.elements[1].elementId, value: "Lovelace" }
    ]
  });

  assert.deepEqual(result.fields.map((field) => field.ok), [true, true]);
  assert.deepEqual(fixture.actions.map((entry) => entry.target.documentIds[0]), ["doc_main", "doc_child"]);
});

test("snapshot collection filters beyond the first 100 candidates before applying limits", () => {
  const buttons = Array.from({ length: 150 }, (_, index) => {
    const label = index === 142 ? "Target after 100" : `Button ${index + 1}`;
    return `<button>${label}</button>`;
  }).join("");
  const dom = new JSDOM(`<!doctype html><html><body>${buttons}</body></html>`, { url: "https://example.com/" });
  const descriptors = new Map();
  const globals = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };

  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  descriptors.set("__portusComposedDom", Object.getOwnPropertyDescriptor(globalThis, "__portusComposedDom"));
  installPortusComposedDomRuntime(globalThis);
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 100 });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 20 });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 100,
    bottom: 20,
    width: 100,
    height: 20,
    toJSON() { return this; }
  });

  try {
    const targeted = capturePortusSnapshotPayload({
      query: "target after 100",
      role: "button",
      maxElements: 10
    }, 10000);
    assert.equal(targeted.candidateCount, 150);
    assert.equal(targeted.matchedElementCount, 1);
    assert.equal(targeted.truncated, false);
    assert.equal(targeted.elements.length, 1);
    assert.equal(targeted.elements[0].label, "Target after 100");

    const capped = capturePortusSnapshotPayload({ role: "button", maxElements: 120 }, 10000);
    assert.equal(capped.candidateCount, 150);
    assert.equal(capped.matchedElementCount, 150);
    assert.equal(capped.elements.length, 120);
    assert.equal(capped.truncated, true);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

test("snapshot collection traverses nested Shadow DOM and preserves filtering metadata", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="light">Light action</button>
    <app-shell id="app"></app-shell>
  </body></html>`, { url: "https://example.com/" });
  const document = dom.window.document;
  const app = document.querySelector("#app");
  const appRoot = app.attachShadow({ mode: "open" });
  appRoot.innerHTML = `<button id="shadow-action">Shadow action</button><nested-panel id="nested"></nested-panel>`;
  const nested = appRoot.querySelector("#nested");
  const nestedRoot = nested.attachShadow({ mode: "open" });
  nestedRoot.innerHTML = `<span id="deep-label">Deep search</span><input id="deep-input" aria-labelledby="deep-label" />`;

  const descriptors = new Map();
  const globals = {
    window: dom.window,
    document,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  descriptors.set("__portusComposedDom", Object.getOwnPropertyDescriptor(globalThis, "__portusComposedDom"));
  installPortusComposedDomRuntime(globalThis);
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 100 });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 20 });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 100,
    bottom: 20,
    width: 100,
    height: 20,
    toJSON() { return this; }
  });

  try {
    const all = capturePortusSnapshotPayload(null, 10000);
    assert.equal(all.candidateCount, 3);
    assert.equal(all.matchedElementCount, 3);
    assert.equal(all.truncated, false);
    assert.deepEqual(all.elements.map((element) => element.label), ["Light action", "Shadow action", "Deep search"]);
    const deep = all.elements[2];
    assert.equal(deep.selectorHint, "#deep-input");
    assert.deepEqual(shadowPathShape(deep.shadowPath), [
      { hostSelectorHint: "#app", rootType: "open" },
      { hostSelectorHint: "#nested", rootType: "open" }
    ]);
    assert.match(deep.shadowPath[0].hostInstanceId, /^sh_\d{6}$/);
    assert.match(deep.shadowPath[1].hostInstanceId, /^sh_\d{6}$/);

    const filtered = capturePortusSnapshotPayload({
      query: "deep search",
      role: "textbox",
      interactiveOnly: true,
      maxElements: 1
    }, 10000);
    assert.equal(filtered.candidateCount, 3);
    assert.equal(filtered.matchedElementCount, 1);
    assert.equal(filtered.truncated, false);
    assert.equal(filtered.elements.length, 1);
    assert.equal(filtered.elements[0].selectorHint, "#deep-input");
    assert.deepEqual(filtered.elements[0].shadowPath, deep.shadowPath);

    const capped = capturePortusSnapshotPayload({ interactiveOnly: true, maxElements: 2 }, 10000);
    assert.equal(capped.candidateCount, 3);
    assert.equal(capped.matchedElementCount, 3);
    assert.equal(capped.elements.length, 2);
    assert.equal(capped.truncated, true);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

test("closed Shadow DOM participates in snapshots waits and actions through chrome.dom", () => {
  const dom = new JSDOM(`<!doctype html><html><body><secure-shell id="secure"></secure-shell></body></html>`, { url: "https://example.com/" });
  const document = dom.window.document;
  const host = document.querySelector("#secure");
  const closedRoot = host.attachShadow({ mode: "closed" });
  closedRoot.innerHTML = `
    <button id="closed-action">Closed action</button>
    <span id="closed-label">Secret name</span>
    <input id="closed-input" aria-labelledby="closed-label" name="secret" />
  `;
  const closedButton = closedRoot.querySelector("#closed-action");
  const closedInput = closedRoot.querySelector("#closed-input");

  const descriptors = new Map();
  const globals = {
    window: dom.window,
    document,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    Event: dom.window.Event,
    InputEvent: dom.window.InputEvent,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    chrome: {
      dom: {
        openOrClosedShadowRoot(element) {
          return element === host ? closedRoot : null;
        }
      }
    }
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  descriptors.set("__portusComposedDom", Object.getOwnPropertyDescriptor(globalThis, "__portusComposedDom"));
  installPortusComposedDomRuntime(globalThis);
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 100 });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 30 });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 110,
    bottom: 50,
    width: 100,
    height: 30,
    toJSON() { return this; }
  });

  let clicks = 0;
  closedButton.addEventListener("click", () => clicks += 1);

  try {
    assert.equal(host.shadowRoot, null);

    const snapshot = capturePortusSnapshotPayload({ interactiveOnly: true }, 10000);
    assert.equal(snapshot.candidateCount, 2);
    const button = snapshot.elements.find((element) => element.selectorHint === "#closed-action");
    const input = snapshot.elements.find((element) => element.selectorHint === "#closed-input");
    assert.ok(button);
    assert.ok(input);
    assert.deepEqual(shadowPathShape(button.shadowPath), [{ hostSelectorHint: "#secure", rootType: "closed" }]);
    assert.deepEqual(shadowPathShape(input.shadowPath), [{ hostSelectorHint: "#secure", rootType: "closed" }]);
    assert.match(button.shadowPath[0].hostInstanceId, /^sh_\d{6}$/);
    assert.equal(input.shadowPath[0].hostInstanceId, button.shadowPath[0].hostInstanceId);
    assert.equal(input.label, "Secret name");

    const wait = evaluatePortusPageWait({ elementQuery: "closed action", role: "button" });
    assert.equal(wait.matched, true);
    assert.equal(wait.details.shadowDepth, 1);
    assert.deepEqual(shadowPathShape(wait.details.shadowPath), [{ hostSelectorHint: "#secure", rootType: "closed" }]);
    assert.equal(wait.details.shadowPath[0].hostInstanceId, button.shadowPath[0].hostInstanceId);

    const click = performPortusDomAction({ action: "click", target: button });
    assert.equal(click.ok, true);
    assert.equal(clicks, 1);

    const type = performPortusDomAction({ action: "type", target: input, text: "Ada" });
    assert.equal(type.ok, true);
    assert.equal(closedInput.value, "Ada");

    const closedRuntime = globalThis.__portusComposedDom;
    Object.defineProperty(globalThis, "__portusComposedDom", {
      configurable: true,
      writable: true,
      value: {
        collect: () => [],
        shadowRootForElement: closedRuntime.shadowRootForElement,
        hostInstanceIdForElement: closedRuntime.hostInstanceIdForElement
      }
    });
    closedButton.id = "renamed-closed-action";
    document.elementsFromPoint = () => [host];
    closedRoot.elementsFromPoint = () => [closedButton];

    const recoveredByBounds = performPortusDomAction({ action: "click", target: button });
    assert.equal(recoveredByBounds.ok, true);
    assert.equal(clicks, 2);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

test("live DOM actions resolve nested Shadow DOM without crossing the captured root", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="light-save">Save</button>
    <app-shell id="app"></app-shell>
  </body></html>`, { url: "https://example.com/" });
  const document = dom.window.document;
  const app = document.querySelector("#app");
  const appRoot = app.attachShadow({ mode: "open" });
  appRoot.innerHTML = `<nested-panel id="nested"></nested-panel>`;
  const nested = appRoot.querySelector("#nested");
  const nestedRoot = nested.attachShadow({ mode: "open" });
  nestedRoot.innerHTML = `
    <button id="shadow-save">Save</button>
    <span id="name-label">Name</span>
    <input id="shadow-name" aria-labelledby="name-label" name="name" />
  `;
  const shadowButton = nestedRoot.querySelector("#shadow-save");
  const shadowInput = nestedRoot.querySelector("#shadow-name");
  const lightButton = document.querySelector("#light-save");

  const descriptors = new Map();
  const globals = {
    window: dom.window,
    document,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    Event: dom.window.Event,
    InputEvent: dom.window.InputEvent,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  descriptors.set("__portusComposedDom", Object.getOwnPropertyDescriptor(globalThis, "__portusComposedDom"));
  installPortusComposedDomRuntime(globalThis);
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 110,
    bottom: 50,
    width: 100,
    height: 30,
    toJSON() { return this; }
  });

  const runtime = globalThis.__portusComposedDom;
  const capturedButton = runtime.collect(document).find((entry) => entry.element === shadowButton);
  const capturedInput = runtime.collect(document).find((entry) => entry.element === shadowInput);
  assert.ok(capturedButton?.shadowPath);
  assert.ok(capturedInput?.shadowPath);
  assert.deepEqual(capturedInput.shadowPath, capturedButton.shadowPath);
  const shadowPath = capturedButton.shadowPath;
  const buttonTarget = {
    shadowPath,
    selectorHint: "#shadow-save",
    tagName: "button",
    role: "button",
    label: "Save",
    text: "Save",
    bounds: { x: 10, y: 20, width: 100, height: 30 },
    state: {},
    disabled: false
  };
  const inputTarget = {
    shadowPath,
    selectorHint: "#shadow-name",
    tagName: "input",
    role: "textbox",
    label: "Name",
    text: "",
    bounds: { x: 10, y: 20, width: 100, height: 30 },
    state: { value: "" },
    disabled: false,
    editable: true,
    inputType: "text",
    name: "name"
  };

  let shadowClicks = 0;
  let lightClicks = 0;
  shadowButton.addEventListener("click", () => shadowClicks += 1);
  lightButton.addEventListener("click", () => lightClicks += 1);

  try {
    const exact = performPortusDomAction({ action: "click", target: buttonTarget });
    assert.equal(exact.ok, true);
    assert.equal(shadowClicks, 1);
    assert.equal(lightClicks, 0);

    shadowButton.id = "renamed-save";
    const recovered = performPortusDomAction({ action: "click", target: buttonTarget });
    assert.equal(recovered.ok, true);
    assert.equal(shadowClicks, 2);
    assert.equal(lightClicks, 0);

    nested.id = "renamed-nested";
    const recoveredAfterHostSelectorChange = performPortusDomAction({ action: "click", target: buttonTarget });
    assert.equal(recoveredAfterHostSelectorChange.ok, true);
    assert.equal(shadowClicks, 3);
    assert.equal(lightClicks, 0);

    const typed = performPortusDomAction({ action: "type", target: inputTarget, text: "Ada" });
    assert.equal(typed.ok, true);
    assert.equal(shadowInput.value, "Ada");

    const filled = performPortusDomAction({
      action: "fillForm",
      partial: false,
      fields: [{ elementId: "el_shadow_name", value: "Lovelace", target: inputTarget }]
    });
    assert.equal(filled.ok, true);
    assert.equal(shadowInput.value, "Lovelace");

    let scrollRequest = null;
    shadowButton.scrollBy = (options) => { scrollRequest = options; };
    const scrolled = performPortusDomAction({ action: "scroll", target: buttonTarget, deltaX: 7, deltaY: 90 });
    assert.equal(scrolled.ok, true);
    assert.deepEqual(scrollRequest, { left: 7, top: 90, behavior: "instant" });

    let originalChanges = 0;
    let replacementChanges = 0;
    shadowInput.addEventListener("change", () => originalChanges += 1);
    const inspectedTypeTarget = performPortusDomAction({
      action: "__portus.inspect-target",
      target: inputTarget,
      preparation: "type",
      actionToken: "type_exact_target"
    });
    assert.equal(inspectedTypeTarget.ok, true);
    const replacementInput = shadowInput.cloneNode();
    shadowInput.replaceWith(replacementInput);
    replacementInput.addEventListener("change", () => replacementChanges += 1);
    const finalizedTypeTarget = performPortusDomAction({
      action: "__portus.finalize-type",
      actionToken: "type_exact_target",
      dispatchChange: true
    });
    assert.equal(finalizedTypeTarget.ok, true);
    assert.equal(originalChanges, 1);
    assert.equal(replacementChanges, 0);

    document.elementsFromPoint = () => [lightButton];
    nested.remove();
    const removedStale = performPortusDomAction({ action: "click", target: buttonTarget });
    assert.equal(removedStale.ok, false);
    assert.equal(removedStale.error.code, "SNAPSHOT_STALE");
    assert.equal(lightClicks, 0);

    const replacementNested = document.createElement("nested-panel");
    replacementNested.id = "nested";
    appRoot.append(replacementNested);
    const replacementRoot = replacementNested.attachShadow({ mode: "open" });
    replacementRoot.innerHTML = `<button id="shadow-save">Save</button>`;
    const replacementButton = replacementRoot.querySelector("#shadow-save");
    let replacementClicks = 0;
    replacementButton.addEventListener("click", () => replacementClicks += 1);
    const replacementStale = performPortusDomAction({ action: "click", target: buttonTarget });
    assert.equal(replacementStale.ok, false);
    assert.equal(replacementStale.error.code, "SNAPSHOT_STALE");
    assert.equal(replacementClicks, 0);
    const replacementEntry = runtime.collect(document).find((entry) => entry.element === replacementButton);
    assert.notEqual(replacementEntry.shadowPath[1].hostInstanceId, shadowPath[1].hostInstanceId);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

test("upload DOM preparation enforces multiple files and cleans its target marker", () => {
  const dom = new JSDOM(`<!doctype html><html><body><input id="upload" type="file" aria-label="Documents"></body></html>`, {
    url: "https://example.com/"
  });
  const document = dom.window.document;
  const input = document.querySelector("#upload");
  const descriptors = new Map();
  const globals = {
    window: dom.window,
    document,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    Event: dom.window.Event,
    InputEvent: dom.window.InputEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  descriptors.set("__portusComposedDom", Object.getOwnPropertyDescriptor(globalThis, "__portusComposedDom"));
  installPortusComposedDomRuntime(globalThis);
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, right: 170, bottom: 52, width: 160, height: 32,
    toJSON() { return this; }
  });
  const target = {
    selectorHint: "#upload",
    tagName: "input",
    role: "textbox",
    label: "Documents",
    text: "",
    bounds: { x: 10, y: 20, width: 160, height: 32 },
    state: {},
    editable: false,
    inputType: "file"
  };

  try {
    const rejected = performPortusDomAction({
      action: "__portus.prepare-upload",
      target,
      markerAttribute: "data-portus-upload-request-one",
      fileCount: 2
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "ACTION_UNSUPPORTED");
    assert.equal(input.hasAttribute("data-portus-upload-request-one"), false);

    input.multiple = true;
    const prepared = performPortusDomAction({
      action: "__portus.prepare-upload",
      target,
      markerAttribute: "data-portus-upload-request-two",
      fileCount: 2
    });
    assert.equal(prepared.ok, true);
    assert.equal(input.hasAttribute("data-portus-upload-request-two"), true);

    const finalized = performPortusDomAction({
      action: "__portus.finalize-upload",
      target,
      markerAttribute: "data-portus-upload-request-two",
    });
    assert.equal(finalized.ok, true);
    assert.equal(input.hasAttribute("data-portus-upload-request-two"), false);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

test("atomic fill-form validates fields across sibling Shadow DOM roots before mutation", () => {
  const dom = new JSDOM(`<!doctype html><html><body><app-shell id="app"></app-shell></body></html>`, { url: "https://example.com/" });
  const document = dom.window.document;
  const app = document.querySelector("#app");
  const appRoot = app.attachShadow({ mode: "open" });
  appRoot.innerHTML = `<left-panel id="left"></left-panel><right-panel id="right"></right-panel>`;
  const left = appRoot.querySelector("#left");
  const right = appRoot.querySelector("#right");
  const leftRoot = left.attachShadow({ mode: "open" });
  const rightRoot = right.attachShadow({ mode: "open" });
  leftRoot.innerHTML = `<input id="first" name="first" />`;
  rightRoot.innerHTML = `<input id="last" name="last" />`;
  const first = leftRoot.querySelector("#first");
  const last = rightRoot.querySelector("#last");

  const descriptors = new Map();
  const globals = {
    window: dom.window,
    document,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    Event: dom.window.Event,
    InputEvent: dom.window.InputEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  descriptors.set("__portusComposedDom", Object.getOwnPropertyDescriptor(globalThis, "__portusComposedDom"));
  installPortusComposedDomRuntime(globalThis);
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 50, width: 100, height: 30,
    toJSON() { return this; }
  });

  const firstTarget = {
    shadowPath: [
      { hostSelectorHint: "#app", rootType: "open" },
      { hostSelectorHint: "#left", rootType: "open" }
    ],
    selectorHint: "#first",
    tagName: "input",
    role: "textbox",
    label: "First",
    text: "",
    bounds: { x: 10, y: 20, width: 100, height: 30 },
    state: { value: "" },
    editable: true,
    inputType: "text",
    name: "first"
  };
  const lastTarget = {
    shadowPath: [
      { hostSelectorHint: "#app", rootType: "open" },
      { hostSelectorHint: "#right", rootType: "open" }
    ],
    selectorHint: "#last",
    tagName: "input",
    role: "textbox",
    label: "Last",
    text: "",
    bounds: { x: 10, y: 20, width: 100, height: 30 },
    state: { value: "" },
    editable: true,
    inputType: "text",
    name: "last"
  };

  try {
    const success = performPortusDomAction({
      action: "fillForm",
      partial: false,
      fields: [
        { elementId: "el_first", value: "Ada", target: firstTarget },
        { elementId: "el_last", value: "Lovelace", target: lastTarget }
      ]
    });
    assert.equal(success.ok, true);
    assert.equal(first.value, "Ada");
    assert.equal(last.value, "Lovelace");

    first.value = "";
    last.value = "";
    right.remove();
    const stale = performPortusDomAction({
      action: "fillForm",
      partial: false,
      fields: [
        { elementId: "el_first", value: "Grace", target: firstTarget },
        { elementId: "el_last", value: "Hopper", target: lastTarget }
      ]
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "SNAPSHOT_STALE");
    assert.equal(first.value, "");

    const partial = performPortusDomAction({
      action: "fillForm",
      partial: true,
      fields: [
        { elementId: "el_first", value: "Grace", target: firstTarget },
        { elementId: "el_last", value: "Hopper", target: lastTarget }
      ]
    });
    assert.equal(partial.ok, true);
    assert.equal(first.value, "Grace");
    assert.deepEqual(partial.details.fields.map((field) => [field.elementId, field.ok, field.error?.code]), [
      ["el_first", true, undefined],
      ["el_last", false, "SNAPSHOT_STALE"]
    ]);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

test("bounds recovery recursively hit-tests nested Shadow DOM", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="light-duplicate">Shadow target</button>
    <app-shell id="app"></app-shell>
  </body></html>`, { url: "https://example.com/" });
  const document = dom.window.document;
  const app = document.querySelector("#app");
  const appRoot = app.attachShadow({ mode: "open" });
  appRoot.innerHTML = `<nested-panel id="nested"></nested-panel>`;
  const nested = appRoot.querySelector("#nested");
  const nestedRoot = nested.attachShadow({ mode: "open" });
  nestedRoot.innerHTML = `
    <button id="source-live">Shadow source</button>
    <button id="target-live">Shadow target</button>
  `;
  const source = nestedRoot.querySelector("#source-live");
  const target = nestedRoot.querySelector("#target-live");
  const lightDuplicate = document.querySelector("#light-duplicate");

  const descriptors = new Map();
  const globals = {
    window: dom.window,
    document,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    Event: dom.window.Event,
    InputEvent: dom.window.InputEvent,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  descriptors.set("__portusComposedDom", Object.getOwnPropertyDescriptor(globalThis, "__portusComposedDom"));
  Object.defineProperty(globalThis, "__portusComposedDom", {
    configurable: true,
    writable: true,
    value: {
      collect: () => [],
      shadowRootForElement: (element) => element.shadowRoot
    }
  });

  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const x = this.id === "source-live" ? 10 : 210;
    return {
      x,
      y: 20,
      left: x,
      top: 20,
      right: x + 100,
      bottom: 50,
      width: 100,
      height: 30,
      toJSON() { return this; }
    };
  };
  document.elementsFromPoint = () => [lightDuplicate, app];
  appRoot.elementsFromPoint = () => [nested];
  nestedRoot.elementsFromPoint = (x) => x < 150 ? [source] : [target];

  const shadowPath = [
    { hostSelectorHint: "#app", rootType: "open" },
    { hostSelectorHint: "#nested", rootType: "open" }
  ];
  const sourceTarget = {
    shadowPath,
    selectorHint: "#stale-source",
    tagName: "button",
    role: "button",
    label: "Shadow source",
    text: "Shadow source",
    bounds: { x: 10, y: 20, width: 100, height: 30 },
    state: {},
    disabled: false
  };
  const dropTarget = {
    shadowPath,
    selectorHint: "#stale-target",
    tagName: "button",
    role: "button",
    label: "Shadow target",
    text: "Shadow target",
    bounds: { x: 210, y: 20, width: 100, height: 30 },
    state: {},
    disabled: false
  };

  let targetClicks = 0;
  let lightClicks = 0;
  let hoverMoves = 0;
  let drops = 0;
  target.addEventListener("click", () => targetClicks += 1);
  lightDuplicate.addEventListener("click", () => lightClicks += 1);
  target.addEventListener("mousemove", () => hoverMoves += 1);
  target.addEventListener("drop", () => drops += 1);

  try {
    const clicked = performPortusDomAction({ action: "click", target: dropTarget });
    assert.equal(clicked.ok, true);
    assert.equal(targetClicks, 1);
    assert.equal(lightClicks, 0);

    const hovered = performPortusDomAction({ action: "hover", target: dropTarget });
    assert.equal(hovered.ok, true);
    assert.equal(hoverMoves, 1);

    const dragged = performPortusDomAction({ action: "drag", sourceTarget, dropTarget });
    assert.equal(dragged.ok, true);
    assert.equal(drops, 1);
    assert.equal(lightClicks, 0);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

test("same-document drag crosses light and Shadow DOM boundaries", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="light-source">Light source</button>
    <button id="light-target">Light target</button>
    <app-shell id="app"></app-shell>
  </body></html>`, { url: "https://example.com/" });
  const document = dom.window.document;
  const app = document.querySelector("#app");
  const appRoot = app.attachShadow({ mode: "open" });
  appRoot.innerHTML = `<left-panel id="left"></left-panel><right-panel id="right"></right-panel>`;
  const left = appRoot.querySelector("#left");
  const right = appRoot.querySelector("#right");
  const leftRoot = left.attachShadow({ mode: "open" });
  const rightRoot = right.attachShadow({ mode: "open" });
  leftRoot.innerHTML = `<button id="shadow-left">Shadow left</button><nested-left id="nested-left"></nested-left>`;
  rightRoot.innerHTML = `<button id="shadow-right">Shadow right</button><nested-right id="nested-right"></nested-right>`;
  const nestedLeft = leftRoot.querySelector("#nested-left");
  const nestedRight = rightRoot.querySelector("#nested-right");
  const nestedLeftRoot = nestedLeft.attachShadow({ mode: "open" });
  const nestedRightRoot = nestedRight.attachShadow({ mode: "open" });
  nestedLeftRoot.innerHTML = `<button id="nested-source">Nested source</button>`;
  nestedRightRoot.innerHTML = `<button id="nested-target">Nested target</button>`;

  const lightSource = document.querySelector("#light-source");
  const lightTarget = document.querySelector("#light-target");
  const shadowLeft = leftRoot.querySelector("#shadow-left");
  const shadowRight = rightRoot.querySelector("#shadow-right");
  const nestedSource = nestedLeftRoot.querySelector("#nested-source");
  const nestedTarget = nestedRightRoot.querySelector("#nested-target");

  const descriptors = new Map();
  const globals = {
    window: dom.window,
    document,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  descriptors.set("__portusComposedDom", Object.getOwnPropertyDescriptor(globalThis, "__portusComposedDom"));
  installPortusComposedDomRuntime(globalThis);
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const xById = new Map([
    ["light-source", 10],
    ["light-target", 160],
    ["shadow-left", 310],
    ["shadow-right", 460],
    ["nested-source", 610],
    ["nested-target", 760]
  ]);
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const x = xById.get(this.id) ?? 0;
    return {
      x, y: 20, left: x, top: 20, right: x + 100, bottom: 50, width: 100, height: 30,
      toJSON() { return this; }
    };
  };

  const lightTargetFor = (element, label) => ({
    selectorHint: `#${element.id}`,
    tagName: "button",
    role: "button",
    label,
    text: label,
    bounds: { x: xById.get(element.id), y: 20, width: 100, height: 30 },
    state: {},
    disabled: false
  });
  const shadowTargetFor = (element, label, shadowPath) => ({
    ...lightTargetFor(element, label),
    shadowPath
  });
  const appLeftPath = [
    { hostSelectorHint: "#app", rootType: "open" },
    { hostSelectorHint: "#left", rootType: "open" }
  ];
  const appRightPath = [
    { hostSelectorHint: "#app", rootType: "open" },
    { hostSelectorHint: "#right", rootType: "open" }
  ];
  const nestedLeftPath = [...appLeftPath, { hostSelectorHint: "#nested-left", rootType: "open" }];
  const nestedRightPath = [...appRightPath, { hostSelectorHint: "#nested-right", rootType: "open" }];

  const targets = {
    lightSource: lightTargetFor(lightSource, "Light source"),
    lightTarget: lightTargetFor(lightTarget, "Light target"),
    shadowLeft: shadowTargetFor(shadowLeft, "Shadow left", appLeftPath),
    shadowRight: shadowTargetFor(shadowRight, "Shadow right", appRightPath),
    nestedSource: shadowTargetFor(nestedSource, "Nested source", nestedLeftPath),
    nestedTarget: shadowTargetFor(nestedTarget, "Nested target", nestedRightPath)
  };

  const drops = { shadowLeft: 0, lightTarget: 0, shadowRight: 0, nestedTarget: 0 };
  shadowLeft.addEventListener("drop", () => drops.shadowLeft += 1);
  lightTarget.addEventListener("drop", () => drops.lightTarget += 1);
  shadowRight.addEventListener("drop", () => drops.shadowRight += 1);
  nestedTarget.addEventListener("drop", () => drops.nestedTarget += 1);

  try {
    assert.equal(performPortusDomAction({ action: "drag", sourceTarget: targets.lightSource, dropTarget: targets.shadowLeft }).ok, true);
    assert.equal(performPortusDomAction({ action: "drag", sourceTarget: targets.shadowLeft, dropTarget: targets.lightTarget }).ok, true);
    assert.equal(performPortusDomAction({ action: "drag", sourceTarget: targets.shadowLeft, dropTarget: targets.shadowRight }).ok, true);
    assert.equal(performPortusDomAction({ action: "drag", sourceTarget: targets.nestedSource, dropTarget: targets.nestedTarget }).ok, true);
    assert.deepEqual(drops, { shadowLeft: 1, lightTarget: 1, shadowRight: 1, nestedTarget: 1 });
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
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
  const actionRuntimeInjection = fixture.scriptInjections.at(-2);
  assert.deepEqual(actionRuntimeInjection.files, ["dist/composed-dom-runtime.js"]);
  assert.deepEqual(actionRuntimeInjection.target, {
    tabId: 1,
    documentIds: [snapshot.elements[0].documentId]
  });

  await assert.rejects(() => bridge.performAction("click", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  }), { code: "SNAPSHOT_STALE" });
});

test("fill form remains all-or-nothing when partial mode is not enabled", async () => {
  const fixture = createChromeFixture({
    executeScript(injection, actions) {
      if (isActionInjection(injection)) {
        actions.push(injection.args[0]);
        return Promise.resolve([{ result: { ok: true, details: { action: "fillForm", fields: [] } } }]);
      }
      return Promise.resolve([{
        result: {
          url: "https://example.com/form",
          title: "Form",
          viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
          visibleText: "First name",
          elements: [{
            role: "textbox",
            label: "First name",
            text: "",
            bounds: { x: 10, y: 20, width: 180, height: 32 },
            state: { value: "" },
            selectorHint: "#first-name",
            tagName: "input",
            editable: true,
            inputType: "text",
            name: "firstName"
          }]
        }
      }]);
    }
  });
  const bridge = createConnectedBridge(fixture);
  const snapshot = await bridge.captureSnapshot(1);

  await assert.rejects(() => bridge.fillForm({
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    fields: [
      { elementId: "el_000001", value: "Ada" },
      { elementId: "el_999999", value: "Lovelace" }
    ]
  }), { code: "SNAPSHOT_STALE" });

  assert.equal(fixture.actions.length, 0);
});

test("fill form partial mode returns mixed per-field results", async () => {
  const fixture = createChromeFixture({
    executeScript(injection, actions) {
      if (isActionInjection(injection)) {
        const payload = injection.args[0];
        actions.push(payload);
        assert.equal(payload.action, "fillForm");
        assert.equal(payload.partial, true);
        assert.equal(payload.fields.length, 2);
        assert.equal(payload.fields[0].target.elementId, "el_000001");
        assert.equal(payload.fields[1].target.elementId, "el_000002");
        return Promise.resolve([{
          result: {
            ok: true,
            details: {
              action: "fillForm",
              partial: true,
              fields: [
                { elementId: "el_000001", ok: true },
                {
                  elementId: "el_000002",
                  ok: false,
                  error: { code: "SNAPSHOT_STALE", message: "Fill form target no longer matches the current DOM." }
                }
              ]
            }
          }
        }]);
      }
      return Promise.resolve([{
        result: {
          url: "https://example.com/form",
          title: "Form",
          viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
          visibleText: "First name Last name",
          elements: [
            {
              role: "textbox",
              label: "First name",
              text: "",
              bounds: { x: 10, y: 20, width: 180, height: 32 },
              state: { value: "" },
              selectorHint: "#first-name",
              tagName: "input",
              editable: true,
              inputType: "text",
              name: "firstName"
            },
            {
              role: "textbox",
              label: "Last name",
              text: "",
              bounds: { x: 10, y: 60, width: 180, height: 32 },
              state: { value: "" },
              selectorHint: "#last-name",
              tagName: "input",
              editable: true,
              inputType: "text",
              name: "lastName"
            }
          ]
        }
      }]);
    }
  });
  const bridge = createConnectedBridge(fixture);
  const snapshot = await bridge.captureSnapshot(1);

  const result = await bridge.fillForm({
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    partial: true,
    fields: [
      { elementId: "el_000001", value: "Ada" },
      { elementId: "el_000002", value: "Lovelace" },
      { elementId: "el_999999", value: "missing@example.com" }
    ]
  });

  assert.equal(result.snapshotInvalidated, true);
  assert.deepEqual(result.fields.map((field) => [field.elementId, field.ok, field.error?.code]), [
    ["el_000001", true, undefined],
    ["el_000002", false, "SNAPSHOT_STALE"],
    ["el_999999", false, "SNAPSHOT_STALE"]
  ]);
  assert.equal(result.details.partial, true);
  assert.equal(result.details.succeeded, 1);
  assert.equal(result.details.failed, 2);
  assert.equal(fixture.actions.length, 1);
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

test("advanced backend keeps core target actions on DOM while disabled", async () => {
  const element = {
    role: "textbox",
    label: "Name",
    text: "",
    bounds: { x: 10, y: 20, width: 180, height: 32 },
    state: { value: "" },
    selectorHint: "#name",
    tagName: "input",
    editable: true,
    inputType: "text"
  };
  const scenarios = [
    ["click", {}],
    ["hover", {}],
    ["press", { key: "Enter" }],
    ["type", { text: "Ada" }],
    ["scroll", { deltaY: 120 }]
  ];

  for (const [actionName, extra] of scenarios) {
    const fixture = createAdvancedActionFixture({ element });
    const bridge = createConnectedBridge(fixture);
    const snapshot = await bridge.captureSnapshot(1);
    const result = await bridge.performAction(actionName, {
      tabId: 1,
      snapshotId: snapshot.snapshotId,
      elementId: snapshot.elements[0].elementId,
      ...extra
    });

    assert.equal(result.backend, "content-script-dom", actionName);
    assert.equal(fixture.actions.length, 1, actionName);
    assert.equal(fixture.actions[0].action, actionName, actionName);
    assert.equal(fixture.debuggerCommands.length, 0, actionName);
  }
});

test("advanced backend uses real CDP input for normal top-level core actions", async () => {
  const baseElement = {
    role: "textbox",
    label: "Name",
    text: "",
    bounds: { x: 10, y: 20, width: 180, height: 32 },
    state: { value: "" },
    selectorHint: "#name",
    tagName: "input",
    editable: true,
    inputType: "text"
  };
  const scenarios = [
    { action: "hover", extra: {}, methods: ["Input.dispatchMouseEvent"] },
    { action: "click", extra: {}, methods: ["Input.dispatchMouseEvent", "Input.dispatchMouseEvent", "Input.dispatchMouseEvent"] },
    { action: "press", extra: { key: "Enter" }, methods: ["Input.dispatchKeyEvent", "Input.dispatchKeyEvent"] },
    { action: "type", extra: { text: "Ada" }, methods: ["Input.insertText"] },
    {
      action: "scroll",
      extra: { deltaX: 0, deltaY: 120 },
      methods: ["Input.dispatchMouseEvent"],
      inspection: { canScrollY: true, canScrollDeltaY: true }
    }
  ];

  for (const scenario of scenarios) {
    const fixture = createAdvancedActionFixture({ element: baseElement, inspection: scenario.inspection ?? {} });
    const bridge = createConnectedBridge(fixture);
    const snapshot = await bridge.captureSnapshot(1);
    await bridge.setAdvancedBackendEnabled(true, false);
    const result = await bridge.performAction(scenario.action, {
      tabId: 1,
      snapshotId: snapshot.snapshotId,
      elementId: snapshot.elements[0].elementId,
      ...scenario.extra
    });

    assert.equal(result.backend, "debugger-cdp", scenario.action);
    assert.equal(result.details.interactionMode, "input", scenario.action);
    assert.equal(result.snapshotInvalidated, true, scenario.action);
    assert.deepEqual(fixture.debuggerCommands.map((command) => command.method), scenario.methods, scenario.action);
    assert.equal(fixture.actions.length, 0, scenario.action);
  }
});

test("advanced click uses live resolved geometry instead of stale snapshot bounds", async () => {
  const fixture = createAdvancedActionFixture({
    inspection: { bounds: { x: 200, y: 300, width: 80, height: 20 } }
  });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);

  const result = await bridge.performAction("click", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  });

  assert.equal(result.backend, "debugger-cdp");
  for (const command of fixture.debuggerCommands) {
    assert.equal(command.params.x, 240);
    assert.equal(command.params.y, 310);
  }
  assert.deepEqual(result.details.point, { x: 240, y: 310 });
});

test("advanced input fails stale before debugger input when live DOM identity no longer resolves", async () => {
  const fixture = createAdvancedActionFixture({
    inspectError: { code: "SNAPSHOT_STALE", message: "Element target no longer matches the current DOM." }
  });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);

  await assert.rejects(() => bridge.performAction("click", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  }), { code: "SNAPSHOT_STALE" });

  assert.equal(fixture.debuggerAttaches.length, 0);
  assert.equal(fixture.debuggerCommands.length, 0);
  assert.equal(fixture.actions.length, 0);
});

test("advanced backend deliberately keeps child-frame actions on the DOM backend", async () => {
  const fixture = createAdvancedActionFixture({ frameId: 7, documentId: "doc_child" });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);
  assert.equal(snapshot.elements[0].frameId, 7);

  const result = await bridge.performAction("click", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  });

  assert.equal(result.backend, "content-script-dom");
  assert.equal(fixture.actions.length, 1);
  assert.equal(fixture.actions[0].action, "click");
  assert.equal(fixture.debuggerCommands.length, 0);
});

test("advanced targeted scroll falls back before debugger input when wheel routing would change semantics", async () => {
  const element = {
    role: "region",
    label: "Static region",
    text: "",
    bounds: { x: 10, y: 20, width: 180, height: 80 },
    state: {},
    selectorHint: "#static-region",
    tagName: "div"
  };
  const fixture = createAdvancedActionFixture({ element });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);

  const result = await bridge.performAction("scroll", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId,
    deltaY: 120
  });

  assert.equal(result.backend, "content-script-dom");
  assert.equal(result.details.advancedBackendFallback, "element-scroll-semantics");
  assert.equal(fixture.debuggerCommands.length, 0);
  assert.equal(fixture.actions.at(-1).action, "scroll");
});

test("advanced type keeps specialized input controls on exact DOM value semantics", async () => {
  const element = {
    role: "checkbox",
    label: "Choice",
    text: "",
    bounds: { x: 10, y: 20, width: 20, height: 20 },
    state: {},
    selectorHint: "#choice",
    tagName: "input",
    editable: true,
    inputType: "checkbox"
  };
  const fixture = createAdvancedActionFixture({ element });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);

  const result = await bridge.performAction("type", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId,
    text: "value"
  });

  assert.equal(result.backend, "content-script-dom");
  assert.equal(result.details.advancedBackendFallback, "specialized-input-semantics");
  assert.equal(fixture.debuggerCommands.length, 0);
  assert.equal(fixture.actions.at(-1).action, "type");
});

test("normal advanced actions fall back to DOM when the debugger API is unavailable", async () => {
  const fixture = createChromeFixture({ debugger: false });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);

  const result = await bridge.performAction("click", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  });

  assert.equal(result.backend, "content-script-dom");
  assert.equal(fixture.actions.length, 1);
  assert.equal(fixture.actions[0].action, "click");
  assert.equal(fixture.debuggerAttaches.length, 0);
  assert.equal(fixture.debuggerCommands.length, 0);
});

test("advanced debugger failures never fall through to a DOM retry", async () => {
  const fixture = createAdvancedActionFixture({
    sendDebuggerCommand(_target, method) {
      if (method === "Input.dispatchMouseEvent") return Promise.reject(new Error("input unavailable"));
      return Promise.resolve({});
    }
  });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);

  await assert.rejects(() => bridge.performAction("hover", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId
  }), { code: "CAPABILITY_UNAVAILABLE" });

  assert.equal(fixture.debuggerAttaches.length, 1);
  assert.equal(fixture.debuggerDetaches.length, 1);
  assert.equal(fixture.actions.length, 0);
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
      if (isActionInjection(injection)) {
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

test("uploads approved files to an exact snapshot file input through CDP", async () => {
  const fixture = createChromeFixture({
    executeScript(injection) {
      if (injection.files) return Promise.resolve([{ result: undefined }]);
      if (isActionInjection(injection)) {
        return Promise.resolve([{ result: defaultInternalActionResult(injection.args[0]) }]);
      }
      return Promise.resolve([{
        result: {
          url: "https://example.com/upload",
          title: "Upload",
          viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
          visibleText: "Choose files",
          closedShadowRootAccessAvailable: true,
          elements: [{
            role: "textbox",
            label: "Choose files",
            text: "",
            bounds: { x: 10, y: 20, width: 160, height: 32 },
            state: {},
            selectorHint: "input[type=file]",
            tagName: "input",
            inputType: "file",
            editable: false
          }]
        }
      }]);
    },
    sendDebuggerCommand(_target, method) {
      if (method === "DOM.performSearch") return Promise.resolve({ searchId: "search-upload", resultCount: 1 });
      if (method === "DOM.getSearchResults") return Promise.resolve({ nodeIds: [42] });
      if (method === "DOM.resolveNode") return Promise.resolve({ object: { objectId: "upload-object" } });
      if (method === "Runtime.callFunctionOn") {
        return Promise.resolve({ result: { value: { fileInput: true, multiple: true } } });
      }
      return Promise.resolve({});
    }
  });
  const bridge = createConnectedBridge(fixture);
  const snapshot = await bridge.captureSnapshot(1);

  const result = await bridge.uploadFiles({
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId,
    files: ["C:\\approved\\one.txt", "C:\\approved\\two.txt"]
  });

  assert.equal(result.backend, "debugger-cdp");
  assert.equal(result.snapshotInvalidated, true);
  assert.deepEqual(result.details.fileNames, ["one.txt", "two.txt"]);
  assert.equal(result.details.fileCount, 2);
  assert.deepEqual(fixture.debuggerCommands.map((command) => command.method), [
    "DOM.enable",
    "DOM.performSearch",
    "DOM.getSearchResults",
    "DOM.resolveNode",
    "Runtime.callFunctionOn",
    "DOM.setFileInputFiles",
    "DOM.discardSearchResults"
  ]);
  const setFiles = fixture.debuggerCommands.find((command) => command.method === "DOM.setFileInputFiles");
  assert.deepEqual(setFiles.params, {
    files: ["C:\\approved\\one.txt", "C:\\approved\\two.txt"],
    nodeId: 42
  });
  const uploadActions = fixture.scriptInjections
    .filter(isActionInjection)
    .map((injection) => injection.args[0]);
  assert.deepEqual(uploadActions.map((action) => action.action), [
    "__portus.prepare-upload",
    "__portus.finalize-upload"
  ]);
  assert.equal(uploadActions[0].markerAttribute, uploadActions[1].markerAttribute);
  assert.deepEqual(fixture.debuggerAttaches, [{ target: { tabId: 1 }, version: "1.3" }]);
  assert.deepEqual(fixture.debuggerDetaches, [{ target: { tabId: 1 } }]);

  await assert.rejects(() => bridge.uploadFiles({
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId,
    files: ["C:\\approved\\three.txt"]
  }), { code: "SNAPSHOT_STALE" });
});

test("rejects debugger commands only when the Chrome debugger API is unavailable", async () => {
  const fixture = createChromeFixture({ debugger: false });
  const bridge = createConnectedBridge(fixture);

  await assert.rejects(() => bridge.handleDialog("dismiss", { tabId: 1 }), {
    code: "CAPABILITY_UNAVAILABLE"
  });
  assert.equal(fixture.debuggerAttaches.length, 0);
});

test("handles browser dialogs independently of the automatic backend preference", async () => {
  const fixture = createChromeFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("dialog.accept", true, false);

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
    executeScript(injection) {
      if (injection.files) return Promise.resolve([{ result: undefined }]);
      const payload = Array.isArray(injection.args) ? injection.args[0] : undefined;
      if (payload && typeof payload === "object" && payload.action === "__portus.inspect-target") {
        return Promise.resolve([{
          frameId: 0,
          documentId: "doc_frame_0",
          result: defaultInternalActionResult(payload)
        }]);
      }
      return Promise.resolve([{
        result: {
          url: "https://example.com/drag",
          title: "Drag",
          viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
          visibleText: "Drag Drop",
          closedShadowRootAccessAvailable: true,
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

test("debugger drag supports normal and CDP-only endpoints in the same document", async () => {
  const scenarios = [
    { name: "normal-to-cdp", sourceIndex: 0, targetIndex: 2, refreshed: [5] },
    { name: "cdp-to-normal", sourceIndex: 1, targetIndex: 0, refreshed: [4] },
    { name: "cdp-to-cdp", sourceIndex: 1, targetIndex: 2, refreshed: [4, 5] }
  ];

  for (const scenario of scenarios) {
    const fixture = createPiercedDragFixture();
    const bridge = createConnectedBridge(fixture);
    await bridge.setCommandPolicyEnabled("action.drag", true, false);
    await bridge.setAdvancedBackendEnabled(true, false);
    const snapshot = await bridge.captureSnapshot(1);
    assert.equal(snapshot.elements.length, 3, scenario.name);
    const commandStart = fixture.debuggerCommands.length;

    const result = await bridge.performAction("drag", {
      tabId: 1,
      snapshotId: snapshot.snapshotId,
      sourceElementId: snapshot.elements[scenario.sourceIndex].elementId,
      targetElementId: snapshot.elements[scenario.targetIndex].elementId
    });

    assert.equal(result.backend, "debugger-cdp", scenario.name);
    assert.equal(result.snapshotInvalidated, true, scenario.name);
    assert.equal(result.details.piercedClosedShadowFallback, true, scenario.name);
    const dragCommands = fixture.debuggerCommands.slice(commandStart);
    assert.deepEqual(
      dragCommands.filter((command) => command.method === "DOM.getBoxModel").map((command) => command.params.backendNodeId),
      scenario.refreshed,
      scenario.name
    );
    assert.equal(dragCommands.filter((command) => command.method === "Input.dispatchMouseEvent").length, 4, scenario.name);
    if (scenario.refreshed.includes(4)) assert.deepEqual(result.details.source, { x: 550, y: 130 }, scenario.name);
    if (scenario.refreshed.includes(5)) assert.deepEqual(result.details.target, { x: 750, y: 330 }, scenario.name);
    assert.equal(fixture.actions.length, 0, scenario.name);
  }
});

test("CDP-only drag fails stale before dispatching mouse input when live bounds disappear", async () => {
  const fixture = createPiercedDragFixture({ staleBackendNodeId: 5 });
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("action.drag", true, false);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);
  const commandStart = fixture.debuggerCommands.length;

  await assert.rejects(() => bridge.performAction("drag", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    sourceElementId: snapshot.elements[0].elementId,
    targetElementId: snapshot.elements[2].elementId
  }), { code: "SNAPSHOT_STALE" });

  const dragCommands = fixture.debuggerCommands.slice(commandStart);
  assert.deepEqual(dragCommands.map((command) => command.method), ["DOM.getBoxModel"]);
  assert.equal(dragCommands[0].params.backendNodeId, 5);
});

test("pierced drag verifies document identity before CDP geometry or input", async () => {
  const fixture = createPiercedDragFixture({ documentAvailable: false });
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("action.drag", true, false);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);
  const commandCount = fixture.debuggerCommands.length;

  await assert.rejects(() => bridge.performAction("drag", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    sourceElementId: snapshot.elements[0].elementId,
    targetElementId: snapshot.elements[2].elementId
  }), { code: "SNAPSHOT_STALE" });

  assert.equal(fixture.debuggerCommands.length, commandCount);
  assert.equal(fixture.actions.length, 0);
  assert.deepEqual(fixture.scriptInjections.at(-1).target, { tabId: 1, documentIds: ["doc_main"] });
});

test("CDP-only drag cannot fall through to DOM after Advanced Backend is disabled", async () => {
  const fixture = createPiercedDragFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("action.drag", true, false);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);
  const commandCount = fixture.debuggerCommands.length;
  await bridge.setAdvancedBackendEnabled(false, false);

  await assert.rejects(() => bridge.performAction("drag", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    sourceElementId: snapshot.elements[1].elementId,
    targetElementId: snapshot.elements[0].elementId
  }), { code: "CAPABILITY_UNAVAILABLE" });

  assert.equal(fixture.debuggerCommands.length, commandCount);
  assert.equal(fixture.actions.length, 0);
});

test("drag keeps the existing cross-document restriction even with Advanced Backend enabled", async () => {
  const fixture = createChromeFixture({
    executeScript(injection) {
      if (injection.files) return Promise.resolve([{ result: undefined }]);
      return Promise.resolve([
        {
          frameId: 0,
          documentId: "doc_main",
          result: {
            url: "https://example.com/drag",
            title: "Main",
            viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
            visibleText: "Source",
            closedShadowRootAccessAvailable: true,
            elements: [{
              role: "button",
              label: "Source",
              text: "Source",
              bounds: { x: 10, y: 20, width: 100, height: 40 },
              state: {},
              selectorHint: "#source",
              tagName: "button"
            }]
          }
        },
        {
          frameId: 7,
          documentId: "doc_child",
          result: {
            url: "https://child.example.com/drag",
            title: "Child",
            viewport: { width: 600, height: 400, deviceScaleFactor: 1 },
            visibleText: "Target",
            closedShadowRootAccessAvailable: true,
            elements: [{
              role: "region",
              label: "Target",
              text: "Target",
              bounds: { x: 20, y: 30, width: 120, height: 50 },
              state: {},
              selectorHint: "#target",
              tagName: "section"
            }]
          }
        }
      ]);
    }
  });
  const bridge = createConnectedBridge(fixture);
  await bridge.setCommandPolicyEnabled("action.drag", true, false);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);

  await assert.rejects(() => bridge.performAction("drag", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    sourceElementId: snapshot.elements[0].elementId,
    targetElementId: snapshot.elements[1].elementId
  }), { code: "ACTION_UNSUPPORTED" });

  assert.equal(fixture.actions.length, 0);
  assert.equal(fixture.debuggerCommands.length, 0);
});

test("uses pierced CDP only for inaccessible closed roots when advanced backend is enabled", async () => {
  const fixture = createChromeFixture({
    executeScript(injection) {
      if (injection.files) return Promise.resolve([{ result: undefined }]);
      if (injection.target?.allFrames === true) {
        return Promise.resolve([{
          frameId: 0,
          documentId: "doc_main",
          result: {
            url: "https://example.com/secure",
            title: "Secure",
            viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
            visibleText: "",
            elements: [],
            candidateCount: 0,
            matchedElementCount: 0,
            truncated: false,
            closedShadowRootAccessAvailable: false
          }
        }]);
      }
      return Promise.resolve([{
        frameId: 0,
        documentId: "doc_main",
        result: { width: 1200, height: 800 }
      }]);
    },
    sendDebuggerCommand(_target, method, params) {
      if (method === "DOM.getDocument") {
        assert.deepEqual(params, { depth: -1, pierce: true });
        return Promise.resolve({
          root: {
            nodeType: 9,
            nodeName: "#document",
            backendNodeId: 1,
            children: [{
              nodeType: 1,
              nodeName: "SECURE-SHELL",
              localName: "secure-shell",
              backendNodeId: 2,
              attributes: ["id", "secure"],
              shadowRoots: [{
                nodeType: 11,
                nodeName: "#document-fragment",
                backendNodeId: 3,
                shadowRootType: "closed",
                children: [{
                  nodeType: 1,
                  nodeName: "BUTTON",
                  localName: "button",
                  backendNodeId: 4,
                  attributes: ["id", "closed-action", "aria-label", "Secret action"],
                  children: [{
                    nodeType: 3,
                    nodeName: "#text",
                    backendNodeId: 5,
                    nodeValue: "Secret action"
                  }]
                }]
              }]
            }]
          }
        });
      }
      if (method === "DOM.getBoxModel") {
        assert.deepEqual(params, { backendNodeId: 4 });
        return Promise.resolve({
          model: {
            border: [10, 20, 110, 20, 110, 60, 10, 60],
            content: [10, 20, 110, 20, 110, 60, 10, 60]
          }
        });
      }
      if (method === "DOM.resolveNode") {
        assert.deepEqual(params, { backendNodeId: 4 });
        return Promise.resolve({ object: { objectId: "remote_closed_action" } });
      }
      if (method === "Runtime.callFunctionOn") {
        assert.equal(params.objectId, "remote_closed_action");
        assert.match(params.functionDeclaration, /\.click\(\)/);
        return Promise.resolve({ result: { value: true } });
      }
      return Promise.resolve({});
    }
  });
  const bridge = createConnectedBridge(fixture);

  const normal = await bridge.captureSnapshot(1, { query: "secret action" });
  assert.equal(normal.elements.length, 0);
  assert.equal(fixture.debuggerAttaches.length, 0);

  await bridge.setAdvancedBackendEnabled(true, false);
  const pierced = await bridge.captureSnapshot(1, { query: "secret action" });
  assert.equal(pierced.elements.length, 1);
  assert.equal(pierced.elements[0].elementId, "el_000001");
  assert.equal(pierced.elements[0].frameId, 0);
  assert.equal(pierced.elements[0].documentId, "doc_main");
  assert.equal(pierced.elements[0].role, "button");
  assert.equal(pierced.elements[0].label, "Secret action");
  assert.equal("backendNodeId" in pierced.elements[0], false);
  assert.equal(JSON.stringify(pierced).includes("backendNodeId"), false);
  assert.deepEqual(fixture.debuggerCommands.map((command) => command.method), [
    "DOM.getDocument",
    "DOM.getBoxModel"
  ]);

  const action = await bridge.performAction("click", {
    tabId: 1,
    snapshotId: pierced.snapshotId,
    elementId: pierced.elements[0].elementId
  });
  assert.equal(action.backend, "debugger-cdp");
  assert.equal(action.snapshotInvalidated, true);
  assert.equal(action.details.piercedClosedShadowFallback, true);
  assert.deepEqual(fixture.debuggerCommands.map((command) => command.method), [
    "DOM.getDocument",
    "DOM.getBoxModel",
    "DOM.resolveNode",
    "Runtime.callFunctionOn"
  ]);
  assert.equal(fixture.actions.length, 0);
  assert.equal(fixture.debuggerAttaches.length, 2);
  assert.equal(fixture.debuggerDetaches.length, 2);
});

test("pierced closed-shadow core actions keep the specialized debugger reachability path", async () => {
  const scenarios = [
    ["click", {}],
    ["hover", {}],
    ["type", { text: "Ada" }],
    ["press", { key: "Enter" }],
    ["scroll", { deltaX: 5, deltaY: 120 }]
  ];

  for (const [actionName, extra] of scenarios) {
    const fixture = createPiercedCoreActionFixture();
    const bridge = createConnectedBridge(fixture);
    await bridge.setAdvancedBackendEnabled(true, false);
    const snapshot = await bridge.captureSnapshot(1, { query: "secret input" });
    assert.equal(snapshot.elements.length, 1, actionName);
    assert.equal(JSON.stringify(snapshot).includes("backendNodeId"), false, actionName);
    const commandStart = fixture.debuggerCommands.length;

    const result = await bridge.performAction(actionName, {
      tabId: 1,
      snapshotId: snapshot.snapshotId,
      elementId: snapshot.elements[0].elementId,
      ...extra
    });

    assert.equal(result.backend, "debugger-cdp", actionName);
    assert.equal(result.details.piercedClosedShadowFallback, true, actionName);
    assert.equal(result.details.action, actionName, actionName);
    assert.deepEqual(
      fixture.debuggerCommands.slice(commandStart).map((command) => command.method),
      ["DOM.resolveNode", "Runtime.callFunctionOn"],
      actionName
    );
    assert.equal(fixture.actions.length, 0, actionName);
  }
});

test("pierced actions verify the captured document before resolving CDP nodes", async () => {
  const fixture = createPiercedCoreActionFixture({ documentAvailable: false });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1, { query: "secret input" });
  const commandCount = fixture.debuggerCommands.length;
  const attachCount = fixture.debuggerAttaches.length;

  await assert.rejects(() => bridge.performAction("type", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId,
    text: "Ada"
  }), { code: "SNAPSHOT_STALE" });

  assert.equal(fixture.debuggerCommands.length, commandCount);
  assert.equal(fixture.debuggerAttaches.length, attachCount);
  assert.deepEqual(fixture.scriptInjections.at(-1).target, { tabId: 1, documentIds: ["doc_main"] });
});

test("pierced closed-shadow actions never fall through to DOM after Advanced Backend is disabled", async () => {
  const fixture = createPiercedCoreActionFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1, { query: "secret input" });
  const commandCount = fixture.debuggerCommands.length;
  await bridge.setAdvancedBackendEnabled(false, false);

  await assert.rejects(() => bridge.performAction("type", {
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    elementId: snapshot.elements[0].elementId,
    text: "Ada"
  }), { code: "CAPABILITY_UNAVAILABLE" });

  assert.equal(fixture.debuggerCommands.length, commandCount);
  assert.equal(fixture.actions.length, 0);
});

test("pierced fallback still reports closed-root counts when normal results fill the requested limit", async () => {
  const fixture = createChromeFixture({
    executeScript(injection) {
      if (injection.files) return Promise.resolve([{ result: undefined }]);
      if (injection.target?.allFrames === true) {
        return Promise.resolve([{
          frameId: 0,
          documentId: "doc_main",
          result: {
            url: "https://example.com/secure-counts",
            title: "Secure counts",
            viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
            visibleText: "Normal action",
            elements: [{
              role: "button",
              label: "Normal action",
              text: "Normal action",
              bounds: { x: 10, y: 20, width: 100, height: 40 },
              state: {},
              selectorHint: "#normal-action",
              tagName: "button"
            }],
            candidateCount: 1,
            matchedElementCount: 1,
            truncated: false,
            closedShadowRootAccessAvailable: false
          }
        }]);
      }
      return Promise.resolve([{ frameId: 0, documentId: "doc_main", result: {} }]);
    },
    sendDebuggerCommand(_target, method, params) {
      if (method === "DOM.getDocument") {
        return Promise.resolve({
          root: {
            nodeType: 9,
            nodeName: "#document",
            backendNodeId: 1,
            children: [{
              nodeType: 1,
              nodeName: "SECURE-SHELL",
              localName: "secure-shell",
              backendNodeId: 2,
              shadowRoots: [{
                nodeType: 11,
                nodeName: "#document-fragment",
                backendNodeId: 3,
                shadowRootType: "closed",
                children: [{
                  nodeType: 1,
                  nodeName: "BUTTON",
                  localName: "button",
                  backendNodeId: 4,
                  attributes: ["id", "closed-action", "aria-label", "Closed action"],
                  children: [{
                    nodeType: 3,
                    nodeName: "#text",
                    backendNodeId: 5,
                    nodeValue: "Closed action"
                  }]
                }]
              }]
            }]
          }
        });
      }
      if (method === "DOM.getBoxModel") {
        assert.deepEqual(params, { backendNodeId: 4 });
        return Promise.resolve({
          model: { border: [200, 20, 300, 20, 300, 60, 200, 60] }
        });
      }
      return Promise.resolve({});
    }
  });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);

  const snapshot = await bridge.captureSnapshot(1, { maxElements: 1 });

  assert.equal(snapshot.elements.length, 1);
  assert.equal(snapshot.elements[0].label, "Normal action");
  assert.equal(snapshot.candidateCount, 2);
  assert.equal(snapshot.matchedElementCount, 2);
  assert.equal(snapshot.truncated, true);
  assert.deepEqual(fixture.debuggerCommands.map((command) => command.method), [
    "DOM.getDocument",
    "DOM.getBoxModel"
  ]);
});

test("atomic fill-form validates normal and CDP-only fields before either backend writes", async () => {
  const { fixture, chronology } = createPiercedFillFormFixture();
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);
  assert.equal(snapshot.elements.length, 2);
  chronology.length = 0;
  fixture.actions.length = 0;

  const result = await bridge.fillForm({
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    fields: [
      { elementId: snapshot.elements[0].elementId, value: "Ada" },
      { elementId: snapshot.elements[1].elementId, value: "Lovelace" }
    ]
  });

  assert.equal(result.backend, "debugger-cdp");
  assert.equal(result.snapshotInvalidated, true);
  assert.deepEqual(result.fields.map((field) => field.ok), [true, true]);
  assert.equal(result.details.mixedBackends, true);
  assert.equal(result.details.normalFieldCount, 1);
  assert.equal(result.details.debuggerFieldCount, 1);
  assert.deepEqual(chronology, [
    "normal-validate",
    "cdp-resolve",
    "cdp-validate",
    "normal-mutate",
    "cdp-mutate"
  ]);
  assert.equal(fixture.actions.length, 2);
  assert.equal(fixture.actions[0].validateOnly, true);
  assert.equal(fixture.actions[1].validateOnly, undefined);
});

test("atomic mixed fill-form does not mutate normal fields when a CDP-only target fails validation", async () => {
  const { fixture, chronology } = createPiercedFillFormFixture({ debuggerEditable: false });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);
  chronology.length = 0;
  fixture.actions.length = 0;

  await assert.rejects(() => bridge.fillForm({
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    fields: [
      { elementId: snapshot.elements[0].elementId, value: "Ada" },
      { elementId: snapshot.elements[1].elementId, value: "Lovelace" }
    ]
  }), { code: "ACTION_UNSUPPORTED" });

  assert.deepEqual(chronology, ["normal-validate", "cdp-resolve", "cdp-validate"]);
  assert.equal(fixture.actions.length, 1);
  assert.equal(fixture.actions[0].validateOnly, true);
});

test("atomic mixed fill-form performs zero mutations when a pierced document was replaced", async () => {
  const { fixture, chronology } = createPiercedFillFormFixture({ documentAvailable: false });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);
  chronology.length = 0;
  fixture.actions.length = 0;
  const commandCount = fixture.debuggerCommands.length;

  await assert.rejects(() => bridge.fillForm({
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    fields: [
      { elementId: snapshot.elements[0].elementId, value: "Ada" },
      { elementId: snapshot.elements[1].elementId, value: "Lovelace" }
    ]
  }), { code: "SNAPSHOT_STALE" });

  assert.deepEqual(chronology, ["normal-validate"]);
  assert.equal(fixture.actions.length, 1);
  assert.equal(fixture.actions[0].validateOnly, true);
  assert.equal(fixture.debuggerCommands.length, commandCount);
});

test("partial mixed fill-form reports a stale CDP-only field without blocking a normal field", async () => {
  const { fixture, chronology } = createPiercedFillFormFixture({ resolveFails: true });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);
  chronology.length = 0;
  fixture.actions.length = 0;

  const result = await bridge.fillForm({
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    partial: true,
    fields: [
      { elementId: snapshot.elements[0].elementId, value: "Ada" },
      { elementId: snapshot.elements[1].elementId, value: "Lovelace" }
    ]
  });

  assert.equal(result.backend, "debugger-cdp");
  assert.equal(result.snapshotInvalidated, true);
  assert.deepEqual(result.fields.map((field) => [field.ok, field.error?.code]), [
    [true, undefined],
    [false, "SNAPSHOT_STALE"]
  ]);
  assert.equal(result.details.succeeded, 1);
  assert.equal(result.details.failed, 1);
  assert.deepEqual(chronology, ["normal-mutate", "cdp-resolve"]);
  assert.equal(fixture.actions.length, 1);
  assert.equal(fixture.actions[0].partial, true);
});

test("partial mixed fill-form isolates a replaced pierced document to that field", async () => {
  const { fixture, chronology } = createPiercedFillFormFixture({ documentAvailable: false });
  const bridge = createConnectedBridge(fixture);
  await bridge.setAdvancedBackendEnabled(true, false);
  const snapshot = await bridge.captureSnapshot(1);
  chronology.length = 0;
  fixture.actions.length = 0;
  const commandCount = fixture.debuggerCommands.length;

  const result = await bridge.fillForm({
    tabId: 1,
    snapshotId: snapshot.snapshotId,
    partial: true,
    fields: [
      { elementId: snapshot.elements[0].elementId, value: "Ada" },
      { elementId: snapshot.elements[1].elementId, value: "Lovelace" }
    ]
  });

  assert.deepEqual(result.fields.map((field) => [field.ok, field.error?.code]), [
    [true, undefined],
    [false, "SNAPSHOT_STALE"]
  ]);
  assert.deepEqual(chronology, ["normal-mutate"]);
  assert.equal(fixture.actions.length, 1);
  assert.equal(fixture.debuggerCommands.length, commandCount);
});

test("detaches debugger sessions when a debugger command fails after attach", async () => {
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

  await assert.rejects(() => bridge.handleDialog("dismiss", { tabId: 1 }), {
    code: "CAPABILITY_UNAVAILABLE"
  });
  assert.equal(fixture.debuggerAttaches.length, 1);
  assert.equal(fixture.debuggerDetaches.length, 1);
});

test("dismisses cookie banners conservatively and prefers reject controls", async () => {
  const fixture = createChromeFixture({
    executeScript(injection, actions) {
      if (isActionInjection(injection)) {
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

test("maps Chrome access failures to BROWSER_ACCESS_DENIED", async () => {
  const captureFixture = createChromeFixture({
    captureVisibleTab() {
      return Promise.reject(new Error("Cannot access contents of the page."));
    }
  });
  const captureBridge = createConnectedBridge(captureFixture);
  await assert.rejects(() => captureBridge.captureScreenshot(1), { code: "BROWSER_ACCESS_DENIED" });

  const scriptFixture = createChromeFixture({
    executeScript() {
      return Promise.reject(new Error("Cannot access contents of url."));
    }
  });
  const scriptBridge = createConnectedBridge(scriptFixture);
  await assert.rejects(() => scriptBridge.captureSnapshot(1), { code: "BROWSER_ACCESS_DENIED" });
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
    protocolVersion: "2",
    requestId,
    kind: "request",
    type,
    payload,
    auth: { brokerToken: TEST_BROKER_TOKEN }
  };
}

function response(requestId, result) {
  return {
    protocolVersion: "2",
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
      navigationPolicyEnabled: true,
      policyMode: "blocklist",
      allowedNavigationRules: [],
      blockedNavigationRules: [],
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

test("terminal settings do not mutate bridge, policy, or UX state", async () => {
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

test("terminal request timeout preserves the native host and recovers on late traffic", async () => {
  const fixture = createChromeFixture();
  const requestTimers = createTimeoutFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome, {
    setTimeout: requestTimers.setTimeout,
    clearTimeout: requestTimers.clearTimeout,
    terminalRequestTimeoutMs: 5
  });

  const terminalPromise = bridge.sendTerminalClientMessage({
    type: "terminal.sessions.list",
    requestId: "treq_timeout",
    payload: {}
  });
  await waitFor(() => fixture.ports.length === 1);
  const terminalPort = fixture.ports[0];
  assert.equal(requestTimers.callbacks.length, 1);

  requestTimers.callbacks[0]();
  await assert.rejects(terminalPromise, { code: "COMMAND_TIMEOUT" });
  assert.equal((await bridge.getStatus()).terminalNativeHostState, "unresponsive");
  assert.equal(terminalPort.disconnected, false);
  assert.equal(fixture.ports.length, 1);

  terminalPort.emitMessage({
    type: "terminal.sessions",
    requestId: "treq_timeout",
    payload: { sessions: [], activeTerminalId: null }
  });
  await waitFor(async () => (await bridge.getStatus()).terminalNativeHostState === "connected");
  assert.equal(terminalPort.disconnected, false);
  assert.equal(fixture.ports.length, 1);
});

test("explicit terminal restart replaces the native host connection", async () => {
  const fixture = createChromeFixture();
  const bridge = createPortusExtensionBridge(fixture.chrome);

  const terminalPromise = bridge.sendTerminalClientMessage({
    type: "terminal.sessions.list",
    requestId: "treq_restart_ready",
    payload: {}
  });
  await waitFor(() => fixture.ports.length === 1);
  const originalPort = fixture.ports[0];
  originalPort.emitMessage({
    type: "terminal.sessions",
    requestId: "treq_restart_ready",
    payload: { sessions: [], activeTerminalId: null }
  });
  await terminalPromise;

  const result = await bridge.handleRuntimeMessage({ type: "portus.terminal.restart" });

  assert.equal(originalPort.disconnected, true);
  assert.equal(fixture.ports.length, 2);
  assert.deepEqual(fixture.connectedHostNames, ["com.portus.browser.terminal", "com.portus.browser.terminal"]);
  assert.equal(result.status.terminalNativeHostState, "connected");
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

function shadowPathShape(path) {
  return path?.map(({ hostSelectorHint, rootType }) => ({ hostSelectorHint, rootType }));
}

function isActionInjection(injection) {
  const payload = Array.isArray(injection.args) ? injection.args[0] : undefined;
  return payload !== null && typeof payload === "object" && typeof payload.action === "string";
}

function isInternalAction(action) {
  return action === "__portus.inspect-target"
    || action === "__portus.finalize-type"
    || action === "__portus.prepare-upload"
    || action === "__portus.finalize-upload";
}

function defaultInternalActionResult(payload) {
  if (payload.action === "__portus.finalize-type") {
    return { ok: true, details: { action: payload.action, targetValidated: true } };
  }
  if (payload.action === "__portus.prepare-upload" || payload.action === "__portus.finalize-upload") {
    return { ok: true, details: { action: payload.action, targetValidated: true, multiple: true } };
  }
  const target = payload.target && typeof payload.target === "object" ? payload.target : {};
  const bounds = target.bounds && typeof target.bounds === "object"
    ? target.bounds
    : { x: 10, y: 20, width: 100, height: 40 };
  return {
    ok: true,
    details: {
      action: payload.action,
      targetValidated: true,
      bounds,
      inViewport: true,
      editable: target.editable === true,
      ...(typeof target.inputType === "string" ? { inputType: target.inputType } : {}),
      canScrollX: false,
      canScrollY: false,
      canScrollDeltaX: false,
      canScrollDeltaY: false
    }
  };
}

function isHistoryInjection(injection) {
  const direction = Array.isArray(injection.args) ? injection.args[0] : undefined;
  return direction === "back" || direction === "forward";
}

function withInjectionMetadata(injection, results) {
  if (!Array.isArray(results)) return results;
  const targetedDocumentId = Array.isArray(injection.target?.documentIds) ? injection.target.documentIds[0] : undefined;
  const targetedFrameId = Array.isArray(injection.target?.frameIds) ? injection.target.frameIds[0] : undefined;
  return results.map((entry, index) => {
    if (entry === null || typeof entry !== "object") return entry;
    const frameId = Number.isInteger(entry.frameId)
      ? entry.frameId
      : Number.isInteger(targetedFrameId)
        ? targetedFrameId
        : index === 0 ? 0 : index;
    const documentId = typeof entry.documentId === "string" && entry.documentId.length > 0
      ? entry.documentId
      : targetedDocumentId ?? `doc_frame_${frameId}`;
    return { ...entry, frameId, documentId };
  });
}

function createPiercedFillFormFixture({ debuggerEditable = true, resolveFails = false, documentAvailable = true } = {}) {
  const chronology = [];
  const fixture = createChromeFixture({
    executeScript(injection, actions) {
      if (injection.files) return Promise.resolve([{ result: undefined }]);
      if (Array.isArray(injection.target?.documentIds) && !Array.isArray(injection.args)) {
        if (!documentAvailable) return Promise.reject(new Error("No document with id doc_main"));
        return Promise.resolve([{ frameId: 0, documentId: injection.target.documentIds[0], result: true }]);
      }
      if (isActionInjection(injection)) {
        const payload = injection.args[0];
        actions.push(payload);
        if (payload.action === "fillForm") {
          chronology.push(payload.validateOnly === true ? "normal-validate" : "normal-mutate");
          return Promise.resolve([{
            frameId: 0,
            documentId: "doc_main",
            result: {
              ok: true,
              details: {
                action: "fillForm",
                partial: payload.partial === true,
                validateOnly: payload.validateOnly === true,
                fields: payload.fields.map((field) => ({ elementId: field.elementId, ok: true }))
              }
            }
          }]);
        }
      }
      if (injection.target?.allFrames === true) {
        return Promise.resolve([{
          frameId: 0,
          documentId: "doc_main",
          result: {
            url: "https://example.com/mixed-form",
            title: "Mixed form",
            viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
            visibleText: "Public name",
            closedShadowRootAccessAvailable: false,
            candidateCount: 1,
            matchedElementCount: 1,
            truncated: false,
            elements: [{
              role: "textbox",
              label: "Public name",
              text: "",
              bounds: { x: 10, y: 20, width: 180, height: 32 },
              state: { value: "" },
              selectorHint: "#public-name",
              tagName: "input",
              editable: true,
              inputType: "text",
              name: "publicName"
            }]
          }
        }]);
      }
      return Promise.resolve([{ result: {} }]);
    },
    sendDebuggerCommand(_target, method, params) {
      if (method === "DOM.getDocument") {
        return Promise.resolve({
          root: {
            nodeType: 9,
            nodeName: "#document",
            backendNodeId: 1,
            children: [{
              nodeType: 1,
              nodeName: "SECURE-SHELL",
              localName: "secure-shell",
              backendNodeId: 2,
              shadowRoots: [{
                nodeType: 11,
                nodeName: "#document-fragment",
                backendNodeId: 3,
                shadowRootType: "closed",
                children: [{
                  nodeType: 1,
                  nodeName: "INPUT",
                  localName: "input",
                  backendNodeId: 4,
                  attributes: ["id", "secret-name", "aria-label", "Secret name", "type", "text", "name", "secretName"]
                }]
              }]
            }]
          }
        });
      }
      if (method === "DOM.getBoxModel") {
        assert.deepEqual(params, { backendNodeId: 4 });
        return Promise.resolve({ model: { border: [10, 70, 190, 70, 190, 102, 10, 102] } });
      }
      if (method === "DOM.resolveNode") {
        chronology.push("cdp-resolve");
        if (resolveFails) return Promise.reject(new Error("Node no longer exists"));
        return Promise.resolve({ object: { objectId: "remote_secret_name" } });
      }
      if (method === "Runtime.callFunctionOn") {
        assert.equal(params.objectId, "remote_secret_name");
        if (String(params.functionDeclaration).includes("return String(this.type||'text').toLowerCase()!=='file'")) {
          chronology.push("cdp-validate");
          return Promise.resolve({ result: { value: debuggerEditable } });
        }
        if (String(params.functionDeclaration).includes("this.value=String(value)")) {
          chronology.push("cdp-mutate");
          return Promise.resolve({ result: { value: true } });
        }
      }
      return Promise.resolve({});
    }
  });
  return { fixture, chronology };
}

function createPiercedDragFixture({ staleBackendNodeId, documentAvailable = true } = {}) {
  const boxCalls = new Map();
  return createChromeFixture({
    executeScript(injection) {
      if (injection.files) return Promise.resolve([{ result: undefined }]);
      if (Array.isArray(injection.target?.documentIds) && !Array.isArray(injection.args)) {
        if (!documentAvailable) return Promise.reject(new Error("No document with id doc_main"));
        return Promise.resolve([{ frameId: 0, documentId: injection.target.documentIds[0], result: true }]);
      }
      const payload = Array.isArray(injection.args) ? injection.args[0] : undefined;
      if (payload && typeof payload === "object" && payload.action === "__portus.inspect-target") {
        return Promise.resolve([{
          frameId: 0,
          documentId: "doc_main",
          result: defaultInternalActionResult(payload)
        }]);
      }
      if (injection.target?.allFrames === true) {
        return Promise.resolve([{
          frameId: 0,
          documentId: "doc_main",
          result: {
            url: "https://example.com/drag-shadow",
            title: "Drag shadow",
            viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
            visibleText: "Normal source",
            closedShadowRootAccessAvailable: false,
            candidateCount: 1,
            matchedElementCount: 1,
            truncated: false,
            elements: [{
              role: "button",
              label: "Normal source",
              text: "Normal source",
              bounds: { x: 10, y: 20, width: 100, height: 40 },
              state: {},
              selectorHint: "#normal-source",
              tagName: "button"
            }]
          }
        }]);
      }
      return Promise.resolve([{ result: {} }]);
    },
    sendDebuggerCommand(_target, method, params) {
      if (method === "DOM.getDocument") {
        return Promise.resolve({
          root: {
            nodeType: 9,
            nodeName: "#document",
            backendNodeId: 1,
            children: [{
              nodeType: 1,
              nodeName: "SECURE-SHELL",
              localName: "secure-shell",
              backendNodeId: 2,
              shadowRoots: [{
                nodeType: 11,
                nodeName: "#document-fragment",
                backendNodeId: 3,
                shadowRootType: "closed",
                children: [
                  {
                    nodeType: 1,
                    nodeName: "BUTTON",
                    localName: "button",
                    backendNodeId: 4,
                    attributes: ["id", "secret-source", "aria-label", "Secret source"]
                  },
                  {
                    nodeType: 1,
                    nodeName: "SECTION",
                    localName: "section",
                    backendNodeId: 5,
                    attributes: ["id", "secret-target", "role", "region", "aria-label", "Secret target"]
                  }
                ]
              }]
            }]
          }
        });
      }
      if (method === "DOM.getBoxModel") {
        const backendNodeId = params.backendNodeId;
        const call = (boxCalls.get(backendNodeId) ?? 0) + 1;
        boxCalls.set(backendNodeId, call);
        if (call > 1 && backendNodeId === staleBackendNodeId) {
          return Promise.reject(new Error("Node no longer has a box"));
        }
        if (backendNodeId === 4) {
          const border = call === 1
            ? [300, 20, 400, 20, 400, 60, 300, 60]
            : [500, 100, 600, 100, 600, 160, 500, 160];
          return Promise.resolve({ model: { border } });
        }
        if (backendNodeId === 5) {
          const border = call === 1
            ? [600, 200, 700, 200, 700, 260, 600, 260]
            : [700, 300, 800, 300, 800, 360, 700, 360];
          return Promise.resolve({ model: { border } });
        }
      }
      return Promise.resolve({});
    }
  });
}

function createPiercedCoreActionFixture({ documentAvailable = true } = {}) {
  return createChromeFixture({
    executeScript(injection) {
      if (injection.files) return Promise.resolve([{ result: undefined }]);
      if (Array.isArray(injection.target?.documentIds) && !Array.isArray(injection.args)) {
        if (!documentAvailable) return Promise.reject(new Error("No document with id doc_main"));
        return Promise.resolve([{ frameId: 0, documentId: injection.target.documentIds[0], result: true }]);
      }
      if (injection.target?.allFrames === true) {
        return Promise.resolve([{
          frameId: 0,
          documentId: "doc_main",
          result: {
            url: "https://example.com/pierced-core",
            title: "Pierced core",
            viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
            visibleText: "",
            closedShadowRootAccessAvailable: false,
            candidateCount: 0,
            matchedElementCount: 0,
            truncated: false,
            elements: []
          }
        }]);
      }
      return Promise.resolve([{ frameId: 0, documentId: "doc_main", result: {} }]);
    },
    sendDebuggerCommand(_target, method, params) {
      if (method === "DOM.getDocument") {
        return Promise.resolve({
          root: {
            nodeType: 9,
            nodeName: "#document",
            backendNodeId: 1,
            children: [{
              nodeType: 1,
              nodeName: "SECURE-SHELL",
              localName: "secure-shell",
              backendNodeId: 2,
              shadowRoots: [{
                nodeType: 11,
                nodeName: "#document-fragment",
                backendNodeId: 3,
                shadowRootType: "closed",
                children: [{
                  nodeType: 1,
                  nodeName: "INPUT",
                  localName: "input",
                  backendNodeId: 4,
                  attributes: ["id", "secret-input", "aria-label", "Secret input", "type", "text", "name", "secretInput"]
                }]
              }]
            }]
          }
        });
      }
      if (method === "DOM.getBoxModel") {
        assert.deepEqual(params, { backendNodeId: 4 });
        return Promise.resolve({ model: { border: [20, 30, 220, 30, 220, 70, 20, 70] } });
      }
      if (method === "DOM.resolveNode") {
        assert.deepEqual(params, { backendNodeId: 4 });
        return Promise.resolve({ object: { objectId: "remote_pierced_core" } });
      }
      if (method === "Runtime.callFunctionOn") {
        assert.equal(params.objectId, "remote_pierced_core");
        return Promise.resolve({ result: { value: true } });
      }
      return Promise.resolve({});
    }
  });
}

function createAdvancedActionFixture({
  element,
  inspection = {},
  inspectError = null,
  frameId = 0,
  documentId = frameId === 0 ? "doc_main" : "doc_child",
  sendDebuggerCommand,
  attachDebugger
} = {}) {
  const snapshotElement = element ?? {
    role: "button",
    label: "Submit",
    text: "Submit",
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    state: {},
    selectorHint: "#submit",
    tagName: "button"
  };
  const pageResult = {
    url: "https://example.com/advanced-action",
    title: "Advanced action",
    viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
    visibleText: snapshotElement.label ?? snapshotElement.text ?? "",
    closedShadowRootAccessAvailable: true,
    candidateCount: 1,
    matchedElementCount: 1,
    truncated: false,
    elements: [snapshotElement]
  };
  return createChromeFixture({
    executeScript(injection, actions) {
      if (injection.files) return Promise.resolve([{ result: undefined }]);
      if (isActionInjection(injection)) {
        const payload = injection.args[0];
        if (payload.action === "__portus.inspect-target") {
          return Promise.resolve([{
            frameId,
            documentId,
            result: inspectError
              ? { ok: false, error: inspectError }
              : {
                  ok: true,
                  details: {
                    action: payload.action,
                    targetValidated: true,
                    bounds: inspection.bounds ?? payload.target.bounds,
                    inViewport: inspection.inViewport ?? true,
                    editable: inspection.editable ?? payload.target.editable === true,
                    ...(inspection.inputType !== undefined
                      ? { inputType: inspection.inputType }
                      : typeof payload.target.inputType === "string"
                        ? { inputType: payload.target.inputType }
                        : {}),
                    canScrollX: inspection.canScrollX ?? false,
                    canScrollY: inspection.canScrollY ?? false,
                    canScrollDeltaX: inspection.canScrollDeltaX ?? false,
                    canScrollDeltaY: inspection.canScrollDeltaY ?? false
                  }
                }
          }]);
        }
        if (payload.action === "__portus.finalize-type") {
          return Promise.resolve([{
            frameId,
            documentId,
            result: { ok: true, details: { action: payload.action, targetValidated: true } }
          }]);
        }
        actions.push(payload);
        return Promise.resolve([{
          frameId,
          documentId,
          result: { ok: true, details: { action: payload.action, targetValidated: true } }
        }]);
      }
      if (injection.target?.allFrames === true) {
        if (frameId === 0) return Promise.resolve([{ frameId, documentId, result: pageResult }]);
        return Promise.resolve([
          {
            frameId: 0,
            documentId: "doc_main",
            result: {
              url: "https://example.com/advanced-action",
              title: "Advanced action",
              viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
              visibleText: "",
              closedShadowRootAccessAvailable: true,
              candidateCount: 0,
              matchedElementCount: 0,
              truncated: false,
              elements: []
            }
          },
          { frameId, documentId, result: pageResult }
        ]);
      }
      return Promise.resolve([{ frameId, documentId, result: {} }]);
    },
    ...(sendDebuggerCommand ? { sendDebuggerCommand } : {}),
    ...(attachDebugger ? { attachDebugger } : {})
  });
}

function createChromeFixture(overrides = {}) {
  const ports = [];
  const connectedHostNames = [];
  const capturedWindows = [];
  const tabUpdates = [];
  let activeTabId = overrides.activeTabId ?? 1;
  const actions = [];
  const scriptInjections = [];
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
    capturedWindows,
    tabUpdates,
    activeTabId: () => activeTabId,
    actions,
    scriptInjections,
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
          const tabs = [
            chromeTab(1, "https://example.com/a", activeTabId === 1),
            chromeTab(2, "https://example.com/b", activeTabId === 2)
          ];
          return Promise.resolve(queryInfo.active === true ? tabs.filter((tab) => tab.active) : tabs);
        },
        get(tabId) {
          if (overrides.getTab) return overrides.getTab(tabId);
          return Promise.resolve(chromeTab(tabId, `https://example.com/${tabId}`, tabId === activeTabId));
        },
        create(properties) {
          return Promise.resolve(chromeTab(3, properties.url, properties.active ?? true));
        },
        update(tabId, properties) {
          tabUpdates.push({ tabId, properties });
          if (overrides.updateTab) return overrides.updateTab(tabId, properties);
          if (properties.active === true) activeTabId = tabId;
          return Promise.resolve(chromeTab(
            tabId,
            properties.url ?? `https://example.com/${tabId}`,
            properties.active ?? activeTabId === tabId
          ));
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
        async executeScript(injection) {
          scriptInjections.push(injection);
          let result;
          if (overrides.executeScript) result = await overrides.executeScript(injection, actions);
          else if (isActionInjection(injection)) {
            const payload = injection.args[0];
            if (isInternalAction(payload.action)) {
              result = [{ result: defaultInternalActionResult(payload) }];
            } else {
              actions.push(payload);
              result = [{ result: { ok: true, details: { action: payload.action } } }];
            }
          } else if (isHistoryInjection(injection)) {
            actions.push(injection.args[0]);
            result = [{ result: { ok: true } }];
          } else {
            result = await defaultSnapshotScriptResult();
          }
          return withInjectionMetadata(injection, result);
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
      closedShadowRootAccessAvailable: true,
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
