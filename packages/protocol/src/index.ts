import { z } from "zod";

export const PROTOCOL_VERSION = "1" as const;

export const JsonObjectSchema = z.record(z.string(), z.unknown());

export const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION);
export const RequestIdSchema = z.string().regex(/^req_[A-Za-z0-9_-]+$/);
export const EventIdSchema = z.string().regex(/^evt_[A-Za-z0-9_-]+$/);
export const BrowserIdSchema = z.string().regex(/^br_[A-Za-z0-9_-]+$/);
export const WindowIdSchema = z.number().int();
export const TabIdSchema = z.number().int();
export const SnapshotIdSchema = z.string().regex(/^snap_[A-Za-z0-9_-]+$/);
export const ElementIdSchema = z.string().regex(/^el_[A-Za-z0-9_-]+$/);
export const RecipeIdSchema = z.string().regex(/^(recipe_[A-Za-z0-9_-]+|[a-z0-9][a-z0-9-]*)$/);
export const CommandIdSchema = z.string().regex(/^cmd_[A-Za-z0-9_-]+$/);
export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const ErrorCodeSchema = z.enum([
  "INVALID_MESSAGE",
  "UNSUPPORTED_PROTOCOL_VERSION",
  "BROKER_UNAVAILABLE",
  "BROKER_TOKEN_REQUIRED",
  "BROKER_TOKEN_INVALID",
  "BROWSER_SESSION_UNAVAILABLE",
  "BRIDGE_DISCONNECTED",
  "TARGET_NOT_FOUND",
  "TAB_NOT_FOUND",
  "PERMISSION_REQUIRED",
  "ORIGIN_BLOCKED",
  "COMMAND_DISABLED_BY_POLICY",
  "COMMAND_TIMEOUT",
  "CAPABILITY_UNAVAILABLE",
  "ACTION_UNSUPPORTED",
  "ACTION_FAILED",
  "DISMISS_TARGET_NOT_FOUND",
  "SNAPSHOT_STALE",
  "NATIVE_HOST_UNAVAILABLE",
  "CONFIG_INVALID",
  "RECIPE_INVALID",
  "TERMINAL_UNAVAILABLE",
  "INTERNAL_ERROR"
]);

export const PortusErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1),
  details: JsonObjectSchema.optional(),
  retryable: z.boolean().optional(),
  suggestedCommand: z.string().min(1).optional(),
  causeCode: z.string().min(1).optional()
}).strict();

export const MessageKindSchema = z.enum(["request", "response", "event"]);

export const BrokerRequestAuthSchema = z.object({
  brokerToken: z.string().min(1)
}).strict();

export const RequestEnvelopeSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  requestId: RequestIdSchema,
  kind: z.literal("request"),
  type: z.string().min(1),
  payload: JsonObjectSchema,
  timeoutMs: z.number().int().positive().optional(),
  auth: BrokerRequestAuthSchema.optional(),
  client: JsonObjectSchema.optional()
}).strict();

const ResponseEnvelopeBaseSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  requestId: RequestIdSchema,
  kind: z.literal("response")
});

export const ResponseEnvelopeSchema = z.discriminatedUnion("ok", [
  ResponseEnvelopeBaseSchema.extend({
    ok: z.literal(true),
    result: JsonObjectSchema
  }).strict(),
  ResponseEnvelopeBaseSchema.extend({
    ok: z.literal(false),
    error: PortusErrorSchema
  }).strict()
]);

export const BrowserNameSchema = z.enum(["Chrome", "Edge", "Brave", "UnknownChromium"]);
export const BridgeStatusSchema = z.enum(["connected", "disconnecting", "disconnected", "error"]);
export const BrowserSessionStatusSchema = z.enum(["available", "expired", "unavailable"]);
export const CapabilitySchema = z.enum([
  "tabs",
  "windows",
  "screenshots",
  "snapshots",
  "actions",
  "advanced-debugger",
  "permissions",
  "events",
  "terminal"
]);

