#!/usr/bin/env node

import { createConnection, type Socket } from "node:net";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DEFAULT_PORTUS_CONFIG, PortusConfigSchema, applyEnvironmentOverrides, loadOrCreateBrokerToken, type PortusConfig } from "@portus/config";
import {
  BrowserSessionSchema,
  ActionResultSchema,
  ConsoleListResultSchema,
  DialogResultSchema,
  DismissResultSchema,
  DownloadGetResultSchema,
  DownloadListResultSchema,
  DownloadWaitResultSchema,
  FillFormResultSchema,
  NetworkGetResultSchema,
  NetworkListResultSchema,
  PROTOCOL_VERSION,
  PolicyPreferencesSchema,
  PortusErrorSchema,
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  EventEnvelopeSchema,
  ScreenshotResultSchema,
  SessionStepSchema,
  SnapshotFilterSchema,
  SnapshotSchema,
  TabSchema,
  WaitResultSchema,
  createPortusError,
  normalizeNavigationRulePattern,
  type ActionResult,
  type BrowserSession,
  type ConsoleListResult,
  type DialogResult,
  type DismissResult,
  type DownloadGetResult,
  type DownloadListResult,
  type DownloadRecord,
  type DownloadWaitResult,
  type ErrorCode,
  type EventEnvelope,
  type FillFormResult,
  type NetworkGetResult,
  type NetworkListResult,
  type NavigationRuleMatch,
  type NavigationRulePattern,
  type PolicyPreferences,
  type PortusError,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ScreenshotResult,
  type SessionStep,
  type Snapshot,
  type Tab,
  type WaitResult
} from "@portus/protocol";
import {
  deleteRecipeFromLibrary,
  defaultRecipeLibraryDirectory,
  getRecipeFromLibrary,
  importRecipeToLibrary,
  listRecipeLibrary,
  loadRecipeRecordFromFile,
  parseRecipeRecord,
  RecipeRecordSchema,
  saveRecipeRecordToDirectory,
  updateRecipeInLibrary,
  validateRecipeForManagement,
  type RecipeLibraryDiagnostic,
  type RecipeManagementIssue,
  type RecipeRecord
} from "@portus/recipes";
import {
  CLI_FLAGS,
  CLI_OUTPUT_FLAG,
  CLI_TIMEOUT_FLAG,
  cliFlagTakesValue,
  getCliFlagSpec
} from "./cli-flags.js";
import {
  cliInvocationOutputFlagRole,
  cliInvocationPath,
  renderCliInvocationUsage,
  resolveCliInvocation,
  validateCliInvocationFlags,
  validateCliInvocationPositionals,
  validateCliInvocationPrimitiveValues,
  validateCliInvocationRepeatability,
  type CliInvocationSpec
} from "./command-spec.js";
import {
  deserializeTransportFrame,
  resolveBrokerEndpoint,
  serializeTransportFrame,
  type TransportKind
} from "@portus/transport";

export type OutputMode = "table" | "json" | "ndjson" | "quiet";

export interface CliCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface PortusBrowserCliOptions {
  config?: unknown;
  env?: Record<string, string | undefined>;
  brokerClient?: BrokerClient;
  now?: () => Date;
  stdout?: (chunk: string) => void;
}

export interface BrokerClient {
  request(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  subscribeEvents?(
    payload: Record<string, unknown>,
    onEvent: (event: EventEnvelope) => void,
    timeoutMs?: number
  ): Promise<void>;
  close?(): Promise<void> | void;
}

interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Map<string, string | boolean | string[]>;
}

interface CliContext {
  config: PortusConfig;
  output: OutputMode;
  broker: BrokerClient;
  timeoutMs: number | undefined;
  writeStdout: (chunk: string) => void;
}

type CliPayloadHandler = (context: CliContext, parsed: ParsedArgs) => Promise<Record<string, unknown>>;
type CliDispatchHandler = (context: CliContext, parsed: ParsedArgs) => Promise<CliCommandResult>;
type CliTabTarget =
  | { kind: "tab-id"; value: number }
  | { kind: "index"; value: number };

type DialogCliAction = "accept" | "dismiss";
type ConsoleCliAction = "list" | "clear";
type NetworkCliAction = "list" | "get";
type DownloadsCliAction = "list" | "get" | "wait";
type BrokerCliAction = "status" | "stop";
type NavigationPolicyArea = "allow" | "block";
type NavigationPolicyAction = "list" | "add" | "remove";
type RetentionPolicyAction = "get" | "set";
type RecipeCliAction =
  | "list"
  | "create"
  | "show"
  | "search"
  | "use"
  | "resolve"
  | "update"
  | "rename"
  | "delete"
  | "validate"
  | "import"
  | "export"
  | "duplicate";

const BrowserListResultSchema = z.object({
  browsers: z.array(BrowserSessionSchema)
}).strict();

const TabListResultSchema = z.object({
  tabs: z.array(TabSchema)
}).strict();

const TabResultSchema = z.object({
  tab: TabSchema
}).strict();

const ScreenshotCommandResultSchema = z.object({
  screenshot: ScreenshotResultSchema
}).strict();

const SnapshotCommandResultSchema = z.object({
  snapshot: SnapshotSchema
}).strict();

const WaitCommandResultSchema = z.object({
  wait: WaitResultSchema
}).strict();

const ActionCommandResultSchema = z.object({
  action: ActionResultSchema
}).strict();

const FillFormCommandResultSchema = z.object({
  fillForm: FillFormResultSchema
}).strict();

const DismissCommandResultSchema = z.object({
  dismiss: DismissResultSchema
}).strict();

const DialogCommandResultSchema = z.object({
  dialog: DialogResultSchema
}).strict();

const ConsoleCommandResultSchema = z.object({
  console: ConsoleListResultSchema
}).strict();

const NetworkListCommandResultSchema = z.object({
  network: NetworkListResultSchema
}).strict();

const NetworkGetCommandResultSchema = z.object({
  network: NetworkGetResultSchema
}).strict();

const RecipeSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string().optional(),
  description: z.string().optional(),
  richSchemaOk: z.boolean().optional(),
  issues: z.array(z.object({
    severity: z.enum(["error", "warning"]),
    path: z.string(),
    message: z.string()
  }).strict()).optional()
}).passthrough();

const RecipeListResultSchema = z.object({
  directory: z.string().optional(),
  recipes: z.array(RecipeSummarySchema),
  diagnostics: z.array(z.unknown()).optional()
}).strict();

const RecipeRecordResultSchema = z.object({
  recipe: RecipeRecordSchema,
  richSchemaOk: z.boolean(),
  issues: z.array(z.object({
    severity: z.enum(["error", "warning"]),
    path: z.string(),
    message: z.string()
  }).strict()),
  diagnostics: z.array(z.unknown()).optional()
}).strict();


const PolicyResultSchema = z.object({
  policy: PolicyPreferencesSchema
}).strict();

const EventListResultSchema = z.object({
  events: z.array(EventEnvelopeSchema)
}).strict();

const SessionStepsResultSchema = z.object({
  steps: z.array(SessionStepSchema)
}).strict();

const BridgeDisconnectResultSchema = z.object({
  disconnected: z.boolean()
}).strict();

const BrokerStatusResultSchema = z.object({
  running: z.boolean(),
  transport: z.enum(["named-pipe", "unix-socket"]).optional(),
  endpointPath: z.string().optional(),
  endpointName: z.string().optional(),
  pipePath: z.string(),
  pipeName: z.string(),
  startedAt: z.string(),
  protocolVersion: z.string(),
  processId: z.number().int().optional()
}).strict();

const BrokerStopResultSchema = z.object({
  stopping: z.boolean(),
  transport: z.enum(["named-pipe", "unix-socket"]).optional(),
  endpointPath: z.string().optional(),
  endpointName: z.string().optional(),
  pipePath: z.string(),
  pipeName: z.string()
}).strict();

const BrowserTargetSchema = z.string().regex(/^br_[A-Za-z0-9_-]+$/);

export class NamedPipeBrokerClient implements BrokerClient {
  private socket: Socket | undefined;
  private buffer = "";
  private nextRequestNumber = 1;
  private readonly eventSubscribers = new Set<(event: EventEnvelope) => void>();
  private readonly pending = new Map<string, {
    resolve: (response: ResponseEnvelope) => void;
    reject: (reason: PortusError) => void;
    timer: ReturnType<typeof setTimeout> | undefined;
  }>();
  private connectPromise: Promise<Socket> | undefined;

  constructor(
    private readonly endpointPath: string,
    private readonly brokerToken?: string,
    private readonly transport: TransportKind = "named-pipe"
  ) {}

  async request(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>> {
    const socket = await this.connect();
    const request = RequestEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: this.createRequestId(),
      kind: "request",
      type,
      payload,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(this.brokerToken === undefined ? {} : { auth: { brokerToken: this.brokerToken } }),
      client: {
        name: "portus-browser-cli"
      }
    });

    return new Promise((resolve, reject) => {
      const timer = timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
          this.pending.delete(request.requestId);
          reject(createPortusError({
            code: "COMMAND_TIMEOUT",
            message: `Broker request timed out after ${timeoutMs}ms.`,
            retryable: true
          }));
        }, timeoutMs);

      this.pending.set(request.requestId, {
        timer,
        resolve: (response) => {
          if (response.ok) resolve(response.result);
          else reject(response.error);
        },
        reject
      });

