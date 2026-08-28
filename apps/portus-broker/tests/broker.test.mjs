import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_COMMAND_POLICY } from "@portus/protocol";
import { deserializeTransportFrame, serializeTransportFrame } from "@portus/transport";
import { createBroker as createRealBroker, createBrokerNamedPipeServer as createRealBrokerNamedPipeServer } from "../dist/index.js";

const TEST_BROKER_TOKEN = "test-broker-token";

function createBroker(options = {}) {
  return createRealBroker({ settingsProfilesPath: null, ...options });
}

function createBrokerNamedPipeServer(options = {}) {
  return createRealBrokerNamedPipeServer({ settingsProfilesPath: null, ...options });
}

function request(requestId, type, payload = {}, extras = {}) {
  const auth = Object.prototype.hasOwnProperty.call(extras, "auth")
    ? {}
    : { auth: { brokerToken: TEST_BROKER_TOKEN } };
  return {
    ...auth,
    protocolVersion: "2",
    requestId,
    kind: "request",
    type,
    payload,
    ...extras
  };
}

const registration = {
  browserName: "Chrome",
  extensionVersion: "0.1.0",
  extensionId: "chrome-extension-id",
  bridgeStatus: "connected",
  capabilities: ["tabs", "events", "screenshots", "snapshots", "actions", "policy"]
};

test("validates config at startup and exposes the platform-local endpoint", () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN });
  const expectedTransport = process.platform === "win32" ? "named-pipe" : "unix-socket";
  const expectedPathSuffix =
    process.platform === "win32" ? "\\\\.\\pipe\\portus-browser-broker" : "/portus-browser-broker.sock";

  assert.equal(broker.endpoint.transport, expectedTransport);
  assert.equal(broker.endpoint.pipeName, "portus-browser-broker");
  assert.equal(broker.pipePath.endsWith(expectedPathSuffix), true);
  assert.throws(() => createBroker({ config: { broker: { allowRemoteConnections: true } } }));
});

test("serves validated requests over the named pipe transport", async () => {
  const pipeName = `portus-broker-test-${process.pid}-${Date.now()}`;
  const server = createBrokerNamedPipeServer({
    brokerToken: TEST_BROKER_TOKEN,
    config: {
      broker: { pipeName },
      nativeHost: { brokerPipeName: pipeName }
    },
    now: fixedClock()
  });

  await server.start();
  try {
    const socket = createConnection(server.broker.pipePath);
    const responsePromise = readOneTransportFrame(socket);
    socket.write(serializeTransportFrame(request("req_001", "browser.list")));
    const frame = await responsePromise;
    assert.equal(frame.message.kind, "response");
    assert.equal(frame.message.ok, true);
    assert.deepEqual(frame.message.result.browsers, []);
    socket.end();
  } finally {
    await server.stop();
  }
});

test("rejects missing and invalid broker tokens before dispatch", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });

  const missing = await broker.handleRequest(request("req_missing", "browser.list", {}, { auth: undefined }));
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "BROKER_TOKEN_REQUIRED");

  const invalid = await broker.handleRequest(request("req_invalid_token", "browser.list", {}, {
    auth: { brokerToken: "wrong-token" }
  }));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "BROKER_TOKEN_INVALID");

  const valid = await broker.handleRequest(request("req_valid_token", "browser.list"));
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.result.browsers, []);
});

test("reports broker status and stops through the broker protocol", async () => {
  const pipeName = `portus-broker-stop-test-${process.pid}-${Date.now()}`;
  const server = createBrokerNamedPipeServer({
    brokerToken: TEST_BROKER_TOKEN,
    config: {
      broker: { pipeName },
      nativeHost: { brokerPipeName: pipeName }
    },
    now: fixedClock()
  });

  await server.start();
  const socket = createConnection(server.broker.pipePath);
  try {
    await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));

    socket.write(serializeTransportFrame(request("req_status", "broker.status")));
    const statusFrame = await readOneTransportFrame(socket);
    assert.equal(statusFrame.message.ok, true);
    assert.equal(statusFrame.message.result.running, true);
    assert.equal(statusFrame.message.result.pipeName, pipeName);

    socket.write(serializeTransportFrame(request("req_stop", "broker.stop")));
    const stopFrame = await readOneTransportFrame(socket);
    assert.equal(stopFrame.message.ok, true);
    assert.equal(stopFrame.message.result.stopping, true);

    await new Promise((resolve) => server.server.once("close", resolve));
  } finally {
    socket.destroy();
    await server.stop();
  }
});

test("rejects unauthenticated broker stop without stopping server", async () => {
  const pipeName = `portus-broker-stop-auth-test-${process.pid}-${Date.now()}`;
  const server = createBrokerNamedPipeServer({
    brokerToken: TEST_BROKER_TOKEN,
    config: {
      broker: { pipeName },
      nativeHost: { brokerPipeName: pipeName }
    },
    now: fixedClock()
  });

  await server.start();
  const socket = createConnection(server.broker.pipePath);
  try {
    await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));

    socket.write(serializeTransportFrame(request("req_stop_missing", "broker.stop", {}, { auth: undefined })));
    const stopFrame = await readOneTransportFrame(socket);
    assert.equal(stopFrame.message.ok, false);
    assert.equal(stopFrame.message.error.code, "BROKER_TOKEN_REQUIRED");

    socket.write(serializeTransportFrame(request("req_status_after_failed_stop", "broker.status")));
    const statusFrame = await readOneTransportFrame(socket);
    assert.equal(statusFrame.message.ok, true);
    assert.equal(statusFrame.message.result.running, true);
  } finally {
    socket.destroy();
    await server.stop();
  }
});

test("rejects routed command requests when the bridge socket closes", async () => {
  const pipeName = `portus-broker-close-test-${process.pid}-${Date.now()}`;
  const server = createBrokerNamedPipeServer({
    brokerToken: TEST_BROKER_TOKEN,
    config: {
      broker: { pipeName },
      nativeHost: { brokerPipeName: pipeName },
      commands: { timeoutMs: 1000 }
    },
    now: fixedClock()
  });

  await server.start();
  const bridgeSocket = createConnection(server.broker.pipePath);
  const cliSocket = createConnection(server.broker.pipePath);
  try {
    await Promise.all([
      new Promise((resolve, reject) => bridgeSocket.once("connect", resolve).once("error", reject)),
      new Promise((resolve, reject) => cliSocket.once("connect", resolve).once("error", reject))
    ]);

    bridgeSocket.write(serializeTransportFrame(request("req_bridge_register", "bridge.register", registrationWithCommandPolicy({
      "action.click": true
    }))));
    const registerFrame = await readOneTransportFrame(bridgeSocket);
    const browserId = registerFrame.message.result.browserId;

    const responsePromise = readOneTransportFrame(cliSocket);
    cliSocket.write(serializeTransportFrame(request("req_cli_action", "action.click", {
      browserId,
      tabId: 1,
      elementId: "el_001"
    })));

    await new Promise((resolve) => setTimeout(resolve, 0));
    bridgeSocket.destroy();
    const responseFrame = await responsePromise;

    assert.equal(responseFrame.message.kind, "response");
    assert.equal(responseFrame.message.ok, false);
    assert.equal(responseFrame.message.error.code, "NATIVE_HOST_UNAVAILABLE");
    assert.equal(responseFrame.message.error.retryable, true);
  } finally {
    bridgeSocket.destroy();
    cliSocket.destroy();
    await server.stop();
  }
});

test("registers bridge-connected sessions and lists only available sessions by default", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const events = [];
  broker.subscribeEvents((event) => events.push(event));

  const register = await broker.handleRequest(request("req_001", "bridge.register", registration));
  assert.equal(register.ok, true);
  assert.equal(register.result.browserId, "br_000001");

  const list = await broker.handleRequest(request("req_002", "browser.list"));
  assert.equal(list.ok, true);
  assert.equal(list.result.browsers.length, 1);
  assert.equal(list.result.browsers[0].browserId, "br_000001");
  assert.deepEqual(events.map((event) => event.type), ["bridge.connected", "session.registered"]);
});

test("accepts heartbeats and disconnects bridge sessions", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const bridgeClient = {
    async sendCommand() {
      return { ok: true };
    }
  };
  const register = await broker.handleRequest(request("req_001", "bridge.register", registrationWithCommandPolicy({
    "action.click": true
  })), { bridgeClient });
  const browserId = register.result.browserId;

  const heartbeat = await broker.handleRequest(request("req_002", "bridge.heartbeat", {
    browserId,
    bridgeStatus: "connected",
    sentAt: "2026-04-28T00:00:00.000Z"
  }));
  assert.equal(heartbeat.ok, true);
  assert.equal(heartbeat.result.accepted, true);

  const disconnected = await broker.handleRequest(request("req_003", "bridge.disconnect", {
    browserId,
    reason: "test"
  }), { bridgeClient });
  assert.equal(disconnected.ok, true);

  const list = await broker.handleRequest(request("req_004", "browser.list"));
  assert.equal(list.result.browsers.length, 0);
  const unavailable = await broker.handleRequest(request("req_005", "browser.list", { includeUnavailable: true }));
  assert.equal(unavailable.result.browsers.length, 1);
  assert.equal(unavailable.result.browsers[0].bridgeStatus, "disconnected");
});

test("expires stale sessions by heartbeat timeout", async () => {
  let now = new Date("2026-04-28T00:00:00.000Z");
  const broker = createBroker({
    brokerToken: TEST_BROKER_TOKEN,
    now: () => now,
    config: {
      broker: {
        sessionTimeoutMs: 1000,
        heartbeatIntervalMs: 100,
        pipeName: "portus-browser-broker"
      },
      nativeHost: {
        brokerPipeName: "portus-browser-broker"
      }
    }
  });
  const events = [];
  broker.subscribeEvents((event) => events.push(event));

  await broker.handleRequest(request("req_001", "bridge.register", registration));
  now = new Date("2026-04-28T00:00:02.000Z");
  const expired = broker.expireStaleSessions();
  assert.equal(expired.length, 1);

  const list = await broker.handleRequest(request("req_002", "browser.list"));
  assert.equal(list.result.browsers.length, 0);
  assert.deepEqual(events.slice(-2).map((event) => event.type), ["session.expired", "bridge.recovery.required"]);
});

