#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { z } from "zod";
import { DEFAULT_PORTUS_CONFIG, PortusConfigSchema, TerminalConfigSchema, getSettingsProfilesPath, loadOrCreateBrokerToken, type PortusConfig } from "@portus/config";
import { BrokerEventBus } from "@portus/events";
import {
  BrowserIdSchema,
  BrowserNameSchema,
  BrowserSessionSchema,
  BrokerEventTypeSchema,
  CommandEnvelopeSchema,
  CommandTypeSchema,
  DEFAULT_COMMAND_POLICY,
  DEFAULT_MAX_CUSTOM_SETTINGS_PROFILES,
  DEFAULT_SETTINGS_PROFILE_NAME,
  INITIAL_CUSTOM_SETTINGS_PROFILE_NAME,
  PROTOCOL_VERSION,
  PolicyPreferencesSchema,
  RegistrationRequestSchema,
  RequestEnvelopeSchema,
  SessionStepSchema,
  SettingsProfileCatalogSchema,
  SettingsProfileContentSchema,
  SettingsProfileIdSchema,
  SettingsProfileNameSchema,
  SettingsProfileSchema,
  SettingsProfileStateSchema,
  TabSchema,
  WaitResultSchema,
  createInvalidMessageError,
  createPortusError,
  safeParseProtocolMessage,
  type BrowserName,
  type BrowserSession,
  type CommandEnvelope,
  type CommandType,
  type EventEnvelope,
  type PolicyPreferences,
  type PortusError,
  type RequestEnvelope,
  type ResponseEnvelope,
  type SessionStep,
  type SettingsProfile,
  type SettingsProfileCatalog,
  type SettingsProfileContent,
  type SettingsProfileState
} from "@portus/protocol";
import {
  RecipeRecordSchema,
  RecipeIdSchema,
  listRecipeLibrary,
  recipeInvalid,
  type RecipeLibraryDiagnostic,
  type RecipeRecord
} from "@portus/recipes";
import {
  deserializeTransportFrame,
  resolveBrokerEndpoint,
  serializeTransportFrame,
  type BrokerEndpoint,
  type TransportKind
} from "@portus/transport";

const BrowserListPayloadSchema = z.object({
  includeUnavailable: z.boolean().optional()
}).strict();

const HeartbeatPayloadSchema = z.object({
  browserId: BrowserIdSchema,
  bridgeStatus: z.enum(["connected", "disconnecting", "disconnected", "error"]),
  sentAt: z.string().datetime({ offset: true })
}).strict();

const BridgeDisconnectPayloadSchema = z.object({
  browserId: BrowserIdSchema,
  reason: z.string().optional()
}).strict();

const EventQueryPayloadSchema = z.object({
  browserId: BrowserIdSchema.optional(),
  type: BrokerEventTypeSchema.optional(),
  limit: z.number().int().positive().max(10000).optional()
}).strict();

const EventPublishPayloadSchema = z.object({
  browserId: BrowserIdSchema,
  type: BrokerEventTypeSchema,
  tabId: z.number().int().optional(),
  payload: z.record(z.string(), z.unknown()).default({})
}).strict();

const SessionStepsPayloadSchema = z.object({
  browserId: BrowserIdSchema,
  limit: z.number().int().positive().max(1000).optional()
}).strict();

const TabWaitPayloadSchema = z.object({
  browserId: BrowserIdSchema.optional(),
  tabId: z.number().int(),
  state: z.enum(["loading", "complete"]).optional(),
  urlContains: z.string().min(1).optional()
}).strict();

const PolicySyncPayloadSchema = z.object({
  browserId: BrowserIdSchema,
  policyPreferences: PolicyPreferencesSchema
}).strict();

const SettingsProfileStatePayloadSchema = z.object({
  browserName: BrowserNameSchema
}).strict();

const SettingsProfileSelectPayloadSchema = z.object({
  browserName: BrowserNameSchema,
  profileId: SettingsProfileIdSchema
}).strict();

const SettingsProfileCreatePayloadSchema = z.object({
  browserName: BrowserNameSchema
}).strict();

const SettingsProfileSavePayloadSchema = z.object({
  browserName: BrowserNameSchema,
  profileId: SettingsProfileIdSchema,
  content: SettingsProfileContentSchema
}).strict();

const SettingsProfileRenamePayloadSchema = z.object({
  browserName: BrowserNameSchema,
  profileId: SettingsProfileIdSchema,
  name: SettingsProfileNameSchema
}).strict();

const SettingsProfilesImportPayloadSchema = z.object({
  catalog: SettingsProfileCatalogSchema
}).strict();

const RecipeLibraryPayloadSchema = z.object({
  directory: z.string().min(1).optional()
}).strict();

const RecipeGetPayloadSchema = z.object({
  recipeId: RecipeIdSchema,
  directory: z.string().min(1).optional()
}).strict();

const RecipeSearchPayloadSchema = z.object({
  query: z.string().min(1),
  directory: z.string().min(1).optional()
}).strict();

const RecipeResolvePayloadSchema = z.object({
  query: z.string().min(1),
  directory: z.string().min(1).optional()
}).strict();

const RoutablePayloadSchema = z.object({
  browserId: BrowserIdSchema.optional()
}).passthrough();

const ROUTED_REQUEST_TYPES = new Set([
  "tab.list",
  "tab.get",
  "tab.open",
  "tab.navigate",
  "tab.history.back",
  "tab.history.forward",
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
  "permission.list",
  "permission.request",
  "permission.revoke",
  "policy.get",
  "policy.allow.add",
  "policy.allow.remove",
  "policy.block.add",
  "policy.block.remove",
  "policy.retention.set"
]);

const REQUIRED_CAPABILITY_BY_REQUEST_TYPE = new Map<string, string>([
  ["tab.list", "tabs"],
  ["tab.get", "tabs"],
  ["tab.open", "tabs"],
  ["tab.navigate", "tabs"],
  ["tab.history.back", "tabs"],
  ["tab.history.forward", "tabs"],
  ["tab.wait", "tabs"],
  ["tab.activate", "tabs"],
  ["tab.close", "tabs"],
  ["screenshot.capture", "screenshots"],
  ["snapshot.capture", "snapshots"],
  ["page.wait", "snapshots"],
  ["action.click", "actions"],
  ["action.hover", "actions"],
  ["action.drag", "actions"],
  ["action.fillForm", "actions"],
  ["action.type", "actions"],
  ["action.press", "actions"],
  ["action.scroll", "actions"],
  ["page.dismiss", "actions"],
  ["dialog.dismiss", "advanced-debugger"],
  ["dialog.accept", "advanced-debugger"],
  ["console.list", "actions"],
  ["console.clear", "actions"],
  ["network.list", "actions"],
  ["network.get", "actions"],
  ["permission.list", "permissions"],
  ["permission.request", "permissions"],
  ["permission.revoke", "permissions"],
  ["policy.get", "permissions"],
  ["policy.allow.add", "permissions"],
  ["policy.allow.remove", "permissions"],
  ["policy.block.add", "permissions"],
  ["policy.block.remove", "permissions"],
  ["policy.retention.set", "permissions"]
]);

export interface BrokerBridgeClient {
  sendCommand(command: CommandEnvelope): Promise<Record<string, unknown>>;
  sendOneWayCommand?(command: CommandEnvelope): Promise<void>;
  sendRequest?(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  sendOneWayRequest?(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<void>;
}

export interface BrokerRequestContext {
  bridgeClient?: BrokerBridgeClient;
}

export interface BrokerCoreOptions {
  config?: unknown;
  now?: () => Date;
  recipes?: unknown[];
  recipeLibraryDirectory?: string;
  brokerToken?: string;
  settingsProfilesPath?: string | null;
}

interface BrowserSessionRecord {
  session: BrowserSession;
  bridgeClient?: BrokerBridgeClient;
  policyPreferences: PolicyPreferences;
  sessionSteps: SessionStep[];
}

export class BrokerCore {
  readonly config: PortusConfig;
  readonly endpoint: BrokerEndpoint;
  readonly endpointPath: string;
  readonly pipePath: string;
  readonly events: BrokerEventBus;
  readonly startedAt: string;
  private readonly recipeRecords = new Map<string, RecipeRecord>();
  private readonly recipeLibraryDirectory: string | undefined;
  private readonly brokerToken: string;
  private readonly settingsProfilesPath: string | null;
  private readonly sessions = new Map<string, BrowserSessionRecord>();
  private settingsProfileCatalog: SettingsProfileCatalog;
  private settingsProfileCatalogLoadedFromDisk = false;
  private readonly now: () => Date;
  private nextBrowserNumber = 1;
  private nextCommandNumber = 1;
  private nextSessionStepNumber = 1;

  constructor(options: BrokerCoreOptions = {}) {
    this.config = PortusConfigSchema.parse(options.config ?? DEFAULT_PORTUS_CONFIG);
    this.brokerToken = options.brokerToken ?? (
      this.config.security.requireBrokerToken ? loadOrCreateBrokerToken() : ""
    );
    this.now = options.now ?? (() => new Date());
    this.recipeLibraryDirectory = options.recipeLibraryDirectory;
    this.settingsProfilesPath = options.settingsProfilesPath === undefined ? getSettingsProfilesPath() : options.settingsProfilesPath;
    this.settingsProfileCatalog = this.loadSettingsProfileCatalog();
    for (const recipeInput of options.recipes ?? []) {
      const recipeRecord = RecipeRecordSchema.parse(recipeInput);
      this.recipeRecords.set(recipeRecord.id, recipeRecord);
    }
    this.endpoint = resolveBrokerEndpoint({
      endpointName: this.config.broker.pipeName,
      transport: this.config.broker.transport
    });
    this.endpointPath = this.endpoint.endpointPath;
    this.pipePath = this.endpoint.endpointPath;
    this.startedAt = this.now().toISOString();
    this.events = new BrokerEventBus({
      retentionLimit: this.config.events.retentionLimit,
      now: this.now
    });
  }

  async handleRequest(input: unknown, context: BrokerRequestContext = {}): Promise<ResponseEnvelope> {
    const parsed = safeParseProtocolMessage(RequestEnvelopeSchema, input);
    if (!parsed.ok) {
      return this.createErrorResponse(extractRequestId(input), parsed.error);
    }

    const request = parsed.data;
    const authError = this.validateBrokerAuth(request);
    if (authError) return this.createErrorResponse(request.requestId, authError);
    try {
      const result = await this.dispatchRequest(request, context);
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: request.requestId,
        kind: "response",
        ok: true,
        result
      };
    } catch (error) {
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: request.requestId,
        kind: "response",
        ok: false,
        error: normalizeBrokerError(error)
      };
    }
  }

