import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeNativeMessageFrame,
  encodeNativeMessage,
  tryReadNativeMessageFrame
} from "../dist/index.js";

const request = {
  protocolVersion: "1",
  requestId: "req_001",
  kind: "request",
  type: "browser.list",
  payload: {}
};

test("encodes and decodes Chrome native messaging frames", () => {
  const frame = encodeNativeMessage(request);
  assert.equal(frame.readUInt32LE(0), frame.byteLength - 4);
  assert.deepEqual(decodeNativeMessageFrame(frame), request);
});

test("supports incremental frame reads", () => {
  const frame = encodeNativeMessage(request);
  assert.equal(tryReadNativeMessageFrame(frame.subarray(0, 3)), null);
  const read = tryReadNativeMessageFrame(Buffer.concat([frame, frame]));
  assert.deepEqual(read.payload, request);
  assert.equal(read.remaining.byteLength, frame.byteLength);
});

test("rejects malformed native messaging frames", () => {
  assert.throws(() => decodeNativeMessageFrame(Buffer.alloc(2)));
  const frame = encodeNativeMessage(request, 1024);
  assert.throws(() => decodeNativeMessageFrame(frame.subarray(0, frame.byteLength - 1)));
  assert.throws(() => encodeNativeMessage(request, 1));
});


test("encodes and decodes terminal native messaging frames", () => {
  const terminalMessage = {
    type: "terminal.session.output",
    terminalId: "term_000001",
    payload: { data: "[32mok[0m" }
  };
  const frame = encodeNativeMessage(terminalMessage);
  assert.deepEqual(decodeNativeMessageFrame(frame), terminalMessage);
});