test("routes commands only to bridge-connected sessions with required capabilities", async () => {
  const routed = [];
  const bridgeClient = {
    async sendCommand(command) {
      routed.push(command);
      if (command.type === "policy.get") {
        return {
          policy: {
            navigationPolicyEnabled: true,
            policyMode: "blocklist",
            allowedNavigationRules: [],
            blockedNavigationRules: [],
            commandPolicy: DEFAULT_COMMAND_POLICY,
            advancedBackendEnabled: false,
            sessionStepRetentionLimit: 10
          }
        };
      }
      return {
        tabs: [{
          browserId: command.targetBrowserId,
          tabId: 1,
          windowId: 1,
          index: 0,
          active: true,
          pinned: false,
          discarded: false,
          title: "Example",
          url: "https://example.com"
        }]
      };
    }
  };
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", registration), { bridgeClient });
  const browserId = register.result.browserId;

  const tabs = await broker.handleRequest(request("req_002", "tab.list", { browserId }));
  assert.equal(tabs.ok, true);
  assert.equal(tabs.result.tabs.length, 1);
  assert.equal(routed.length, 1);
  assert.equal(routed[0].type, "tab.list");
  assert.equal(routed[0].targetBrowserId, browserId);

  const policy = await broker.handleRequest(request("req_003", "policy.get", { browserId }));
  assert.equal(policy.ok, true);
  assert.equal(policy.result.policy.policyMode, "blocklist");
  assert.equal(routed[1].type, "policy.get");

  await broker.handleRequest(request("req_004", "bridge.disconnect", { browserId }), { bridgeClient });
  const afterDisconnect = await broker.handleRequest(request("req_005", "tab.list", { browserId }));
  assert.equal(afterDisconnect.ok, false);
  assert.equal(afterDisconnect.error.code, "BROWSER_SESSION_UNAVAILABLE");
});

test("snapshot embedded screenshots require screenshot policy and capability", async () => {
  const routed = [];
  const bridgeClient = {
    async sendCommand(command) {
      routed.push(command);
      return { snapshot: {} };
    }
  };
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });

  const policyRegister = await broker.handleRequest(request("req_snapshot_policy_register", "bridge.register", registrationWithCommandPolicy({
    "snapshot.capture": true,
    "screenshot.capture": false
  })), { bridgeClient });
  const policyBlocked = await broker.handleRequest(request("req_snapshot_policy", "snapshot.capture", {
    browserId: policyRegister.result.browserId,
    tabId: 1,
    includeScreenshot: true
  }));
  assert.equal(policyBlocked.ok, false);
  assert.equal(policyBlocked.error.code, "COMMAND_DISABLED_BY_POLICY");
  assert.equal(routed.length, 0);

  const capabilityBroker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const capabilityRegister = await capabilityBroker.handleRequest(request("req_snapshot_cap_register", "bridge.register", {
    ...registrationWithCommandPolicy({
      "snapshot.capture": true,
      "screenshot.capture": true
    }),
    capabilities: ["tabs", "events", "snapshots", "actions", "policy"]
  }), { bridgeClient });
  const capabilityBlocked = await capabilityBroker.handleRequest(request("req_snapshot_capability", "snapshot.capture", {
    browserId: capabilityRegister.result.browserId,
    tabId: 1,
    includeScreenshot: true
  }));
  assert.equal(capabilityBlocked.ok, false);
  assert.equal(capabilityBlocked.error.code, "CAPABILITY_UNAVAILABLE");
  assert.equal(routed.length, 0);
});

test("authorizes upload files against canonical Broker roots and redacts paths", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "portus-upload-broker-"));
  const allowedRoot = join(workspace, "approved");
  const allowedFile = join(allowedRoot, "document.txt");
  const outsideFile = join(workspace, "outside.txt");
  await mkdir(allowedRoot);
  await writeFile(allowedFile, "approved");
  await writeFile(outsideFile, "outside");

  const routed = [];
  const bridgeClient = {
    async sendCommand(command) {
      routed.push(command);
      return {
        action: {
          backend: "debugger-cdp",
          completedAt: "2026-04-28T00:00:00.000Z",
          snapshotInvalidated: true,
          details: { action: "upload" }
        }
      };
    }
  };
  const broker = createBroker({
    brokerToken: TEST_BROKER_TOKEN,
    now: fixedClock(),
    config: { security: { allowedUploadRoots: [allowedRoot] } }
  });
  const register = await broker.handleRequest(request("req_upload_register", "bridge.register", {
    ...registrationWithCommandPolicy({ "action.upload": true }),
    capabilities: [...registration.capabilities, "advanced-debugger"]
  }), { bridgeClient });
  const browserId = register.result.browserId;
  const uploadPayload = {
    browserId,
    tabId: 7,
    snapshotId: "snap_001",
    elementId: "el_001",
    files: [allowedFile]
  };

  const allowed = await broker.handleRequest(request("req_upload_allowed", "action.upload", uploadPayload));
  assert.equal(allowed.ok, true);
  assert.deepEqual(routed[0].args.files, [await realpath(allowedFile)]);

  const outside = await broker.handleRequest(request("req_upload_outside", "action.upload", {
    ...uploadPayload,
    files: [join(allowedRoot, "..", "outside.txt")]
  }));
  assert.equal(outside.ok, false);
  assert.equal(outside.error.code, "UPLOAD_PATH_DENIED");
  assert.equal(routed.length, 1);

  const directory = await broker.handleRequest(request("req_upload_directory", "action.upload", {
    ...uploadPayload,
    files: [allowedRoot]
  }));
  assert.equal(directory.ok, false);
  assert.equal(directory.error.code, "UPLOAD_PATH_DENIED");

  const steps = await broker.handleRequest(request("req_upload_steps", "session.steps", { browserId }));
  assert.equal(steps.ok, true);
  assert.equal(steps.result.steps[0].args.files, "[redacted-file-paths]");
  assert.equal(steps.result.steps[0].args.fileCount, 1);
  assert.doesNotMatch(JSON.stringify(steps.result.steps), /document\.txt/);

  const disabledBroker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const disabledRegister = await disabledBroker.handleRequest(request("req_upload_disabled_register", "bridge.register", {
    ...registrationWithCommandPolicy({ "action.upload": true }),
    capabilities: [...registration.capabilities, "advanced-debugger"]
  }), { bridgeClient });
  const disabled = await disabledBroker.handleRequest(request("req_upload_disabled", "action.upload", {
    ...uploadPayload,
    browserId: disabledRegister.result.browserId
  }));
  assert.equal(disabled.ok, false);
  assert.equal(disabled.error.code, "UPLOAD_PATH_DENIED");
});

test("terminal-shaped traffic does not register or expose broker browser sessions", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });

  const invalid = await broker.handleRequest({
    type: "terminal.sessions.list",
    requestId: "treq_001",
    payload: {}
  });
  assert.equal(invalid.ok, false);

  const list = await broker.handleRequest(request("req_terminal_list", "browser.list"));
  assert.equal(list.ok, true);
  assert.deepEqual(list.result.browsers, []);
});

test("requires advanced debugger capability before routing dialog commands", async () => {
  const routed = [];
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", registrationWithCommandPolicy({
    "dialog.dismiss": true
  })), {
    bridgeClient: {
      async sendCommand(command) {
        routed.push(command);
        return {
          dialog: {
            handled: true,
            action: "dismiss",
            backend: "debugger-cdp",
            completedAt: "2026-04-28T00:00:00.000Z"
          }
        };
      }
    }
  });

  const unavailable = await broker.handleRequest(request("req_002", "dialog.dismiss", {
    browserId: register.result.browserId,
    tabId: 1
  }));

  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, "CAPABILITY_UNAVAILABLE");
  assert.equal(routed.length, 0);

  const advancedRegister = await broker.handleRequest(request("req_003", "bridge.register", {
    ...registrationWithCommandPolicy({
      "dialog.dismiss": true
    }),
    capabilities: [...registration.capabilities, "advanced-debugger"]
  }), {
    bridgeClient: {
      async sendCommand(command) {
        routed.push(command);
        return {
          dialog: {
            handled: true,
            action: "dismiss",
            backend: "debugger-cdp",
            completedAt: "2026-04-28T00:00:00.000Z"
          }
        };
      }
    }
  });

  const routedDialog = await broker.handleRequest(request("req_004", "dialog.dismiss", {
    browserId: advancedRegister.result.browserId,
    tabId: 1
  }));

  assert.equal(routedDialog.ok, true);
  assert.equal(routed.at(-1).type, "dialog.dismiss");
});

test("stores bridge policy preferences and syncs routed policy updates", async () => {
  const routed = [];
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", {
    ...registration,
    policyPreferences: {
      allowedNavigationRules: [],
      blockedNavigationRules: [{
        match: "authority",
        value: "https://blocked.example",
        source: "extension",
        updatedAt: "2026-04-28T00:00:00.000Z"
      }], 
      commandPolicy: {
        ...DEFAULT_COMMAND_POLICY,
        "policy.allow.add": true
      },
      sessionStepRetentionLimit: 12
    }
  }), {
    bridgeClient: {
      async sendCommand(command) {
        routed.push(command);
        return {
          policy: {
            allowedNavigationRules: [{
              match: "authority",
              value: "https://example.com",
              source: "cli",
              updatedAt: "2026-04-28T00:00:00.000Z"
            }],
            blockedNavigationRules: [],
            sessionStepRetentionLimit: 20
          }
        };
      }
    }
  });

  const blocked = await broker.handleRequest(request("req_002", "tab.open", {
    browserId: register.result.browserId,
    url: "https://blocked.example/a"
  }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "NAVIGATION_BLOCKED");
  assert.equal(routed.length, 0);

  const policy = await broker.handleRequest(request("req_003", "policy.allow.add", {
    browserId: register.result.browserId,
    match: "authority",
    value: "https://example.com"
  }));
  assert.equal(policy.ok, true);
  assert.equal(policy.result.policy.sessionStepRetentionLimit, 20);
  assert.equal(routed[0].type, "policy.allow.add");

  const allowed = await broker.handleRequest(request("req_004", "tab.open", {
    browserId: register.result.browserId,
    url: "https://example.com/a"
  }));
  assert.equal(allowed.ok, true);
  assert.equal(routed[1].type, "tab.open");
});