  private validateBrokerAuth(request: RequestEnvelope): PortusError | null {
    if (!this.config.security.requireBrokerToken) return null;
    const token = request.auth?.brokerToken;
    if (!token) return brokerError("BROKER_TOKEN_REQUIRED", "Broker token is required.", false);
    if (!constantTimeStringEqual(token, this.brokerToken)) {
      return brokerError("BROKER_TOKEN_INVALID", "Broker token is invalid.", false);
    }
    return null;
  }

  listSessions(includeUnavailable = false): BrowserSession[] {
    this.expireStaleSessions();
    const sessions = [...this.sessions.values()].map((record) => record.session);
    if (includeUnavailable) return sessions;
    return sessions.filter((session) => session.status === "available" && session.bridgeStatus === "connected");
  }

  expireStaleSessions(): BrowserSession[] {
    const expired: BrowserSession[] = [];
    const nowMs = this.now().getTime();

    for (const record of this.sessions.values()) {
      if (record.session.status !== "available") continue;
      const heartbeatAgeMs = nowMs - Date.parse(record.session.lastHeartbeat);
      if (heartbeatAgeMs <= this.config.broker.sessionTimeoutMs) continue;

      record.session = BrowserSessionSchema.parse({
        ...record.session,
        status: "expired",
        bridgeStatus: "disconnected"
      });
      record.sessionSteps = [];
      expired.push(record.session);
      this.events.publish({
        type: "session.expired",
        browserId: record.session.browserId,
        payload: {
          browserId: record.session.browserId,
          lastHeartbeat: record.session.lastHeartbeat
        }
      });
      this.events.publish({
        type: "bridge.recovery.required",
        browserId: record.session.browserId,
        payload: {
          browserId: record.session.browserId,
          reason: "heartbeat-timeout",
          lastHeartbeat: record.session.lastHeartbeat
        }
      });
    }

    return expired;
  }

  subscribeEvents(subscriber: (event: EventEnvelope) => void): () => void {
    return this.events.subscribe(subscriber);
  }

  private async dispatchRequest(request: RequestEnvelope, context: BrokerRequestContext): Promise<Record<string, unknown>> {
    switch (request.type) {
      case "browser.list": {
        const payload = BrowserListPayloadSchema.parse(request.payload);
        return { browsers: this.listSessions(payload.includeUnavailable ?? false) };
      }
      case "broker.status":
        return this.getBrokerStatus();
      case "broker.stop":
        return {
          stopping: true,
          transport: this.endpoint.transport,
          endpointPath: this.endpointPath,
          endpointName: this.endpoint.endpointName,
          pipePath: this.pipePath,
          pipeName: this.config.broker.pipeName
        };
      case "bridge.register":
        return this.registerBridge(request, context);
      case "bridge.heartbeat":
        return this.acceptHeartbeat(request);
      case "bridge.disconnect":
        return this.disconnectBridge(request, context);
      case "policy.sync":
        return this.syncPolicyPreferences(request);
      case "settings.profile.state":
        return this.getSettingsProfileState(request);
      case "settings.profile.select":
        return await this.selectSettingsProfile(request);
      case "settings.profile.create":
        return await this.createSettingsProfile(request);
      case "settings.profile.save":
        return await this.saveSettingsProfile(request);
      case "settings.profile.reset":
        return await this.resetSettingsProfile(request);
      case "settings.profile.rename":
        return await this.renameSettingsProfile(request);
      case "settings.profile.delete":
        return await this.deleteSettingsProfile(request);
      case "settings.profiles.export":
        return { catalog: this.settingsProfileCatalog };
      case "settings.profiles.import":
        return await this.importSettingsProfiles(request);
      case "event.publish":
        return this.publishExtensionEvent(request, context);
      case "event.subscribe":
        return this.subscribeEventStream(request);
      case "events.recent":
        return this.listRecentEvents(request);
      case "session.steps":
        return this.listSessionSteps(request);
      case "tab.wait":
        return this.waitForTab(request);
      case "recipe.list":
        return this.listRecipes(request);
      case "recipe.get":
        return this.getRecipe(request);
      case "recipe.search":
        return this.searchRecipes(request);
      case "recipe.resolve":
        return this.resolveRecipe(request);
      default:
        if (ROUTED_REQUEST_TYPES.has(request.type)) return this.routeCommand(request);
        throw invalidMessage(`Unsupported broker request type: ${request.type}`);
    }
  }

  private getBrokerStatus(): Record<string, unknown> {
    return {
      running: true,
      transport: this.endpoint.transport,
      endpointPath: this.endpointPath,
      endpointName: this.endpoint.endpointName,
      pipePath: this.pipePath,
      pipeName: this.config.broker.pipeName,
      startedAt: this.startedAt,
      protocolVersion: PROTOCOL_VERSION,
      processId: process.pid
    };
  }

  private registerBridge(request: RequestEnvelope, context: BrokerRequestContext): Record<string, unknown> {
    const registration = RegistrationRequestSchema.parse(request.payload);
    this.maybeInitializeSettingsProfilesFromRegistration(
      registration.settingsProfileContent
        ?? (registration.policyPreferences
          ? SettingsProfileContentSchema.parse({
            ...this.defaultSettingsProfileContent(),
            policyPreferences: registration.policyPreferences
          })
          : undefined)
    );
    const browserId = this.createBrowserId();
    const now = this.now().toISOString();
    const settingsProfiles = this.createSettingsProfileState(registration.browserName);
    const session = BrowserSessionSchema.parse({
      browserId,
      browserName: registration.browserName,
      extensionVersion: registration.extensionVersion,
      connectedAt: now,
      lastHeartbeat: now,
      capabilities: registration.capabilities,
      bridgeStatus: "connected",
      status: "available",
      browserLabel: registration.browserLabel,
      profileLabel: registration.profileLabel,
      extensionId: registration.extensionId
    });

    const policyPreferences = PolicyPreferencesSchema.parse(settingsProfiles.content.policyPreferences);
    this.sessions.set(browserId, context.bridgeClient === undefined
      ? { session, policyPreferences, sessionSteps: [] }
      : { session, bridgeClient: context.bridgeClient, policyPreferences, sessionSteps: [] });

    this.events.publish({
      type: "bridge.connected",
      browserId,
      requestId: request.requestId,
      payload: {
        browserId,
        browserName: session.browserName
      }
    });
    this.events.publish({
      type: "session.registered",
      browserId,
      requestId: request.requestId,
      payload: {
        session,
        policyPreferences
      }
    });

    return {
      browserId,
      heartbeatIntervalMs: this.config.broker.heartbeatIntervalMs,
      settingsProfiles
    };
  }

  private acceptHeartbeat(request: RequestEnvelope): Record<string, unknown> {
    const payload = HeartbeatPayloadSchema.parse(request.payload);
    const record = this.sessions.get(payload.browserId);
    if (!record || record.session.status !== "available") {
      throw brokerError("BROWSER_SESSION_UNAVAILABLE", "Browser session is unavailable.", true);
    }

    record.session = BrowserSessionSchema.parse({
      ...record.session,
      bridgeStatus: payload.bridgeStatus,
      lastHeartbeat: this.now().toISOString(),
      status: payload.bridgeStatus === "connected" ? "available" : "unavailable"
    });

    return {
      accepted: true,
      serverTime: this.now().toISOString()
    };
  }

  private async disconnectBridge(request: RequestEnvelope, context: BrokerRequestContext): Promise<Record<string, unknown>> {
    const payload = BridgeDisconnectPayloadSchema.parse(request.payload);
    const record = this.sessions.get(payload.browserId);
    if (!record) {
      throw brokerError("BROWSER_SESSION_UNAVAILABLE", "Browser session is unavailable.", true);
    }

    const source = context.bridgeClient && context.bridgeClient === record.bridgeClient ? "extension" : "cli";
    if (source === "cli") {
      this.enforceCommandPolicy("bridge.disconnect", record);
      if (!record.bridgeClient) {
        throw brokerError("NATIVE_HOST_UNAVAILABLE", "No active native host connection is available for this browser session.", true);
      }
      const command = CommandEnvelopeSchema.parse({
        commandId: this.createCommandId(),
        type: "bridge.disconnect",
        args: {
          browserId: payload.browserId,
          reason: payload.reason ?? "cli-requested"
        },
        targetBrowserId: payload.browserId,
        timeoutMs: request.timeoutMs
      });
      if (record.bridgeClient.sendOneWayCommand) {
        await record.bridgeClient.sendOneWayCommand(command);
      } else {
        void record.bridgeClient.sendCommand(command).catch(() => undefined);
      }
    }

    record.session = BrowserSessionSchema.parse({
      ...record.session,
      bridgeStatus: "disconnected",
      status: "unavailable"
    });
    record.sessionSteps = [];

    this.events.publish({
      type: "bridge.disconnected",
      browserId: payload.browserId,
      requestId: request.requestId,
      payload: {
        browserId: payload.browserId,
        reason: payload.reason ?? (source === "cli" ? "cli-requested" : "requested"),
        source,
        reconnect: "extension-ui-only"
      }
    });

    return { disconnected: true };
  }