      socket.write(serializeTransportFrame(request, this.transport), (error) => {
        if (!error) return;
        this.clearPending(request.requestId);
        reject(brokerUnavailableError(error.message));
      });
    });
  }

  async subscribeEvents(
    payload: Record<string, unknown>,
    onEvent: (event: EventEnvelope) => void,
    timeoutMs?: number
  ): Promise<void> {
    const socket = await this.connect();
    this.eventSubscribers.add(onEvent);
    try {
      await this.request("event.subscribe", payload, timeoutMs);
      await new Promise<void>((resolve, reject) => {
        const onClose = () => {
          socket.off("error", onError);
          resolve();
        };
        const onError = (error: Error) => {
          socket.off("close", onClose);
          reject(brokerUnavailableError(error.message));
        };
        socket.once("close", onClose);
        socket.once("error", onError);
      });
    } finally {
      this.eventSubscribers.delete(onEvent);
    }
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    if (!socket || socket.destroyed) return;
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.end();
    });
  }

  private connect(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connectPromise) return this.connectPromise;

    const connection = new Promise<Socket>((resolve, reject) => {
      const socket = createConnection(this.endpointPath);
      const onConnect = () => {
        socket.off("error", onError);
        this.socket = socket;
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
          this.acceptData(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
        });
        socket.on("close", () => {
          if (this.socket === socket) this.socket = undefined;
          this.rejectAllPending(brokerUnavailableError("Broker connection closed."));
        });
        socket.on("error", (error) => {
          if (this.socket !== socket) return;
          this.rejectAllPending(brokerUnavailableError(error.message));
        });
        resolve(socket);
      };
      const onError = (error: Error) => {
        socket.off("connect", onConnect);
        reject(brokerUnavailableError(error.message));
      };
      socket.once("connect", onConnect);
      socket.once("error", onError);
    });
    this.connectPromise = connection;
    void connection.finally(() => {
      if (this.connectPromise === connection) this.connectPromise = undefined;
    }).catch(() => undefined);
    return connection;
  }

  private acceptData(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.acceptFrame(line);
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private acceptFrame(line: string): void {
    try {
      const frame = deserializeTransportFrame(line);
      if (frame.message.kind === "event") {
        const event = EventEnvelopeSchema.parse(frame.message);
        for (const subscriber of this.eventSubscribers) subscriber(event);
        return;
      }
      if (frame.message.kind !== "response") return;
      const response = ResponseEnvelopeSchema.parse(frame.message);
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.clearPending(response.requestId);
      pending.resolve(response);
    } catch (error) {
      this.rejectAllPending(createPortusError({
        code: "INVALID_MESSAGE",
        message: "Broker returned an invalid response.",
        details: {
          reason: error instanceof Error ? error.message : "invalid broker response"
        }
      }));
    }
  }

  private clearPending(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(requestId);
  }

  private rejectAllPending(error: PortusError): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.reject(error);
    }
  }

  private createRequestId(): string {
    return `req_cli_${this.nextRequestNumber++}`;
  }
}

export async function runPortusBrowserCli(
  argv: string[],
  options: PortusBrowserCliOptions = {}
): Promise<CliCommandResult> {
  let broker: BrokerClient | undefined;
  let outputMode = inferOutputMode(argv);
  try {
    const config = createCliConfig(options);
    const parsed = parseArgs(argv);
    const resolution = resolveCliInvocation(parsed.command, parsed.positionals);
    if (!resolution.ok) throw usageError(resolution.message);
    const invocation = resolution.invocation;
    const invocationUsage = renderCliInvocationUsage(invocation.spec);
    const flagValidationError = validateCliInvocationFlags(invocation, parsed.flags.keys());
    if (flagValidationError) throw usageError(flagValidationError, invocationUsage);
    const repeatabilityValidationError = validateCliInvocationRepeatability(invocation, parsed.flags);
    if (repeatabilityValidationError) throw usageError(repeatabilityValidationError, invocationUsage);
    const positionalValidationError = validateCliInvocationPositionals(invocation);
    if (positionalValidationError) throw usageError(positionalValidationError, invocationUsage);
    const primitiveValidationError = validateCliInvocationPrimitiveValues(invocation, parsed.flags);
    if (primitiveValidationError) throw usageError(primitiveValidationError, invocationUsage);
    const output = resolveOutputMode(parsed, config, invocation.spec);
    outputMode = output;
    const timeoutMs = readOptionalIntegerFlag(parsed, CLI_TIMEOUT_FLAG.name) ?? config.commands.timeoutMs;
    broker = options.brokerClient ?? createDefaultBrokerClient(config);
    const context: CliContext = {
        config,
        output,
        broker,
        timeoutMs,
        writeStdout: options.stdout ?? ((chunk) => {
          process.stdout.write(chunk);
        })
      };

    const handlerPath = cliInvocationPath(invocation.spec);
    const handler = getCliHandler(handlerPath);
    if (!handler) {
      throw createPortusError({
        code: "INTERNAL_ERROR",
        message: `No CLI handler registered for ${handlerPath}.`
      });
    }
    return await handler(context, parsed);
  } catch (error) {
    return renderFailure(error, outputMode);
  } finally {
    await broker?.close?.();
  }
}

function outputHandler(handler: CliPayloadHandler, outputOverride?: OutputMode): CliDispatchHandler {
  return async (context, parsed) => success(outputOverride ?? context.output, await handler(context, parsed));
}

const CLI_HANDLERS = {
  "browsers": outputHandler(handleBrowsers),
  "tabs": outputHandler(handleTabs),
  "tab": outputHandler(handleTab),
  "open": outputHandler(handleOpen),
  "navigate": outputHandler(handleNavigate),
  "back": outputHandler((context, parsed) => handleHistory(context, parsed, "tab.history.back")),
  "forward": outputHandler((context, parsed) => handleHistory(context, parsed, "tab.history.forward")),
  "activate-tab": outputHandler(handleActivateTab),
  "close-tab": outputHandler(handleCloseTab),
  "screenshot": outputHandler(handleScreenshot),
  "snapshot": outputHandler(handleSnapshot),
  "click": outputHandler((context, parsed) => handleAction(context, parsed, "click")),
  "hover": outputHandler((context, parsed) => handleAction(context, parsed, "hover")),
  "drag": outputHandler((context, parsed) => handleAction(context, parsed, "drag")),
  "fill-form": outputHandler(handleFillForm),
  "upload": outputHandler(handleUpload),
  "type": outputHandler((context, parsed) => handleAction(context, parsed, "type")),
  "press": outputHandler((context, parsed) => handleAction(context, parsed, "press")),
  "scroll": outputHandler((context, parsed) => handleAction(context, parsed, "scroll")),
  "dismiss": outputHandler(handleDismiss),
  "wait": outputHandler(handleWait),
  "watch": outputHandler(handleWatch, "quiet"),

  "dialog accept": outputHandler((context, parsed) => handleDialog(context, parsed, "accept")),
  "dialog dismiss": outputHandler((context, parsed) => handleDialog(context, parsed, "dismiss")),
  "console list": outputHandler((context, parsed) => handleConsole(context, parsed, "list")),
  "console clear": outputHandler((context, parsed) => handleConsole(context, parsed, "clear")),
  "network list": outputHandler((context, parsed) => handleNetwork(context, parsed, "list")),
  "network get": outputHandler((context, parsed) => handleNetwork(context, parsed, "get")),
  "downloads list": outputHandler((context, parsed) => handleDownloads(context, parsed, "list")),
  "downloads get": outputHandler((context, parsed) => handleDownloads(context, parsed, "get")),
  "downloads wait": outputHandler((context, parsed) => handleDownloads(context, parsed, "wait")),
  "events recent": outputHandler(handleEvents),
  "session steps": outputHandler(handleSession),
  "bridge disconnect": outputHandler(handleBridge),
  "broker status": outputHandler((context, parsed) => handleBroker(context, parsed, "status")),
  "broker stop": outputHandler((context, parsed) => handleBroker(context, parsed, "stop")),

  "policy allow list": outputHandler((context, parsed) => handleNavigationPolicy(context, parsed, "allow", "list")),
  "policy allow add": outputHandler((context, parsed) => handleNavigationPolicy(context, parsed, "allow", "add")),
  "policy allow remove": outputHandler((context, parsed) => handleNavigationPolicy(context, parsed, "allow", "remove")),
  "policy block list": outputHandler((context, parsed) => handleNavigationPolicy(context, parsed, "block", "list")),
  "policy block add": outputHandler((context, parsed) => handleNavigationPolicy(context, parsed, "block", "add")),
  "policy block remove": outputHandler((context, parsed) => handleNavigationPolicy(context, parsed, "block", "remove")),
  "policy retention get": outputHandler((context, parsed) => handleRetentionPolicy(context, parsed, "get")),
  "policy retention set": outputHandler((context, parsed) => handleRetentionPolicy(context, parsed, "set")),

  "recipes list": outputHandler((context, parsed) => handleRecipes(context, parsed, "list")),
  "recipes create": outputHandler((context, parsed) => handleRecipes(context, parsed, "create")),
  "recipes show": outputHandler((context, parsed) => handleRecipes(context, parsed, "show")),
  "recipes search": outputHandler((context, parsed) => handleRecipes(context, parsed, "search")),
  "recipes use": outputHandler((context, parsed) => handleRecipes(context, parsed, "use")),
  "recipes resolve": outputHandler((context, parsed) => handleRecipes(context, parsed, "resolve")),
  "recipes update": outputHandler((context, parsed) => handleRecipes(context, parsed, "update")),
  "recipes rename": outputHandler((context, parsed) => handleRecipes(context, parsed, "rename")),
  "recipes delete": outputHandler((context, parsed) => handleRecipes(context, parsed, "delete")),
  "recipes validate": outputHandler((context, parsed) => handleRecipes(context, parsed, "validate")),
  "recipes import": outputHandler((context, parsed) => handleRecipes(context, parsed, "import")),
  "recipes export": outputHandler((context, parsed) => handleRecipes(context, parsed, "export")),
  "recipes duplicate": outputHandler((context, parsed) => handleRecipes(context, parsed, "duplicate"))
} satisfies Record<string, CliDispatchHandler>;

export const CLI_HANDLER_PATHS: readonly string[] = Object.freeze(Object.keys(CLI_HANDLERS));

function getCliHandler(path: string): CliDispatchHandler | undefined {
  return (CLI_HANDLERS as Record<string, CliDispatchHandler>)[path];
}

async function handleBrowsers(context: CliContext): Promise<Record<string, unknown>> {
  const browsers = await listBrowsers(context);
  return {
    ok: true,
    browsers
  };
}

async function handleTabs(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const browserId = await resolveRequiredBrowser(context, parsed);
  const result = TabListResultSchema.parse(await context.broker.request("tab.list", { browserId }, context.timeoutMs));
  return {
    ok: true,
    browserId,
    tabs: sortTabs(result.tabs)
  };
}

