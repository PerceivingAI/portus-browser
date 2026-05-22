import assert from "node:assert/strict";
import test from "node:test";
import {
  createNamedPipeEndpoint,
  deserializeTransportFrame,
  getUnixSocketPath,
  getWindowsNamedPipePath,
  resolveBrokerEndpoint,
  serializeTransportFrame
} from "../dist/index.js";

const request = {
  protocolVersion: "1",
  requestId: "req_001",
  kind: "request",
  type: "browser.list",
  payload: {}
};

test("creates Windows named pipe endpoints", () => {
  assert.deepEqual(createNamedPipeEndpoint("portus-browser-broker"), {
    transport: "named-pipe",
    endpointName: "portus-browser-broker",
    endpointPath: "\\\\.\\pipe\\portus-browser-broker",
    pipeName: "portus-browser-broker",
    pipePath: "\\\\.\\pipe\\portus-browser-broker"
  });
  assert.equal(getWindowsNamedPipePath("portus-browser-broker"), "\\\\.\\pipe\\portus-browser-broker");
  assert.throws(() => getWindowsNamedPipePath("../bad"));
});

test("resolves broker endpoints by platform", () => {
  assert.deepEqual(resolveBrokerEndpoint({
    endpointName: "portus-browser-broker",
    platform: "win32"
  }), {
    transport: "named-pipe",
    endpointName: "portus-browser-broker",
    endpointPath: "\\\\.\\pipe\\portus-browser-broker",
    pipeName: "portus-browser-broker",
    pipePath: "\\\\.\\pipe\\portus-browser-broker"
  });

  assert.deepEqual(resolveBrokerEndpoint({
    endpointName: "portus-browser-broker",
    platform: "linux",
    env: {
      XDG_RUNTIME_DIR: "/run/user/1000"
    }
  }), {
    transport: "unix-socket",
    endpointName: "portus-browser-broker",
    endpointPath: "/run/user/1000/portus-browser/portus-browser-broker.sock",
    pipeName: "portus-browser-broker",
    pipePath: "/run/user/1000/portus-browser/portus-browser-broker.sock"
  });

  assert.equal(getUnixSocketPath("portus-browser-broker", {
    platform: "darwin",
    runtimeDirectory: "/tmp/portus"
  }), "/tmp/portus/portus-browser-broker.sock");
});

test("serializes validated transport frames", () => {
  const serialized = serializeTransportFrame(request);
  assert.equal(serialized.endsWith("\n"), true);
  const parsed = deserializeTransportFrame(serialized);
  assert.equal(parsed.transport, "named-pipe");
  assert.deepEqual(parsed.message, request);

  const unixFrame = deserializeTransportFrame(serializeTransportFrame(request, "unix-socket"));
  assert.equal(unixFrame.transport, "unix-socket");
});