test("navigation policy disabled bypasses URL rules without disabling command policy", async () => {
  const routed = [];
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", {
    ...registration,
    policyPreferences: {
      navigationPolicyEnabled: false,
      allowedNavigationRules: [],
      blockedNavigationRules: [{
        match: "authority",
        value: "https://blocked.example",
        source: "extension",
        updatedAt: "2026-04-28T00:00:00.000Z"
      }],
      commandPolicy: DEFAULT_COMMAND_POLICY,
      sessionStepRetentionLimit: 10
    }
  }), {
    bridgeClient: {
      async sendCommand(command) {
        routed.push(command);
        return {
          tab: {
            browserId: register.result.browserId,
            tabId: 1,
            windowId: 1,
            index: 0,
            active: true,
            pinned: false,
            discarded: false,
            title: "Blocked",
            url: command.args.url
          }
        };
      }
    }
  });

  const allowed = await broker.handleRequest(request("req_002", "tab.open", {
    browserId: register.result.browserId,
    url: "https://blocked.example/a"
  }));
  assert.equal(allowed.ok, true);
  assert.equal(routed[0].type, "tab.open");

  await broker.handleRequest(request("req_003", "policy.sync", {
    browserId: register.result.browserId,
    policyPreferences: {
      navigationPolicyEnabled: false,
      allowedNavigationRules: [],
      blockedNavigationRules: [{
        match: "authority",
        value: "https://blocked.example",
        source: "extension",
        updatedAt: "2026-04-28T00:00:00.000Z"
      }],
      commandPolicy: {
        ...DEFAULT_COMMAND_POLICY,
        "tab.open": false
      },
      sessionStepRetentionLimit: 10
    }
  }));

  const disabledCommand = await broker.handleRequest(request("req_004", "tab.open", {
    browserId: register.result.browserId,
    url: "https://other.example/a"
  }));
  assert.equal(disabledCommand.ok, false);
  assert.equal(disabledCommand.error.code, "COMMAND_DISABLED_BY_POLICY");
});

test("routes existing-tab navigation through active navigation policy and records session steps", async () => {
  const routed = [];
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", {
    ...registration,
    policyPreferences: {
      policyMode: "allowlist",
      allowedNavigationRules: [{
        match: "authority",
        value: "https://example.com",
        source: "extension",
        updatedAt: "2026-04-28T00:00:00.000Z"
      }, {
        match: "scheme",
        value: "file:",
        source: "extension",
        updatedAt: "2026-04-28T00:00:00.000Z"
      }],
      blockedNavigationRules: [{
        match: "authority",
        value: "https://blocked.example",
        source: "extension",
        updatedAt: "2026-04-28T00:00:00.000Z"
      }],
      commandPolicy: DEFAULT_COMMAND_POLICY,
      sessionStepRetentionLimit: 10
    }
  }), {
    bridgeClient: {
      async sendCommand(command) {
        routed.push(command);
        return {
          tab: {
            browserId: register.result.browserId,
            tabId: command.args.tabId,
            windowId: 1,
            index: 0,
            active: true,
            pinned: false,
            discarded: false,
            title: "Example",
            url: command.args.url
          }
        };
      }
    }
  });

  const blocked = await broker.handleRequest(request("req_002", "tab.navigate", {
    browserId: register.result.browserId,
    tabId: 9,
    url: "https://blocked.example/path"
  }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "NAVIGATION_BLOCKED");
  assert.equal(routed.length, 0);

  const allowed = await broker.handleRequest(request("req_003", "tab.navigate", {
    browserId: register.result.browserId,
    tabId: 9,
    url: "https://example.com/path"
  }));
  assert.equal(allowed.ok, true);
  assert.equal(routed[0].type, "tab.navigate");

  const fileAllowed = await broker.handleRequest(request("req_004", "tab.navigate", {
    browserId: register.result.browserId,
    tabId: 9,
    url: "file:///C:/Projects/example.txt"
  }));
  assert.equal(fileAllowed.ok, true);
  assert.equal(routed[1].args.url, "file:///C:/Projects/example.txt");

  const steps = await broker.handleRequest(request("req_005", "session.steps", {
    browserId: register.result.browserId
  }));
  assert.equal(steps.ok, true);
  assert.deepEqual(steps.result.steps.map((step) => [step.commandType, step.status]), [
    ["tab.navigate", "blocked"],
    ["tab.navigate", "completed"],
    ["tab.navigate", "completed"]
  ]);
});

test("routes tab history navigation and records session steps", async () => {
  const routed = [];
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", {
    ...registration,
    policyPreferences: {
      policyMode: "blocklist",
      allowedNavigationRules: [],
      blockedNavigationRules: [],
      commandPolicy: DEFAULT_COMMAND_POLICY,
      sessionStepRetentionLimit: 10
    }
  }), {
    bridgeClient: {
      async sendCommand(command) {
        routed.push(command);
        return {
          tab: {
            browserId: register.result.browserId,
            tabId: command.args.tabId,
            windowId: 1,
            index: 0,
            active: true,
            pinned: false,
            discarded: false,
            title: "History",
            url: "https://example.com/history"
          }
        };
      }
    }
  });

  const back = await broker.handleRequest(request("req_002", "tab.history.back", {
    browserId: register.result.browserId,
    tabId: 9
  }));
  const forward = await broker.handleRequest(request("req_003", "tab.history.forward", {
    browserId: register.result.browserId,
    tabId: 9
  }));

  assert.equal(back.ok, true);
  assert.equal(forward.ok, true);
  assert.deepEqual(routed.map((command) => command.type), ["tab.history.back", "tab.history.forward"]);

  const steps = await broker.handleRequest(request("req_004", "session.steps", {
    browserId: register.result.browserId
  }));
  assert.deepEqual(steps.result.steps.map((step) => step.commandType), ["tab.history.back", "tab.history.forward"]);
});

test("waits for current tab state and records session step", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", registration), {
    bridgeClient: {
      async sendCommand(command) {
        return {
          tab: {
            browserId: register.result.browserId,
            tabId: command.args.tabId,
            windowId: 1,
            index: 0,
            active: true,
            pinned: false,
            discarded: false,
            title: "Ready",
            url: "https://example.com/ready",
            status: "complete"
          }
        };
      }
    }
  });

  const wait = await broker.handleRequest(request("req_002", "tab.wait", {
    browserId: register.result.browserId,
    tabId: 9,
    state: "complete",
    urlContains: "ready"
  }));

  assert.equal(wait.ok, true);
  assert.equal(wait.result.wait.source, "current-tab");
  assert.equal(wait.result.wait.url, "https://example.com/ready");

  const steps = await broker.handleRequest(request("req_003", "session.steps", {
    browserId: register.result.browserId
  }));
  assert.equal(steps.result.steps.at(-1).commandType, "tab.wait");
});

test("wait times out when tab condition never matches", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", registration), {
    bridgeClient: {
      async sendCommand(command) {
        return {
          tab: {
            browserId: register.result.browserId,
            tabId: command.args.tabId,
            windowId: 1,
            index: 0,
            active: true,
            pinned: false,
            discarded: false,
            title: "Loading",
            url: "https://example.com/loading",
            status: "loading"
          }
        };
      }
    }
  });

  const wait = await broker.handleRequest(request("req_002", "tab.wait", {
    browserId: register.result.browserId,
    tabId: 9,
    state: "complete"
  }, { timeoutMs: 5 }));

  assert.equal(wait.ok, false);
  assert.equal(wait.error.code, "COMMAND_TIMEOUT");
});

test("blocks routed commands disabled by bridge command policy", async () => {
  const routed = [];
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", {
    ...registration,
    policyPreferences: {
      policyMode: "blocklist",
      allowedNavigationRules: [],
      blockedNavigationRules: [],
      commandPolicy: {
        ...DEFAULT_COMMAND_POLICY,
        "tab.close": false,
        "policy.allow.add": false
      },
      sessionStepRetentionLimit: 10
    }
  }), {
    bridgeClient: {
      async sendCommand(command) {
        routed.push(command);
        return { closed: true, tabId: 1 };
      }
    }
  });

  const close = await broker.handleRequest(request("req_002", "tab.close", {
    browserId: register.result.browserId,
    tabId: 1
  }));
  const policyWrite = await broker.handleRequest(request("req_003", "policy.allow.add", {
    browserId: register.result.browserId,
    match: "authority",
    value: "https://example.com"
  }));

  assert.equal(close.ok, false);
  assert.equal(close.error.code, "COMMAND_DISABLED_BY_POLICY");
  assert.equal(policyWrite.ok, false);
  assert.equal(policyWrite.error.code, "COMMAND_DISABLED_BY_POLICY");
  assert.equal(routed.length, 0);
});