async function handleTab(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const target = readRequiredTabTarget(parsed);
  const browserId = await resolveRequiredBrowser(context, parsed);
  const tabId = await resolveRequiredTabId(context, target, browserId);
  const result = TabResultSchema.parse(await context.broker.request("tab.get", { browserId, tabId }, context.timeoutMs));
  return {
    ok: true,
    tab: result.tab
  };
}

async function handleOpen(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const urlInput = parsed.positionals[0] as string;

  const active = !hasFlag(parsed, "background");
  const payload: Record<string, unknown> = {
    url: normalizeUrl(urlInput, context.config.commands.normalizeUrls),
    active
  };

  const browserFlag = readOptionalStringFlag(parsed, "browser");
  if (browserFlag !== undefined) payload.browserId = await resolveBrowserTarget(context, browserFlag);

  const result = TabResultSchema.parse(await context.broker.request("tab.open", payload, context.timeoutMs));
  return {
    ok: true,
    tab: result.tab
  };
}

async function handleNavigate(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const urlInput = parsed.positionals[0] as string;
  const tabId = readRequiredIntegerFlag(parsed, "tab-id");
  const browserId = await resolveRequiredBrowser(context, parsed);
  const result = TabResultSchema.parse(await context.broker.request("tab.navigate", {
    browserId,
    tabId,
    url: normalizeUrl(urlInput, context.config.commands.normalizeUrls)
  }, context.timeoutMs));
  return {
    ok: true,
    tab: result.tab
  };
}

async function handleHistory(context: CliContext, parsed: ParsedArgs, requestType: "tab.history.back" | "tab.history.forward"): Promise<Record<string, unknown>> {
  const tabId = readRequiredIntegerFlag(parsed, "tab-id");
  const browserId = await resolveRequiredBrowser(context, parsed);
  const result = TabResultSchema.parse(await context.broker.request(requestType, { browserId, tabId }, context.timeoutMs));
  return {
    ok: true,
    tab: result.tab
  };
}

async function handleActivateTab(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const tabId = readRequiredIntegerFlag(parsed, "tab-id");
  const browserId = await resolveRequiredBrowser(context, parsed);
  const result = TabResultSchema.parse(await context.broker.request("tab.activate", { browserId, tabId }, context.timeoutMs));
  return {
    ok: true,
    tab: result.tab
  };
}

async function handleCloseTab(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const tabId = readRequiredIntegerFlag(parsed, "tab-id");
  const browserId = await resolveRequiredBrowser(context, parsed);
  const result = await context.broker.request("tab.close", { browserId, tabId }, context.timeoutMs);
  return {
    ok: true,
    closed: result.closed === true,
    tabId: typeof result.tabId === "number" ? result.tabId : tabId
  };
}

async function handleScreenshot(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const browserId = await resolveRequiredBrowser(context, parsed);
  const payload: Record<string, unknown> = { browserId };
  const tabId = readOptionalIntegerFlag(parsed, "tab-id");
  if (tabId !== undefined) payload.tabId = tabId;
  if (hasFlag(parsed, "debugger")) payload.useDebugger = true;
  const result = ScreenshotCommandResultSchema.parse(await context.broker.request("screenshot.capture", payload, context.timeoutMs));
  return {
    ok: true,
    screenshot: result.screenshot
  };
}

async function handleSnapshot(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const browserId = await resolveRequiredBrowser(context, parsed);
  const payload: Record<string, unknown> = { browserId };
  const tabId = readOptionalIntegerFlag(parsed, "tab-id");
  if (tabId !== undefined) payload.tabId = tabId;
  const filter = readSnapshotFilter(parsed);
  if (filter !== undefined) payload.filter = filter;
  const includeScreenshot = hasFlag(parsed, "screenshot");
  const useDebugger = hasFlag(parsed, "debugger");
  if (useDebugger && !includeScreenshot) throw usageError("snapshot --debugger requires --screenshot.");
  if (includeScreenshot) payload.includeScreenshot = true;
  if (useDebugger) payload.useDebugger = true;
  const result = SnapshotCommandResultSchema.parse(await context.broker.request("snapshot.capture", payload, context.timeoutMs));
  return {
    ok: true,
    snapshot: result.snapshot
  };
}


async function handleNavigationPolicy(
  context: CliContext,
  parsed: ParsedArgs,
  area: NavigationPolicyArea,
  action: NavigationPolicyAction
): Promise<Record<string, unknown>> {
  const rule = action === "list" ? undefined : readNavigationRuleFlags(parsed);
  const browserId = await resolveRequiredBrowser(context, parsed);
  if (action === "list") {
    const result = PolicyResultSchema.parse(await context.broker.request("policy.get", { browserId }, context.timeoutMs));
    return {
      ok: true,
      policy: result.policy,
      entries: area === "allow" ? result.policy.allowedNavigationRules : result.policy.blockedNavigationRules
    };
  }

  const payload: Record<string, unknown> = {
    browserId,
    ...rule
  };
  const reason = readOptionalStringFlag(parsed, "reason");
  if (reason && action === "add") payload.reason = reason;
  const result = PolicyResultSchema.parse(await context.broker.request(`policy.${area}.${action}`, payload, context.timeoutMs));
  return {
    ok: true,
    policy: result.policy,
    entries: area === "allow" ? result.policy.allowedNavigationRules : result.policy.blockedNavigationRules
  };
}

async function handleRetentionPolicy(
  context: CliContext,
  parsed: ParsedArgs,
  action: RetentionPolicyAction
): Promise<Record<string, unknown>> {
  const browserId = await resolveRequiredBrowser(context, parsed);
  if (action === "get") {
    const result = PolicyResultSchema.parse(await context.broker.request("policy.get", { browserId }, context.timeoutMs));
    return {
      ok: true,
      policy: result.policy,
      retention: result.policy.sessionStepRetentionLimit
    };
  }

  const limit = Number(parsed.positionals[2]);
  const result = PolicyResultSchema.parse(await context.broker.request("policy.retention.set", { browserId, limit }, context.timeoutMs));
  return {
    ok: true,
    policy: result.policy,
    retention: result.policy.sessionStepRetentionLimit
  };
}

async function handleWatch(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  if (!context.broker.subscribeEvents) {
    throw createPortusError({
      code: "CAPABILITY_UNAVAILABLE",
      message: "Broker client does not support live event subscriptions."
    });
  }
  const payload = await buildEventQueryPayload(context, parsed, false);
  const output = context.output === "quiet"
    ? "quiet"
    : hasFlag(parsed, "json") || context.output === "json" || context.output === "ndjson"
      ? "ndjson"
      : "table";
  await context.broker.subscribeEvents(payload, (event) => {
    const chunk = renderEventStreamChunk(event, output);
    if (chunk.length > 0) context.writeStdout(chunk);
  }, context.timeoutMs);
  return { ok: true };
}

async function handleWait(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const tabId = readRequiredIntegerFlag(parsed, "tab-id");
  const state = readOptionalStringFlag(parsed, "state");
  const elementState = readOptionalStringFlag(parsed, "element-state");
  const urlContains = readOptionalStringFlag(parsed, "url-contains");
  const text = readOptionalStringFlag(parsed, "text");
  const elementQuery = readOptionalStringFlag(parsed, "element-query");
  const role = readOptionalStringFlag(parsed, "role");
  const value = readOptionalStringFlag(parsed, "value");
  const hasElementCriteria = elementQuery !== undefined || role !== undefined;
  const hasElementPredicate = elementState !== undefined || value !== undefined;
  const isPageWait = text !== undefined || hasElementCriteria || hasElementPredicate;
  const isTabWait = state !== undefined || urlContains !== undefined;
  if (!isPageWait && !isTabWait) {
    throw usageError("wait requires --state, --url-contains, --text, --element-query, or --role.");
  }
  if (isPageWait && isTabWait) throw usageError("Use either tab wait flags or page wait flags, not both.");
  if (hasElementPredicate && !hasElementCriteria) {
    throw usageError("--element-state and --value require --element-query or --role.");
  }
  if (elementState !== undefined && value !== undefined) {
    throw usageError("Use either --element-state or --value, not both.");
  }
  if (text !== undefined && hasElementCriteria && hasElementPredicate) {
    throw usageError("--text cannot be combined with an element state or value wait.");
  }

  const browserId = await resolveRequiredBrowser(context, parsed);
  const payload: Record<string, unknown> = { browserId, tabId };
  if (state !== undefined) payload.state = state;
  if (urlContains !== undefined) payload.urlContains = urlContains;
  if (text !== undefined) payload.text = text;
  if (elementQuery !== undefined) payload.elementQuery = elementQuery;
  if (role !== undefined) payload.role = role;
  if (elementState !== undefined) payload.elementState = elementState;
  if (value !== undefined) payload.value = value;

  const requestType = isPageWait ? "page.wait" : "tab.wait";
  const result = WaitCommandResultSchema.parse(await context.broker.request(requestType, payload, context.timeoutMs));
  return {
    ok: true,
    wait: result.wait
  };
}

async function handleEvents(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const payload = await buildEventQueryPayload(context, parsed, true);
  const result = EventListResultSchema.parse(await context.broker.request("events.recent", payload, context.timeoutMs));
  return {
    ok: true,
    events: result.events
  };
}

async function handleSession(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const browserId = await resolveRequiredBrowser(context, parsed);
  const limit = readOptionalIntegerFlag(parsed, "limit");
  const payload: Record<string, unknown> = { browserId };
  if (limit !== undefined) payload.limit = limit;
  const result = SessionStepsResultSchema.parse(await context.broker.request("session.steps", payload, context.timeoutMs));
  return {
    ok: true,
    steps: result.steps
  };
}

async function handleBridge(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const browserId = await resolveRequiredBrowser(context, parsed);
  const result = BridgeDisconnectResultSchema.parse(await context.broker.request("bridge.disconnect", {
    browserId,
    reason: readOptionalStringFlag(parsed, "reason") ?? "cli-requested"
  }, context.timeoutMs));
  return {
    ok: true,
    disconnected: result.disconnected
  };
}