  private syncPolicyPreferences(request: RequestEnvelope): Record<string, unknown> {
    const payload = PolicySyncPayloadSchema.parse(request.payload);
    const record = this.sessions.get(payload.browserId);
    if (!record || record.session.status !== "available" || record.session.bridgeStatus !== "connected") {
      throw brokerError("BROWSER_SESSION_UNAVAILABLE", "Browser session is unavailable.", true);
    }
    record.policyPreferences = payload.policyPreferences;
    this.events.publish({
      type: "policy.changed",
      browserId: payload.browserId,
      requestId: request.requestId,
      payload: {
        browserId: payload.browserId,
        source: "extension",
        policyMode: payload.policyPreferences.policyMode,
        allowedOrigins: payload.policyPreferences.allowedOrigins.length,
        blockedOrigins: payload.policyPreferences.blockedOrigins.length,
        sessionStepRetentionLimit: payload.policyPreferences.sessionStepRetentionLimit
      }
    });
    return { policy: record.policyPreferences };
  }

  private getSettingsProfileState(request: RequestEnvelope): Record<string, unknown> {
    const payload = SettingsProfileStatePayloadSchema.parse(request.payload);
    return {
      settingsProfiles: this.createSettingsProfileState(payload.browserName)
    };
  }

  private async selectSettingsProfile(request: RequestEnvelope): Promise<Record<string, unknown>> {
    const payload = SettingsProfileSelectPayloadSchema.parse(request.payload);
    this.requireSettingsProfile(payload.profileId);
    this.settingsProfileCatalog = SettingsProfileCatalogSchema.parse({
      ...this.settingsProfileCatalog,
      activeProfileByBrowserType: {
        ...this.settingsProfileCatalog.activeProfileByBrowserType,
        [payload.browserName]: payload.profileId
      }
    });
    this.persistSettingsProfileCatalog();
    await this.alignBrowserTypeToActiveProfile(payload.browserName, "settings.profile.apply-selection");
    return {
      settingsProfiles: this.createSettingsProfileState(payload.browserName)
    };
  }

  private async createSettingsProfile(request: RequestEnvelope): Promise<Record<string, unknown>> {
    const payload = SettingsProfileCreatePayloadSchema.parse(request.payload);
    const customCount = this.countCustomSettingsProfiles();
    if (customCount >= this.settingsProfileCatalog.maxCustomProfiles) {
      throw brokerError("CONFIG_INVALID", "The maximum number of settings profiles has been reached.", false);
    }
    const now = this.now().toISOString();
    const name = this.nextSettingsProfileName();
    const profile = SettingsProfileSchema.parse({
      profileId: this.nextSettingsProfileId(name),
      name,
      builtIn: false,
      readOnly: false,
      content: this.defaultSettingsProfileContent(),
      createdAt: now,
      updatedAt: now
    });
    this.settingsProfileCatalog = SettingsProfileCatalogSchema.parse({
      ...this.settingsProfileCatalog,
      profiles: [...this.settingsProfileCatalog.profiles, profile],
      activeProfileByBrowserType: {
        ...this.settingsProfileCatalog.activeProfileByBrowserType,
        [payload.browserName]: profile.profileId
      }
    });
    this.persistSettingsProfileCatalog();
    await this.alignBrowserTypeToActiveProfile(payload.browserName, "settings.profile.apply-selection");
    return {
      settingsProfiles: this.createSettingsProfileState(payload.browserName)
    };
  }

  private async saveSettingsProfile(request: RequestEnvelope): Promise<Record<string, unknown>> {
    const payload = SettingsProfileSavePayloadSchema.parse(request.payload);
    const profile = this.requireSettingsProfile(payload.profileId);
    if (profile.readOnly) {
      throw brokerError("CONFIG_INVALID", `${profile.name} is read-only.`, false);
    }
    this.updateSettingsProfileContent(payload.profileId, payload.content);
    this.persistSettingsProfileCatalog();
    await this.alignProfileContent(payload.profileId, "settings.profile.apply-saved-content");
    return {
      settingsProfiles: this.createSettingsProfileState(payload.browserName)
    };
  }

  private async resetSettingsProfile(request: RequestEnvelope): Promise<Record<string, unknown>> {
    const payload = SettingsProfileSelectPayloadSchema.parse(request.payload);
    const profile = this.requireSettingsProfile(payload.profileId);
    if (profile.readOnly) {
      return {
        settingsProfiles: this.createSettingsProfileState(payload.browserName)
      };
    }
    this.updateSettingsProfileContent(payload.profileId, this.defaultSettingsProfileContent());
    this.persistSettingsProfileCatalog();
    await this.alignProfileContent(payload.profileId, "settings.profile.apply-saved-content");
    return {
      settingsProfiles: this.createSettingsProfileState(payload.browserName)
    };
  }

  private async renameSettingsProfile(request: RequestEnvelope): Promise<Record<string, unknown>> {
    const payload = SettingsProfileRenamePayloadSchema.parse({
      ...request.payload,
      name: typeof request.payload.name === "string" ? request.payload.name.trim() : request.payload.name
    });
    const profile = this.requireSettingsProfile(payload.profileId);
    if (profile.readOnly) {
      throw brokerError("CONFIG_INVALID", `${profile.name} is read-only.`, false);
    }
    const duplicate = this.settingsProfileCatalog.profiles.find((candidate) => (
      candidate.profileId !== payload.profileId && candidate.name === payload.name
    ));
    if (duplicate) {
      throw brokerError("CONFIG_INVALID", "Settings profile names must be unique.", false);
    }
    this.updateSettingsProfileName(payload.profileId, payload.name);
    this.persistSettingsProfileCatalog();
    await this.alignSettingsProfileMetadata();
    return {
      settingsProfiles: this.createSettingsProfileState(payload.browserName)
    };
  }

  private async deleteSettingsProfile(request: RequestEnvelope): Promise<Record<string, unknown>> {
    const payload = SettingsProfileSelectPayloadSchema.parse(request.payload);
    const profile = this.requireSettingsProfile(payload.profileId);
    if (profile.readOnly) {
      throw brokerError("CONFIG_INVALID", `${profile.name} is read-only.`, false);
    }
    const remainingCustomProfiles = this.settingsProfileCatalog.profiles.filter((candidate) => (
      !candidate.readOnly && candidate.profileId !== payload.profileId
    ));
    if (remainingCustomProfiles.length === 0) {
      throw brokerError("CONFIG_INVALID", "At least one custom settings profile is required.", false);
    }

    const activeBeforeByBrowserName = new Map<BrowserName, string>();
    for (const record of this.sessions.values()) {
      if (record.session.status !== "available" || record.session.bridgeStatus !== "connected") continue;
      if (!activeBeforeByBrowserName.has(record.session.browserName)) {
        activeBeforeByBrowserName.set(record.session.browserName, this.activeSettingsProfile(record.session.browserName).profileId);
      }
    }

    const fallbackProfileId = remainingCustomProfiles[0]!.profileId;
    this.settingsProfileCatalog = SettingsProfileCatalogSchema.parse({
      ...this.settingsProfileCatalog,
      profiles: this.settingsProfileCatalog.profiles.filter((candidate) => candidate.profileId !== payload.profileId),
      activeProfileByBrowserType: Object.fromEntries(Object.entries(this.settingsProfileCatalog.activeProfileByBrowserType).map(([browserName, profileId]) => [
        browserName,
        profileId === payload.profileId ? fallbackProfileId : profileId
      ]))
    });
    this.persistSettingsProfileCatalog();
    await this.alignSettingsProfileCatalogAfterDelete(payload.profileId, activeBeforeByBrowserName);
    return {
      settingsProfiles: this.createSettingsProfileState(payload.browserName)
    };
  }

  private async importSettingsProfiles(request: RequestEnvelope): Promise<Record<string, unknown>> {
    const payload = SettingsProfilesImportPayloadSchema.parse(request.payload);
    const catalog = this.normalizeSettingsProfileCatalog(payload.catalog);
    this.validateSettingsProfileCatalog(catalog);
    this.settingsProfileCatalog = catalog;
    this.persistSettingsProfileCatalog();
    await this.alignAllActiveSettingsProfiles();
    return { catalog: this.settingsProfileCatalog };
  }

  private maybeInitializeSettingsProfilesFromRegistration(content: SettingsProfileContent | undefined): void {
    if (this.settingsProfileCatalogLoadedFromDisk || content === undefined) return;
    const initialProfile = this.initialCustomSettingsProfile();
    if (!initialProfile) return;
    this.updateSettingsProfileContent(initialProfile.profileId, content);
    this.persistSettingsProfileCatalog();
    this.settingsProfileCatalogLoadedFromDisk = true;
  }

  private createSettingsProfileState(browserName: BrowserName): SettingsProfileState {
    const activeProfile = this.activeSettingsProfile(browserName);
    return SettingsProfileStateSchema.parse({
      profiles: this.settingsProfileCatalog.profiles.map((profile) => ({
        profileId: profile.profileId,
        name: profile.name,
        builtIn: profile.builtIn,
        readOnly: profile.readOnly
      })),
      activeProfileId: activeProfile.profileId,
      activeProfileName: activeProfile.name,
      activeProfileReadOnly: activeProfile.readOnly,
      dirty: false,
      autoSave: activeProfile.content.autoSave,
      canCreateProfile: this.countCustomSettingsProfiles() < this.settingsProfileCatalog.maxCustomProfiles,
      maxCustomProfiles: this.settingsProfileCatalog.maxCustomProfiles,
      content: activeProfile.content
    });
  }

  private activeSettingsProfile(browserName: BrowserName): SettingsProfile {
    const selectedProfileId = this.settingsProfileCatalog.activeProfileByBrowserType[browserName];
    if (selectedProfileId) {
      const selectedProfile = this.settingsProfileCatalog.profiles.find((profile) => profile.profileId === selectedProfileId);
      if (selectedProfile) return selectedProfile;
    }
    return this.initialCustomSettingsProfile()
      ?? this.settingsProfileCatalog.profiles.find((profile) => !profile.readOnly)
      ?? this.settingsProfileCatalog.profiles[0] as SettingsProfile;
  }

  private initialCustomSettingsProfile(): SettingsProfile | undefined {
    return this.settingsProfileCatalog.profiles.find((profile) => profile.name === INITIAL_CUSTOM_SETTINGS_PROFILE_NAME);
  }

