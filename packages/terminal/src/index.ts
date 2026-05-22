import { z } from "zod";

export const TERMINAL_NATIVE_HOST_NAME = "com.portus.browser.terminal" as const;
export const DEFAULT_TERMINAL_PROFILE_ID = "auto" as const;
export const DEFAULT_TERMINAL_WORKING_DIRECTORY = "Downloads/portus-session" as const;
export const DEFAULT_TERMINAL_STARTUP_COMMAND = null;
export const TERMINAL_OUTPUT_CHUNK_MAX_LENGTH = 64 * 1024;

export const TerminalIdSchema = z.string().regex(/^term_[A-Za-z0-9_-]+$/);
export const TerminalRequestIdSchema = z.string().regex(/^treq_[A-Za-z0-9_-]+$/);
export const TerminalProfileIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);

export const TerminalProfileKindSchema = z.enum(["shell", "wsl", "custom"]);
export const TerminalProfileSourceSchema = z.enum(["detected", "manual", "config"]);
export const TerminalSessionStatusSchema = z.enum(["starting", "running", "exited", "error", "closed"]);
export const TerminalWorkingDirectoryModeSchema = z.enum(["Downloads/portus-session", "absolute"]);

const NonEmptyStringSchema = z.string().min(1);

export const TerminalProfileCapabilitySchema = z.object({
  portusTabs: z.boolean().default(true),
  shellMultiplexer: z.boolean().default(false),
  externalGuiTabs: z.boolean().default(false)
}).strict();

export const TerminalProfileSchema = z.object({
  profileId: TerminalProfileIdSchema,
  label: NonEmptyStringSchema,
  kind: TerminalProfileKindSchema,
  command: NonEmptyStringSchema,
  args: z.array(z.string()).default([]),
  detected: z.boolean(),
  source: TerminalProfileSourceSchema,
  embeddedPtySupported: z.boolean(),
  capabilities: TerminalProfileCapabilitySchema.default({
    portusTabs: true,
    shellMultiplexer: false,
    externalGuiTabs: false
  })
}).strict().superRefine((value, context) => {
  if (!value.embeddedPtySupported) {
    context.addIssue({
      code: "custom",
      path: ["embeddedPtySupported"],
      message: "terminal profile must support embedded PTY sessions"
    });
  }
  if (value.capabilities.externalGuiTabs) {
    context.addIssue({
      code: "custom",
      path: ["capabilities", "externalGuiTabs"],
      message: "external GUI terminal tabs are not embedded terminal capabilities"
    });
  }
});

export const TerminalStartupCommandSchema = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}, z.string().min(1).nullable().default(DEFAULT_TERMINAL_STARTUP_COMMAND));

export const TerminalSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  defaultProfileId: TerminalProfileIdSchema.default(DEFAULT_TERMINAL_PROFILE_ID),
  manualTerminalPath: z.string().min(1).nullable().default(null),
  startupCommand: TerminalStartupCommandSchema,
  defaultWorkingDirectory: z.string().min(1).default(DEFAULT_TERMINAL_WORKING_DIRECTORY),
  fontSize: z.number().int().min(10).max(24).default(16),
  maxSessions: z.number().int().positive().default(5),
  idleTimeoutMs: z.number().int().positive().default(1800000)
}).strict();

export const TerminalSessionMetadataSchema = z.object({
  terminalId: TerminalIdSchema,
  profileId: TerminalProfileIdSchema,
  title: NonEmptyStringSchema,
  cwd: NonEmptyStringSchema,
  status: TerminalSessionStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
  lastActiveAt: z.string().datetime({ offset: true }),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  exitCode: z.number().int().nullable().optional()
}).strict();

export const TerminalResizePayloadSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive()
}).strict();

export const TerminalOutputChunkSchema = z.object({
  data: z.string().max(TERMINAL_OUTPUT_CHUNK_MAX_LENGTH)
}).strict();

export const TerminalErrorPayloadSchema = z.object({
  code: z.enum(["TERMINAL_UNAVAILABLE", "INVALID_MESSAGE", "PROFILE_NOT_FOUND", "SESSION_NOT_FOUND", "PTY_EXITED", "INTERNAL_ERROR"]),
  message: NonEmptyStringSchema,
  retryable: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional()
}).strict();