test("accepts policy sync updates from connected bridge sessions", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", registrationWithCommandPolicy({
    "action.click": true
  })), {
    bridgeClient: {
      async sendCommand() {
        return { ok: true };
      }
    }
  });
  const browserId = register.result.browserId;

  const synced = await broker.handleRequest(request("req_002", "policy.sync", {
    browserId,
    policyPreferences: {
      allowedNavigationRules: [],
      blockedNavigationRules: [{
        match: "authority",
        value: "https://blocked.example",
        source: "extension",
        updatedAt: "2026-04-28T00:00:00.000Z"
      }],
      sessionStepRetentionLimit: 33
    }
  }));
  assert.equal(synced.ok, true);
  assert.equal(synced.result.policy.sessionStepRetentionLimit, 33);

  const blocked = await broker.handleRequest(request("req_003", "tab.open", {
    browserId,
    url: "https://blocked.example/a"
  }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "NAVIGATION_BLOCKED");
});

test("keeps active settings profile selection per browser type", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const chromeOne = profileBridgeClient();
  const chromeTwo = profileBridgeClient();
  const edgeOne = profileBridgeClient();

  await broker.handleRequest(request("req_register_chrome_1", "bridge.register", registration), { bridgeClient: chromeOne });
  await broker.handleRequest(request("req_register_chrome_2", "bridge.register", registration), { bridgeClient: chromeTwo });
  await broker.handleRequest(request("req_register_edge_1", "bridge.register", { ...registration, browserName: "Edge" }), { bridgeClient: edgeOne });

  const initialChrome = await broker.handleRequest(request("req_profile_state", "settings.profile.state", { browserName: "Chrome" }));
  assert.equal(initialChrome.result.settingsProfiles.activeProfileName, "Profile_1");

  const created = await broker.handleRequest(request("req_profile_create", "settings.profile.create", { browserName: "Chrome" }));
  assert.equal(created.result.settingsProfiles.activeProfileName, "Profile_2");
  assert.equal(chromeOne.profileRequests.filter((message) => message.type === "settings.profile.apply-selection").length, 1);
  assert.equal(chromeTwo.profileRequests.filter((message) => message.type === "settings.profile.apply-selection").length, 1);
  assert.equal(edgeOne.profileRequests.length, 0);

  const edgeState = await broker.handleRequest(request("req_edge_profile_state", "settings.profile.state", { browserName: "Edge" }));
  assert.equal(edgeState.result.settingsProfiles.activeProfileName, "Profile_1");
});

test("saved profile content propagates to every browser using that profile", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const chromeClient = profileBridgeClient();
  const edgeClient = profileBridgeClient();

  const chromeRegister = await broker.handleRequest(request("req_register_chrome", "bridge.register", registration), { bridgeClient: chromeClient });
  const edgeRegister = await broker.handleRequest(request("req_register_edge", "bridge.register", { ...registration, browserName: "Edge" }), { bridgeClient: edgeClient });
  const created = await broker.handleRequest(request("req_create_profile", "settings.profile.create", { browserName: "Chrome" }));
  const profileId = created.result.settingsProfiles.activeProfileId;
  await broker.handleRequest(request("req_select_edge", "settings.profile.select", { browserName: "Edge", profileId }));
  chromeClient.profileRequests.length = 0;
  edgeClient.profileRequests.length = 0;

  const content = JSON.parse(JSON.stringify(created.result.settingsProfiles.content));
  content.policyPreferences.commandPolicy["tab.open"] = false;
  const saved = await broker.handleRequest(request("req_save_profile", "settings.profile.save", {
    browserName: "Chrome",
    profileId,
    content
  }));
  assert.equal(saved.ok, true);
  assert.equal(chromeClient.profileRequests.filter((message) => message.type === "settings.profile.apply-saved-content").length, 1);
  assert.equal(edgeClient.profileRequests.filter((message) => message.type === "settings.profile.apply-saved-content").length, 1);

  const chromeBlocked = await broker.handleRequest(request("req_chrome_tab_open", "tab.open", {
    browserId: chromeRegister.result.browserId,
    url: "https://example.com"
  }));
  const edgeBlocked = await broker.handleRequest(request("req_edge_tab_open", "tab.open", {
    browserId: edgeRegister.result.browserId,
    url: "https://example.com"
  }));
  assert.equal(chromeBlocked.ok, false);
  assert.equal(chromeBlocked.error.code, "COMMAND_DISABLED_BY_POLICY");
  assert.equal(edgeBlocked.ok, false);
  assert.equal(edgeBlocked.error.code, "COMMAND_DISABLED_BY_POLICY");
});

test("resetting a profile preserves its name and profile count", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const created = await broker.handleRequest(request("req_create_profile", "settings.profile.create", { browserName: "Chrome" }));
  const profileId = created.result.settingsProfiles.activeProfileId;
  const renamed = await broker.handleRequest(request("req_rename_profile", "settings.profile.rename", {
    browserName: "Chrome",
    profileId,
    name: "Work_Profile"
  }));
  const profileCount = renamed.result.settingsProfiles.profiles.length;
  const content = JSON.parse(JSON.stringify(renamed.result.settingsProfiles.content));
  content.policyPreferences.commandPolicy["tab.open"] = false;
  await broker.handleRequest(request("req_save_profile", "settings.profile.save", {
    browserName: "Chrome",
    profileId,
    content
  }));

  const reset = await broker.handleRequest(request("req_reset_profile", "settings.profile.reset", {
    browserName: "Chrome",
    profileId
  }));

  assert.equal(reset.ok, true);
  assert.equal(reset.result.settingsProfiles.activeProfileName, "Work_Profile");
  assert.equal(reset.result.settingsProfiles.profiles.length, profileCount);
  assert.equal(reset.result.settingsProfiles.profiles.find((profile) => profile.profileId === profileId).name, "Work_Profile");
  assert.equal(reset.result.settingsProfiles.content.policyPreferences.commandPolicy["tab.open"], true);
});

test("renames custom profiles without changing saved profile content", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const created = await broker.handleRequest(request("req_create_profile", "settings.profile.create", { browserName: "Chrome" }));
  const profileId = created.result.settingsProfiles.activeProfileId;
  const content = JSON.parse(JSON.stringify(created.result.settingsProfiles.content));
  content.policyPreferences.sessionStepRetentionLimit = 77;
  await broker.handleRequest(request("req_save_profile", "settings.profile.save", {
    browserName: "Chrome",
    profileId,
    content
  }));

  const renamed = await broker.handleRequest(request("req_rename_profile", "settings.profile.rename", {
    browserName: "Chrome",
    profileId,
    name: "  Work_Profile  "
  }));
  const duplicate = await broker.handleRequest(request("req_rename_duplicate", "settings.profile.rename", {
    browserName: "Chrome",
    profileId,
    name: "Profile_1"
  }));
  const empty = await broker.handleRequest(request("req_rename_empty", "settings.profile.rename", {
    browserName: "Chrome",
    profileId,
    name: "   "
  }));
  const readOnly = await broker.handleRequest(request("req_rename_default", "settings.profile.rename", {
    browserName: "Chrome",
    profileId: "profile_default",
    name: "Default_Renamed"
  }));

  assert.equal(renamed.ok, true);
  assert.equal(renamed.result.settingsProfiles.activeProfileName, "Work_Profile");
  assert.equal(renamed.result.settingsProfiles.activeProfileId, profileId);
  assert.equal(renamed.result.settingsProfiles.content.policyPreferences.sessionStepRetentionLimit, 77);
  assert.equal(duplicate.ok, false);
  assert.equal(empty.ok, false);
  assert.equal(readOnly.ok, false);
});

test("deletes custom profiles only and applies fallback to browsers using the deleted profile", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const chromeClient = profileBridgeClient();
  const edgeClient = profileBridgeClient();

  await broker.handleRequest(request("req_register_chrome", "bridge.register", registration), { bridgeClient: chromeClient });
  await broker.handleRequest(request("req_register_edge", "bridge.register", { ...registration, browserName: "Edge" }), { bridgeClient: edgeClient });
  const created = await broker.handleRequest(request("req_create_profile", "settings.profile.create", { browserName: "Chrome" }));
  const profileId = created.result.settingsProfiles.activeProfileId;
  await broker.handleRequest(request("req_select_edge", "settings.profile.select", { browserName: "Edge", profileId }));
  chromeClient.profileRequests.length = 0;
  edgeClient.profileRequests.length = 0;

  const deleted = await broker.handleRequest(request("req_delete_profile", "settings.profile.delete", {
    browserName: "Chrome",
    profileId
  }));

  assert.equal(deleted.ok, true);
  assert.equal(deleted.result.settingsProfiles.activeProfileName, "Profile_1");
  assert.equal(deleted.result.settingsProfiles.profiles.some((profile) => profile.profileId === profileId), false);
  assert.deepEqual(chromeClient.profileRequests.map((message) => message.type), ["settings.profile.apply-selection"]);
  assert.deepEqual(edgeClient.profileRequests.map((message) => message.type), ["settings.profile.apply-selection"]);

  const edgeState = await broker.handleRequest(request("req_edge_state", "settings.profile.state", { browserName: "Edge" }));
  assert.equal(edgeState.result.settingsProfiles.activeProfileName, "Profile_1");

  const deleteDefault = await broker.handleRequest(request("req_delete_default", "settings.profile.delete", {
    browserName: "Chrome",
    profileId: "profile_default"
  }));
  const deleteLastCustom = await broker.handleRequest(request("req_delete_last_custom", "settings.profile.delete", {
    browserName: "Chrome",
    profileId: "profile_1"
  }));
  assert.equal(deleteDefault.ok, false);
  assert.equal(deleteLastCustom.ok, false);
});

test("rejects saved profiles with invalid terminal settings", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const created = await broker.handleRequest(request("req_create_profile", "settings.profile.create", { browserName: "Chrome" }));
  const content = JSON.parse(JSON.stringify(created.result.settingsProfiles.content));
  content.terminalPreferences.fontSize = 100;

  const saved = await broker.handleRequest(request("req_save_profile", "settings.profile.save", {
    browserName: "Chrome",
    profileId: created.result.settingsProfiles.activeProfileId,
    content
  }));

  assert.equal(saved.ok, false);
  assert.equal(saved.error.code, "INVALID_MESSAGE");
});