  private requireSettingsProfile(profileId: string): SettingsProfile {
    const profile = this.settingsProfileCatalog.profiles.find((candidate) => candidate.profileId === profileId);
    if (!profile) throw brokerError("CONFIG_INVALID", "Settings profile was not found.", false);
    return profile;
  }

  private updateSettingsProfileContent(profileId: string, content: SettingsProfileContent): void {
    const parsedContent = SettingsProfileContentSchema.parse({
      ...content,
      terminalPreferences: TerminalConfigSchema.parse(content.terminalPreferences)
    });
    let found = false;
    const now = this.now().toISOString();
    this.settingsProfileCatalog = SettingsProfileCatalogSchema.parse({
      ...this.settingsProfileCatalog,
      profiles: this.settingsProfileCatalog.profiles.map((profile) => {
        if (profile.profileId !== profileId) return profile;
        found = true;
        return SettingsProfileSchema.parse({
          ...profile,
          content: parsedContent,
          updatedAt: now
        });
      })
    });
    if (!found) throw brokerError("CONFIG_INVALID", "Settings profile was not found.", false);
  }

  private updateSettingsProfileName(profileId: string, name: string): void {
    let found = false;
    const now = this.now().toISOString();
    this.settingsProfileCatalog = SettingsProfileCatalogSchema.parse({
      ...this.settingsProfileCatalog,
      profiles: this.settingsProfileCatalog.profiles.map((profile) => {
        if (profile.profileId !== profileId) return profile;
        found = true;
        return SettingsProfileSchema.parse({
          ...profile,
          name,
          updatedAt: now
        });
      })
    });
    if (!found) throw brokerError("CONFIG_INVALID", "Settings profile was not found.", false);
  }

  private async alignBrowserTypeToActiveProfile(browserName: BrowserName, type: string): Promise<void> {
    const state = this.createSettingsProfileState(browserName);
    await Promise.all([...this.sessions.values()]
      .filter((record) => record.session.browserName === browserName)
      .filter((record) => record.session.status === "available" && record.session.bridgeStatus === "connected")
      .map(async (record) => {
        record.policyPreferences = PolicyPreferencesSchema.parse(state.content.policyPreferences);
        await this.sendSettingsProfileUpdate(record, type, state);
      }));
  }

  private async alignSettingsProfileMetadata(): Promise<void> {
    const states = new Map<BrowserName, SettingsProfileState>();
    await Promise.all([...this.sessions.values()]
      .filter((record) => record.session.status === "available" && record.session.bridgeStatus === "connected")
      .map(async (record) => {
        let state = states.get(record.session.browserName);
        if (!state) {
          state = this.createSettingsProfileState(record.session.browserName);
          states.set(record.session.browserName, state);
        }
        await this.sendSettingsProfileUpdate(record, "settings.profile.apply-metadata", state);
      }));
  }

  private async alignSettingsProfileCatalogAfterDelete(deletedProfileId: string, activeBeforeByBrowserName: Map<BrowserName, string>): Promise<void> {
    const states = new Map<BrowserName, SettingsProfileState>();
    await Promise.all([...this.sessions.values()]
      .filter((record) => record.session.status === "available" && record.session.bridgeStatus === "connected")
      .map(async (record) => {
        let state = states.get(record.session.browserName);
        if (!state) {
          state = this.createSettingsProfileState(record.session.browserName);
          states.set(record.session.browserName, state);
        }
        const activeProfileChanged = activeBeforeByBrowserName.get(record.session.browserName) === deletedProfileId;
        if (activeProfileChanged) {
          record.policyPreferences = PolicyPreferencesSchema.parse(state.content.policyPreferences);
          await this.sendSettingsProfileUpdate(record, "settings.profile.apply-selection", state);
          return;
        }
        await this.sendSettingsProfileUpdate(record, "settings.profile.apply-metadata", state);
      }));
  }

  private async alignProfileContent(profileId: string, type: string): Promise<void> {
    const states = new Map<BrowserName, SettingsProfileState>();
    await Promise.all([...this.sessions.values()]
      .filter((record) => record.session.status === "available" && record.session.bridgeStatus === "connected")
      .filter((record) => this.activeSettingsProfile(record.session.browserName).profileId === profileId)
      .map(async (record) => {
        let state = states.get(record.session.browserName);
        if (!state) {
          state = this.createSettingsProfileState(record.session.browserName);
          states.set(record.session.browserName, state);
        }
        record.policyPreferences = PolicyPreferencesSchema.parse(state.content.policyPreferences);
        await this.sendSettingsProfileUpdate(record, type, state);
      }));
  }

  private async alignAllActiveSettingsProfiles(): Promise<void> {
    const states = new Map<BrowserName, SettingsProfileState>();
    await Promise.all([...this.sessions.values()]
      .filter((record) => record.session.status === "available" && record.session.bridgeStatus === "connected")
      .map(async (record) => {
        let state = states.get(record.session.browserName);
        if (!state) {
          state = this.createSettingsProfileState(record.session.browserName);
          states.set(record.session.browserName, state);
        }
        record.policyPreferences = PolicyPreferencesSchema.parse(state.content.policyPreferences);
        await this.sendSettingsProfileUpdate(record, "settings.profile.apply-selection", state);
      }));
  }

  private async sendSettingsProfileUpdate(record: BrowserSessionRecord, type: string, state: SettingsProfileState): Promise<void> {
    if (!record.bridgeClient) return;
    const payload = { settingsProfiles: state };
    try {
      if (record.bridgeClient.sendOneWayRequest) {
        await record.bridgeClient.sendOneWayRequest(type, payload);
        return;
      }
      if (record.bridgeClient.sendRequest) {
        await record.bridgeClient.sendRequest(type, payload);
      }
    } catch {
      // A stale bridge should not prevent the Broker from saving profile state.
    }
  }

  private loadSettingsProfileCatalog(): SettingsProfileCatalog {
    if (this.settingsProfilesPath === null) return this.defaultSettingsProfileCatalog();
    if (!existsSync(this.settingsProfilesPath)) return this.defaultSettingsProfileCatalog();

    try {
      const raw = readFileSync(this.settingsProfilesPath, "utf8");
      const parsed = this.normalizeSettingsProfileCatalog(SettingsProfileCatalogSchema.parse(JSON.parse(raw)));
      this.validateSettingsProfileCatalog(parsed);
      this.settingsProfileCatalogLoadedFromDisk = true;
      return parsed;
    } catch {
      return this.defaultSettingsProfileCatalog();
    }
  }

  private persistSettingsProfileCatalog(): void {
    if (this.settingsProfilesPath === null) return;
    mkdirSync(dirname(this.settingsProfilesPath), { recursive: true });
    writeFileSync(this.settingsProfilesPath, `${JSON.stringify(this.settingsProfileCatalog, null, 2)}\n`, "utf8");
  }

  private defaultSettingsProfileCatalog(): SettingsProfileCatalog {
    const now = this.now().toISOString();
    const defaultContent = this.defaultSettingsProfileContent();
    return SettingsProfileCatalogSchema.parse({
      version: 1,
      maxCustomProfiles: DEFAULT_MAX_CUSTOM_SETTINGS_PROFILES,
      profiles: [
        {
          profileId: "profile_default",
          name: DEFAULT_SETTINGS_PROFILE_NAME,
          builtIn: true,
          readOnly: true,
          content: defaultContent,
          createdAt: now,
          updatedAt: now
        },
        {
          profileId: this.profileIdForName(INITIAL_CUSTOM_SETTINGS_PROFILE_NAME),
          name: INITIAL_CUSTOM_SETTINGS_PROFILE_NAME,
          builtIn: false,
          readOnly: false,
          content: defaultContent,
          createdAt: now,
          updatedAt: now
        }
      ],
      activeProfileByBrowserType: {}
    });
  }

  private defaultSettingsProfileContent(): SettingsProfileContent {
    return SettingsProfileContentSchema.parse({
      policyPreferences: this.defaultPolicyPreferences(),
      terminalPreferences: TerminalConfigSchema.parse(this.config.terminal),
      autoSave: true
    });
  }

  private normalizeSettingsProfileCatalog(catalog: SettingsProfileCatalog): SettingsProfileCatalog {
    return SettingsProfileCatalogSchema.parse({
      ...catalog,
      profiles: catalog.profiles.map((profile) => {
        if (profile.name !== DEFAULT_SETTINGS_PROFILE_NAME) {
          return {
            ...profile,
            content: SettingsProfileContentSchema.parse({
              ...profile.content,
              terminalPreferences: TerminalConfigSchema.parse(profile.content.terminalPreferences)
            })
          };
        }
        return {
          ...profile,
          content: this.defaultSettingsProfileContent()
        };
      })
    });
  }