async function handleBroker(context: CliContext, _parsed: ParsedArgs, action: BrokerCliAction): Promise<Record<string, unknown>> {
  const result = action === "status"
    ? BrokerStatusResultSchema.parse(await context.broker.request("broker.status", {}, context.timeoutMs))
    : BrokerStopResultSchema.parse(await context.broker.request("broker.stop", {}, context.timeoutMs));
  return {
    ok: true,
    broker: result
  };
}

async function handleAction(
  context: CliContext,
  parsed: ParsedArgs,
  action: "click" | "hover" | "drag" | "type" | "press" | "scroll"
): Promise<Record<string, unknown>> {
  const tabId = readRequiredIntegerFlag(parsed, "tab-id");
  const elementId = readOptionalStringFlag(parsed, "element");
  const snapshotId = readOptionalStringFlag(parsed, "snapshot");
  const actionPayload: Record<string, unknown> = {};
  if (elementId !== undefined) actionPayload.elementId = elementId;
  if (snapshotId !== undefined) actionPayload.snapshotId = snapshotId;

  if (action === "click" || action === "hover") {
    if (elementId === undefined) throw usageError("--element is required.");
    if (snapshotId === undefined) throw usageError("--snapshot is required.");
  } else if (action === "drag") {
    const sourceElementId = readOptionalStringFlag(parsed, "from");
    const targetElementId = readOptionalStringFlag(parsed, "to");
    if (sourceElementId === undefined) throw usageError("--from is required.");
    if (targetElementId === undefined) throw usageError("--to is required.");
    if (snapshotId === undefined) throw usageError("--snapshot is required.");
    actionPayload.sourceElementId = sourceElementId;
    actionPayload.targetElementId = targetElementId;
  } else if (action === "type") {
    if (elementId === undefined) throw usageError("--element is required.");
    if (snapshotId === undefined) throw usageError("--snapshot is required.");
    actionPayload.text = parsed.positionals[0] as string;
  } else if (action === "press") {
    actionPayload.key = parsed.positionals[0] as string;
  } else {
    actionPayload.deltaX = readOptionalNumberFlag(parsed, "x") ?? 0;
    actionPayload.deltaY = readOptionalNumberFlag(parsed, "y") ?? 600;
  }

  const browserId = await resolveRequiredBrowser(context, parsed);
  const payload: Record<string, unknown> = {
    browserId,
    tabId,
    ...actionPayload
  };
  const result = ActionCommandResultSchema.parse(await context.broker.request(`action.${action}`, payload, context.timeoutMs));
  return {
    ok: true,
    action: result.action
  };
}

async function handleFillForm(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const tabId = readRequiredIntegerFlag(parsed, "tab-id");
  const snapshotId = readOptionalStringFlag(parsed, "snapshot");
  if (!snapshotId) throw usageError("--snapshot is required.");
  const fields = await readFillFormFieldsFromCli(parsed);
  const browserId = await resolveRequiredBrowser(context, parsed);
  const result = FillFormCommandResultSchema.parse(await context.broker.request("action.fillForm", {
    browserId,
    tabId,
    snapshotId,
    fields,
    partial: hasFlag(parsed, "partial") ? true : undefined
  }, context.timeoutMs));
  return {
    ok: true,
    fillForm: result.fillForm
  };
}

async function handleUpload(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const tabId = readRequiredIntegerFlag(parsed, "tab-id");
  const snapshotId = readOptionalStringFlag(parsed, "snapshot");
  const elementId = readOptionalStringFlag(parsed, "element");
  if (!snapshotId) throw usageError("--snapshot is required.");
  if (!elementId) throw usageError("--element is required.");
  const browserId = await resolveRequiredBrowser(context, parsed);
  const result = ActionCommandResultSchema.parse(await context.broker.request("action.upload", {
    browserId,
    tabId,
    snapshotId,
    elementId,
    files: parsed.positionals
  }, context.timeoutMs));
  return {
    ok: true,
    action: result.action
  };
}

async function handleDismiss(context: CliContext, parsed: ParsedArgs): Promise<Record<string, unknown>> {
  const tabId = readRequiredIntegerFlag(parsed, "tab-id");
  const browserId = await resolveRequiredBrowser(context, parsed);
  const payload: Record<string, unknown> = {
    browserId,
    tabId,
    kind: readOptionalStringFlag(parsed, "kind") ?? "any",
    strategy: readOptionalStringFlag(parsed, "strategy") ?? "conservative",
    dryRun: hasFlag(parsed, "dry-run")
  };
  const result = DismissCommandResultSchema.parse(await context.broker.request("page.dismiss", payload, context.timeoutMs));
  return {
    ok: true,
    dismiss: result.dismiss
  };
}

async function handleDialog(context: CliContext, parsed: ParsedArgs, action: DialogCliAction): Promise<Record<string, unknown>> {
  const tabId = readRequiredIntegerFlag(parsed, "tab-id");
  const browserId = await resolveRequiredBrowser(context, parsed);
  const payload: Record<string, unknown> = { browserId, tabId };
  const text = readOptionalStringFlag(parsed, "text");
  if (text !== undefined) payload.text = text;
  const result = DialogCommandResultSchema.parse(await context.broker.request(`dialog.${action}`, payload, context.timeoutMs));
  return {
    ok: true,
    dialog: result.dialog
  };
}

async function handleConsole(context: CliContext, parsed: ParsedArgs, action: ConsoleCliAction): Promise<Record<string, unknown>> {
  const tabId = readRequiredIntegerFlag(parsed, "tab-id");
  const browserId = await resolveRequiredBrowser(context, parsed);
  if (action === "clear") {
    const result = await context.broker.request("console.clear", { browserId, tabId }, context.timeoutMs);
    return { ok: true, cleared: result.cleared === true, tabId };
  }
  const limit = readOptionalIntegerFlag(parsed, "limit");
  const payload: Record<string, unknown> = { browserId, tabId };
  if (limit !== undefined) payload.limit = limit;
  const result = ConsoleCommandResultSchema.parse(await context.broker.request("console.list", payload, context.timeoutMs));
  return {
    ok: true,
    console: result.console
  };
}

async function handleNetwork(context: CliContext, parsed: ParsedArgs, action: NetworkCliAction): Promise<Record<string, unknown>> {
  const tabId = readRequiredIntegerFlag(parsed, "tab-id");
  const browserId = await resolveRequiredBrowser(context, parsed);
  if (action === "get") {
    const requestId = parsed.positionals[1] as string;
    const result = NetworkGetCommandResultSchema.parse(await context.broker.request("network.get", { browserId, tabId, requestId }, context.timeoutMs));
    return {
      ok: true,
      network: result.network
    };
  }
  const limit = readOptionalIntegerFlag(parsed, "limit");
  const payload: Record<string, unknown> = { browserId, tabId };
  if (limit !== undefined) payload.limit = limit;
  const result = NetworkListCommandResultSchema.parse(await context.broker.request("network.list", payload, context.timeoutMs));
  return {
    ok: true,
    network: result.network
  };
}

async function handleDownloads(context: CliContext, parsed: ParsedArgs, action: DownloadsCliAction): Promise<Record<string, unknown>> {
  const browserId = await resolveRequiredBrowser(context, parsed);
  if (action === "get") {
    const downloadId = Number(parsed.positionals[1]);
    if (!Number.isInteger(downloadId) || downloadId < 0) {
      throw createPortusError({
        code: "INVALID_MESSAGE",
        message: "downloads get requires a non-negative integer <download-id>."
      });
    }
    const result = DownloadGetResultSchema.parse(await context.broker.request("download.get", { browserId, downloadId }, context.timeoutMs));
    return {
      ok: true,
      download: result.download
    };
  }

  const payload: Record<string, unknown> = { browserId };
  if (action === "wait") {
    const positional = parsed.positionals[1] !== undefined ? Number(parsed.positionals[1]) : undefined;
    if (positional !== undefined && (!Number.isInteger(positional) || positional < 0)) {
      throw createPortusError({
        code: "INVALID_MESSAGE",
        message: "downloads wait requires a non-negative integer <download-id> or --url-contains/--filename-contains."
      });
    }
    const urlContains = readOptionalStringFlag(parsed, "url-contains");
    const filenameContains = readOptionalStringFlag(parsed, "filename-contains");
    if (positional === undefined && urlContains === undefined && filenameContains === undefined) {
      throw createPortusError({
        code: "INVALID_MESSAGE",
        message: "downloads wait requires <download-id> or --url-contains or --filename-contains."
      });
    }
    if (positional !== undefined) payload.downloadId = positional;
    if (urlContains !== undefined) payload.urlContains = urlContains;
    if (filenameContains !== undefined) payload.filenameContains = filenameContains;
    const waitResult = DownloadWaitResultSchema.parse(await context.broker.request("download.wait", payload, context.timeoutMs));
    return {
      ok: true,
      downloadWait: waitResult
    };
  }

  const limit = readOptionalIntegerFlag(parsed, "limit");
  if (limit !== undefined) payload.limit = limit;
  const listResult = DownloadListResultSchema.parse(await context.broker.request("download.list", payload, context.timeoutMs));
  return {
    ok: true,
    downloads: listResult.downloads,
    ...(listResult.captureStartedAt === undefined ? {} : { captureStartedAt: listResult.captureStartedAt })
  };
}