export const BrowserSessionSchema = z.object({
  browserId: BrowserIdSchema,
  browserName: BrowserNameSchema,
  extensionVersion: z.string().min(1),
  connectedAt: IsoDateTimeSchema,
  lastHeartbeat: IsoDateTimeSchema,
  capabilities: z.array(CapabilitySchema),
  bridgeStatus: BridgeStatusSchema,
  status: BrowserSessionStatusSchema,
  browserLabel: z.string().min(1).optional(),
  profileLabel: z.string().min(1).optional(),
  extensionId: z.string().min(1).optional(),
  nativeHostId: z.string().min(1).optional()
}).strict();

export const HttpOriginSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "http:" || url.protocol === "https:");
  } catch {
    return false;
  }
}, "must be an http(s) origin");

export const PolicyOriginPatternSchema = z.string().refine((value) => {
  if (HttpOriginSchema.safeParse(value).success) return true;
  const normalized = value.toLowerCase();
  return /^(?:(https?):\/\/)?\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.test(normalized);
}, "must be an http(s) origin or wildcard host pattern like *.example.com");

export const PolicySourceSchema = z.enum(["extension", "cli", "config"]);

export const CommandTypeSchema = z.enum([
  "browser.list",
  "tab.list",
  "tab.get",
  "tab.open",
  "tab.navigate",
  "tab.history.back",
  "tab.history.forward",
  "tab.wait",
  "tab.activate",
  "tab.close",
  "screenshot.capture",
  "snapshot.capture",
  "page.wait",
  "action.click",
  "action.hover",
  "action.drag",
  "action.fillForm",
  "action.type",
  "action.press",
  "action.scroll",
  "page.dismiss",
  "dialog.dismiss",
  "dialog.accept",
  "console.list",
  "console.clear",
  "network.list",
  "network.get",
  "recipe.list",
  "recipe.get",
  "recipe.search",
  "recipe.resolve",
  "permission.list",
  "permission.request",
  "permission.revoke",
  "policy.get",
  "policy.allow.add",
  "policy.allow.remove",
  "policy.block.add",
  "policy.block.remove",
  "policy.retention.set",
  "event.subscribe",
  "events.recent",
  "session.steps",
  "bridge.disconnect"
]);

export const DEFAULT_COMMAND_POLICY = {
  "browser.list": true,
  "tab.list": true,
  "tab.get": true,
  "tab.open": true,
  "tab.navigate": true,
  "tab.history.back": true,
  "tab.history.forward": true,
  "tab.wait": true,
  "tab.activate": true,
  "tab.close": true,
  "screenshot.capture": true,
  "snapshot.capture": true,
  "page.wait": true,
  "action.click": true,
  "action.hover": true,
  "action.drag": true,
  "action.fillForm": true,
  "action.type": true,
  "action.press": true,
  "action.scroll": true,
  "page.dismiss": true,
  "dialog.dismiss": false,
  "dialog.accept": false,
  "console.list": false,
  "console.clear": false,
  "network.list": false,
  "network.get": false,
  "recipe.list": true,
  "recipe.get": true,
  "recipe.search": true,
  "recipe.resolve": true,
  "permission.list": true,
  "permission.request": false,
  "permission.revoke": false,
  "policy.get": true,
  "policy.allow.add": false,
  "policy.allow.remove": false,
  "policy.block.add": false,
  "policy.block.remove": false,
  "policy.retention.set": false,
  "event.subscribe": true,
  "events.recent": true,
  "session.steps": true,
  "bridge.disconnect": false
} as const satisfies Record<z.infer<typeof CommandTypeSchema>, boolean>;

