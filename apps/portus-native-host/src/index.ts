import { createConnection, type Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import { DEFAULT_PORTUS_CONFIG, PortusConfigSchema, loadOrCreateBrokerToken, type PortusConfig } from "@portus/config";
import {
  NativeMessageFrameError,
  decodeNativeMessageFrame,
  encodeNativeMessage,
  tryReadNativeMessageFrame,
  type NativeMessagePayload
} from "@portus/native-messaging";
import {
  PROTOCOL_VERSION,
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  EventEnvelopeSchema,
  createInvalidMessageError,
  createPortusError,
  type PortusError,
  type ResponseEnvelope,
  type RequestEnvelope,
  type EventEnvelope
} from "@portus/protocol";
import {
  deserializeTransportFrame,
  resolveBrokerEndpoint,
  serializeTransportFrame,
  type BrokerEndpoint
} from "@portus/transport";

export interface NativeHostRelayOptions {
  config?: unknown;
  input?: Readable;
  output?: Writable;
  startBroker?: () => Promise<void> | void;
  brokerToken?: string;
}

export class NativeHostRelay {
  readonly config: PortusConfig;
  readonly brokerEndpoint: BrokerEndpoint;
  readonly brokerEndpointPath: string;
  readonly brokerPipePath: string;
  private readonly brokerToken: string | undefined;
  private input?: Readable;
  private output?: Writable;
  private brokerSocket: Socket | undefined;
  private nativeBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private brokerBuffer = "";
  private brokerConnected = false;
  private readonly startBroker: (() => Promise<void> | void) | undefined;

  constructor(options: NativeHostRelayOptions = {}) {
    this.config = PortusConfigSchema.parse(options.config ?? DEFAULT_PORTUS_CONFIG);
    this.brokerEndpoint = resolveBrokerEndpoint({
      endpointName: this.config.nativeHost.brokerPipeName,
      transport: this.config.broker.transport
    });
    this.brokerEndpointPath = this.brokerEndpoint.endpointPath;
    this.brokerPipePath = this.brokerEndpoint.endpointPath;
    this.brokerToken = this.config.security.requireBrokerToken ? options.brokerToken ?? loadOrCreateBrokerToken() : undefined;
    this.startBroker = options.startBroker;
    if (options.input && options.output) this.attach(options.input, options.output);
  }

  attach(input: Readable, output: Writable): void {
    this.input = input;
    this.output = output;
    input.on("data", (chunk: Buffer | string) => {
      this.acceptNativeData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
  }

  async connectBroker(): Promise<void> {
    if (this.brokerConnected && this.brokerSocket) return Promise.resolve();
    try {
      await this.connectBrokerOnce();
    } catch (error) {
      if (!this.config.nativeHost.startBrokerIfMissing || !this.startBroker) throw error;
      await this.startBroker();
      await this.connectBrokerAfterStart();
    }
  }

  private connectBrokerOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.brokerEndpointPath);
      this.brokerSocket = socket;

      const onConnect = () => {
        socket.off("error", onError);
        this.brokerConnected = true;
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
          this.acceptBrokerData(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
        });
        socket.on("close", () => {
          this.brokerConnected = false;
        });
        resolve();
      };
      const onError = (error: Error) => {
        socket.off("connect", onConnect);
        this.brokerConnected = false;
        this.brokerSocket = undefined;
        reject(error);
      };

      socket.once("connect", onConnect);
      socket.once("error", onError);
    });
  }

  private async connectBrokerAfterStart(): Promise<void> {
    const deadline = Date.now() + this.config.nativeHost.connectTimeoutMs;
    let lastError: unknown;
    while (Date.now() <= deadline) {
      try {
        await this.connectBrokerOnce();
        return;
      } catch (error) {
        lastError = error;
        await delay(100);
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error("Broker did not become available after startup.");
  }

  stop(): Promise<void> {
    const socket = this.brokerSocket;
    this.brokerSocket = undefined;
    this.brokerConnected = false;
    if (!socket || socket.destroyed) return Promise.resolve();
    return new Promise((resolve) => {
      socket.once("close", () => resolve());
      socket.end();
    });
  }

  private acceptNativeData(chunk: Buffer): void {
    this.nativeBuffer = Buffer.concat([this.nativeBuffer, chunk]);
    try {
      let read = tryReadNativeMessageFrame(this.nativeBuffer);
      while (read) {
        this.nativeBuffer = read.remaining;
        this.handleNativeMessage(read.payload);
        read = tryReadNativeMessageFrame(this.nativeBuffer);
      }
    } catch (error) {
      this.nativeBuffer = Buffer.alloc(0);
      this.writeNativeResponse(createErrorResponse("req_invalid", normalizeNativeHostError(error)));
    }
  }

  private handleNativeMessage(message: NativeMessagePayload): void {
    const protocolMessage = parseProtocolNativeMessage(message);
    if (!protocolMessage) {
      this.writeNativeResponse(createErrorResponse("req_invalid", createInvalidMessageError({
        reason: "terminal messages must use com.portus.browser.terminal"
      })));
      return;
    }

    if (!this.brokerSocket || !this.brokerConnected) {
      if (protocolMessage.kind === "request") {
        this.writeNativeResponse(createErrorResponse(protocolMessage.requestId, brokerUnavailableError()));
      }
      return;
    }

    const brokerMessage = protocolMessage.kind === "request" && this.brokerToken !== undefined
      ? RequestEnvelopeSchema.parse({
        ...protocolMessage,
        auth: { brokerToken: this.brokerToken }
      })
      : protocolMessage;

    this.brokerSocket.write(serializeTransportFrame(brokerMessage, this.brokerEndpoint.transport), (error) => {
      if (error && protocolMessage.kind === "request") {
        this.writeNativeResponse(createErrorResponse(protocolMessage.requestId, brokerUnavailableError()));
      }
    });
  }

  private acceptBrokerData(chunk: string): void {
    this.brokerBuffer += chunk;
    let newlineIndex = this.brokerBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.brokerBuffer.slice(0, newlineIndex);
      this.brokerBuffer = this.brokerBuffer.slice(newlineIndex + 1);
      try {
        const frame = deserializeTransportFrame(line);
        this.writeNativeMessage(frame.message);
      } catch (error) {
        this.writeNativeResponse(createErrorResponse("req_invalid", normalizeNativeHostError(error)));
      }
      newlineIndex = this.brokerBuffer.indexOf("\n");
    }
  }

  private writeNativeMessage(message: NativeMessagePayload): void {
    if (!this.output) return;
    this.output.write(encodeNativeMessage(message));
  }

  private writeNativeResponse(response: ResponseEnvelope): void {
    this.writeNativeMessage(response);
  }
}

