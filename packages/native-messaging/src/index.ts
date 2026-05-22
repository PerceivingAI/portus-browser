import { z } from "zod";
import { EventEnvelopeSchema, RequestEnvelopeSchema, ResponseEnvelopeSchema } from "@portus/protocol";
import { TerminalClientMessageSchema, TerminalServerMessageSchema } from "@portus/terminal";

export const DEFAULT_MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;
export const NATIVE_MESSAGE_HEADER_BYTES = 4;

export const NativeMessagePayloadSchema = z.union([
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  EventEnvelopeSchema,
  TerminalClientMessageSchema,
  TerminalServerMessageSchema
]);

export type NativeMessagePayload = z.infer<typeof NativeMessagePayloadSchema>;

export class NativeMessageFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeMessageFrameError";
  }
}

export function encodeNativeMessage(
  payload: NativeMessagePayload,
  maxBytes = DEFAULT_MAX_NATIVE_MESSAGE_BYTES
): Buffer {
  const parsed = NativeMessagePayloadSchema.parse(payload);
  const body = Buffer.from(JSON.stringify(parsed), "utf8");
  if (body.byteLength > maxBytes) {
    throw new NativeMessageFrameError(`Native message exceeds ${maxBytes} bytes.`);
  }

  const frame = Buffer.allocUnsafe(NATIVE_MESSAGE_HEADER_BYTES + body.byteLength);
  frame.writeUInt32LE(body.byteLength, 0);
  body.copy(frame, NATIVE_MESSAGE_HEADER_BYTES);
  return frame;
}

export function decodeNativeMessageFrame(
  frame: Buffer,
  maxBytes = DEFAULT_MAX_NATIVE_MESSAGE_BYTES
): NativeMessagePayload {
  if (frame.byteLength < NATIVE_MESSAGE_HEADER_BYTES) {
    throw new NativeMessageFrameError("Native message frame is missing length header.");
  }

  const length = frame.readUInt32LE(0);
  if (length > maxBytes) {
    throw new NativeMessageFrameError(`Native message declares ${length} bytes, exceeding ${maxBytes}.`);
  }

  const expectedLength = NATIVE_MESSAGE_HEADER_BYTES + length;
  if (frame.byteLength !== expectedLength) {
    throw new NativeMessageFrameError(`Native message frame length mismatch. Expected ${expectedLength}, received ${frame.byteLength}.`);
  }

  const json = frame.subarray(NATIVE_MESSAGE_HEADER_BYTES).toString("utf8");
  return NativeMessagePayloadSchema.parse(JSON.parse(json));
}

export function tryReadNativeMessageFrame(
  buffer: Buffer,
  maxBytes = DEFAULT_MAX_NATIVE_MESSAGE_BYTES
): { payload: NativeMessagePayload; remaining: Buffer } | null {
  if (buffer.byteLength < NATIVE_MESSAGE_HEADER_BYTES) return null;

  const length = buffer.readUInt32LE(0);
  if (length > maxBytes) {
    throw new NativeMessageFrameError(`Native message declares ${length} bytes, exceeding ${maxBytes}.`);
  }

  const frameLength = NATIVE_MESSAGE_HEADER_BYTES + length;
  if (buffer.byteLength < frameLength) return null;

  const frame = buffer.subarray(0, frameLength);
  const remaining = buffer.subarray(frameLength);
  return {
    payload: decodeNativeMessageFrame(frame, maxBytes),
    remaining
  };
}