  private validateSettingsProfileCatalog(catalog: SettingsProfileCatalog): void {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const profile of catalog.profiles) {
      if (ids.has(profile.profileId)) throw brokerError("CONFIG_INVALID", "Settings profile ids must be unique.", false);
      if (names.has(profile.name)) throw brokerError("CONFIG_INVALID", "Settings profile names must be unique.", false);
      ids.add(profile.profileId);
      names.add(profile.name);
    }
    const defaultProfile = catalog.profiles.find((profile) => profile.name === DEFAULT_SETTINGS_PROFILE_NAME);
    if (!defaultProfile || !defaultProfile.builtIn || !defaultProfile.readOnly) {
      throw brokerError("CONFIG_INVALID", `${DEFAULT_SETTINGS_PROFILE_NAME} must exist and be read-only.`, false);
    }
    for (const profile of catalog.profiles) {
      TerminalConfigSchema.parse(profile.content.terminalPreferences);
    }
    const customCount = catalog.profiles.filter((profile) => !profile.readOnly).length;
    if (customCount === 0) {
      throw brokerError("CONFIG_INVALID", "At least one custom settings profile is required.", false);
    }
    if (customCount > catalog.maxCustomProfiles) {
      throw brokerError("CONFIG_INVALID", "Settings profile count exceeds the configured maximum.", false);
    }
    for (const profileId of Object.values(catalog.activeProfileByBrowserType)) {
      if (!profileId || ids.has(profileId)) continue;
      throw brokerError("CONFIG_INVALID", "Active settings profile selection references a missing profile.", false);
    }
  }

  private countCustomSettingsProfiles(): number {
    return this.settingsProfileCatalog.profiles.filter((profile) => !profile.readOnly).length;
  }

  private nextSettingsProfileName(): string {
    const names = new Set(this.settingsProfileCatalog.profiles.map((profile) => profile.name));
    for (let index = 1; index <= this.settingsProfileCatalog.maxCustomProfiles + 1; index += 1) {
      const name = `Profile_${index}`;
      if (!names.has(name)) return name;
    }
    return `Profile_${this.settingsProfileCatalog.profiles.length + 1}`;
  }

  private nextSettingsProfileId(name: string): string {
    const ids = new Set(this.settingsProfileCatalog.profiles.map((profile) => profile.profileId));
    const base = this.profileIdForName(name);
    if (!ids.has(base)) return base;
    for (let index = 2; index <= this.settingsProfileCatalog.maxCustomProfiles + 2; index += 1) {
      const candidate = SettingsProfileIdSchema.parse(`${base}_${index}`);
      if (!ids.has(candidate)) return candidate;
    }
    return SettingsProfileIdSchema.parse(`${base}_${this.now().getTime().toString(36)}`);
  }

  private profileIdForName(name: string): string {
    const suffix = name
      .replace(/^Profile_/i, "")
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return SettingsProfileIdSchema.parse(`profile_${suffix || "custom"}`);
  }

  private subscribeEventStream(request: RequestEnvelope): Record<string, unknown> {
    const payload = EventQueryPayloadSchema.parse(request.payload);
    this.enforceSelectionCommandPolicy("event.subscribe", payload.browserId);
    return { subscribed: true };
  }

  private publishExtensionEvent(request: RequestEnvelope, context: BrokerRequestContext): Record<string, unknown> {
    const payload = EventPublishPayloadSchema.parse(request.payload);
    const record = this.sessions.get(payload.browserId);
    if (!record || record.session.status !== "available" || record.session.bridgeStatus !== "connected") {
      throw brokerError("BROWSER_SESSION_UNAVAILABLE", "Browser session is unavailable.", true);
    }
    if (!context.bridgeClient || context.bridgeClient !== record.bridgeClient) {
      throw brokerError("BROKER_TOKEN_INVALID", "Only the connected Portus Bridge may publish browser events.", false);
    }

    const event = this.events.publish({
      type: payload.type,
      browserId: payload.browserId,
      tabId: payload.tabId,
      requestId: request.requestId,
      payload: {
        ...payload.payload,
        browserId: payload.browserId,
        source: "extension"
      }
    });
    return { published: true, event };
  }

  private listRecentEvents(request: RequestEnvelope): Record<string, unknown> {
    const payload = EventQueryPayloadSchema.parse(request.payload);
    this.enforceSelectionCommandPolicy("events.recent", payload.browserId);
    const events = this.events.list()
      .filter((event) => this.eventMatchesQuery(event, payload))
      .slice(-(payload.limit ?? this.config.events.retentionLimit));
    return { events };
  }

  private listSessionSteps(request: RequestEnvelope): Record<string, unknown> {
    const payload = SessionStepsPayloadSchema.parse(request.payload);
    const record = this.resolveTargetSession(payload.browserId);
    this.enforceCommandPolicy("session.steps", record);
    const steps = record.sessionSteps.slice(-(payload.limit ?? record.policyPreferences.sessionStepRetentionLimit));
    return { steps };
  }

  private async listRecipes(request: RequestEnvelope): Promise<Record<string, unknown>> {
    const payload = RecipeLibraryPayloadSchema.parse(request.payload);
    this.enforceCommandPolicyIfSessionsAvailable("recipe.list");
    const library = await this.loadRecipeRecords(payload.directory);
    return {
      ...(library.directory === undefined ? {} : { directory: library.directory }),
      recipes: library.recipes.map((entry) => summarizeRecipeRecord(entry.recipe, entry.richSchemaOk, entry.issues)),
      diagnostics: library.diagnostics
    };
  }

  private async getRecipe(request: RequestEnvelope): Promise<Record<string, unknown>> {
    const payload = RecipeGetPayloadSchema.parse(request.payload);
    this.enforceCommandPolicyIfSessionsAvailable("recipe.get");
    const library = await this.loadRecipeRecords(payload.directory);
    const entry = library.recipes.find((value) => value.recipe.id === payload.recipeId);
    if (!entry) {
      throw recipeInvalid(`Recipe ${payload.recipeId} is not available.`, {
        recipeId: payload.recipeId
      });
    }

    return {
      recipe: entry.recipe,
      richSchemaOk: entry.richSchemaOk,
      issues: entry.issues,
      diagnostics: library.diagnostics
    };
  }

  private async searchRecipes(request: RequestEnvelope): Promise<Record<string, unknown>> {
    const payload = RecipeSearchPayloadSchema.parse(request.payload);
    this.enforceCommandPolicyIfSessionsAvailable("recipe.search");
    const query = payload.query.toLocaleLowerCase();
    const library = await this.loadRecipeRecords(payload.directory);
    const matches = library.recipes
      .filter((entry) => recipeMatchesQuery(entry.recipe, query))
      .map((entry) => summarizeRecipeRecord(entry.recipe, entry.richSchemaOk, entry.issues));

    return {
      recipes: matches,
      diagnostics: library.diagnostics
    };
  }

  private async resolveRecipe(request: RequestEnvelope): Promise<Record<string, unknown>> {
    const payload = RecipeResolvePayloadSchema.parse(request.payload);
    this.enforceCommandPolicyIfSessionsAvailable("recipe.resolve");
    const query = payload.query.toLocaleLowerCase();
    const library = await this.loadRecipeRecords(payload.directory);
    const exact = library.recipes.find((entry) => entry.recipe.id.toLocaleLowerCase() === query);
    const matches = exact === undefined
      ? library.recipes.filter((entry) => recipeMatchesQuery(entry.recipe, query))
      : [exact];

    if (matches.length !== 1) {
      throw recipeInvalid(matches.length === 0 ? "No recipe matched the requested query." : "Recipe query is ambiguous.", {
        query: payload.query,
        matches: matches.map((entry) => summarizeRecipeRecord(entry.recipe, entry.richSchemaOk, entry.issues))
      });
    }

    const entry = matches[0] as { recipe: RecipeRecord; richSchemaOk: boolean; issues: Array<{ severity: "error" | "warning"; path: string; message: string }> };
    return {
      recipe: entry.recipe,
      richSchemaOk: entry.richSchemaOk,
      issues: entry.issues,
      diagnostics: library.diagnostics
    };
  }

  private async loadRecipeRecords(directoryOverride?: string): Promise<{
    directory?: string;
    recipes: Array<{ recipe: RecipeRecord; richSchemaOk: boolean; issues: Array<{ severity: "error" | "warning"; path: string; message: string }> }>;
    diagnostics: RecipeLibraryDiagnostic[];
  }> {
    const directory = directoryOverride ?? this.recipeLibraryDirectory;
    if (directory !== undefined) {
      const library = await listRecipeLibrary({ directory });
      return {
        directory: library.directory,
        recipes: library.recipes,
        diagnostics: library.diagnostics
      };
    }

    return {
      recipes: [...this.recipeRecords.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((recipe) => ({
          recipe,
          richSchemaOk: RecipeRecordSchema.safeParse(recipe).success && "intent" in recipe,
          issues: "content" in recipe
            ? [{
              severity: "warning" as const,
              path: "",
              message: "Recipe is management-valid but does not match the preferred structured workflow schema."
            }]
            : []
        })),
      diagnostics: []
    };
  }

  private async waitForTab(request: RequestEnvelope): Promise<Record<string, unknown>> {
    this.expireStaleSessions();
    const payload = TabWaitPayloadSchema.parse(request.payload);
    if (payload.state === undefined && payload.urlContains === undefined) {
      throw invalidMessage("tab.wait requires --state or --url-contains.");
    }
    const record = this.resolveTargetSession(payload.browserId);
    this.enforceCommandPolicy("tab.wait", record);
    if (!record.session.capabilities.includes("tabs" as never)) {
      throw brokerError("CAPABILITY_UNAVAILABLE", "Browser session does not support tabs.", false);
    }
    if (!record.bridgeClient) {
      throw brokerError("NATIVE_HOST_UNAVAILABLE", "No active native host connection is available for this browser session.", true);
    }

    const timeoutMs = request.timeoutMs ?? this.config.commands.timeoutMs;
    const command = CommandEnvelopeSchema.parse({
      commandId: this.createCommandId(),
      type: "tab.get",
      args: {
        browserId: record.session.browserId,
        tabId: payload.tabId
      },
      targetBrowserId: record.session.browserId,
      targetTabId: payload.tabId,
      timeoutMs
    });

    const condition = tabWaitCondition(payload);

    try {
      const wait = await new Promise<Record<string, unknown>>((resolve, reject) => {
        let settled = false;
        let unsubscribe = (): void => undefined;
        const finish = (callback: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubscribe();
          callback();
        };
        const timer = setTimeout(() => {
          finish(() => reject(createPortusError({
            code: "COMMAND_TIMEOUT",
            message: `Timed out waiting for tab ${payload.tabId}.`,
            retryable: true,
            details: { browserId: record.session.browserId, tabId: payload.tabId, condition }
          })));
        }, timeoutMs);
        unsubscribe = this.events.subscribe((event) => {
          if (!eventMatchesTabWait(event, record.session.browserId, payload)) return;
          finish(() => resolve(WaitResultSchema.parse({
            browserId: record.session.browserId,
            tabId: payload.tabId,
            matched: true,
            source: "broker-event",
            condition,
            completedAt: this.now().toISOString(),
            eventId: event.eventId,
            ...tabWaitEventDetails(event)
          })));
        });

        void withBrokerTimeout(record.bridgeClient!.sendCommand(command), command)
          .then((result) => {
            const tab = readTabFromResult(result);
            if (!tabMatchesWait(tab, payload)) return;
            finish(() => resolve(WaitResultSchema.parse({
              browserId: record.session.browserId,
              tabId: payload.tabId,
              matched: true,
              source: "current-tab",
              condition,
              completedAt: this.now().toISOString(),
              url: tab.url,
              title: tab.title
            })));
          })
          .catch((error) => finish(() => reject(error)));
      });
      this.recordSessionStep(record, request, "completed");
      return { wait };
    } catch (error) {
      const portusError = normalizeBrokerError(error);
      this.recordSessionStep(record, request, "failed", portusError);
      throw portusError;
    }
  }

  private async routeCommand(request: RequestEnvelope): Promise<Record<string, unknown>> {
    this.expireStaleSessions();
    const payload = RoutablePayloadSchema.parse(request.payload);
    const record = this.resolveTargetSession(payload.browserId);
    const commandType = CommandTypeSchema.parse(request.type);
    this.enforceCommandPolicy(commandType, record);
    const requiredCapability = REQUIRED_CAPABILITY_BY_REQUEST_TYPE.get(request.type);
    if (requiredCapability && !record.session.capabilities.includes(requiredCapability as never)) {
      throw brokerError("CAPABILITY_UNAVAILABLE", `Browser session does not support ${requiredCapability}.`, false);
    }
    if (!record.bridgeClient) {
      throw brokerError("NATIVE_HOST_UNAVAILABLE", "No active native host connection is available for this browser session.", true);
    }
    try {
      this.enforcePolicyBeforeRoute(request.type, request.payload, record);
    } catch (error) {
      const portusError = normalizeBrokerError(error);
      if (portusError.code === "ORIGIN_BLOCKED") {
        this.publishOriginBlocked(request, record, portusError);
        this.recordSessionStep(record, request, "blocked", portusError);
      }
      throw portusError;
    }

    const command = CommandEnvelopeSchema.parse({
      commandId: this.createCommandId(),
      type: request.type,
      args: request.payload,
      targetBrowserId: record.session.browserId,
      targetTabId: typeof request.payload.tabId === "number" ? request.payload.tabId : undefined,
      timeoutMs: request.timeoutMs ?? this.config.commands.timeoutMs
    });

    if (request.type.startsWith("action.")) {
      this.events.publish({
        type: "action.started",
        browserId: record.session.browserId,
        tabId: command.targetTabId,
        requestId: request.requestId,
        payload: {
          browserId: record.session.browserId,
          tabId: command.targetTabId,
          commandId: command.commandId,
          action: request.type
        }
      });
    }

    try {
      const result = await withBrokerTimeout(record.bridgeClient.sendCommand(command), command);
      this.syncPolicyResult(record, result);
      this.publishRoutedSuccessEvents(request, record, command, result);
      this.recordSessionStep(record, request, "completed");
      if (request.type.startsWith("action.")) {
        this.events.publish({
          type: "action.completed",
          browserId: record.session.browserId,
          tabId: command.targetTabId,
          requestId: request.requestId,
          payload: {
            browserId: record.session.browserId,
            tabId: command.targetTabId,
            commandId: command.commandId,
            action: request.type
          }
        });
      }
      return result;
    } catch (error) {
      const portusError = normalizeBrokerError(error);
      if (portusError.code === "PERMISSION_REQUIRED") {
        this.events.publish({
          type: "permission.required",
          browserId: record.session.browserId,
          tabId: command.targetTabId,
          requestId: request.requestId,
          payload: {
            browserId: record.session.browserId,
            tabId: command.targetTabId,
            commandId: command.commandId,
            commandType: request.type,
            origin: readErrorOrigin(portusError)
          }
        });
      }
      if (portusError.code === "ORIGIN_BLOCKED") this.publishOriginBlocked(request, record, portusError);
      this.recordSessionStep(record, request, portusError.code === "ORIGIN_BLOCKED" ? "blocked" : "failed", portusError);
      if (request.type.startsWith("action.")) {
        this.events.publish({
          type: "action.failed",
          browserId: record.session.browserId,
          tabId: command.targetTabId,
          requestId: request.requestId,
          payload: {
            browserId: record.session.browserId,
            tabId: command.targetTabId,
            commandId: command.commandId,
            action: request.type,
            error: portusError
          }
        });
      }
      throw portusError;
    }
  }

  private resolveTargetSession(browserId: string | undefined): BrowserSessionRecord {
    if (browserId) {
      const record = this.sessions.get(browserId);
      if (!record || record.session.status !== "available" || record.session.bridgeStatus !== "connected") {
        throw brokerError("BROWSER_SESSION_UNAVAILABLE", "Browser session is unavailable.", true);
      }
      return record;
    }

    const available = [...this.sessions.values()]
      .filter((record) => record.session.status === "available" && record.session.bridgeStatus === "connected")
      .sort((a, b) => Date.parse(a.session.connectedAt) - Date.parse(b.session.connectedAt));

    if (available.length === 0) {
      throw brokerError("BROWSER_SESSION_UNAVAILABLE", "No bridge-connected browser is available.", true);
    }
    if (available.length === 1) return available[0] as BrowserSessionRecord;

    const strategy = this.config.sessions.defaultTargetStrategy;
    if (strategy === "newest") return available[available.length - 1] as BrowserSessionRecord;
    if (strategy === "oldest" || strategy === "preferred") return available[0] as BrowserSessionRecord;
    throw brokerError("TARGET_NOT_FOUND", "Multiple bridge-connected browsers are available; specify a browser target.", false);
  }

  eventMatchesSubscription(event: EventEnvelope, query: unknown): boolean {
    const payload = EventQueryPayloadSchema.parse(query);
    if (!this.eventMatchesQuery(event, payload)) return false;
    if (!event.browserId) return true;
    const record = this.sessions.get(event.browserId);
    if (!record || record.session.status !== "available" || record.session.bridgeStatus !== "connected") return false;
    return record.policyPreferences.commandPolicy["event.subscribe"] !== false;
  }

  private eventMatchesQuery(event: EventEnvelope, query: z.infer<typeof EventQueryPayloadSchema>): boolean {
    if (query.browserId && event.browserId !== query.browserId) return false;
    if (query.type && event.type !== query.type) return false;
    return true;
  }

  private enforceSelectionCommandPolicy(type: CommandType, browserId: string | undefined): void {
    this.expireStaleSessions();
    if (browserId) {
      this.enforceCommandPolicy(type, this.resolveTargetSession(browserId));
      return;
    }

    const available = [...this.sessions.values()]
      .filter((record) => record.session.status === "available" && record.session.bridgeStatus === "connected");
    if (available.length === 0) {
      throw brokerError("BROWSER_SESSION_UNAVAILABLE", "No bridge-connected browser is available.", true);
    }
    for (const record of available) this.enforceCommandPolicy(type, record);
  }

  private enforceCommandPolicyIfSessionsAvailable(type: CommandType): void {
    this.expireStaleSessions();
    const available = [...this.sessions.values()]
      .filter((record) => record.session.status === "available" && record.session.bridgeStatus === "connected");
    for (const record of available) this.enforceCommandPolicy(type, record);
  }

  private enforcePolicyBeforeRoute(type: string, payload: Record<string, unknown>, record: BrowserSessionRecord): void {
    if (type !== "tab.open" && type !== "tab.navigate") return;
    const url = payload.url;
    if (typeof url !== "string") return;
    const origin = originFromUrl(url);
    if (!origin) return;
    enforcePolicyForOrigin(origin, record.policyPreferences);
  }

  private enforceCommandPolicy(type: CommandType, record: BrowserSessionRecord): void {
    if (record.policyPreferences.commandPolicy[type] !== false) return;
    throw brokerError("COMMAND_DISABLED_BY_POLICY", `Portus policy disables command ${type}.`, false);
  }

  private syncPolicyResult(record: BrowserSessionRecord, result: Record<string, unknown>): void {
    const parsed = PolicyPreferencesSchema.safeParse(result.policy);
    if (parsed.success) record.policyPreferences = parsed.data;
  }

  private publishRoutedSuccessEvents(
    request: RequestEnvelope,
    record: BrowserSessionRecord,
    command: CommandEnvelope,
    result: Record<string, unknown>
  ): void {
    if (request.type === "tab.open" && isRecord(result.tab)) {
      this.events.publish({
        type: "tab.created",
        browserId: record.session.browserId,
        tabId: readOptionalNumberFromRecord(result.tab, "tabId"),
        requestId: request.requestId,
        payload: {
          browserId: record.session.browserId,
          tab: redactTabLike(result.tab, this.config.logging.redactUrls, this.config.logging.redactTitles)
        }
      });
    }
    if (request.type === "tab.navigate" && isRecord(result.tab)) {
      this.events.publish({
        type: "tab.updated",
        browserId: record.session.browserId,
        tabId: readOptionalNumberFromRecord(result.tab, "tabId"),
        requestId: request.requestId,
        payload: {
          browserId: record.session.browserId,
          tab: redactTabLike(result.tab, this.config.logging.redactUrls, this.config.logging.redactTitles)
        }
      });
    }
    if ((request.type === "tab.history.back" || request.type === "tab.history.forward") && isRecord(result.tab)) {
      this.events.publish({
        type: "tab.updated",
        browserId: record.session.browserId,
        tabId: readOptionalNumberFromRecord(result.tab, "tabId"),
        requestId: request.requestId,
        payload: {
          browserId: record.session.browserId,
          direction: request.type === "tab.history.back" ? "back" : "forward",
          tab: redactTabLike(result.tab, this.config.logging.redactUrls, this.config.logging.redactTitles)
        }
      });
    }
    if (request.type === "tab.activate" && isRecord(result.tab)) {
      this.events.publish({
        type: "tab.activated",
        browserId: record.session.browserId,
        tabId: readOptionalNumberFromRecord(result.tab, "tabId"),
        requestId: request.requestId,
        payload: {
          browserId: record.session.browserId,
          tab: redactTabLike(result.tab, this.config.logging.redactUrls, this.config.logging.redactTitles)
        }
      });
    }
    if (request.type === "tab.close") {
      this.events.publish({
        type: "tab.closed",
        browserId: record.session.browserId,
        tabId: command.targetTabId,
        requestId: request.requestId,
        payload: {
          browserId: record.session.browserId,
          tabId: command.targetTabId
        }
      });
    }
    if (request.type.startsWith("action.") && isRecord(result.action) && result.action.snapshotInvalidated === true) {
      this.events.publish({
        type: "snapshot.invalidated",
        browserId: record.session.browserId,
        tabId: command.targetTabId,
        requestId: request.requestId,
        payload: {
          browserId: record.session.browserId,
          tabId: command.targetTabId,
          commandId: command.commandId,
          reason: request.type
        }
      });
    }
    if (request.type.startsWith("policy.") && isRecord(result.policy)) {
      this.events.publish({
        type: "policy.changed",
        browserId: record.session.browserId,
        requestId: request.requestId,
        payload: {
          browserId: record.session.browserId,
          commandType: request.type
        }
      });
    }
    if (request.type === "permission.request" || request.type === "permission.revoke") {
      this.events.publish({
        type: "permission.changed",
        browserId: record.session.browserId,
        requestId: request.requestId,
        payload: {
          browserId: record.session.browserId,
          commandType: request.type
        }
      });
    }
  }

  private publishOriginBlocked(request: RequestEnvelope, record: BrowserSessionRecord, error: PortusError): void {
    this.events.publish({
      type: "origin.blocked",
      browserId: record.session.browserId,
      requestId: request.requestId,
      payload: {
        browserId: record.session.browserId,
        commandType: request.type,
        origin: readErrorOrigin(error)
      }
    });
  }

  private recordSessionStep(
    record: BrowserSessionRecord,
    request: RequestEnvelope,
    status: "completed" | "failed" | "blocked",
    error?: PortusError
  ): void {
    const limit = record.policyPreferences.sessionStepRetentionLimit;
    if (limit <= 0) return;
    const commandType = CommandTypeSchema.safeParse(request.type);
    if (!commandType.success) return;
    const payload = isRecord(request.payload) ? request.payload : {};
    const step = SessionStepSchema.parse({
      stepId: this.createSessionStepId(),
      browserId: record.session.browserId,
      commandType: commandType.data,
      status,
      createdAt: this.now().toISOString(),
      requestId: request.requestId,
      tabId: typeof payload.tabId === "number" ? payload.tabId : undefined,
      origin: originFromPayload(payload),
      url: redactUrlFromPayload(payload, this.config.logging.redactUrls),
      args: redactStepArgs(commandType.data, payload, this.config.logging.redactUrls),
      error
    });
    record.sessionSteps.push(step);
    while (record.sessionSteps.length > limit) record.sessionSteps.shift();
    this.events.publish({
      type: "session.step.recorded",
      browserId: record.session.browserId,
      tabId: step.tabId,
      requestId: request.requestId,
      payload: {
        stepId: step.stepId,
        browserId: step.browserId,
        commandType: step.commandType,
        status: step.status
      }
    });
  }

  private defaultPolicyPreferences(): PolicyPreferences {
    const now = this.now().toISOString();
    return PolicyPreferencesSchema.parse({
      policyMode: this.config.permissions.defaultPolicyMode,
      allowedOrigins: this.config.permissions.defaultAllowlist.map((origin) => ({
        origin,
        source: "config",
        updatedAt: now
      })),
      blockedOrigins: this.config.permissions.defaultBlocklist.map((origin) => ({
        origin,
        source: "config",
        updatedAt: now
      })),
      commandPolicy: {
        ...DEFAULT_COMMAND_POLICY,
        ...this.config.permissions.defaultCommandPolicy
      },
      sessionStepRetentionLimit: this.config.permissions.sessionStepRetentionLimit
    });
  }

  private createBrowserId(): string {
    return `br_${String(this.nextBrowserNumber++).padStart(6, "0")}`;
  }

  private createCommandId(): string {
    return `cmd_${String(this.nextCommandNumber++).padStart(6, "0")}`;
  }

  private createSessionStepId(): string {
    return `step_${String(this.nextSessionStepNumber++).padStart(6, "0")}`;
  }

  private createErrorResponse(requestId: string, error: PortusError): ResponseEnvelope {
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      kind: "response",
      ok: false,
      error
    };
  }
}

