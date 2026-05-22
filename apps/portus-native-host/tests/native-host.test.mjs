import assert from "node:assert/strict";
import { createConnection } from "node:net";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createBrokerNamedPipeServer } from "@portus/broker";
import { encodeNativeMessage, tryReadNativeMessageFrame } from "@portus/native-messaging";
import { deserializeTransportFrame, serializeTransportFrame } from "@portus/transport";
import { createDefaultBrokerStarter } from "../dist/bin.js";
import { createNativeHostRelay } from "../dist/index.js";

const TEST_BROKER_TOKEN = "test-broker-token";

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

function extensionRequest(requestId, type, payload = {}) {
  const message = request(requestId, type, payload);
  delete message.auth;
  return message;
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

const registration = {
  browserName: "Chrome",
  extensionVersion: "0.1.0",
  extensionId: "chrome-extension-id",
  bridgeStatus: "connected",
  capabilities: ["tabs", "events"]
};

test("relays bridge registration from native messaging stdio to broker pipe", async () => {
  const { server, relay, input, output } = await startRelayFixture();
  try {
    input.write(encodeNativeMessage(extensionRequest("req_001", "bridge.register", registration)));
    const message = await readNativeMessage(output);
    assert.equal(message.kind, "response");
    assert.equal(message.ok, true);
    assert.equal(message.result.browserId, "br_000001");
    assert.equal(message.result.heartbeatIntervalMs, 5000);
  } finally {
    await relay.stop();
    await server.stop();
  }
});

test("returns broker unavailable when no broker pipe is connected", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const relay = createNativeHostRelay({
    brokerToken: TEST_BROKER_TOKEN, input, output });

  input.write(encodeNativeMessage(extensionRequest("req_001", "browser.list")));
  const message = await readNativeMessage(output);
  assert.equal(message.kind, "response");
  assert.equal(message.ok, false);
  assert.equal(message.error.code, "BROKER_UNAVAILABLE");
});

test("starts broker through configured startup hook when pipe is initially missing", async () => {
  const pipeName = `portus-native-host-start-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let server;
  let started = 0;
  const input = new PassThrough();
  const output = new PassThrough();
  const relay = createNativeHostRelay({
    brokerToken: TEST_BROKER_TOKEN,
    input,
    output,
    config: {
      broker: { pipeName },
      nativeHost: {
        brokerPipeName: pipeName,
        startBrokerIfMissing: true
      }
    },
    async startBroker() {
      started += 1;
      server = createBrokerNamedPipeServer({
    brokerToken: TEST_BROKER_TOKEN,
        config: {
          broker: { pipeName },
          nativeHost: { brokerPipeName: pipeName }
        },
        now: () => new Date("2026-04-28T00:00:00.000Z")
      });
      await server.start();
    }
  });

  try {
    await relay.connectBroker();
    assert.equal(started, 1);
    input.write(encodeNativeMessage(extensionRequest("req_001", "browser.list")));
    const message = await readNativeMessage(output);
    assert.equal(message.ok, true);
    assert.deepEqual(message.result.browsers, []);
  } finally {
    await relay.stop();
    if (server) await server.stop();
  }
});

test("default broker starter launches broker detached with isolated stdio", async () => {
  let accessedPath = "";
  let spawnCall;
  let unrefCalled = false;
  const starter = createDefaultBrokerStarter({
    brokerEntry: "C:/repo/apps/portus-broker/dist/index.js",
    nodePath: "C:/node/node.exe",
    access: async (path) => {
      accessedPath = path;
    },
    spawn: (file, args, options) => {
      spawnCall = { file, args, options };
      return {
        unref() {
          unrefCalled = true;
        }
      };
    }
  });

  await starter();

  assert.equal(accessedPath, "C:/repo/apps/portus-broker/dist/index.js");
  assert.deepEqual(spawnCall, {
    file: "C:/node/node.exe",
    args: ["C:/repo/apps/portus-broker/dist/index.js"],
    options: {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }
  });
  assert.equal(unrefCalled, true);
});

test("resolves Unix socket endpoint when configured for Unix transport", () => {
  const relay = createNativeHostRelay({
    brokerToken: TEST_BROKER_TOKEN,
    config: {
      broker: {
        transport: "unix-socket",
        pipeName: "portus-native-host-unix-test"
      },
      nativeHost: {
        brokerPipeName: "portus-native-host-unix-test"
      }
    }
  });

  assert.equal(relay.brokerEndpoint.transport, "unix-socket");
  assert.match(relay.brokerEndpointPath, /portus-native-host-unix-test\.sock$/);
});

test("relays broker-routed commands to extension and returns extension response", async () => {
  const { server, relay, input, output } = await startRelayFixture();
  const cliSocket = createConnection(server.broker.pipePath);
  try {
    input.write(encodeNativeMessage(extensionRequest("req_001", "bridge.register", registration)));
    const registrationResponse = await readNativeMessage(output);
    const browserId = registrationResponse.result.browserId;

    const cliResponsePromise = readTransportFrame(cliSocket);
    cliSocket.write(serializeTransportFrame(request("req_002", "tab.list", { browserId })));

    const commandToExtension = await readNativeMessage(output);
    assert.equal(commandToExtension.kind, "request");
    assert.equal(commandToExtension.type, "tab.list");
    assert.equal(commandToExtension.payload.browserId, browserId);

    input.write(encodeNativeMessage(response(commandToExtension.requestId, {
      tabs: []
    })));

    const cliFrame = await cliResponsePromise;
    assert.equal(cliFrame.message.kind, "response");
    assert.equal(cliFrame.message.ok, true);
    assert.deepEqual(cliFrame.message.result.tabs, []);
  } finally {
    cliSocket.end();
    await relay.stop();
    await server.stop();
  }
});

test("rejects terminal messages on the browser-control native host", async () => {
  const { server, relay, input, output } = await startRelayFixture();
  try {
    input.write(encodeNativeMessage({
      type: "terminal.sessions.list",
      requestId: "treq_001",
      payload: {}
    }));
    const message = await readNativeMessage(output);
    assert.equal(message.kind, "response");
    assert.equal(message.ok, false);
    assert.equal(message.error.code, "INVALID_MESSAGE");

    const list = await server.broker.handleRequest(request("req_after_terminal", "browser.list"));
    assert.equal(list.ok, true);
    assert.deepEqual(list.result.browsers, []);
  } finally {
    await relay.stop();
    await server.stop();
  }
});

async function startRelayFixture() {
  const pipeName = `portus-native-host-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const server = createBrokerNamedPipeServer({
    brokerToken: TEST_BROKER_TOKEN,
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
      nativeHost: {
        brokerPipeName: pipeName
      },
      broker: {
        pipeName
      }
    }
  });
  await relay.connectBroker();
  return { server, relay, input, output };
}

function readNativeMessage(output) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      const read = tryReadNativeMessageFrame(buffer);
      if (!read) return;
      output.off("data", onData);
      output.off("error", reject);
      resolve(read.payload);
    };
    output.on("data", onData);
    output.once("error", reject);
  });
}

function readTransportFrame(socket) {
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
  });
}