test("uses configured defaults for built-in settings profiles", async () => {
  const broker = createBroker({
    brokerToken: TEST_BROKER_TOKEN,
    now: fixedClock(),
    config: {
      policy: {
        defaultAllowedNavigationRules: [{ match: "authority", value: "https://allowed.example" }],
        defaultBlockedNavigationRules: [{ match: "authority", value: "https://blocked.example" }],
        sessionStepRetentionLimit: 25
      },
      terminal: {
        defaultProfileId: "pwsh",
        startupCommand: null
      }
    }
  });

  const state = await broker.handleRequest(request("req_profile_state", "settings.profile.state", { browserName: "Chrome" }));

  assert.equal(state.ok, true);
  assert.equal(state.result.settingsProfiles.content.policyPreferences.allowedNavigationRules[0].value, "https://allowed.example");
  assert.equal(state.result.settingsProfiles.content.policyPreferences.blockedNavigationRules[0].value, "https://blocked.example");
  assert.equal(state.result.settingsProfiles.content.policyPreferences.sessionStepRetentionLimit, 25);
  assert.equal(state.result.settingsProfiles.content.terminalPreferences.defaultProfileId, "pwsh");
  assert.equal(state.result.settingsProfiles.content.terminalPreferences.startupCommand, null);
});

test("normalizes imported Default_Profile content back to default values", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const exported = await broker.handleRequest(request("req_export_profiles", "settings.profiles.export"));
  const catalog = JSON.parse(JSON.stringify(exported.result.catalog));
  const defaultProfile = catalog.profiles.find((profile) => profile.name === "Default_Profile");
  defaultProfile.content.policyPreferences.sessionStepRetentionLimit = 999;
  defaultProfile.content.terminalPreferences.defaultProfileId = "missing-terminal";

  const imported = await broker.handleRequest(request("req_import_profiles", "settings.profiles.import", { catalog }));
  const selected = await broker.handleRequest(request("req_select_default", "settings.profile.select", {
    browserName: "Chrome",
    profileId: defaultProfile.profileId
  }));

  assert.equal(imported.ok, true);
  assert.equal(selected.result.settingsProfiles.activeProfileName, "Default_Profile");
  assert.equal(selected.result.settingsProfiles.content.policyPreferences.sessionStepRetentionLimit, 10);
  assert.equal(selected.result.settingsProfiles.content.terminalPreferences.defaultProfileId, "auto");
  assert.equal(selected.result.settingsProfiles.content.terminalPreferences.startupCommand, null);
});

test("rejects imported custom profiles with invalid terminal settings", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const exported = await broker.handleRequest(request("req_export_profiles", "settings.profiles.export"));
  const catalog = JSON.parse(JSON.stringify(exported.result.catalog));
  const customProfile = catalog.profiles.find((profile) => profile.name === "Profile_1");
  customProfile.content.terminalPreferences.fontSize = 100;

  const imported = await broker.handleRequest(request("req_import_profiles", "settings.profiles.import", { catalog }));

  assert.equal(imported.ok, false);
  assert.equal(imported.error.code, "INVALID_MESSAGE");
});

test("migrates legacy invalid terminal profile ids in imported custom profiles", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const exported = await broker.handleRequest(request("req_export_profiles", "settings.profiles.export"));
  const catalog = JSON.parse(JSON.stringify(exported.result.catalog));
  const customProfile = catalog.profiles.find((profile) => profile.name === "Profile_1");
  customProfile.content.terminalPreferences.defaultProfileId = "PowerShell 7";
  customProfile.content.terminalPreferences.fontSize = 18;
  customProfile.content.terminalPreferences.startupCommand = "codex";

  const imported = await broker.handleRequest(request("req_import_profiles", "settings.profiles.import", { catalog }));
  const migratedProfile = imported.result.catalog.profiles.find((profile) => profile.name === "Profile_1");

  assert.equal(imported.ok, true);
  assert.equal(migratedProfile.content.terminalPreferences.defaultProfileId, "auto");
  assert.equal(migratedProfile.content.terminalPreferences.fontSize, 18);
  assert.equal(migratedProfile.content.terminalPreferences.startupCommand, "codex");
  assert.equal(imported.result.catalog.profiles.length, catalog.profiles.length);
});

test("creates unique profile ids when imported profiles already use generated ids", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const exported = await broker.handleRequest(request("req_export_profiles", "settings.profiles.export"));
  const catalog = JSON.parse(JSON.stringify(exported.result.catalog));
  const profileOne = catalog.profiles.find((profile) => profile.name === "Profile_1");
  catalog.profiles.push({
    ...JSON.parse(JSON.stringify(profileOne)),
    profileId: "profile_2",
    name: "Work_Profile"
  });

  const imported = await broker.handleRequest(request("req_import_profiles", "settings.profiles.import", { catalog }));
  const created = await broker.handleRequest(request("req_create_profile", "settings.profile.create", { browserName: "Chrome" }));
  const ids = created.result.settingsProfiles.profiles.map((profile) => profile.profileId);

  assert.equal(imported.ok, true);
  assert.equal(created.result.settingsProfiles.activeProfileName, "Profile_2");
  assert.notEqual(created.result.settingsProfiles.activeProfileId, "profile_2");
  assert.equal(new Set(ids).size, ids.length);
});

test("persists Broker-owned settings profile catalog", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-settings-profiles-"));
  const settingsProfilesPath = join(directory, "settings-profiles.json");
  const broker = createRealBroker({ brokerToken: TEST_BROKER_TOKEN, settingsProfilesPath, now: fixedClock() });

  const created = await broker.handleRequest(request("req_create_profile", "settings.profile.create", { browserName: "Chrome" }));
  assert.equal(created.result.settingsProfiles.activeProfileName, "Profile_2");

  const reloaded = createRealBroker({ brokerToken: TEST_BROKER_TOKEN, settingsProfilesPath, now: fixedClock() });
  const state = await reloaded.handleRequest(request("req_profile_state", "settings.profile.state", { browserName: "Chrome" }));
  assert.equal(state.result.settingsProfiles.activeProfileName, "Profile_2");
  assert.ok(state.result.settingsProfiles.profiles.some((profile) => profile.name === "Default_Profile"));
  assert.ok(state.result.settingsProfiles.profiles.some((profile) => profile.name === "Profile_1"));
  assert.ok(state.result.settingsProfiles.profiles.some((profile) => profile.name === "Profile_2"));
});

test("missing settings profile catalog initializes from the first browser registration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-settings-profiles-missing-"));
  const settingsProfilesPath = join(directory, "settings-profiles.json");
  const broker = createRealBroker({ brokerToken: TEST_BROKER_TOKEN, settingsProfilesPath, now: fixedClock() });

  const registered = await broker.handleRequest(request("req_register_profiles", "bridge.register", registrationWithCommandPolicy({})), {
    bridgeClient: profileBridgeClient()
  });

  assert.equal(registered.ok, true);
  const stored = JSON.parse(await readFile(settingsProfilesPath, "utf8"));
  const profile = stored.profiles.find((candidate) => candidate.name === "Profile_1");
  assert.equal(profile.content.policyPreferences.policyMode, "blocklist");
  assert.equal(profile.content.policyPreferences.sessionStepRetentionLimit, 10);
});

test("corrupt settings profile catalog is preserved and blocks persisted profile mutations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-settings-profiles-corrupt-"));
  const settingsProfilesPath = join(directory, "settings-profiles.json");
  const original = "{ this is not valid json\n";
  await writeFile(settingsProfilesPath, original, "utf8");
  const broker = createRealBroker({ brokerToken: TEST_BROKER_TOKEN, settingsProfilesPath, now: fixedClock() });

  const state = await broker.handleRequest(request("req_profile_state", "settings.profile.state", { browserName: "Chrome" }));
  assert.equal(state.ok, true);
  assert.equal(state.result.settingsProfiles.activeProfileName, "Profile_1");

  const exported = await broker.handleRequest(request("req_export_profiles", "settings.profiles.export"));
  assert.equal(exported.ok, false);
  assert.equal(exported.error.code, "CONFIG_INVALID");
  assert.match(exported.error.message, /original file has been preserved/i);

  const registered = await broker.handleRequest(request("req_register_profiles", "bridge.register", registrationWithCommandPolicy({})), {
    bridgeClient: profileBridgeClient()
  });
  assert.equal(registered.ok, true);
  assert.equal(await readFile(settingsProfilesPath, "utf8"), original);

  const content = state.result.settingsProfiles.content;
  const mutations = [
    ["settings.profile.create", { browserName: "Chrome" }],
    ["settings.profile.select", { browserName: "Chrome", profileId: "profile_1" }],
    ["settings.profile.save", { browserName: "Chrome", profileId: "profile_1", content }],
    ["settings.profile.reset", { browserName: "Chrome", profileId: "profile_1" }],
    ["settings.profile.rename", { browserName: "Chrome", profileId: "profile_1", name: "Recovered_Profile" }],
    ["settings.profile.delete", { browserName: "Chrome", profileId: "profile_1" }]
  ];

  for (const [type, payload] of mutations) {
    const response = await broker.handleRequest(request(`req_${type.replace(/[^a-z]+/gi, "_")}`, type, payload));
    assert.equal(response.ok, false, type);
    assert.equal(response.error.code, "CONFIG_INVALID", type);
    assert.match(response.error.message, /original file has been preserved/i, type);
    assert.equal(await readFile(settingsProfilesPath, "utf8"), original, type);
  }
});