async function handleRecipes(context: CliContext, parsed: ParsedArgs, action: RecipeCliAction): Promise<Record<string, unknown>> {
  const directory = readOptionalStringFlag(parsed, "directory");

  switch (action) {
    case "list": {
      const library = RecipeListResultSchema.parse(await context.broker.request("recipe.list", recipeRequestPayload(directory), context.timeoutMs));
      return {
        ok: true,
        ...(library.directory === undefined ? {} : { directory: library.directory }),
        recipes: library.recipes,
        diagnostics: library.diagnostics
      };
    }
    case "create": {
      const id = parsed.positionals[1] as string;
      const positionalName = parsed.positionals[2];
      const name = positionalName ?? id;
      const recipe = await readRecipeInput(parsed, id, name, undefined, positionalName);
      const filePath = await saveRecipeRecordToDirectory(recipe, directory ?? defaultRecipeLibraryDirectory(), {
        overwrite: hasFlag(parsed, "force")
      });
      return { ok: true, recipe: parseRecipeRecord(recipe), filePath };
    }
    case "show": {
      const id = parsed.positionals[1] as string;
      const entry = RecipeRecordResultSchema.parse(await context.broker.request("recipe.get", {
        recipeId: id,
        ...recipeRequestPayload(directory)
      }, context.timeoutMs));
      return {
        ok: true,
        recipe: entry.recipe,
        richSchemaOk: entry.richSchemaOk,
        issues: entry.issues
      };
    }
    case "search": {
      const query = parsed.positionals.slice(1).join(" ");
      const result = RecipeListResultSchema.parse(await context.broker.request("recipe.search", {
        query,
        ...recipeRequestPayload(directory)
      }, context.timeoutMs));
      return {
        ok: true,
        ...(result.directory === undefined ? {} : { directory: result.directory }),
        recipes: result.recipes,
        diagnostics: result.diagnostics
      };
    }
    case "use":
    case "resolve": {
      const query = parsed.positionals.slice(1).join(" ");
      const resolved = RecipeRecordResultSchema.parse(await context.broker.request("recipe.resolve", {
        query,
        ...recipeRequestPayload(directory)
      }, context.timeoutMs));
      return {
        ok: true,
        recipe: resolved.recipe,
        richSchemaOk: resolved.richSchemaOk,
        issues: resolved.issues,
        diagnostics: resolved.diagnostics,
        readOnly: true
      };
    }
    case "update": {
      const id = parsed.positionals[1] as string;
      const current = await getRecipeFromLibrary(id, recipeLibraryOptions(directory));
      const recipe = await readRecipeInput(parsed, current.recipe.id, current.recipe.name, current.recipe);
      const filePath = await updateRecipeInLibrary(id, recipe, recipeLibraryOptions(directory));
      return { ok: true, recipe: parseRecipeRecord(recipe), filePath };
    }
    case "rename": {
      const id = parsed.positionals[1] as string;
      const newName = parsed.positionals[2] as string;
      const entry = await getRecipeFromLibrary(id, recipeLibraryOptions(directory));
      const recipe = parseRecipeRecord({ ...entry.recipe, name: newName });
      const filePath = await updateRecipeInLibrary(id, recipe, recipeLibraryOptions(directory));
      return { ok: true, recipe, filePath };
    }
    case "delete": {
      const id = parsed.positionals[1] as string;
      if (!hasFlag(parsed, "yes")) throw usageError("recipes delete requires --yes.");
      const filePath = await deleteRecipeFromLibrary(id, recipeLibraryOptions(directory));
      return { ok: true, deleted: true, recipeId: id, filePath };
    }
    case "validate": {
      const target = parsed.positionals[1] as string;
      return validateRecipeTarget(target, directory);
    }
    case "import": {
      const filePath = parsed.positionals[1] as string;
      const importId = readOptionalStringFlag(parsed, "id");
      const importName = readOptionalStringFlag(parsed, "name");
      const importedPath = await importRecipeToLibrary(filePath, {
        ...recipeLibraryOptions(directory),
        ...(importId === undefined ? {} : { id: importId }),
        ...(importName === undefined ? {} : { name: importName }),
        ...(hasFlag(parsed, "force") ? { overwrite: true } : {})
      });
      const entry = await loadRecipeRecordFromFile(importedPath);
      return { ok: true, recipe: entry.recipe, filePath: importedPath };
    }
    case "export": {
      const id = parsed.positionals[1] as string;
      const outputPath = readOptionalStringFlag(parsed, "output");
      if (outputPath === undefined) throw usageError("recipes export requires --output.");
      const entry = await getRecipeFromLibrary(id, recipeLibraryOptions(directory));
      await mkdir(dirname(outputPath), { recursive: true });
      await copyFile(entry.filePath, outputPath, hasFlag(parsed, "force") ? 0 : 1);
      return { ok: true, recipeId: id, filePath: outputPath };
    }
    case "duplicate": {
      const id = parsed.positionals[1] as string;
      const newId = parsed.positionals[2] as string;
      const entry = await getRecipeFromLibrary(id, recipeLibraryOptions(directory));
      const recipe = parseRecipeRecord({
        ...entry.recipe,
        id: newId,
        name: readOptionalStringFlag(parsed, "name") ?? entry.recipe.name
      });
      const filePath = await saveRecipeRecordToDirectory(recipe, directory ?? defaultRecipeLibraryDirectory(), {
        overwrite: hasFlag(parsed, "force")
      });
      return { ok: true, recipe, filePath };
    }
  }
}

async function readRecipeInput(
  parsed: ParsedArgs,
  fallbackId: string,
  fallbackName: string,
  existing?: RecipeRecord,
  positionalName?: string
): Promise<RecipeRecord> {
  const filePath = readOptionalStringFlag(parsed, "file");
  const jsonInput = readOptionalStringFlag(parsed, "json-input");
  const content = readOptionalStringFlag(parsed, "content");
  const sources = [filePath, jsonInput, content].filter((value) => value !== undefined).length;
  if (sources > 1) throw usageError("Use only one of --file, --json-input, or --content.");

  const nameOverride = readOptionalStringFlag(parsed, "name") ?? positionalName;
  const kindOverride = readOptionalStringFlag(parsed, "kind");
  const descriptionOverride = readOptionalStringFlag(parsed, "description");
  const structuredSource = filePath !== undefined
    ? parseRecipeRecord(parseRecipeJsonText(await readFile(filePath, "utf8"), filePath))
    : jsonInput !== undefined
      ? parseRecipeRecord(parseRecipeJsonText(jsonInput, "--json-input"))
      : undefined;

  if (structuredSource !== undefined) {
    if (structuredSource.id !== fallbackId) {
      throw createPortusError({
        code: "RECIPE_INVALID",
        message: "Structured recipe id must match the command recipe id.",
        details: {
          recipeId: fallbackId,
          inputRecipeId: structuredSource.id
        }
      });
    }
    return parseRecipeRecord({
      ...structuredSource,
      ...(nameOverride === undefined ? {} : { name: nameOverride }),
      ...(kindOverride === undefined ? {} : { kind: kindOverride }),
      ...(descriptionOverride === undefined ? {} : { description: descriptionOverride })
    });
  }

  const base = existing ?? {
    id: fallbackId,
    name: fallbackName,
    content: ""
  };
  const record = {
    ...base,
    id: fallbackId,
    name: nameOverride ?? fallbackName,
    ...(kindOverride === undefined ? {} : { kind: kindOverride }),
    ...(descriptionOverride === undefined ? {} : { description: descriptionOverride }),
    ...(content === undefined ? {} : { content })
  };

  if (!("content" in record) || record.content === "") {
    throw usageError("recipes create/update requires --content, --file, or --json-input.");
  }

  return parseRecipeRecord(record);
}

function parseRecipeJsonText(text: string, source: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw createPortusError({
      code: "RECIPE_INVALID",
      message: "Recipe JSON input is invalid.",
      details: {
        source,
        reason: error instanceof Error ? error.message : "JSON parse failed."
      }
    });
  }
}

async function validateRecipeTarget(target: string, directory: string | undefined): Promise<Record<string, unknown>> {
  const entry = target.endsWith(".json")
    ? await loadRecipeRecordFromFile(target)
    : await getRecipeFromLibrary(target, recipeLibraryOptions(directory));
  const validation = validateRecipeForManagement(entry.recipe);
  return {
    ok: validation.ok,
    richSchemaOk: validation.ok ? validation.richSchemaOk : false,
    recipe: entry.recipe,
    issues: validation.issues
  };
}

async function resolveRecipeForAgent(query: string, directory: string | undefined): Promise<{
  recipe: RecipeRecord;
  richSchemaOk: boolean;
  issues: RecipeManagementIssue[];
  diagnostics: RecipeLibraryDiagnostic[];
}> {
  const library = await listRecipeLibrary(recipeLibraryOptions(directory));
  const normalizedQuery = query.toLocaleLowerCase();
  const exact = library.recipes.find((entry) => entry.recipe.id.toLocaleLowerCase() === normalizedQuery);
  const matches = exact === undefined
    ? library.recipes.filter((entry) => recipeRecordMatchesQuery(entry.recipe, normalizedQuery))
    : [exact];

  if (matches.length !== 1) {
    throw createPortusError({
      code: "RECIPE_INVALID",
      message: matches.length === 0 ? "No recipe matched the requested query." : "Recipe query is ambiguous.",
      details: {
        query,
        matches: matches.map((entry) => summarizeRecipeEntry(entry.recipe, entry.richSchemaOk, entry.issues))
      }
    });
  }

  const entry = matches[0] as {
    recipe: RecipeRecord;
    richSchemaOk: boolean;
    issues: RecipeManagementIssue[];
  };
  return {
    recipe: entry.recipe,
    richSchemaOk: entry.richSchemaOk,
    issues: entry.issues,
    diagnostics: library.diagnostics
  };
}

function recipeLibraryOptions(directory: string | undefined): { directory?: string } {
  return directory === undefined ? {} : { directory };
}

function recipeRequestPayload(directory: string | undefined): Record<string, unknown> {
  return directory === undefined ? {} : { directory };
}

function summarizeRecipeEntry(
  recipe: RecipeRecord,
  richSchemaOk: boolean,
  issues: RecipeManagementIssue[]
): Record<string, unknown> {
  return {
    id: recipe.id,
    name: recipe.name,
    ...("kind" in recipe && recipe.kind !== undefined ? { kind: recipe.kind } : {}),
    ...("description" in recipe && recipe.description !== undefined ? { description: recipe.description } : {}),
    richSchemaOk,
    issues
  };
}