export const PolicyModeSchema = z.enum(["blocklist", "allowlist"]);
export const CommandPolicySchema = z.partialRecord(CommandTypeSchema, z.boolean());
export const SidePanelDefaultViewSchema = z.enum(["terminal", "settings"]);
export const IconClickBehaviorSchema = z.enum(["popup", "side-panel"]);
export const DEFAULT_SETTINGS_PROFILE_NAME = "Default_Profile" as const;
export const INITIAL_CUSTOM_SETTINGS_PROFILE_NAME = "Profile_1" as const;
export const SETTINGS_PROFILE_CREATE_OPTION = "__portus_create_profile__" as const;
export const DEFAULT_MAX_CUSTOM_SETTINGS_PROFILES = 10 as const;
export const SettingsProfileIdSchema = z.string().regex(/^profile_[A-Za-z0-9_-]+$/);
export const SettingsProfileNameSchema = z.string().min(1).max(80);

export const PolicyOriginEntrySchema = z.object({
  origin: PolicyOriginPatternSchema,
  source: PolicySourceSchema,
  updatedAt: IsoDateTimeSchema.optional(),
  reason: z.string().min(1).optional()
}).strict();

export const PolicyPreferencesSchema = z.object({
  originPolicyEnabled: z.boolean().default(true),
  policyMode: PolicyModeSchema.default("blocklist"),
  allowedOrigins: z.array(PolicyOriginEntrySchema).default([]),
  blockedOrigins: z.array(PolicyOriginEntrySchema).default([]),
  commandPolicy: CommandPolicySchema.default(DEFAULT_COMMAND_POLICY).transform((policy) => ({
    ...DEFAULT_COMMAND_POLICY,
    ...policy
  })),
  advancedBackendEnabled: z.boolean().default(false),
  sessionStepRetentionLimit: z.number().int().min(0).max(1000).default(10)
}).strict();

export const ExtensionUxPreferencesSchema = z.object({
  defaultPanelView: SidePanelDefaultViewSchema.default("terminal"),
  iconClickBehavior: IconClickBehaviorSchema.default("popup")
}).strict();

export const SettingsProfileContentSchema = z.object({
  policyPreferences: PolicyPreferencesSchema.default(() => PolicyPreferencesSchema.parse({})),
  uxPreferences: ExtensionUxPreferencesSchema.default(() => ExtensionUxPreferencesSchema.parse({})),
  terminalPreferences: z.record(z.string(), z.unknown()).default({}),
  autoSave: z.boolean().default(true)
}).strict();

export const SettingsProfileSchema = z.object({
  profileId: SettingsProfileIdSchema,
  name: SettingsProfileNameSchema,
  builtIn: z.boolean().default(false),
  readOnly: z.boolean().default(false),
  content: SettingsProfileContentSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
}).strict();

export const SettingsProfileSummarySchema = SettingsProfileSchema.pick({
  profileId: true,
  name: true,
  builtIn: true,
  readOnly: true
});

export const SettingsProfileBrowserSelectionSchema = z.partialRecord(BrowserNameSchema, SettingsProfileIdSchema);

export const SettingsProfileCatalogSchema = z.object({
  version: z.literal(1).default(1),
  maxCustomProfiles: z.number().int().positive().default(DEFAULT_MAX_CUSTOM_SETTINGS_PROFILES),
  profiles: z.array(SettingsProfileSchema).min(1),
  activeProfileByBrowserType: SettingsProfileBrowserSelectionSchema.default({})
}).strict();

export const SettingsProfileStateSchema = z.object({
  profiles: z.array(SettingsProfileSummarySchema),
  activeProfileId: SettingsProfileIdSchema,
  activeProfileName: SettingsProfileNameSchema,
  activeProfileReadOnly: z.boolean(),
  dirty: z.boolean().default(false),
  autoSave: z.boolean().default(true),
  canCreateProfile: z.boolean(),
  maxCustomProfiles: z.number().int().positive(),
  content: SettingsProfileContentSchema
}).strict();