test("semantic settings profile corruption is preserved instead of silently resetting", async () => {
  const seed = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const exported = await seed.handleRequest(request("req_export_seed", "settings.profiles.export"));
  const validCatalog = exported.result.catalog;
  const corruptions = [
    {
      name: "duplicate profile id",
      mutate(catalog) {
        catalog.profiles[1].profileId = catalog.profiles[0].profileId;
      }
    },
    {
      name: "missing active profile",
      mutate(catalog) {
        catalog.activeProfileByBrowserType.Chrome = "profile_missing";
      }
    }
  ];

  for (const corruption of corruptions) {
    const directory = await mkdtemp(join(tmpdir(), "portus-settings-profiles-semantic-corrupt-"));
    const settingsProfilesPath = join(directory, "settings-profiles.json");
    const catalog = JSON.parse(JSON.stringify(validCatalog));
    corruption.mutate(catalog);
    const original = `${JSON.stringify(catalog, null, 2)}\n`;
    await writeFile(settingsProfilesPath, original, "utf8");

    const broker = createRealBroker({ brokerToken: TEST_BROKER_TOKEN, settingsProfilesPath, now: fixedClock() });
    const response = await broker.handleRequest(request("req_export_corrupt", "settings.profiles.export"));
    assert.equal(response.ok, false, corruption.name);
    assert.equal(response.error.code, "CONFIG_INVALID", corruption.name);
    assert.equal(await readFile(settingsProfilesPath, "utf8"), original, corruption.name);
  }
});

test("valid settings profile import explicitly recovers corrupt persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-settings-profiles-recovery-"));
  const settingsProfilesPath = join(directory, "settings-profiles.json");
  const original = "{ broken catalog\n";
  await writeFile(settingsProfilesPath, original, "utf8");
  const broker = createRealBroker({ brokerToken: TEST_BROKER_TOKEN, settingsProfilesPath, now: fixedClock() });

  const seed = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const seedExport = await seed.handleRequest(request("req_export_seed", "settings.profiles.export"));
  const catalog = JSON.parse(JSON.stringify(seedExport.result.catalog));

  const failedImport = await broker.handleRequest(request("req_failed_import", "settings.profiles.import", {
    catalog: { ...catalog, profiles: [] }
  }));
  assert.equal(failedImport.ok, false);
  assert.equal(await readFile(settingsProfilesPath, "utf8"), original);

  const recovered = await broker.handleRequest(request("req_recover_import", "settings.profiles.import", { catalog }));
  assert.equal(recovered.ok, true);
  assert.deepEqual(JSON.parse(await readFile(settingsProfilesPath, "utf8")), recovered.result.catalog);

  const created = await broker.handleRequest(request("req_create_after_recovery", "settings.profile.create", { browserName: "Chrome" }));
  assert.equal(created.ok, true);
  assert.equal(created.result.settingsProfiles.activeProfileName, "Profile_2");
  const storedAfterCreate = JSON.parse(await readFile(settingsProfilesPath, "utf8"));
  assert.ok(storedAfterCreate.profiles.some((profile) => profile.name === "Profile_2"));
});

test("atomic settings profile persistence failure preserves disk and in-memory state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-settings-profiles-atomic-failure-"));
  const settingsProfilesPath = join(directory, "settings-profiles.json");
  const seed = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const seedExport = await seed.handleRequest(request("req_export_seed", "settings.profiles.export"));
  const original = `${JSON.stringify(seedExport.result.catalog, null, 2)}\n`;
  await writeFile(settingsProfilesPath, original, "utf8");

  const broker = createRealBroker({ brokerToken: TEST_BROKER_TOKEN, settingsProfilesPath, now: fixedClock() });
  const occupiedTemporaryPath = `${settingsProfilesPath}.tmp-${process.pid}-1`;
  await writeFile(occupiedTemporaryPath, "occupied", "utf8");

  const created = await broker.handleRequest(request("req_create_profile", "settings.profile.create", { browserName: "Chrome" }));
  assert.equal(created.ok, false);
  assert.equal(created.error.code, "CONFIG_INVALID");
  assert.match(created.error.message, /persisted atomically/i);
  assert.equal(await readFile(settingsProfilesPath, "utf8"), original);
  assert.equal(await readFile(occupiedTemporaryPath, "utf8"), "occupied");

  const state = await broker.handleRequest(request("req_profile_state", "settings.profile.state", { browserName: "Chrome" }));
  assert.equal(state.ok, true);
  assert.equal(state.result.settingsProfiles.profiles.some((profile) => profile.name === "Profile_2"), false);
});

test("migrates persisted invalid terminal profile ids without resetting profile content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-settings-profiles-terminal-legacy-"));
  const settingsProfilesPath = join(directory, "settings-profiles.json");
  const seedBroker = createRealBroker({ brokerToken: TEST_BROKER_TOKEN, settingsProfilesPath, now: fixedClock() });
  const exported = await seedBroker.handleRequest(request("req_export_profiles", "settings.profiles.export"));
  const catalog = JSON.parse(JSON.stringify(exported.result.catalog));
  const customProfile = catalog.profiles.find((profile) => profile.name === "Profile_1");
  customProfile.content.terminalPreferences.defaultProfileId = "PowerShell 7";
  customProfile.content.terminalPreferences.fontSize = 19;
  customProfile.content.terminalPreferences.startupCommand = "codex";
  await writeFile(settingsProfilesPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

  const reloaded = createRealBroker({ brokerToken: TEST_BROKER_TOKEN, settingsProfilesPath, now: fixedClock() });
  const state = await reloaded.handleRequest(request("req_profile_state", "settings.profile.state", { browserName: "Chrome" }));
  const stored = JSON.parse(await readFile(settingsProfilesPath, "utf8"));
  const storedProfile = stored.profiles.find((profile) => profile.name === "Profile_1");

  assert.equal(state.result.settingsProfiles.content.terminalPreferences.defaultProfileId, "auto");
  assert.equal(state.result.settingsProfiles.content.terminalPreferences.fontSize, 19);
  assert.equal(state.result.settingsProfiles.content.terminalPreferences.startupCommand, "codex");
  assert.equal(storedProfile.content.terminalPreferences.defaultProfileId, "auto");
  assert.equal(storedProfile.content.terminalPreferences.fontSize, 19);
  assert.equal(stored.profiles.length, catalog.profiles.length);
});

test("migrates persisted version 1 origin profiles to version 2 navigation rules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-settings-profiles-legacy-"));
  const settingsProfilesPath = join(directory, "settings-profiles.json");
  await writeFile(settingsProfilesPath, JSON.stringify({
    version: 1,
    maxCustomProfiles: 10,
    profiles: [{
      profileId: "profile_default",
      name: "Default_Profile",
      builtIn: true,
      readOnly: true,
      content: {
        policyPreferences: {},
        uxPreferences: {},
        terminalPreferences: {},
        autoSave: true
      },
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z"
    }, {
      profileId: "profile_1",
      name: "Profile_1",
      builtIn: false,
      readOnly: false,
      content: {
        policyPreferences: {
          originPolicyEnabled: true,
          policyMode: "blocklist",
          allowedOrigins: [],
          blockedOrigins: [{
            origin: "https://blocked.example",
            source: "extension",
            updatedAt: "2026-04-28T00:00:00.000Z"
          }]
        },
        uxPreferences: {},
        terminalPreferences: {},
        autoSave: true
      },
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z"
    }],
    activeProfileByBrowserType: {}
  }), "utf8");

  const broker = createRealBroker({ brokerToken: TEST_BROKER_TOKEN, settingsProfilesPath, now: fixedClock() });
  await broker.handleRequest(request("req_profile_select", "settings.profile.select", {
    browserName: "Chrome",
    profileId: "profile_1"
  }));
  const state = await broker.handleRequest(request("req_profile_state", "settings.profile.state", { browserName: "Chrome" }));
  const stored = JSON.parse(await readFile(settingsProfilesPath, "utf8"));
  const storedProfile = stored.profiles.find((profile) => profile.profileId === "profile_1");

  assert.equal(state.result.settingsProfiles.content.policyPreferences.blockedNavigationRules[0].match, "authority");
  assert.equal(state.result.settingsProfiles.content.policyPreferences.blockedNavigationRules[0].value, "https://blocked.example");
  assert.equal(stored.version, 2);
  assert.equal(storedProfile.content.policyPreferences.blockedNavigationRules[0].value, "https://blocked.example");
  assert.equal("blockedOrigins" in storedProfile.content.policyPreferences, false);
});

test("accepts extension-published tab lifecycle events and streams them to subscribers", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const bridgeClient = {
    async sendCommand() {
      return { ok: true };
    }
  };
  const events = [];
  broker.subscribeEvents((event) => events.push(event));
  const register = await broker.handleRequest(request("req_001", "bridge.register", registrationWithCommandPolicy({
    "event.subscribe": true,
    "events.recent": true
  })), { bridgeClient });
  const browserId = register.result.browserId;
  assert.equal(broker.eventMatchesSubscription(
    { type: "tab.updated", browserId },
    { browserId, types: ["tab.updated", "tab.closed"] }
  ), true);
  assert.equal(broker.eventMatchesSubscription(
    { type: "action.completed", browserId },
    { browserId, types: ["tab.updated", "tab.closed"] }
  ), false);

  const published = await broker.handleRequest(request("req_002", "event.publish", {
    browserId,
    type: "tab.updated",
    tabId: 9,
    payload: {
      status: "complete",
      url: "https://example.com/"
    }
  }), { bridgeClient });

  assert.equal(published.ok, true);
  assert.equal(published.result.event.type, "tab.updated");
  assert.equal(published.result.event.tabId, 9);
  assert.equal(published.result.event.payload.status, "complete");
  assert.equal(published.result.event.payload.source, "extension");
  assert.equal(events.at(-1).type, "tab.updated");

  const rejected = await broker.handleRequest(request("req_003", "event.publish", {
    browserId,
    type: "tab.updated",
    tabId: 9,
    payload: { status: "loading" }
  }));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "BROKER_TOKEN_INVALID");
});

