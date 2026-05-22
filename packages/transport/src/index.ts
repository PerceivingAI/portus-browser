import { tmpdir } from "node:os";
import { join, posix as pathPosix } from "node:path";
import { z } from "zod";
import { EventEnvelopeSchema, RequestEnvelopeSchema, ResponseEnvelopeSchema } from "@portus/protocol";

export const TransportKindSchema = z.enum(["named-pipe", "unix-socket"]);
export const BrokerTransportConfigSchema = z.enum(["local", "named-pipe", "unix-socket"]);

export const EndpointNameSchema = z.string().min(1).refine((value) => {
  return !/[\\/]/.test(value);
}, "endpoint name must not contain path separators");

export const PipeNameSchema = EndpointNameSchema;

export const NamedPipeEndpointSchema = z.object({
  transport: TransportKindSchema,
  endpointName: EndpointNameSchema,
  endpointPath: z.string().min(1),
  pipeName: PipeNameSchema,
  pipePath: z.string().min(1)
}).strict();

export const BrokerEndpointSchema = NamedPipeEndpointSchema;

export const TransportMessageSchema = z.union([
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  EventEnvelopeSchema
]);

export const TransportFrameSchema = z.object({
  transport: TransportKindSchema,
  message: TransportMessageSchema
}).strict();

export type TransportKind = z.infer<typeof TransportKindSchema>;
export type BrokerTransportConfig = z.infer<typeof BrokerTransportConfigSchema>;
export type NamedPipeEndpoint = z.infer<typeof NamedPipeEndpointSchema>;
export type BrokerEndpoint = z.infer<typeof BrokerEndpointSchema>;
export type TransportMessage = z.infer<typeof TransportMessageSchema>;
export type TransportFrame = z.infer<typeof TransportFrameSchema>;

export function getWindowsNamedPipePath(pipeName: string): string {
  const parsed = EndpointNameSchema.parse(pipeName);
  return `\\\\.\\pipe\\${parsed}`;
}

export interface UnixSocketPathOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  runtimeDirectory?: string;
}

export function getUnixSocketPath(endpointName: string, options: UnixSocketPathOptions = {}): string {
  const parsed = EndpointNameSchema.parse(endpointName);
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const runtimeDirectory = options.runtimeDirectory ?? getDefaultUnixRuntimeDirectory(platform, env);
  return platform === "win32" ? join(runtimeDirectory, `${parsed}.sock`) : pathPosix.join(runtimeDirectory, `${parsed}.sock`);
}

export interface ResolveBrokerEndpointOptions extends UnixSocketPathOptions {
  endpointName?: string;
  pipeName?: string;
  transport?: BrokerTransportConfig;
}

export function resolveBrokerEndpoint(options: ResolveBrokerEndpointOptions = {}): BrokerEndpoint {
  const endpointName = EndpointNameSchema.parse(options.endpointName ?? options.pipeName ?? "portus-browser-broker");
  const platform = options.platform ?? process.platform;
  const configuredTransport = BrokerTransportConfigSchema.parse(options.transport ?? "local");
  const transport: TransportKind =
    configuredTransport === "local" ? (platform === "win32" ? "named-pipe" : "unix-socket") : configuredTransport;
  const socketOptions: UnixSocketPathOptions = { platform };
  if (options.env !== undefined) socketOptions.env = options.env;
  if (options.runtimeDirectory !== undefined) socketOptions.runtimeDirectory = options.runtimeDirectory;
  const endpointPath =
    transport === "named-pipe"
      ? getWindowsNamedPipePath(endpointName)
      : getUnixSocketPath(endpointName, socketOptions);

  return BrokerEndpointSchema.parse({
    transport,
    endpointName,
    endpointPath,
    pipeName: endpointName,
    pipePath: endpointPath
  });
}

export function createNamedPipeEndpoint(pipeName: string): NamedPipeEndpoint {
  return resolveBrokerEndpoint({
    endpointName: pipeName,
    platform: "win32",
    transport: "named-pipe"
  });
}

export function serializeTransportFrame(message: TransportMessage, transport: TransportKind = "named-pipe"): string {
  const frame = TransportFrameSchema.parse({
    transport,
    message
  });
  return `${JSON.stringify(frame)}\n`;
}

export function deserializeTransportFrame(frame: string): TransportFrame {
  return TransportFrameSchema.parse(JSON.parse(frame));
}

function getDefaultUnixRuntimeDirectory(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): string {
  if (platform === "linux" && env.XDG_RUNTIME_DIR) {
    return pathPosix.join(env.XDG_RUNTIME_DIR, "portus-browser");
  }

  const userId = typeof process.getuid === "function" ? process.getuid() : env.USER ?? env.USERNAME ?? "user";
  const runtimeBase = platform === process.platform ? tmpdir() : "/tmp";
  return platform === "win32" ? join(runtimeBase, `portus-browser-${userId}`) : pathPosix.join(runtimeBase, `portus-browser-${userId}`);
}