export const RegistrationRequestSchema = z.object({
  browserName: BrowserNameSchema,
  extensionVersion: z.string().min(1),
  extensionId: z.string().min(1),
  bridgeStatus: z.literal("connected"),
  capabilities: z.array(CapabilitySchema),
  browserLabel: z.string().min(1).optional(),
  profileLabel: z.string().min(1).optional(),
  policyPreferences: PolicyPreferencesSchema.optional(),
  settingsProfileContent: SettingsProfileContentSchema.optional()
}).strict();

export const RegistrationResultSchema = z.object({
  browserId: BrowserIdSchema,
  heartbeatIntervalMs: z.number().int().positive(),
  settingsProfiles: SettingsProfileStateSchema.optional()
}).strict();

export const HeartbeatPayloadSchema = z.object({
  browserId: BrowserIdSchema,
  bridgeStatus: BridgeStatusSchema,
  sentAt: IsoDateTimeSchema
}).strict();

export const ViewportSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  deviceScaleFactor: z.number().positive()
}).strict();

export const BoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative()
}).strict();

export const TabSchema = z.object({
  browserId: BrowserIdSchema,
  tabId: TabIdSchema,
  windowId: WindowIdSchema,
  index: z.number().int().nonnegative(),
  active: z.boolean(),
  pinned: z.boolean(),
  discarded: z.boolean(),
  title: z.string(),
  url: z.string(),
  favIconUrl: z.string().optional(),
  status: z.string().optional()
}).strict();

export const PermissionSourceSchema = z.enum(["extension", "cli", "config", "activeTab"]);
export const PermissionScopeSchema = z.enum(["origin", "session", "temporary"]);

export const PermissionRecordSchema = z.object({
  origin: HttpOriginSchema,
  granted: z.boolean(),
  source: PermissionSourceSchema,
  scope: PermissionScopeSchema,
  requestedAt: IsoDateTimeSchema.optional(),
  grantedAt: IsoDateTimeSchema.optional(),
  reason: z.string().min(1).optional()
}).strict();

export const CommandEnvelopeSchema = z.object({
  commandId: CommandIdSchema,
  type: CommandTypeSchema,
  args: JsonObjectSchema,
  targetBrowserId: BrowserIdSchema.optional(),
  targetTabId: TabIdSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
  requiredPermission: z.string().min(1).optional(),
  capabilityLayer: z.number().int().min(1).max(3).optional()
}).strict();

const CommandResultBaseSchema = z.object({
  commandId: CommandIdSchema
});

export const CommandResultSchema = z.discriminatedUnion("ok", [
  CommandResultBaseSchema.extend({
    ok: z.literal(true),
    result: JsonObjectSchema
  }).strict(),
  CommandResultBaseSchema.extend({
    ok: z.literal(false),
    error: PortusErrorSchema
  }).strict()
]);

export const BrokerEventTypeSchema = z.enum([
  "bridge.connected",
  "bridge.disconnected",
  "session.registered",
  "session.expired",
  "tab.created",
  "tab.updated",
  "tab.activated",
  "tab.closed",
  "snapshot.invalidated",
  "permission.required",
  "permission.changed",
  "policy.changed",
  "origin.blocked",
  "action.started",
  "action.completed",
  "action.failed",
  "advanced.backend.attached",
  "advanced.backend.detached",
  "advanced.backend.failed",
  "session.step.recorded",
  "bridge.recovery.required"
]);

export const EventEnvelopeSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  eventId: EventIdSchema,
  kind: z.literal("event"),
  type: BrokerEventTypeSchema,
  createdAt: IsoDateTimeSchema,
  payload: JsonObjectSchema,
  browserId: BrowserIdSchema.optional(),
  tabId: TabIdSchema.optional(),
  requestId: RequestIdSchema.optional()
}).strict();

export const BrokerEventSchema = EventEnvelopeSchema;

export const SessionStepStatusSchema = z.enum(["completed", "failed", "blocked"]);