function recipeRecordMatchesQuery(recipe: RecipeRecord, query: string): boolean {
  const examples = "examples" in recipe && Array.isArray(recipe.examples) ? recipe.examples : [];
  const content = "content" in recipe
    ? typeof recipe.content === "string"
      ? recipe.content
      : JSON.stringify(recipe.content)
    : undefined;
  const searchable = [
    recipe.id,
    recipe.name,
    "kind" in recipe ? recipe.kind : undefined,
    "description" in recipe ? recipe.description : undefined,
    "intent" in recipe ? recipe.intent : undefined,
    "notes" in recipe ? recipe.notes : undefined,
    ...examples,
    content
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLocaleLowerCase();

  return searchable.includes(query);
}

async function listBrowsers(context: CliContext): Promise<BrowserSession[]> {
  const result = BrowserListResultSchema.parse(await context.broker.request("browser.list", {
    includeUnavailable: false
  }, context.timeoutMs));
  return sortBrowsers(result.browsers);
}

async function buildEventQueryPayload(context: CliContext, parsed: ParsedArgs, includeLimit: boolean): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {};
  const browser = readOptionalStringFlag(parsed, "browser");
  if (browser) payload.browserId = await resolveBrowserTarget(context, browser);
  const types = [...new Set(readStringFlags(parsed, "type"))];
  if (types.length > 0) payload.types = types;
  if (includeLimit) {
    const limit = readOptionalIntegerFlag(parsed, "limit");
    if (limit !== undefined) payload.limit = limit;
  }
  return payload;
}

async function resolveRequiredBrowser(context: CliContext, parsed: ParsedArgs): Promise<string> {
  const browser = readOptionalStringFlag(parsed, "browser");
  if (!browser) throw usageError("--browser is required.");
  return resolveBrowserTarget(context, browser);
}

async function resolveBrowserTarget(context: CliContext, target: string): Promise<string> {
  if (BrowserTargetSchema.safeParse(target).success) return target;
  const index = parseDisplayIndex(target);
  if (index === null) throw usageError("--browser must be a browser id or display index.");
  const browsers = await listBrowsers(context);
  const selected = browsers[index - 1];
  if (!selected) {
    throw createPortusError({
      code: "TARGET_NOT_FOUND",
      message: `Browser display index ${index} is unavailable.`,
      details: { index }
    });
  }
  return selected.browserId;
}

function readRequiredTabTarget(parsed: ParsedArgs): CliTabTarget {
  const tabId = readOptionalIntegerFlag(parsed, "tab-id");
  const index = readOptionalIntegerFlag(parsed, "index");
  if (tabId !== undefined && index !== undefined) throw usageError("Use either --tab-id or --index, not both.");
  if (tabId === undefined && index === undefined) throw usageError("--tab-id or --index is required.");
  return tabId !== undefined
    ? { kind: "tab-id", value: tabId }
    : { kind: "index", value: index as number };
}

async function resolveRequiredTabId(context: CliContext, target: CliTabTarget, browserId: string): Promise<number> {
  if (target.kind === "tab-id") return target.value;
  const index = target.value;
  const result = TabListResultSchema.parse(await context.broker.request("tab.list", { browserId }, context.timeoutMs));
  const selected = sortTabs(result.tabs)[index - 1];
  if (!selected) {
    throw createPortusError({
      code: "TAB_NOT_FOUND",
      message: `Tab display index ${index} is unavailable.`,
      details: { index }
    });
  }
  return selected.tabId;
}

function success(output: OutputMode, result: Record<string, unknown>): CliCommandResult {
  return {
    exitCode: 0,
    stdout: renderSuccess(output, result),
    stderr: ""
  };
}

function renderSuccess(output: OutputMode, result: Record<string, unknown>): string {
  if (output === "quiet") return "";
  if (output === "json") return `${JSON.stringify(result, null, 2)}\n`;
  if (output === "ndjson") return `${JSON.stringify(result)}\n`;
  if (Array.isArray(result.browsers)) return renderBrowserTable(result.browsers as BrowserSession[]);
  if (Array.isArray(result.tabs)) return renderTabTable(result.tabs as Tab[]);
  if (isRecord(result.tab)) return renderTabTable([result.tab as Tab]);
  if (isRecord(result.screenshot)) return renderScreenshotTable(result.screenshot as ScreenshotResult);
  if (isRecord(result.snapshot)) return renderSnapshotTable(result.snapshot as Snapshot);
  if (isRecord(result.wait)) return renderWaitTable(result.wait as WaitResult);
  if (isRecord(result.action)) return renderActionTable(result.action as ActionResult);
  if (isRecord(result.fillForm)) return renderFillFormTable(result.fillForm as FillFormResult);
  if (isRecord(result.dismiss)) return renderDismissTable(result.dismiss as DismissResult);
  if (isRecord(result.dialog)) return renderDialogTable(result.dialog as DialogResult);
  if (isRecord(result.console)) return renderConsoleTable(result.console as ConsoleListResult);
  if (isRecord(result.network)) return renderNetworkTable(result.network as NetworkListResult | NetworkGetResult);
  if (Array.isArray(result.downloads)) return renderDownloadTable(result.downloads as unknown as DownloadRecord[]);
  if (isRecord(result.download)) return renderDownloadTable([result.download as unknown as DownloadRecord]);
  if (isRecord(result.downloadWait)) return renderDownloadWaitTable(result.downloadWait as unknown as DownloadWaitResult);
  if (Array.isArray(result.recipes)) return renderRecipeTable(result.recipes as Array<Record<string, unknown>>);
  if (isRecord(result.recipe)) return `${JSON.stringify(result.recipe, null, 2)}\n`;
  if (Array.isArray(result.entries)) return renderPolicyEntryTable(result.entries as PolicyPreferences["allowedNavigationRules"]);
  if (typeof result.retention === "number") return renderTable(["RETENTION"], [{ RETENTION: String(result.retention) }]);
  if (isRecord(result.policy)) return renderPolicyTable(result.policy as PolicyPreferences);
  if (Array.isArray(result.events)) return renderEventTable(result.events as EventEnvelope[]);
  if (isRecord(result.event)) return renderEventTable([result.event as EventEnvelope]);
  if (Array.isArray(result.steps)) return renderSessionStepTable(result.steps as SessionStep[]);
  if (typeof result.disconnected === "boolean") return renderTable(["DISCONNECTED"], [{ DISCONNECTED: String(result.disconnected) }]);
  if (isRecord(result.broker)) return renderBrokerTable(result.broker);
  return `${JSON.stringify(result, null, 2)}\n`;
}

function renderFailure(error: unknown, output: OutputMode): CliCommandResult {
  const portusError = normalizeCliError(error);
  const exitCode = exitCodeForError(portusError);
  if (output === "json" || output === "ndjson") {
    return {
      exitCode,
      stdout: "",
      stderr: `${JSON.stringify({ ok: false, error: portusError }, null, output === "json" ? 2 : 0)}\n`
    };
  }
  return {
    exitCode,
    stdout: "",
    stderr: renderTextError(portusError)
  };
}

function renderTextError(error: PortusError): string {
  const suggestion = error.suggestedCommand ? `\nSuggested command: ${error.suggestedCommand}` : "";
  const usageText = error.details && isRecord(error.details) && typeof error.details.usageText === "string"
    ? `\n${error.details.usageText}`
    : "";
  return `${error.code}: ${error.message}${suggestion}${usageText}\n`;
}

function renderBrowserTable(browsers: BrowserSession[]): string {
  const rows = browsers.map((browser, index) => ({
    INDEX: String(index + 1),
    BROWSER_ID: browser.browserId,
    BROWSER: browser.browserName,
    BRIDGE: browser.bridgeStatus,
    CONNECTED_AT: browser.connectedAt,
    LAST_HEARTBEAT: browser.lastHeartbeat
  }));
  return renderTable(["INDEX", "BROWSER_ID", "BROWSER", "BRIDGE", "CONNECTED_AT", "LAST_HEARTBEAT"], rows);
}

function renderTabTable(tabs: Tab[]): string {
  const rows = sortTabs(tabs).map((tab, index) => ({
    INDEX: String(index + 1),
    TAB_ID: String(tab.tabId),
    WINDOW_ID: String(tab.windowId),
    ACTIVE: String(tab.active),
    PINNED: String(tab.pinned),
    DISCARDED: String(tab.discarded),
    TITLE: tab.title,
    URL: tab.url
  }));
  return renderTable(["INDEX", "TAB_ID", "WINDOW_ID", "ACTIVE", "PINNED", "DISCARDED", "TITLE", "URL"], rows);
}

function renderScreenshotTable(screenshot: ScreenshotResult): string {
  return renderTable(["BROWSER_ID", "TAB_ID", "MIME_TYPE", "CAPTURED_AT", "ACTIVATED_TAB_BEFORE_CAPTURE", "RESTORED_PREVIOUS_ACTIVE_TAB"], [{
    BROWSER_ID: screenshot.browserId,
    TAB_ID: String(screenshot.tabId),
    MIME_TYPE: screenshot.mimeType,
    CAPTURED_AT: screenshot.capturedAt,
    ACTIVATED_TAB_BEFORE_CAPTURE: String(screenshot.activatedTabBeforeCapture),
    RESTORED_PREVIOUS_ACTIVE_TAB: screenshot.restoredPreviousActiveTab === undefined ? "" : String(screenshot.restoredPreviousActiveTab)
  }]);
}

function renderSnapshotTable(snapshot: Snapshot): string {
  return renderTable(["SNAPSHOT_ID", "BROWSER_ID", "TAB_ID", "FILTERED", "TITLE", "URL", "ELEMENTS"], [{
    SNAPSHOT_ID: snapshot.snapshotId,
    BROWSER_ID: snapshot.browserId,
    TAB_ID: String(snapshot.tabId),
    FILTERED: String(snapshot.filtered === true),
    TITLE: snapshot.title,
    URL: snapshot.url,
    ELEMENTS: String(snapshot.elements.length)
  }]);
}

function renderWaitTable(wait: WaitResult): string {
  return renderTable(["BROWSER_ID", "TAB_ID", "SOURCE", "MATCHED", "COMPLETED_AT", "URL", "TITLE"], [{
    BROWSER_ID: wait.browserId,
    TAB_ID: String(wait.tabId),
    SOURCE: wait.source,
    MATCHED: String(wait.matched),
    COMPLETED_AT: wait.completedAt,
    URL: wait.url ?? "",
    TITLE: wait.title ?? ""
  }]);
}

