import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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
    protocolVersion: "1",
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
  capabilities: ["tabs", "events", "screenshots", "snapshots", "actions", "permissions"]
};

test("validates config at startup and exposes named pipe endpoint", () => {
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN });
  assert.equal(broker.endpoint.transport, "named-pipe");
  assert.equal(broker.endpoint.pipeName, "portus-browser-broker");
  assert.equal(broker.pipePath, "\\\\.\\pipe\\portus-browser-broker");
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
      if (command.type === "permission.list") {
        return {
          permissions: [{
            origin: "https://example.com",
            granted: true,
            source: "extension",
            scope: "origin"
          }]
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

  const permissions = await broker.handleRequest(request("req_003", "permission.list", { browserId }));
  assert.equal(permissions.ok, true);
  assert.equal(permissions.result.permissions[0].origin, "https://example.com");
  assert.equal(routed[1].type, "permission.list");

  await broker.handleRequest(request("req_004", "bridge.disconnect", { browserId }), { bridgeClient });
  const afterDisconnect = await broker.handleRequest(request("req_005", "tab.list", { browserId }));
  assert.equal(afterDisconnect.ok, false);
  assert.equal(afterDisconnect.error.code, "BROWSER_SESSION_UNAVAILABLE");
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
      allowedOrigins: [],
      blockedOrigins: [{
        origin: "https://blocked.example",
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
            allowedOrigins: [{
              origin: "https://example.com",
              source: "cli",
              updatedAt: "2026-04-28T00:00:00.000Z"
            }],
            blockedOrigins: [],
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
  assert.equal(blocked.error.code, "ORIGIN_BLOCKED");
  assert.equal(routed.length, 0);

  const policy = await broker.handleRequest(request("req_003", "policy.allow.add", {
    browserId: register.result.browserId,
    origin: "https://example.com"
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

test("origin policy disabled bypasses URL lists without disabling command policy", async () => {
  const routed = [];
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", {
    ...registration,
    policyPreferences: {
      originPolicyEnabled: false,
      allowedOrigins: [],
      blockedOrigins: [{
        origin: "https://blocked.example",
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
      originPolicyEnabled: false,
      allowedOrigins: [],
      blockedOrigins: [{
        origin: "https://blocked.example",
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

test("routes existing-tab navigation through active origin policy and records session steps", async () => {
  const routed = [];
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", {
    ...registration,
    policyPreferences: {
      policyMode: "allowlist",
      allowedOrigins: [{
        origin: "https://example.com",
        source: "extension",
        updatedAt: "2026-04-28T00:00:00.000Z"
      }],
      blockedOrigins: [{
        origin: "https://blocked.example",
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
  assert.equal(blocked.error.code, "ORIGIN_BLOCKED");
  assert.equal(routed.length, 0);

  const allowed = await broker.handleRequest(request("req_003", "tab.navigate", {
    browserId: register.result.browserId,
    tabId: 9,
    url: "https://example.com/path"
  }));
  assert.equal(allowed.ok, true);
  assert.equal(routed[0].type, "tab.navigate");

  const steps = await broker.handleRequest(request("req_004", "session.steps", {
    browserId: register.result.browserId
  }));
  assert.equal(steps.ok, true);
  assert.deepEqual(steps.result.steps.map((step) => [step.commandType, step.status]), [
    ["tab.navigate", "blocked"],
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
      allowedOrigins: [],
      blockedOrigins: [],
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
      allowedOrigins: [],
      blockedOrigins: [],
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
    origin: "https://example.com"
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
      allowedOrigins: [],
      blockedOrigins: [{
        origin: "https://blocked.example",
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
  assert.equal(blocked.error.code, "ORIGIN_BLOCKED");
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
      permissions: {
        defaultAllowlist: ["https://allowed.example"],
        defaultBlocklist: ["https://blocked.example"],
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
  assert.equal(state.result.settingsProfiles.content.policyPreferences.allowedOrigins[0].origin, "https://allowed.example");
  assert.equal(state.result.settingsProfiles.content.policyPreferences.blockedOrigins[0].origin, "https://blocked.example");
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

test("enforces wildcard origins only for the active policy mode", async () => {
  const routed = [];
  const broker = createBroker({ brokerToken: TEST_BROKER_TOKEN, now: fixedClock() });
  const register = await broker.handleRequest(request("req_001", "bridge.register", {
    ...registration,
    policyPreferences: {
      policyMode: "allowlist",
      allowedOrigins: [{
        origin: "*.tripadvisor.com",
        source: "extension",
        updatedAt: "2026-04-28T00:00:00.000Z"
      }],
      blockedOrigins: [{
        origin: "*.tripadvisor.com",
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
  assert.equal(blocked.error.code, "ORIGIN_BLOCKED");
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

  const events = await broker.handleRequest(request("req_004", "events.recent", { browserId, type: "session.step.recorded" }));
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
    protocolVersion: "2",
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
      allowedOrigins: [],
      blockedOrigins: [],
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