export const SessionStepSchema = z.object({
  stepId: z.string().regex(/^step_[A-Za-z0-9_-]+$/),
  browserId: BrowserIdSchema,
  commandType: CommandTypeSchema,
  status: SessionStepStatusSchema,
  createdAt: IsoDateTimeSchema,
  requestId: RequestIdSchema.optional(),
  tabId: TabIdSchema.optional(),
  origin: HttpOriginSchema.optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  args: JsonObjectSchema.optional(),
  error: PortusErrorSchema.optional()
}).strict();

export const ScreenshotResultSchema = z.object({
  browserId: BrowserIdSchema,
  tabId: TabIdSchema,
  capturedAt: IsoDateTimeSchema,
  mimeType: z.string().min(1),
  data: z.string(),
  activatedTabBeforeCapture: z.boolean(),
  previousActiveTabId: TabIdSchema.optional()
}).strict();

export const SnapshotElementSchema = z.object({
  elementId: ElementIdSchema,
  role: z.string(),
  label: z.string(),
  text: z.string(),
  bounds: BoundsSchema,
  state: JsonObjectSchema,
  selectorHint: z.string().optional(),
  tagName: z.string().optional(),
  disabled: z.boolean().optional(),
  editable: z.boolean().optional(),
  href: z.string().optional(),
  inputType: z.string().optional(),
  name: z.string().optional(),
  placeholder: z.string().optional()
}).strict();

export const SnapshotFilterSchema = z.object({
  query: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  interactiveOnly: z.boolean().optional(),
  maxElements: z.number().int().positive().max(10000).optional()
}).strict();

export const SnapshotSchema = z.object({
  snapshotId: SnapshotIdSchema,
  browserId: BrowserIdSchema,
  tabId: TabIdSchema,
  url: z.string(),
  title: z.string(),
  viewport: ViewportSchema,
  screenshot: ScreenshotResultSchema,
  visibleText: z.string(),
  elements: z.array(SnapshotElementSchema),
  capturedAt: IsoDateTimeSchema,
  cleanedDom: z.string().optional(),
  filtered: z.boolean().optional(),
  filter: SnapshotFilterSchema.nullable().optional()
}).strict();

export const WaitConditionSchema = z.object({
  state: z.enum(["loading", "complete"]).optional(),
  urlContains: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  elementQuery: z.string().min(1).optional(),
  role: z.string().min(1).optional()
}).strict();

export const WaitResultSchema = z.object({
  browserId: BrowserIdSchema,
  tabId: TabIdSchema,
  matched: z.boolean(),
  source: z.enum(["broker-event", "current-tab", "page-script"]),
  condition: WaitConditionSchema,
  completedAt: IsoDateTimeSchema,
  url: z.string().optional(),
  title: z.string().optional(),
  eventId: EventIdSchema.optional(),
  details: JsonObjectSchema.optional()
}).strict();

export type WaitResult = z.infer<typeof WaitResultSchema>;

export const ActionBackendSchema = z.enum(["extension-api", "content-script-dom", "debugger-cdp"]);
export const ActionNameSchema = z.enum(["click", "hover", "drag", "fillForm", "type", "press", "scroll"]);

export const ActionRequestSchema = z.object({
  action: ActionNameSchema,
  browserId: BrowserIdSchema,
  tabId: TabIdSchema,
  snapshotId: SnapshotIdSchema.optional(),
  elementId: ElementIdSchema.optional(),
  sourceElementId: ElementIdSchema.optional(),
  targetElementId: ElementIdSchema.optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  deltaX: z.number().optional(),
  deltaY: z.number().optional()
}).strict();

export const FillFormFieldSchema = z.object({
  elementId: ElementIdSchema,
  value: z.string()
}).strict();

export const FillFormRequestSchema = z.object({
  action: z.literal("fillForm"),
  browserId: BrowserIdSchema,
  tabId: TabIdSchema,
  snapshotId: SnapshotIdSchema,
  fields: z.array(FillFormFieldSchema).min(1),
  partial: z.boolean().optional()
}).strict();