export const TerminalCreateSessionPayloadSchema = z.object({
  profileId: TerminalProfileIdSchema.optional(),
  cwd: NonEmptyStringSchema.optional(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  reuseExisting: z.boolean().optional()
}).strict();

export const TerminalSettingsSetPayloadSchema = z.object({
  settings: TerminalSettingsSchema
}).strict();

export const TerminalProfilesListPayloadSchema = z.object({
  profiles: z.array(TerminalProfileSchema)
}).strict();

export const TerminalSessionsListPayloadSchema = z.object({
  sessions: z.array(TerminalSessionMetadataSchema),
  activeTerminalId: TerminalIdSchema.nullable().optional()
}).strict();

export const TerminalClientMessageTypeSchema = z.enum([
  "terminal.settings.get",
  "terminal.settings.set",
  "terminal.profiles.list",
  "terminal.sessions.list",
  "terminal.session.create",
  "terminal.session.attach",
  "terminal.session.detach",
  "terminal.session.input",
  "terminal.session.resize",
  "terminal.session.close"
]);

export const TerminalServerMessageTypeSchema = z.enum([
  "terminal.settings",
  "terminal.profiles",
  "terminal.sessions",
  "terminal.session.created",
  "terminal.session.attached",
  "terminal.session.detached",
  "terminal.session.output",
  "terminal.session.exit",
  "terminal.session.error"
]);

export const TerminalClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("terminal.settings.get"),
    requestId: TerminalRequestIdSchema.optional(),
    payload: z.object({}).strict().default({})
  }).strict(),
  z.object({
    type: z.literal("terminal.settings.set"),
    requestId: TerminalRequestIdSchema.optional(),
    payload: TerminalSettingsSetPayloadSchema
  }).strict(),
  z.object({
    type: z.literal("terminal.profiles.list"),
    requestId: TerminalRequestIdSchema.optional(),
    payload: z.object({}).strict().default({})
  }).strict(),
  z.object({
    type: z.literal("terminal.sessions.list"),
    requestId: TerminalRequestIdSchema.optional(),
    payload: z.object({}).strict().default({})
  }).strict(),
  z.object({
    type: z.literal("terminal.session.create"),
    requestId: TerminalRequestIdSchema.optional(),
    payload: TerminalCreateSessionPayloadSchema
  }).strict(),
  z.object({
    type: z.literal("terminal.session.attach"),
    requestId: TerminalRequestIdSchema.optional(),
    terminalId: TerminalIdSchema,
    payload: z.object({}).strict().default({})
  }).strict(),
  z.object({
    type: z.literal("terminal.session.detach"),
    requestId: TerminalRequestIdSchema.optional(),
    terminalId: TerminalIdSchema,
    payload: z.object({}).strict().default({})
  }).strict(),
  z.object({
    type: z.literal("terminal.session.input"),
    requestId: TerminalRequestIdSchema.optional(),
    terminalId: TerminalIdSchema,
    payload: z.object({ data: z.string().min(1) }).strict()
  }).strict(),
  z.object({
    type: z.literal("terminal.session.resize"),
    requestId: TerminalRequestIdSchema.optional(),
    terminalId: TerminalIdSchema,
    payload: TerminalResizePayloadSchema
  }).strict(),
  z.object({
    type: z.literal("terminal.session.close"),
    requestId: TerminalRequestIdSchema.optional(),
    terminalId: TerminalIdSchema,
    payload: z.object({}).strict().default({})
  }).strict()
]);

export const TerminalServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("terminal.settings"),
    requestId: TerminalRequestIdSchema.optional(),
    payload: z.object({ settings: TerminalSettingsSchema }).strict()
  }).strict(),
  z.object({
    type: z.literal("terminal.profiles"),
    requestId: TerminalRequestIdSchema.optional(),
    payload: TerminalProfilesListPayloadSchema
  }).strict(),
  z.object({
    type: z.literal("terminal.sessions"),
    requestId: TerminalRequestIdSchema.optional(),
    payload: TerminalSessionsListPayloadSchema
  }).strict(),
  z.object({
    type: z.literal("terminal.session.created"),
    requestId: TerminalRequestIdSchema.optional(),
    terminalId: TerminalIdSchema,
    payload: z.object({ session: TerminalSessionMetadataSchema }).strict()
  }).strict(),
  z.object({
    type: z.literal("terminal.session.attached"),
    requestId: TerminalRequestIdSchema.optional(),
    terminalId: TerminalIdSchema,
    payload: z.object({ session: TerminalSessionMetadataSchema }).strict()
  }).strict(),
  z.object({
    type: z.literal("terminal.session.detached"),
    requestId: TerminalRequestIdSchema.optional(),
    terminalId: TerminalIdSchema,
    payload: z.object({}).strict().default({})
  }).strict(),
  z.object({
    type: z.literal("terminal.session.output"),
    requestId: TerminalRequestIdSchema.optional(),
    terminalId: TerminalIdSchema,
    payload: TerminalOutputChunkSchema
  }).strict(),
  z.object({
    type: z.literal("terminal.session.exit"),
    requestId: TerminalRequestIdSchema.optional(),
    terminalId: TerminalIdSchema,
    payload: z.object({ exitCode: z.number().int().nullable() }).strict()
  }).strict(),
  z.object({
    type: z.literal("terminal.session.error"),
    requestId: TerminalRequestIdSchema.optional(),
    terminalId: TerminalIdSchema.optional(),
    payload: TerminalErrorPayloadSchema
  }).strict()
]);

export type TerminalId = z.infer<typeof TerminalIdSchema>;
export type TerminalRequestId = z.infer<typeof TerminalRequestIdSchema>;
export type TerminalProfileId = z.infer<typeof TerminalProfileIdSchema>;
export type TerminalProfileCapability = z.infer<typeof TerminalProfileCapabilitySchema>;
export type TerminalProfile = z.infer<typeof TerminalProfileSchema>;
export type TerminalSettings = z.infer<typeof TerminalSettingsSchema>;
export type TerminalSessionMetadata = z.infer<typeof TerminalSessionMetadataSchema>;
export type TerminalResizePayload = z.infer<typeof TerminalResizePayloadSchema>;
export type TerminalOutputChunk = z.infer<typeof TerminalOutputChunkSchema>;
export type TerminalErrorPayload = z.infer<typeof TerminalErrorPayloadSchema>;
export type TerminalClientMessageType = z.infer<typeof TerminalClientMessageTypeSchema>;
export type TerminalServerMessageType = z.infer<typeof TerminalServerMessageTypeSchema>;
export type TerminalClientMessage = z.infer<typeof TerminalClientMessageSchema>;
export type TerminalServerMessage = z.infer<typeof TerminalServerMessageSchema>;