export function createBroker(options: BrokerCoreOptions = {}): BrokerCore {
  return new BrokerCore(options);
}

export class BrokerNamedPipeServer {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private started = false;

  constructor(readonly broker: BrokerCore) {
    this.server = createServer((socket) => {
      this.handleSocket(socket);
    });
  }

  async start(): Promise<void> {
    if (this.started) return Promise.resolve();
    await this.prepareEndpoint();
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        this.started = true;
        resolve();
      };

      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.broker.endpointPath);
    });
  }

  stop(): Promise<void> {
    if (!this.started) return Promise.resolve();
    for (const socket of this.sockets) socket.end();
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        this.started = false;
        const cleanupError = this.cleanupEndpoint();
        if (cleanupError) {
          reject(cleanupError);
          return;
        }
        resolve();
      });
    });
  }

  private async prepareEndpoint(): Promise<void> {
    if (this.broker.endpoint.transport !== "unix-socket") return;

    mkdirSync(dirname(this.broker.endpointPath), { recursive: true, mode: 0o700 });
    if (!existsSync(this.broker.endpointPath)) return;
    if (await canConnectToEndpoint(this.broker.endpointPath)) return;

    try {
      unlinkSync(this.broker.endpointPath);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }

  private cleanupEndpoint(): Error | undefined {
    if (this.broker.endpoint.transport !== "unix-socket") return undefined;

    try {
      unlinkSync(this.broker.endpointPath);
      return undefined;
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  private handleSocket(socket: Socket): void {
    let buffer = "";
    const bridgeClient = new SocketBridgeClient(socket, this.broker.endpoint.transport);
    const subscriptions = new Set<() => void>();
    this.sockets.add(socket);
    socket.once("close", () => {
      this.sockets.delete(socket);
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.clear();
      bridgeClient.rejectAllPending(brokerError("NATIVE_HOST_UNAVAILABLE", "Native host connection closed while commands were pending.", true));
    });
    socket.once("error", () => {
      bridgeClient.rejectAllPending(brokerError("NATIVE_HOST_UNAVAILABLE", "Native host connection failed while commands were pending.", true));
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        this.handleFrame(line, socket, bridgeClient, subscriptions);
        newlineIndex = buffer.indexOf("\n");
      }
    });
  }

  private async handleFrame(
    line: string,
    socket: Socket,
    bridgeClient: SocketBridgeClient,
    subscriptions: Set<() => void>
  ): Promise<void> {
    try {
      const frame = deserializeTransportFrame(line);
      if (bridgeClient.acceptFrame(frame.message)) return;
      if (frame.message.kind !== "request") return;
      const response = await this.broker.handleRequest(frame.message, { bridgeClient });
      socket.write(serializeTransportFrame(response, this.broker.endpoint.transport), () => {
        if (frame.message.kind === "request" && frame.message.type === "broker.stop" && response.ok) {
          socket.end();
          void this.stop().catch(() => undefined);
        }
      });
      if (response.ok && frame.message.type === "event.subscribe") {
        const query = frame.message.payload;
        const unsubscribe = this.broker.subscribeEvents((event) => {
          if (!this.broker.eventMatchesSubscription(event, query)) return;
          socket.write(serializeTransportFrame(event, this.broker.endpoint.transport));
        });
        subscriptions.add(unsubscribe);
      }
    } catch (error) {
      const response = createErrorResponse("req_invalid", normalizeBrokerError(invalidMessage(
        error instanceof Error ? error.message : "Invalid transport frame."
      )));
      socket.write(serializeTransportFrame(response, this.broker.endpoint.transport));
    }
  }
}

function canConnectToEndpoint(endpointPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(endpointPath);
    let settled = false;
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(connected);
    };

    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

class SocketBridgeClient implements BrokerBridgeClient {
  private readonly pending = new Map<string, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (reason: PortusError) => void;
  }>();
  private nextRequestNumber = 1;

  constructor(private readonly socket: Socket, private readonly transport: TransportKind) {}

  sendCommand(command: CommandEnvelope): Promise<Record<string, unknown>> {
    const requestId = command.commandId.replace(/^cmd_/, "req_");
    const request = RequestEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      kind: "request",
      type: command.type,
      payload: command.args,
      timeoutMs: command.timeoutMs
    });

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.socket.write(serializeTransportFrame(request, this.transport), (error) => {
        if (error) {
          this.pending.delete(requestId);
          reject(brokerError("NATIVE_HOST_UNAVAILABLE", "Failed to write command to native host connection.", true));
        }
      });
    });
  }

  sendOneWayCommand(command: CommandEnvelope): Promise<void> {
    const requestId = command.commandId.replace(/^cmd_/, "req_");
    const request = RequestEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      kind: "request",
      type: command.type,
      payload: command.args,
      timeoutMs: command.timeoutMs
    });

    return new Promise((resolve, reject) => {
      this.socket.write(serializeTransportFrame(request, this.transport), (error) => {
        if (error) {
          reject(brokerError("NATIVE_HOST_UNAVAILABLE", "Failed to write command to native host connection.", true));
          return;
        }
        resolve();
      });
    });
  }

  sendRequest(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>> {
    const request = this.createRequest(type, payload, timeoutMs);
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
      this.socket.write(serializeTransportFrame(request, this.transport), (error) => {
        if (error) {
          this.pending.delete(request.requestId);
          reject(brokerError("NATIVE_HOST_UNAVAILABLE", "Failed to write request to native host connection.", true));
        }
      });
    });
  }

  sendOneWayRequest(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<void> {
    const request = this.createRequest(type, payload, timeoutMs);
    return new Promise((resolve, reject) => {
      this.socket.write(serializeTransportFrame(request, this.transport), (error) => {
        if (error) {
          reject(brokerError("NATIVE_HOST_UNAVAILABLE", "Failed to write request to native host connection.", true));
          return;
        }
        resolve();
      });
    });
  }

  private createRequest(type: string, payload: Record<string, unknown>, timeoutMs?: number): RequestEnvelope {
    return RequestEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: `req_bridge_${this.nextRequestNumber++}`,
      kind: "request",
      type,
      payload,
      timeoutMs
    });
  }

  acceptFrame(message: RequestEnvelope | ResponseEnvelope | EventEnvelope): boolean {
    if (message.kind !== "response") return false;
    const pending = this.pending.get(message.requestId);
    if (!pending) return false;
    this.pending.delete(message.requestId);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(message.error);
    return true;
  }

  rejectAllPending(error: PortusError): void {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      pending.reject(error);
    }
  }
}