function renderActionTable(action: ActionResult): string {
  return renderTable(["BACKEND", "COMPLETED_AT", "SNAPSHOT_INVALIDATED"], [{
    BACKEND: action.backend,
    COMPLETED_AT: action.completedAt,
    SNAPSHOT_INVALIDATED: String(action.snapshotInvalidated ?? false)
  }]);
}

function renderFillFormTable(fillForm: FillFormResult): string {
  const rows = fillForm.fields.map((field) => ({
    ELEMENT_ID: field.elementId,
    OK: String(field.ok),
    ERROR: field.error?.code ?? ""
  }));
  return renderTable(["ELEMENT_ID", "OK", "ERROR"], rows);
}

function renderDismissTable(dismiss: DismissResult): string {
  return renderTable(["DISMISSED", "DRY_RUN", "KIND", "STRATEGY", "ELEMENT_ID", "LABEL", "REASON"], [{
    DISMISSED: String(dismiss.dismissed),
    DRY_RUN: String(dismiss.dryRun),
    KIND: dismiss.kind,
    STRATEGY: dismiss.strategy,
    ELEMENT_ID: dismiss.elementId ?? "",
    LABEL: dismiss.label ?? "",
    REASON: dismiss.reason ?? ""
  }]);
}

function renderDialogTable(dialog: DialogResult): string {
  return renderTable(["ACTION", "HANDLED", "BACKEND", "COMPLETED_AT"], [{
    ACTION: dialog.action,
    HANDLED: String(dialog.handled),
    BACKEND: dialog.backend ?? "",
    COMPLETED_AT: dialog.completedAt
  }]);
}

function renderConsoleTable(result: ConsoleListResult): string {
  const rows = result.messages.map((message) => ({
    CREATED_AT: message.createdAt,
    LEVEL: message.level,
    SOURCE: message.source,
    TEXT: message.text
  }));
  return renderTable(["CREATED_AT", "LEVEL", "SOURCE", "TEXT"], rows);
}

function renderNetworkTable(result: NetworkListResult | NetworkGetResult): string {
  const requests = "request" in result ? [result.request] : result.requests;
  const rows = requests.map((request) => ({
    REQUEST_ID: request.requestId,
    TAB_ID: String(request.tabId),
    METHOD: request.method,
    STATUS: request.statusCode === undefined ? "" : String(request.statusCode),
    TYPE: request.resourceType ?? "",
    URL: request.url
  }));
  return renderTable(["REQUEST_ID", "TAB_ID", "METHOD", "STATUS", "TYPE", "URL"], rows);
}

function renderDownloadTable(downloads: DownloadRecord[]): string {
  const rows = downloads.map((download) => ({
    DOWNLOAD_ID: String(download.downloadId),
    STATE: download.state,
    RECEIVED: String(download.receivedBytes),
    TOTAL: download.totalBytes === undefined ? "" : String(download.totalBytes),
    URL: download.url,
    FILENAME: download.filename,
    LOCAL_PATH: download.finalPath ?? ""
  }));
  return renderTable(["DOWNLOAD_ID", "STATE", "RECEIVED", "TOTAL", "URL", "FILENAME", "LOCAL_PATH"], rows);
}

function renderDownloadWaitTable(result: DownloadWaitResult): string {
  const download = result.download;
  const condition = Object.entries(result.condition)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return renderTable(["MATCHED", "CONDITION", "DOWNLOAD_ID", "STATE", "LOCAL_PATH", "COMPLETED_AT"], [{
    MATCHED: String(result.matched),
    CONDITION: condition,
    DOWNLOAD_ID: String(download.downloadId),
    STATE: download.state,
    LOCAL_PATH: download.finalPath ?? "",
    COMPLETED_AT: result.completedAt
  }]);
}

function renderRecipeTable(recipes: Array<Record<string, unknown>>): string {
  const rows = [...recipes]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((recipe) => ({
      RECIPE_ID: String(recipe.id ?? ""),
      NAME: String(recipe.name ?? ""),
      KIND: String(recipe.kind ?? ""),
      RICH_SCHEMA: String(recipe.richSchemaOk ?? ""),
      ISSUES: String(Array.isArray(recipe.issues) ? recipe.issues.length : 0),
      DESCRIPTION: String(recipe.description ?? "")
    }));
  return renderTable(["RECIPE_ID", "NAME", "KIND", "RICH_SCHEMA", "ISSUES", "DESCRIPTION"], rows);
}


function renderPolicyTable(policy: PolicyPreferences): string {
  return renderTable(["ENABLED", "MODE", "ALLOWED", "BLOCKED", "RETENTION"], [{
    ENABLED: String(policy.navigationPolicyEnabled),
    MODE: policy.policyMode,
    ALLOWED: String(policy.allowedNavigationRules.length),
    BLOCKED: String(policy.blockedNavigationRules.length),
    RETENTION: String(policy.sessionStepRetentionLimit)
  }]);
}

function renderPolicyEntryTable(entries: PolicyPreferences["allowedNavigationRules"]): string {
  const rows = [...entries]
    .sort((a, b) => a.match.localeCompare(b.match) || a.value.localeCompare(b.value))
    .map((entry) => ({
      MATCH: entry.match,
      VALUE: entry.value,
      SOURCE: entry.source,
      UPDATED_AT: entry.updatedAt ?? "",
      REASON: entry.reason ?? ""
    }));
  return renderTable(["MATCH", "VALUE", "SOURCE", "UPDATED_AT", "REASON"], rows);
}

function renderEventTable(events: EventEnvelope[]): string {
  const rows = events.map((event) => ({
    EVENT_ID: event.eventId,
    TYPE: event.type,
    BROWSER_ID: event.browserId ?? "",
    TAB_ID: event.tabId === undefined ? "" : String(event.tabId),
    CREATED_AT: event.createdAt
  }));
  return renderTable(["EVENT_ID", "TYPE", "BROWSER_ID", "TAB_ID", "CREATED_AT"], rows);
}

function renderSessionStepTable(steps: SessionStep[]): string {
  const rows = steps.map((step) => ({
    STEP_ID: step.stepId,
    COMMAND: step.commandType,
    STATUS: step.status,
    TAB_ID: step.tabId === undefined ? "" : String(step.tabId),
    ORIGIN: step.origin ?? "",
    CREATED_AT: step.createdAt
  }));
  return renderTable(["STEP_ID", "COMMAND", "STATUS", "TAB_ID", "ORIGIN", "CREATED_AT"], rows);
}

function renderBrokerTable(broker: Record<string, unknown>): string {
  return renderTable(["RUNNING", "STOPPING", "TRANSPORT", "ENDPOINT_NAME", "ENDPOINT_PATH", "PID", "STARTED_AT"], [{
    RUNNING: typeof broker.running === "boolean" ? String(broker.running) : "",
    STOPPING: typeof broker.stopping === "boolean" ? String(broker.stopping) : "",
    TRANSPORT: typeof broker.transport === "string" ? broker.transport : "",
    ENDPOINT_NAME: typeof broker.endpointName === "string" ? broker.endpointName : typeof broker.pipeName === "string" ? broker.pipeName : "",
    ENDPOINT_PATH: typeof broker.endpointPath === "string" ? broker.endpointPath : typeof broker.pipePath === "string" ? broker.pipePath : "",
    PID: typeof broker.processId === "number" ? String(broker.processId) : "",
    STARTED_AT: typeof broker.startedAt === "string" ? broker.startedAt : ""
  }]);
}

function renderEventStreamChunk(event: EventEnvelope, output: "table" | "ndjson" | "quiet"): string {
  if (output === "quiet") return "";
  if (output === "ndjson") return `${JSON.stringify(event)}\n`;
  return renderEventTable([event]);
}

function renderTable(columns: string[], rows: Array<Record<string, string>>): string {
  const widths = columns.map((column) => {
    return Math.max(column.length, ...rows.map((row) => row[column]?.length ?? 0));
  });
  const header = columns.map((column, index) => column.padEnd(widths[index] as number)).join("  ");
  if (rows.length === 0) return `${header}\n`;
  const body = rows.map((row) => {
    return columns.map((column, index) => (row[column] ?? "").padEnd(widths[index] as number)).join("  ");
  });
  return `${[header, ...body].join("\n")}\n`;
}

function sortBrowsers(browsers: BrowserSession[]): BrowserSession[] {
  return [...browsers].sort((a, b) => Date.parse(a.connectedAt) - Date.parse(b.connectedAt));
}

function sortTabs(tabs: Tab[]): Tab[] {
  return [...tabs].sort((a, b) => {
    if (a.windowId !== b.windowId) return a.windowId - b.windowId;
    return a.index - b.index;
  });
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  let command: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token.startsWith("--")) {
      const flag = token.slice(2);
      if (flag.length === 0) throw usageError("Invalid flag.");
      const [name, inlineValue] = flag.split("=", 2);
      if (!name) throw usageError("Invalid flag.");
      const spec = getCliFlagSpec(name);
      if (!spec) throw usageError(`Unknown flag: --${name}.`);
      const takesValue = cliFlagTakesValue(spec);
      if (inlineValue !== undefined) {
        if (!takesValue) throw usageError(`--${name} does not take a value.`);
        if (inlineValue.length === 0) throw usageError(`--${name} requires a value.`);
        setParsedFlag(flags, spec, inlineValue);
        continue;
      }
      if (takesValue) {
        const next = argv[index + 1];
        if (next === undefined || next.startsWith("--")) throw usageError(`--${name} requires a value.`);
        setParsedFlag(flags, spec, next);
        index += 1;
      } else {
        setParsedFlag(flags, spec, true);
      }
      continue;
    }
    if (!command) {
      command = token;
    } else {
      positionals.push(token);
    }
  }

  return { command, positionals, flags };
}