test("enforces wildcard navigation rules only for the active policy mode", async () => {
  const routed = [];
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", {
    ...registration,
    policyPreferences: {
      policyMode: "allowlist",
      allowedNavigationRules: [{
        match: "host-wildcard",
        value: "*.tripadvisor.com",
        source: "extension",
        updatedAt: "2026-04-28T00:00:00.000Z"
      }],
      blockedNavigationRules: [{
        match: "host-wildcard",
        value: "*.tripadvisor.com",
        source: "extension",
        updatedAt: "2026-04-28T00:00:00.000Z"
      }],
      commandPolicy: DEFAULT_COMMAND_POLICY,
      sessionStepRetentionLimit: 10
    }
  }), {
    bridgeClient: {
      async sendCommand(command) {
        routed.push(command);
        return {
          tab: {
            browserId: command.targetBrowserId,
            tabId: 1,
            windowId: 1,
            index: 0,
            active: true,
            pinned: false,
            discarded: false,
            title: "",
            url: command.args.url
          }
        };
      }
    }
  });
  const browserId = register.result.browserId;

  const allowed = await broker.handleRequest(request("req_002", "tab.open", {
    browserId,
    url: "https://www.tripadvisor.com/AttractionProductReview-a"
  }));
  assert.equal(allowed.ok, true);
  assert.equal(routed.length, 1);

  const blocked = await broker.handleRequest(request("req_003", "tab.open", {
    browserId,
    url: "https://example.com/"
  }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "NAVIGATION_BLOCKED");
  assert.equal(routed.length, 1);
});

test("publishes action lifecycle events and maps routed failures", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const events = [];
  broker.subscribeEvents((event) => events.push(event));
  const register = await broker.handleRequest(request("req_001", "bridge.register", registrationWithCommandPolicy({
    "action.click": true
  })), {
    bridgeClient: {
      async sendCommand() {
        throw {
          code: "ACTION_FAILED",
          message: "Action failed."
        };
      }
    }
  });

  const response = await broker.handleRequest(request("req_002", "action.click", {
    browserId: register.result.browserId,
    tabId: 1,
    elementId: "el_001"
  }));

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "ACTION_FAILED");
  assert.deepEqual(events.filter((event) => event.type.startsWith("action.")).map((event) => event.type), ["action.started", "action.failed"]);
});

test("enforces broker command timeouts and publishes action failure events", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const events = [];
  broker.subscribeEvents((event) => events.push(event));
  const register = await broker.handleRequest(request("req_001", "bridge.register", registrationWithCommandPolicy({
    "action.click": true
  })), {
    bridgeClient: {
      async sendCommand() {
        return new Promise(() => {});
      }
    }
  });

  const response = await broker.handleRequest(request("req_002", "action.click", {
    browserId: register.result.browserId,
    tabId: 1,
    elementId: "el_001"
  }, {
    timeoutMs: 1
  }));

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "COMMAND_TIMEOUT");
  assert.equal(response.error.retryable, true);
  assert.equal(response.error.details.type, "action.click");
  assert.deepEqual(events.filter((event) => event.type.startsWith("action.")).map((event) => event.type), ["action.started", "action.failed"]);
  assert.equal(events.at(-1).payload.error.code, "COMMAND_TIMEOUT");
});

test("uses configured default timeout for routed commands", async () => {
  const broker = createBroker({
    brokerToken: TEST_BROKER_TOKEN,
    now: fixedClock(),
    config: { commands: { timeoutMs: 1 } }
  });
  const register = await broker.handleRequest(request("req_001", "bridge.register", registrationWithCommandPolicy({
    "action.click": true
  })), {
    bridgeClient: {
      async sendCommand() {
        return new Promise(() => {});
      }
    }
  });

  const response = await broker.handleRequest(request("req_002", "action.click", {
    browserId: register.result.browserId,
    tabId: 1,
    elementId: "el_001"
  }));

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "COMMAND_TIMEOUT");
  assert.equal(response.error.details.timeoutMs, 1);
});

test("enforces command policy for event, history, and CLI bridge commands", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", registration), {
    bridgeClient: {
      async sendCommand() {
        return { disconnected: true };
      }
    }
  });
  const browserId = register.result.browserId;

  const subscribe = await broker.handleRequest(request("req_002", "event.subscribe", { browserId }));
  const recent = await broker.handleRequest(request("req_003", "events.recent", { browserId }));
  const steps = await broker.handleRequest(request("req_004", "session.steps", { browserId }));
  const disconnect = await broker.handleRequest(request("req_005", "bridge.disconnect", { browserId }));

  assert.equal(subscribe.ok, true);
  assert.equal(recent.ok, true);
  assert.equal(steps.ok, true);
  assert.equal(disconnect.ok, false);
  assert.equal(disconnect.error.code, "COMMAND_DISABLED_BY_POLICY");

  const disabledRegister = await broker.handleRequest(request("req_006", "bridge.register", registrationWithCommandPolicy({
    "event.subscribe": false,
    "events.recent": false,
    "session.steps": false
  })), {
    bridgeClient: {
      async sendCommand() {
        return { ok: true };
      }
    }
  });
  const disabledBrowserId = disabledRegister.result.browserId;
  const disabledSubscribe = await broker.handleRequest(request("req_007", "event.subscribe", { browserId: disabledBrowserId }));
  const disabledRecent = await broker.handleRequest(request("req_008", "events.recent", { browserId: disabledBrowserId }));
  const disabledSteps = await broker.handleRequest(request("req_009", "session.steps", { browserId: disabledBrowserId }));

  assert.equal(disabledSubscribe.ok, false);
  assert.equal(disabledSubscribe.error.code, "COMMAND_DISABLED_BY_POLICY");
  assert.equal(disabledRecent.ok, false);
  assert.equal(disabledRecent.error.code, "COMMAND_DISABLED_BY_POLICY");
  assert.equal(disabledSteps.ok, false);
  assert.equal(disabledSteps.error.code, "COMMAND_DISABLED_BY_POLICY");
});

test("CLI bridge disconnect returns after sending a one-way disconnect command", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  let sent = false;
  const register = await broker.handleRequest(request("req_001", "bridge.register", registrationWithCommandPolicy({
    "bridge.disconnect": true
  })), {
    bridgeClient: {
      async sendCommand() {
        sent = true;
        return new Promise(() => undefined);
      }
    }
  });
  const browserId = register.result.browserId;

  const disconnected = await broker.handleRequest(request("req_002", "bridge.disconnect", { browserId }));
  const list = await broker.handleRequest(request("req_003", "browser.list"));

  assert.equal(sent, true);
  assert.equal(disconnected.ok, true);
  assert.equal(disconnected.result.disconnected, true);
  assert.equal(list.result.browsers.length, 0);
});

test("retains bounded redacted session steps and recent events in memory", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", registrationWithCommandPolicy({
    "action.type": true,
    "session.steps": true,
    "events.recent": true
  })), {
    bridgeClient: {
      async sendCommand() {
        return {
          action: {
            backend: "dom",
            completedAt: "2026-04-28T00:00:00.000Z",
            snapshotInvalidated: true
          }
        };
      }
    }
  });
  const browserId = register.result.browserId;

  const action = await broker.handleRequest(request("req_002", "action.type", {
    browserId,
    tabId: 7,
    elementId: "el_001",
    text: "secret typed value"
  }));
  assert.equal(action.ok, true);

  const steps = await broker.handleRequest(request("req_003", "session.steps", { browserId }));
  assert.equal(steps.ok, true);
  assert.equal(steps.result.steps.length, 1);
  assert.equal(steps.result.steps[0].args.text, "[redacted-text]");
  assert.equal(steps.result.steps[0].args.textLength, 18);
  assert.doesNotMatch(JSON.stringify(steps.result.steps), /secret typed value/);

  const events = await broker.handleRequest(request("req_004", "events.recent", { browserId, types: ["session.step.recorded"] }));
  assert.equal(events.ok, true);
  assert.equal(events.result.events.length, 1);
  assert.doesNotMatch(JSON.stringify(events.result.events), /secret typed value/);
});

test("lists registered recipes in stable order", async () => {
  const broker = createBroker({
    brokerToken: TEST_BROKER_TOKEN,
    recipes: [
      recipeRecord("workspace", "Workspace"),
      recipeRecord("morning", "Morning")
    ]
  });

  const response = await broker.handleRequest(request("req_001", "recipe.list"));

  assert.equal(response.ok, true);
  assert.deepEqual(response.result.recipes.map((item) => item.id), ["morning", "workspace"]);
  assert.equal(response.result.recipes[0].content, undefined);
  assert.equal(response.result.diagnostics.length, 0);
});

test("enforces command policy for broker-routed recipe reads", async () => {
  const broker = createBroker({
    brokerToken: TEST_BROKER_TOKEN,
    recipes: [recipeRecord("morning", "Morning")]
  });
  await broker.handleRequest(request("req_001", "bridge.register", registrationWithCommandPolicy({
    "recipe.list": false
  })));

  const response = await broker.handleRequest(request("req_002", "recipe.list"));

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "COMMAND_DISABLED_BY_POLICY");
});

test("gets and searches recipe records without browser side effects", async () => {
  const broker = createBroker({
    brokerToken: TEST_BROKER_TOKEN,
    recipes: [{
      id: "expedia-latest-10",
      name: "Expedia Latest 10",
      kind: "retrieval-workflow",
      intent: "Get the latest 10 Expedia reviews for the saved restaurant.",
      examples: ["use the expedia workflow for the latest 10"]
    }]
  });

  const listed = await broker.handleRequest(request("req_001", "recipe.list"));
  const found = await broker.handleRequest(request("req_002", "recipe.search", {
    query: "expedia workflow"
  }));
  const got = await broker.handleRequest(request("req_003", "recipe.get", {
    recipeId: "expedia-latest-10"
  }));
  const resolved = await broker.handleRequest(request("req_004", "recipe.resolve", {
    query: "use the expedia workflow"
  }));
  const browsers = await broker.handleRequest(request("req_004", "browser.list", {
    includeUnavailable: true
  }));

  assert.equal(listed.ok, true);
  assert.equal(found.ok, true);
  assert.deepEqual(found.result.recipes.map((item) => item.id), ["expedia-latest-10"]);
  assert.equal(got.ok, true);
  assert.equal(got.result.recipe.intent, "Get the latest 10 Expedia reviews for the saved restaurant.");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.result.recipe.id, "expedia-latest-10");
  assert.deepEqual(browsers.result.browsers, []);
});