export const ActionResultSchema = z.object({
  backend: ActionBackendSchema,
  completedAt: IsoDateTimeSchema,
  snapshotInvalidated: z.boolean().optional(),
  details: JsonObjectSchema.optional()
}).strict();

export const FillFormFieldResultSchema = z.object({
  elementId: ElementIdSchema,
  ok: z.boolean(),
  error: PortusErrorSchema.optional()
}).strict();

export const FillFormResultSchema = z.object({
  backend: ActionBackendSchema,
  completedAt: IsoDateTimeSchema,
  snapshotInvalidated: z.boolean(),
  fields: z.array(FillFormFieldResultSchema),
  details: JsonObjectSchema.optional()
}).strict();

export const DialogResultSchema = z.object({
  handled: z.boolean(),
  action: z.enum(["accept", "dismiss"]),
  backend: ActionBackendSchema.optional(),
  completedAt: IsoDateTimeSchema,
  details: JsonObjectSchema.optional()
}).strict();

export const ConsoleMessageSchema = z.object({
  level: z.enum(["debug", "log", "info", "warn", "error"]),
  text: z.string(),
  createdAt: IsoDateTimeSchema,
  source: z.enum(["page", "portus"]),
  url: z.string().optional(),
  line: z.number().int().nonnegative().optional()
}).strict();

export const ConsoleListResultSchema = z.object({
  messages: z.array(ConsoleMessageSchema),
  captureStartedAt: IsoDateTimeSchema.optional()
}).strict();

export const NetworkRecordSchema = z.object({
  requestId: z.string().min(1),
  tabId: TabIdSchema,
  url: z.string(),
  method: z.string().min(1),
  resourceType: z.string().optional(),
  statusCode: z.number().int().optional(),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.optional(),
  error: z.string().optional(),
  redacted: z.boolean()
}).strict();

export const NetworkListResultSchema = z.object({
  requests: z.array(NetworkRecordSchema),
  captureStartedAt: IsoDateTimeSchema.optional()
}).strict();

export const NetworkGetResultSchema = z.object({
  request: NetworkRecordSchema
}).strict();

export const DismissKindSchema = z.enum(["any", "popup", "cookie"]);
export const DismissStrategySchema = z.enum(["conservative", "accept"]);

export const DismissResultSchema = z.object({
  strategy: DismissStrategySchema,
  kind: DismissKindSchema,
  dryRun: z.boolean(),
  dismissed: z.boolean(),
  snapshotId: SnapshotIdSchema,
  elementId: ElementIdSchema.optional(),
  label: z.string().optional(),
  role: z.string().optional(),
  href: z.string().optional(),
  reason: z.string().optional(),
  action: ActionResultSchema.optional()
}).strict();

export const TerminalMessageTypeSchema = z.enum([
  "terminal.start",
  "terminal.input",
  "terminal.resize",
  "terminal.output",
  "terminal.exit",
  "terminal.error"
]);

export const TerminalMessageSchema = z.object({
  type: TerminalMessageTypeSchema,
  terminalId: z.string().min(1),
  payload: JsonObjectSchema
}).strict();