function setParsedFlag(
  flags: Map<string, string | boolean | string[]>,
  spec: { name: string },
  value: string | boolean
): void {
  const current = flags.get(spec.name);
  if (current === undefined) {
    flags.set(spec.name, value);
    return;
  }
  if (Array.isArray(current)) {
    current.push(String(value));
    return;
  }
  flags.set(spec.name, [String(current), String(value)]);
}

function readSnapshotFilter(parsed: ParsedArgs): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};
  const query = readOptionalStringFlag(parsed, "query");
  const role = readOptionalStringFlag(parsed, "role");
  const maxElements = readOptionalIntegerFlag(parsed, "max-elements");
  if (query !== undefined) filter.query = query;
  if (role !== undefined) filter.role = role;
  if (hasFlag(parsed, "interactive-only")) filter.interactiveOnly = true;
  if (maxElements !== undefined) filter.maxElements = maxElements;
  if (Object.keys(filter).length === 0) return undefined;
  return SnapshotFilterSchema.parse(filter);
}

async function readFillFormFieldsFromCli(parsed: ParsedArgs): Promise<Array<{ elementId: string; value: string }>> {
  const sources = [
    readOptionalStringFlag(parsed, "fields") !== undefined,
    readOptionalStringFlag(parsed, "json-fields") !== undefined,
    readStringFlags(parsed, "field").length > 0
  ].filter(Boolean).length;
  if (sources !== 1) throw usageError("fill-form requires exactly one of --fields, --json-fields, or --field.");

  const fieldsPath = readOptionalStringFlag(parsed, "fields");
  if (fieldsPath !== undefined) {
    try {
      return parseFillFormFields(JSON.parse(await readFile(fieldsPath, "utf8")));
    } catch (error) {
      if (PortusErrorSchema.safeParse(error).success) throw error;
      throw usageError(`Fill form fields file is invalid JSON: ${fieldsPath}.`);
    }
  }

  const jsonFields = readOptionalStringFlag(parsed, "json-fields");
  if (jsonFields !== undefined) {
    try {
      return parseFillFormFields(JSON.parse(jsonFields));
    } catch (error) {
      if (PortusErrorSchema.safeParse(error).success) throw error;
      throw usageError("Fill form --json-fields value is invalid JSON.");
    }
  }

  return parseFillFormFields(readStringFlags(parsed, "field").map((entry) => {
    const separator = entry.indexOf("=");
    if (separator <= 0) throw usageError("--field must use elementId=value.");
    return {
      elementId: entry.slice(0, separator),
      value: entry.slice(separator + 1)
    };
  }));
}

function parseFillFormFields(input: unknown): Array<{ elementId: string; value: string }> {
  const normalized = !Array.isArray(input) && isRecord(input)
    ? Object.entries(input).map(([elementId, value]) => ({ elementId, value }))
    : input;
  const parsed = z.array(z.object({
    elementId: z.string().regex(/^el_[A-Za-z0-9_-]+$/),
    value: z.string()
  }).strict()).min(1).safeParse(normalized);
  if (!parsed.success) throw usageError("Fill form fields must be an array of { elementId, value } or an object keyed by element id.");
  return parsed.data;
}

function resolveOutputMode(parsed: ParsedArgs, config: PortusConfig, invocation: CliInvocationSpec): OutputMode {
  if (parsed.flags.has(CLI_FLAGS.json.name)) return "json";
  if (parsed.flags.has(CLI_FLAGS.quiet.name)) return "quiet";
  const output = cliInvocationOutputFlagRole(invocation) === "renderer"
    ? readOptionalStringFlag(parsed, CLI_OUTPUT_FLAG.name)
    : undefined;
  if (!output) return config.cli.output;
  if (output === "table" || output === "json" || output === "ndjson" || output === "quiet") return output;
  throw usageError(`--${CLI_OUTPUT_FLAG.name} must be table, json, ndjson, or quiet.`);
}

function inferOutputMode(argv: string[]): OutputMode {
  const jsonFlag = `--${CLI_FLAGS.json.name}`;
  const quietFlag = `--${CLI_FLAGS.quiet.name}`;
  const outputFlag = `--${CLI_OUTPUT_FLAG.name}`;
  if (argv.includes(jsonFlag)) return "json";
  if (argv.includes(quietFlag)) return "quiet";
  const outputIndex = argv.indexOf(outputFlag);
  if (outputIndex >= 0) {
    const output = argv[outputIndex + 1];
    if (output === "json" || output === "ndjson" || output === "quiet") return output;
  }
  const inlineOutputPrefix = `${outputFlag}=`;
  const inlineOutput = argv.find((value) => value.startsWith(inlineOutputPrefix));
  if (inlineOutput) {
    const output = inlineOutput.slice(inlineOutputPrefix.length);
    if (output === "json" || output === "ndjson" || output === "quiet") return output;
  }
  return "table";
}

function readOptionalStringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return value === undefined ? undefined : value as string;
}

function readStringFlags(parsed: ParsedArgs, name: string): string[] {
  const value = parsed.flags.get(name);
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value as string];
}

function readRequiredIntegerFlag(parsed: ParsedArgs, name: string): number {
  const value = readOptionalIntegerFlag(parsed, name);
  if (value === undefined) throw usageError(`--${name} is required.`);
  return value;
}

function readOptionalIntegerFlag(parsed: ParsedArgs, name: string): number | undefined {
  const value = readOptionalStringFlag(parsed, name);
  return value === undefined ? undefined : Number(value);
}

function readOptionalNumberFlag(parsed: ParsedArgs, name: string): number | undefined {
  const value = readOptionalStringFlag(parsed, name);
  return value === undefined ? undefined : Number(value);
}

function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.get(name) === true;
}

function parseDisplayIndex(value: string): number | null {
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  return Number(value);
}

function normalizeUrl(input: string, normalize: boolean): string {
  const candidate = normalize && !/^[a-z][a-z0-9+.-]*:/i.test(input) ? `https://${input}` : input;
  try {
    return new URL(candidate).toString();
  } catch {
    throw usageError("URL must be valid.");
  }
}

const NAVIGATION_RULE_FLAGS: ReadonlyArray<readonly [string, NavigationRuleMatch]> = [
  ["scheme", "scheme"],
  ["authority", "authority"],
  ["host-wildcard", "host-wildcard"],
  ["url-exact", "url-exact"],
  ["url-prefix", "url-prefix"]
];

function readNavigationRuleFlags(parsed: ParsedArgs): NavigationRulePattern {
  const provided = NAVIGATION_RULE_FLAGS.flatMap(([flag, match]) => {
    const value = readOptionalStringFlag(parsed, flag);
    return value === undefined ? [] : [{ match, value }];
  });
  if (provided.length !== 1) {
    throw usageError("Provide exactly one navigation rule flag: --scheme, --authority, --host-wildcard, --url-exact, or --url-prefix.");
  }
  const rule = provided[0] as { match: NavigationRuleMatch; value: string };
  try {
    return normalizeNavigationRulePattern(rule.match, rule.value);
  } catch {
    throw usageError(`Invalid ${rule.match} navigation rule: ${rule.value}.`);
  }
}

function createCliConfig(options: PortusBrowserCliOptions): PortusConfig {
  const base = PortusConfigSchema.parse(options.config ?? DEFAULT_PORTUS_CONFIG);
  return applyEnvironmentOverrides(base, options.env ?? process.env);
}

function createDefaultBrokerClient(config: PortusConfig): BrokerClient {
  const brokerToken = config.security.requireBrokerToken ? loadOrCreateBrokerToken() : undefined;
  const endpoint = resolveBrokerEndpoint({
    endpointName: config.broker.pipeName,
    transport: config.broker.transport
  });
  return new NamedPipeBrokerClient(endpoint.endpointPath, brokerToken, endpoint.transport);
}

function usageError(message: string, usageText?: string): PortusError {
  return createPortusError({
    code: "INVALID_MESSAGE",
    message,
    details: {
      usage: true,
      ...(usageText === undefined ? {} : { usageText })
    }
  });
}

function brokerUnavailableError(message: string): PortusError {
  return createPortusError({
    code: "BROKER_UNAVAILABLE",
    message: `Portus Broker is unavailable. ${message}`,
    retryable: true
  });
}

function normalizeCliError(error: unknown): PortusError {
  const parsed = PortusErrorSchema.safeParse(error);
  if (parsed.success) return parsed.data;
  if (error instanceof z.ZodError) {
    return createPortusError({
      code: "INVALID_MESSAGE",
      message: "Invalid broker response.",
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      }
    });
  }
  if (error instanceof Error) {
    return createPortusError({
      code: "INTERNAL_ERROR",
      message: error.message
    });
  }
  return createPortusError({
    code: "INTERNAL_ERROR",
    message: "Unexpected CLI failure."
  });
}

function exitCodeForError(error: PortusError): number {
  if (error.details && isRecord(error.details) && error.details.usage === true) return 2;
  const byCode: Partial<Record<ErrorCode, number>> = {
    CONFIG_INVALID: 3,
    BROKER_UNAVAILABLE: 4,
    NATIVE_HOST_UNAVAILABLE: 4,
    BROWSER_ACCESS_DENIED: 5,
    NAVIGATION_BLOCKED: 5,
    COMMAND_DISABLED_BY_POLICY: 5,
    UPLOAD_PATH_DENIED: 5,
    BROWSER_SESSION_UNAVAILABLE: 6,
    BRIDGE_DISCONNECTED: 6,
    TARGET_NOT_FOUND: 6,
    TAB_NOT_FOUND: 6,
    COMMAND_TIMEOUT: 7,
    INTERNAL_ERROR: 70
  };
  return byCode[error.code] ?? 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main(): Promise<void> {
  const result = await runPortusBrowserCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

const currentModulePath = fileURLToPath(import.meta.url);
let isMain = false;
try {
  isMain = process.argv[1] ? realpathSync(process.argv[1]) === realpathSync(currentModulePath) : false;
} catch {
  isMain = process.argv[1] === currentModulePath;
}
if (isMain) {
  void main();
}

export const portusBrowserCliApp = {
  name: "portus-browser-cli",
  packageName: "@portus/browser-cli",
  phase: "browser-cli"
} as const;