test("recipe resolve reports ambiguous matches without browser side effects", async () => {
  const broker = createBroker({
    brokerToken: TEST_BROKER_TOKEN,
    recipes: [{
      id: "news-work",
      name: "News Work",
      content: "Open work news tabs."
    }, {
      id: "news-personal",
      name: "News Personal",
      content: "Open personal news tabs."
    }]
  });

  const response = await broker.handleRequest(request("req_001", "recipe.resolve", {
    query: "news"
  }));
  const browsers = await broker.handleRequest(request("req_002", "browser.list", {
    includeUnavailable: true
  }));

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "RECIPE_INVALID");
  assert.equal(response.error.details.matches.length, 2);
  assert.deepEqual(browsers.result.browsers, []);
});

test("lists recipe library records and malformed diagnostics from storage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-broker-recipes-"));
  await writeFile(join(directory, "news-setup.json"), `${JSON.stringify({
    id: "news-setup",
    name: "News Setup",
    content: "Restore the saved news tabs."
  }, null, 2)}\n`, "utf8");
  await writeFile(join(directory, "broken.json"), "{", "utf8");
  const broker = createBroker({
    brokerToken: TEST_BROKER_TOKEN,
    recipeLibraryDirectory: directory
  });

  const response = await broker.handleRequest(request("req_001", "recipe.list"));

  assert.equal(response.ok, true);
  assert.deepEqual(response.result.recipes.map((item) => item.id), ["news-setup"]);
  assert.equal(response.result.recipes[0].richSchemaOk, false);
  assert.equal(response.result.diagnostics.some((diagnostic) => diagnostic.filePath.endsWith("broken.json")), true);
});

test("returns typed protocol errors for invalid messages", async () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN });
  const missingVersion = await broker.handleRequest({
    requestId: "req_001",
    kind: "request",
    type: "browser.list",
    payload: {}
  });
  assert.equal(missingVersion.ok, false);
  assert.equal(missingVersion.error.code, "INVALID_MESSAGE");

  const unsupportedVersion = await broker.handleRequest({
    protocolVersion: "1",
    requestId: "req_002",
    kind: "request",
    type: "browser.list",
    payload: {}
  });
  assert.equal(unsupportedVersion.ok, false);
  assert.equal(unsupportedVersion.error.code, "UNSUPPORTED_PROTOCOL_VERSION");
});

function fixedClock() {
  return () => new Date("2026-04-28T00:00:00.000Z");
}

function registrationWithCommandPolicy(overrides) {
  return {
    ...registration,
    policyPreferences: {
      policyMode: "blocklist",
      allowedNavigationRules: [],
      blockedNavigationRules: [],
      commandPolicy: {
        ...DEFAULT_COMMAND_POLICY,
        ...overrides
      },
      sessionStepRetentionLimit: 10
    }
  };
}

function profileBridgeClient() {
  const profileRequests = [];
  return {
    profileRequests,
    async sendCommand() {
      return { ok: true };
    },
    async sendOneWayRequest(type, payload) {
      profileRequests.push({ type, payload });
    },
    async sendRequest(type, payload) {
      profileRequests.push({ type, payload });
      return { ok: true };
    }
  };
}

function recipeRecord(id, name) {
  return {
    id,
    name,
    content: `Use the ${name} recipe.`
  };
}

function readOneTransportFrame(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    socket.setEncoding("utf8");
    const onData = (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) return;
      socket.off("error", reject);
      socket.off("data", onData);
      resolve(deserializeTransportFrame(buffer.slice(0, newlineIndex)));
    };
    socket.on("error", reject);
    socket.on("data", onData);
  });
}

test("gates download commands by policy and capability before routing", async () => {
  const routed = [];
  const bridgeClient = {
    sendCommand: async (command) => {
      routed.push(command);
      return command.type === "download.list"
        ? { downloads: [], captureStartedAt: "2026-04-28T00:00:00.000Z" }
        : { download: { downloadId: 7 } };
    }
  };

  const capabilityBroker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const capabilityRegister = await capabilityBroker.handleRequest(request("req_dl_cap_reg", "bridge.register", {
    ...registrationWithCommandPolicy({ "download.list": true, "download.get": true, "download.wait": true }),
    capabilities: ["tabs", "events", "screenshots", "snapshots", "actions", "policy"]
  }), { bridgeClient });
  const capabilityBlocked = await capabilityBroker.handleRequest(request("req_dl_capability", "download.list", {
    browserId: capabilityRegister.result.browserId
  }));
  assert.equal(capabilityBlocked.ok, false);
  assert.equal(capabilityBlocked.error.code, "CAPABILITY_UNAVAILABLE");
  assert.equal(routed.length, 0);

  const defaultPolicyBroker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const defaultPolicyRegister = await defaultPolicyBroker.handleRequest(request("req_dl_policy_def_reg", "bridge.register", {
    ...registration,
    capabilities: ["tabs", "events", "screenshots", "snapshots", "actions", "policy", "downloads"]
  }), { bridgeClient });
  const policyDenied = await defaultPolicyBroker.handleRequest(request("req_dl_policy_def", "download.list", {
    browserId: defaultPolicyRegister.result.browserId
  }));
  assert.equal(policyDenied.ok, false);
  assert.equal(policyDenied.error.code, "COMMAND_DISABLED_BY_POLICY");
  assert.equal(routed.length, 0);

  const routedBroker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const routedRegister = await routedBroker.handleRequest(request("req_dl_ok_reg", "bridge.register", {
    ...registrationWithCommandPolicy({ "download.list": true, "download.get": true, "download.wait": true }),
    capabilities: ["tabs", "events", "screenshots", "snapshots", "actions", "policy", "downloads"]
  }), { bridgeClient });
  const routedResponse = await routedBroker.handleRequest(request("req_dl_ok", "download.list", {
    browserId: routedRegister.result.browserId
  }));
  assert.equal(routedResponse.ok, true);
  const routedGet = await routedBroker.handleRequest(request("req_dl_get", "download.get", {
    browserId: routedRegister.result.browserId,
    downloadId: 7
  }));
  const routedWait = await routedBroker.handleRequest(request("req_dl_wait", "download.wait", {
    browserId: routedRegister.result.browserId,
    filenameContains: "report.pdf"
  }));
  assert.equal(routedGet.ok, true);
  assert.equal(routedWait.ok, true);
  assert.deepEqual(routed.map((command) => command.type), ["download.list", "download.get", "download.wait"]);
  assert.equal(routed[0].targetBrowserId, routedRegister.result.browserId);
});

test("requires exact-session approval before routing configured commands", async () => {
  const approvals = [];
  const routed = [];
  const bridgeClient = {
    async sendRequest(type, payload) {
      approvals.push({ type, payload });
      return {
        approvalId: payload.approvalId,
        decision: "approved",
        decidedAt: "2026-04-28T00:00:01.000Z"
      };
    },
    async sendCommand(command) {
      routed.push(command);
      return { tab: { tabId: 7, url: "https://example.com/path" } };
    }
  };
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const approvalRegistration = registrationWithCommandPolicy({ "tab.navigate": true });
  approvalRegistration.policyPreferences.approvalPolicy = { "tab.navigate": true };
  const registered = await broker.handleRequest(request("req_approval_reg", "bridge.register", approvalRegistration), { bridgeClient });
  const browserId = registered.result.browserId;

  const response = await broker.handleRequest(request("req_approval_command", "tab.navigate", {
    browserId,
    tabId: 7,
    url: "https://user:password@example.com/path?token=secret#section"
  }, { timeoutMs: 1000 }));

  assert.equal(response.ok, true);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].type, "approval.request");
  assert.equal(approvals[0].payload.browserId, browserId);
  assert.equal(approvals[0].payload.commandType, "tab.navigate");
  assert.equal(approvals[0].payload.summary.url, "https://example.com/path");
  assert.equal(JSON.stringify(approvals[0]).includes("secret"), false);
  assert.equal(JSON.stringify(approvals[0]).includes("password"), false);
  assert.equal(routed.length, 1);
  assert.equal(routed[0].targetBrowserId, browserId);
  assert.ok(routed[0].timeoutMs > 0 && routed[0].timeoutMs <= 1000);
});

test("fails closed when command approval is rejected or times out", async () => {
  for (const scenario of ["rejected", "timeout"]) {
    const routed = [];
    const bridgeClient = {
      async sendRequest(_type, payload) {
        if (scenario === "timeout") return new Promise(() => undefined);
        throw {
          code: "COMMAND_REJECTED_BY_USER",
          message: "User rejected command action.click.",
          details: { approvalId: payload.approvalId }
        };
      },
      async sendCommand(command) {
        routed.push(command);
        return { action: {} };
      }
    };
    const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
    const approvalRegistration = registrationWithCommandPolicy({ "action.click": true });
    approvalRegistration.policyPreferences.approvalPolicy = { "action.click": true };
    const registered = await broker.handleRequest(request(`req_approval_${scenario}_reg`, "bridge.register", approvalRegistration), { bridgeClient });
    const response = await broker.handleRequest(request(`req_approval_${scenario}`, "action.click", {
      browserId: registered.result.browserId,
      tabId: 7,
      elementId: "el_001"
    }, { timeoutMs: scenario === "timeout" ? 10 : 1000 }));

    assert.equal(response.ok, false);
    assert.equal(response.error.code, scenario === "timeout" ? "COMMAND_TIMEOUT" : "COMMAND_REJECTED_BY_USER");
    assert.equal(routed.length, 0);
  }
});