export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;
export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type SessionStep = z.infer<typeof SessionStepSchema>;
export type PortusError = z.infer<typeof PortusErrorSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type BrowserName = z.infer<typeof BrowserNameSchema>;
export type BrowserSession = z.infer<typeof BrowserSessionSchema>;
export type Tab = z.infer<typeof TabSchema>;
export type PermissionRecord = z.infer<typeof PermissionRecordSchema>;
export type PolicyOriginEntry = z.infer<typeof PolicyOriginEntrySchema>;
export type PolicyMode = z.infer<typeof PolicyModeSchema>;
export type CommandType = z.infer<typeof CommandTypeSchema>;
export type CommandPolicy = z.infer<typeof CommandPolicySchema>;
export type PolicyPreferences = z.infer<typeof PolicyPreferencesSchema>;
export type SidePanelDefaultView = z.infer<typeof SidePanelDefaultViewSchema>;
export type IconClickBehavior = z.infer<typeof IconClickBehaviorSchema>;
export type ExtensionUxPreferences = z.infer<typeof ExtensionUxPreferencesSchema>;
export type SettingsProfileContent = z.infer<typeof SettingsProfileContentSchema>;
export type SettingsProfile = z.infer<typeof SettingsProfileSchema>;
export type SettingsProfileSummary = z.infer<typeof SettingsProfileSummarySchema>;
export type SettingsProfileCatalog = z.infer<typeof SettingsProfileCatalogSchema>;
export type SettingsProfileState = z.infer<typeof SettingsProfileStateSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type SnapshotElement = z.infer<typeof SnapshotElementSchema>;
export type SnapshotFilter = z.infer<typeof SnapshotFilterSchema>;
export type ScreenshotResult = z.infer<typeof ScreenshotResultSchema>;
export type ActionRequest = z.infer<typeof ActionRequestSchema>;
export type ActionResult = z.infer<typeof ActionResultSchema>;
export type FillFormField = z.infer<typeof FillFormFieldSchema>;
export type FillFormRequest = z.infer<typeof FillFormRequestSchema>;
export type FillFormResult = z.infer<typeof FillFormResultSchema>;
export type DialogResult = z.infer<typeof DialogResultSchema>;
export type ConsoleMessage = z.infer<typeof ConsoleMessageSchema>;
export type ConsoleListResult = z.infer<typeof ConsoleListResultSchema>;
export type NetworkRecord = z.infer<typeof NetworkRecordSchema>;
export type NetworkListResult = z.infer<typeof NetworkListResultSchema>;
export type NetworkGetResult = z.infer<typeof NetworkGetResultSchema>;
export type DismissKind = z.infer<typeof DismissKindSchema>;
export type DismissStrategy = z.infer<typeof DismissStrategySchema>;
export type DismissResult = z.infer<typeof DismissResultSchema>;
export type TerminalMessage = z.infer<typeof TerminalMessageSchema>;

export class PortusValidationError extends Error {
  readonly portusError: PortusError;

  constructor(portusError: PortusError) {
    super(portusError.message);
    this.name = "PortusValidationError";
    this.portusError = portusError;
  }
}

export function createPortusError(input: PortusError): PortusError {
  return PortusErrorSchema.parse(input);
}

export function createInvalidMessageError(details?: Record<string, unknown>): PortusError {
  return createPortusError({
    code: "INVALID_MESSAGE",
    message: "Invalid Portus protocol message.",
    details
  });
}

export function createUnsupportedProtocolVersionError(protocolVersion: unknown): PortusError {
  return createPortusError({
    code: "UNSUPPORTED_PROTOCOL_VERSION",
    message: "Unsupported Portus protocol version.",
    details: { protocolVersion }
  });
}

export function safeParseProtocolMessage<T>(
  schema: z.ZodType<T>,
  input: unknown
): { ok: true; data: T } | { ok: false; error: PortusError } {
  const versionCheck = z.object({ protocolVersion: z.unknown().optional() }).passthrough().safeParse(input);
  if (!versionCheck.success || versionCheck.data.protocolVersion === undefined) {
    return { ok: false, error: createInvalidMessageError({ reason: "missing protocolVersion" }) };
  }
  if (versionCheck.data.protocolVersion !== PROTOCOL_VERSION) {
    return { ok: false, error: createUnsupportedProtocolVersionError(versionCheck.data.protocolVersion) };
  }

  const result = schema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      error: createInvalidMessageError({
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      })
    };
  }
  return { ok: true, data: result.data };
}

export function parseProtocolMessage<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = safeParseProtocolMessage(schema, input);
  if (!result.ok) throw new PortusValidationError(result.error);
  return result.data;
}