export async function runNativeHost(options: NativeHostRelayOptions = {}): Promise<NativeHostRelay> {
  const relay = new NativeHostRelay({
    ...options,
    input: options.input ?? process.stdin,
    output: options.output ?? process.stdout
  });
  await relay.connectBroker();
  return relay;
}

export function createNativeHostRelay(options: NativeHostRelayOptions = {}): NativeHostRelay {
  return new NativeHostRelay(options);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseProtocolNativeMessage(message: NativeMessagePayload): RequestEnvelope | ResponseEnvelope | EventEnvelope | null {
  const request = RequestEnvelopeSchema.safeParse(message);
  if (request.success) return request.data;
  const response = ResponseEnvelopeSchema.safeParse(message);
  if (response.success) return response.data;
  const event = EventEnvelopeSchema.safeParse(message);
  if (event.success) return event.data;
  return null;
}

function createErrorResponse(requestId: string, error: PortusError): ResponseEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    kind: "response",
    ok: false,
    error
  };
}

function brokerUnavailableError(): PortusError {
  return createPortusError({
    code: "BROKER_UNAVAILABLE",
    message: "Portus Broker is unavailable.",
    retryable: true
  });
}

function normalizeNativeHostError(error: unknown): PortusError {
  if (error instanceof NativeMessageFrameError) {
    return createInvalidMessageError({ reason: error.message });
  }

  if (error instanceof SyntaxError) {
    return createInvalidMessageError({ reason: "invalid JSON" });
  }

  const maybeEnvelope = tryDecodeProtocolEnvelope(error);
  if (maybeEnvelope) return maybeEnvelope;

  return createInvalidMessageError({
    reason: error instanceof Error ? error.message : "invalid native host message"
  });
}

function tryDecodeProtocolEnvelope(error: unknown): PortusError | null {
  if (!(error instanceof Error)) return null;
  return null;
}

export function decodeNativeFrameForTest(frame: Buffer): NativeMessagePayload {
  return decodeNativeMessageFrame(frame);
}

export const portusNativeHostApp = {
  name: "portus-native-host",
  packageName: "@portus/native-host",
  phase: "native-host"
} as const;