export function createBrokerNamedPipeServer(options: BrokerCoreOptions = {}): BrokerNamedPipeServer {
  return new BrokerNamedPipeServer(createBroker(options));
}

export async function startBrokerCli(): Promise<void> {
  const server = createBrokerNamedPipeServer();
  await server.start();
  process.stdout.write(`Portus Broker listening on ${server.broker.endpointPath}\n`);

  let stopping = false;
  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`Portus Broker received ${signal}; shutting down.\n`);
    await server.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    void stop("SIGTERM");
  });
}

export function brokerError(code: PortusError["code"], message: string, retryable?: boolean): PortusError {
  return createPortusError({
    code,
    message,
    retryable
  });
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function invalidMessage(message: string): PortusError {
  return createInvalidMessageError({ reason: message });
}

function createOkResponse(requestId: string, result: Record<string, unknown>): ResponseEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    kind: "response",
    ok: true,
    result
  };
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

function summarizeRecipeRecord(
  recipe: RecipeRecord,
  richSchemaOk: boolean,
  issues: Array<{ severity: "error" | "warning"; path: string; message: string }>
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

function recipeMatchesQuery(recipe: RecipeRecord, query: string): boolean {
  const examples = "examples" in recipe && Array.isArray(recipe.examples) ? recipe.examples : [];
  const searchable = [
    recipe.id,
    recipe.name,
    "kind" in recipe ? recipe.kind : undefined,
    "description" in recipe ? recipe.description : undefined,
    "intent" in recipe ? recipe.intent : undefined,
    "notes" in recipe ? recipe.notes : undefined,
    ...examples,
    "content" in recipe && typeof recipe.content === "string" ? recipe.content : undefined
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLocaleLowerCase();

  return searchable.includes(query);
}

function normalizeBrokerError(error: unknown): PortusError {
  if (isPortusError(error)) return error;
  if (isNodeListenAddressInUseError(error)) {
    return brokerError(
      "BROKER_UNAVAILABLE",
      "Portus Broker is already running on the configured named pipe. Stop the existing Broker before starting another one.",
      true
    );
  }
  if (error instanceof z.ZodError) {
    return createInvalidMessageError({
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }
  return brokerError("INTERNAL_ERROR", "Unexpected broker failure.", false);
}

function isNodeListenAddressInUseError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "EADDRINUSE";
}

function enforcePolicyForOrigin(origin: string, policy: PolicyPreferences): void {
  if (policy.originPolicyEnabled === false) return;
  if (policy.policyMode === "blocklist") {
    if (policy.blockedOrigins.some((entry) => policyOriginMatches(entry.origin, origin))) {
      throw createPortusError({
        code: "ORIGIN_BLOCKED",
        message: `Portus policy blocks browser control for ${origin}.`,
        retryable: false,
        details: { origin }
      });
    }
    return;
  }
  if (policy.allowedOrigins.some((entry) => policyOriginMatches(entry.origin, origin))) return;
  throw createPortusError({
    code: "ORIGIN_BLOCKED",
    message: `Portus policy does not allow browser control for ${origin}.`,
    retryable: false,
    details: { origin }
  });
}

function policyOriginMatches(pattern: string, origin: string): boolean {
  if (pattern === origin) return true;
  const wildcard = pattern.toLowerCase().match(/^(?:(https?):\/\/)?\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/);
  if (!wildcard) return false;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (wildcard[1] && parsed.protocol !== `${wildcard[1]}:`) return false;
  const suffix = wildcard[2];
  const host = parsed.hostname.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`);
}

function readErrorOrigin(error: PortusError): string | undefined {
  if (isRecord(error.details) && typeof error.details.origin === "string") return error.details.origin;
  return undefined;
}

function readOptionalNumberFromRecord(record: Record<string, unknown>, key: string): number | undefined {
  return typeof record[key] === "number" ? record[key] : undefined;
}

function redactTabLike(record: Record<string, unknown>, redactUrls: boolean, redactTitles: boolean): Record<string, unknown> {
  return {
    ...record,
    ...(redactUrls && typeof record.url === "string" ? { url: "[redacted-url]" } : {}),
    ...(redactTitles && typeof record.title === "string" ? { title: "[redacted-title]" } : {})
  };
}

function originFromPayload(payload: Record<string, unknown>): string | undefined {
  const url = typeof payload.url === "string" ? payload.url : undefined;
  return url === undefined ? undefined : originFromUrl(url) ?? undefined;
}

function redactUrlFromPayload(payload: Record<string, unknown>, redactUrls: boolean): string | undefined {
  if (typeof payload.url !== "string") return undefined;
  return redactUrls ? "[redacted-url]" : payload.url;
}

function redactStepArgs(type: CommandType, payload: Record<string, unknown>, redactUrls: boolean): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "text") {
      args.text = "[redacted-text]";
      if (typeof value === "string") args.textLength = value.length;
      continue;
    }
    if (key === "fields" && Array.isArray(value)) {
      args.fields = value.map((field) => {
        if (!isRecord(field)) return { value: "[redacted-text]" };
        return {
          ...field,
          value: "[redacted-text]",
          valueLength: typeof field.value === "string" ? field.value.length : undefined
        };
      });
      continue;
    }
    if (key === "url" && typeof value === "string" && redactUrls) {
      args.url = "[redacted-url]";
      continue;
    }
    if (key === "screenshot" || key === "snapshot" || key === "data" || key === "clipboard") continue;
    args[key] = value;
  }
  if (type === "action.type" && args.text === undefined) args.text = "[redacted-text]";
  return args;
}

function originFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function withBrokerTimeout(
  operation: Promise<Record<string, unknown>>,
  command: CommandEnvelope
): Promise<Record<string, unknown>> {
  if (command.timeoutMs === undefined) return operation;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createPortusError({
        code: "COMMAND_TIMEOUT",
        message: `Broker command timed out after ${command.timeoutMs}ms.`,
        retryable: true,
        details: {
          commandId: command.commandId,
          type: command.type,
          timeoutMs: command.timeoutMs
        }
      }));
    }, command.timeoutMs);

    operation.then((result) => {
      clearTimeout(timer);
      resolve(result);
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function isPortusError(error: unknown): error is PortusError {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && "message" in error;
}

function tabWaitCondition(payload: z.infer<typeof TabWaitPayloadSchema>): Record<string, unknown> {
  const condition: Record<string, unknown> = {};
  if (payload.state !== undefined) condition.state = payload.state;
  if (payload.urlContains !== undefined) condition.urlContains = payload.urlContains;
  return condition;
}

function readTabFromResult(result: Record<string, unknown>): z.infer<typeof TabSchema> {
  const parsed = TabSchema.safeParse(result.tab);
  if (!parsed.success) {
    throw createPortusError({
      code: "INVALID_MESSAGE",
      message: "tab.get returned an invalid tab result."
    });
  }
  return parsed.data;
}

function tabMatchesWait(tab: z.infer<typeof TabSchema>, payload: z.infer<typeof TabWaitPayloadSchema>): boolean {
  if (tab.tabId !== payload.tabId) return false;
  if (payload.state !== undefined && tab.status !== payload.state) return false;
  if (payload.urlContains !== undefined && !tab.url.includes(payload.urlContains)) return false;
  return true;
}

function eventMatchesTabWait(event: EventEnvelope, browserId: string, payload: z.infer<typeof TabWaitPayloadSchema>): boolean {
  if (event.type !== "tab.updated" && event.type !== "tab.created" && event.type !== "tab.activated") return false;
  if (event.browserId !== browserId) return false;
  if (event.tabId !== undefined && event.tabId !== payload.tabId) return false;
  const eventTab = readOptionalRecordFromRecord(event.payload, "tab");
  const eventTabId = eventTab ? readOptionalNumberFromRecord(eventTab, "tabId") : readOptionalNumberFromRecord(event.payload, "tabId");
  if (eventTabId !== undefined && eventTabId !== payload.tabId) return false;
  if (event.tabId === undefined && eventTabId === undefined) return false;
  if (payload.state !== undefined) {
    const status = eventTab ? readOptionalStringFromRecord(eventTab, "status") : readOptionalStringFromRecord(event.payload, "status");
    if (status !== payload.state) return false;
  }
  if (payload.urlContains !== undefined) {
    const url = eventTab ? readOptionalStringFromRecord(eventTab, "url") : readOptionalStringFromRecord(event.payload, "url");
    if (!url || !url.includes(payload.urlContains)) return false;
  }
  return true;
}

function tabWaitEventDetails(event: EventEnvelope): Record<string, unknown> {
  const tab = readOptionalRecordFromRecord(event.payload, "tab");
  const details: Record<string, unknown> = {};
  const url = tab ? readOptionalStringFromRecord(tab, "url") : readOptionalStringFromRecord(event.payload, "url");
  const title = tab ? readOptionalStringFromRecord(tab, "title") : readOptionalStringFromRecord(event.payload, "title");
  if (url !== undefined) details.url = url;
  if (title !== undefined) details.title = title;
  return details;
}

function readOptionalRecordFromRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function readOptionalStringFromRecord(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractRequestId(input: unknown): string {
  if (typeof input === "object" && input !== null && "requestId" in input && typeof input.requestId === "string") {
    return input.requestId;
  }
  return "req_invalid";
}

export const portusBrokerApp = {
  name: "portus-broker",
  packageName: "@portus/broker",
  phase: "broker-core"
} as const;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startBrokerCli().catch((error: unknown) => {
    const normalized = normalizeBrokerError(error);
    process.stderr.write(`${normalized.code}: ${normalized.message}\n`);
    process.exit(1);
  });
}
