import {
  ActionResultSchema,
  ActionRequestSchema,
  CommandTypeSchema,
  ConsoleListResultSchema,
  DEFAULT_COMMAND_POLICY,
  DEFAULT_MAX_CUSTOM_SETTINGS_PROFILES,
  DEFAULT_SETTINGS_PROFILE_NAME,
  DialogResultSchema,
  DismissKindSchema,
  DismissStrategySchema,
  ExtensionUxPreferencesSchema,
  FillFormRequestSchema,
  FillFormResultSchema,
  IconClickBehaviorSchema,
  INITIAL_CUSTOM_SETTINGS_PROFILE_NAME,
  NetworkGetResultSchema,
  NetworkListResultSchema,
  PROTOCOL_VERSION,
  PolicyOriginEntrySchema,
  PolicyModeSchema,
  PolicyPreferencesSchema,
  PortusErrorSchema,
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  ScreenshotResultSchema,
  SettingsProfileCatalogSchema,
  SettingsProfileContentSchema,
  SettingsProfileNameSchema,
  SettingsProfileStateSchema,
  SidePanelDefaultViewSchema,
  SnapshotFilterSchema,
  SnapshotSchema,
  TabSchema,
  WaitResultSchema,
  createPortusError,
  type ActionResult,
  type BrowserName,
  type BrowserSession,
  type CommandType,
  type DismissKind,
  type DismissResult,
  type DismissStrategy,
  type ExtensionUxPreferences,
  type IconClickBehavior,
  type PortusError,
  type PolicyOriginEntry,
  type PolicyMode,
  type PolicyPreferences,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ScreenshotResult,
  type SettingsProfileCatalog,
  type SettingsProfileContent,
  type SettingsProfileState,
  type Snapshot,
  type SnapshotFilter,
  type SnapshotElement,
  type Tab
} from "@portus/protocol";
import {
  TERMINAL_NATIVE_HOST_NAME,
  TerminalClientMessageSchema,
  TerminalServerMessageSchema,
  TerminalSettingsSchema,
  type TerminalClientMessage,
  type TerminalServerMessage,
  type TerminalSettings
} from "@portus/terminal";
import { PermissionRecordSchema, type PermissionRecord } from "@portus/permissions";
import { createDomActionResult, markSnapshotsStaleForTab, resolveActionElement, type SnapshotStoreEntry } from "@portus/actions";
import { buildSnapshot, createSnapshotId, filterSnapshot, type SnapshotElementCandidate } from "@portus/snapshots";

export type BridgeState = "disconnected" | "connecting" | "connected" | "disconnecting" | "error";
export type NativeHostState = "disconnected" | "connecting" | "connected" | "error";
export type TerminalNativeHostState = NativeHostState;
export type BrokerState = "unknown" | "connected" | "unavailable" | "error";
export type PermissionState = "unknown" | "granted" | "missing" | "requested" | "denied" | "error";

export interface PortusNativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: ChromeEvent<(message: unknown) => void>;
  onDisconnect: ChromeEvent<() => void>;
}

export interface ChromeEvent<TListener extends (...args: any[]) => unknown> {
  addListener(listener: TListener): void;
  removeListener?(listener: TListener): void;
}

export interface PortusRuntimePort {
  name: string;
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: ChromeEvent<(message: unknown) => void>;
  onDisconnect: ChromeEvent<() => void>;
}

export interface ChromeTab {
  id?: number;
  windowId: number;
  index: number;
  active: boolean;
  pinned?: boolean;
  discarded?: boolean;
  title?: string;
  url?: string;
  favIconUrl?: string;
  status?: string;
}

export interface ChromeTabChangeInfo {
  status?: string;
  title?: string;
  url?: string;
  favIconUrl?: string;
  pinned?: boolean;
  discarded?: boolean;
}

export interface ChromeTabActiveInfo {
  tabId: number;
  windowId: number;
}

export interface ChromeTabRemoveInfo {
  windowId: number;
  isWindowClosing: boolean;
}

export interface ChromeWindow {
  id?: number;
  focused?: boolean;
  state?: string;
  type?: string;
  incognito?: boolean;
}

export interface PortusChromeApi {
  runtime: {
    id?: string;
    lastError?: { message?: string };
    connectNative(hostName: string): PortusNativePort;
    onConnect?: ChromeEvent<(port: PortusRuntimePort) => void>;
    onMessage?: ChromeEvent<(
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void
    ) => boolean | void>;
  };
  tabs: {
    query(queryInfo: Record<string, unknown>): Promise<ChromeTab[]> | void;
    get(tabId: number): Promise<ChromeTab> | void;
    create(createProperties: Record<string, unknown>): Promise<ChromeTab> | void;
    update(tabId: number, updateProperties: Record<string, unknown>): Promise<ChromeTab> | void;
    remove(tabId: number): Promise<void> | void;
    captureVisibleTab(windowId?: number, options?: Record<string, unknown>): Promise<string> | void;
    onCreated?: ChromeEvent<(tab: ChromeTab) => void>;
    onUpdated?: ChromeEvent<(tabId: number, changeInfo: ChromeTabChangeInfo, tab: ChromeTab) => void>;
    onActivated?: ChromeEvent<(activeInfo: ChromeTabActiveInfo) => void>;
    onRemoved?: ChromeEvent<(tabId: number, removeInfo: ChromeTabRemoveInfo) => void>;
  };
  scripting?: {
    executeScript(injection: {
      target: { tabId: number };
      func: (...args: never[]) => unknown;
      args?: unknown[];
      world?: "ISOLATED" | "MAIN";
    }): Promise<Array<{ result?: unknown }>> | void;
  };
  windows?: {
    getAll(getInfo?: Record<string, unknown>): Promise<ChromeWindow[]> | void;
    update(windowId: number, updateInfo: Record<string, unknown>): Promise<ChromeWindow> | void;
  };
  permissions?: {
    contains(permissions: { origins?: string[] }): Promise<boolean> | void;
    request(permissions: { origins?: string[] }): Promise<boolean> | void;
    remove(permissions: { origins?: string[] }): Promise<boolean> | void;
  };
  storage?: {
    local?: {
      get(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> | void;
      set(items: Record<string, unknown>): Promise<void> | void;
    };
  };
  action?: {
    setTitle(details: { title: string }): Promise<void> | void;
    setBadgeText?(details: { text: string }): Promise<void> | void;
    setBadgeBackgroundColor?(details: { color: string }): Promise<void> | void;
  };
  sidePanel?: {
    open(options: { windowId?: number; tabId?: number }): Promise<void> | void;
    close?(options: { windowId?: number; tabId?: number }): Promise<void> | void;
    setPanelBehavior?(options: { openPanelOnActionClick: boolean }): Promise<void> | void;
    onOpened?: ChromeEvent<(info: unknown) => void>;
    onClosed?: ChromeEvent<(info: unknown) => void>;
  };
  debugger?: {
    attach(target: ChromeDebuggerTarget, requiredVersion: string): Promise<void> | void;
    detach(target: ChromeDebuggerTarget): Promise<void> | void;
    sendCommand(target: ChromeDebuggerTarget, method: string, commandParams?: Record<string, unknown>): Promise<unknown> | void;
  };
  webRequest?: {
    onBeforeRequest?: ChromeWebRequestEvent;
    onCompleted?: ChromeWebRequestEvent;
    onErrorOccurred?: ChromeWebRequestEvent;
  };
}

export interface ChromeDebuggerTarget {
  tabId: number;
}

export interface ChromeWebRequestEvent {
  addListener(listener: (details: ChromeWebRequestDetails) => void, filter?: Record<string, unknown>): void;
  removeListener?(listener: (details: ChromeWebRequestDetails) => void): void;
}

export interface ChromeWebRequestDetails {
  requestId: string;
  tabId?: number;
  url: string;
  method?: string;
  type?: string;
  statusCode?: number;
  error?: string;
  timeStamp?: number;
}

export interface PortusExtensionBridgeOptions {
  nativeHostName?: string;
  terminalNativeHostName?: string;
  browserName?: BrowserName;
  extensionVersion?: string;
  browserLabel?: string;
  profileLabel?: string;
  now?: () => Date;
  setInterval?: (callback: () => void, timeoutMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  setTimeout?: (callback: () => void, timeoutMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  nativeRequestTimeoutMs?: number;
}

export interface PortusExtensionStatus {
  bridgeState: BridgeState;
  nativeHostState: NativeHostState;
  brokerState: BrokerState;
  sidePanelOpen: boolean;
  permissionState: PermissionState;
  activeTabOrigin: string | null;
  activeTabUrl: string | null;
  browserId: string | null;
  nativeHostName: string;
  terminalNativeHostName: string;
  terminalNativeHostState: TerminalNativeHostState;
  allowlist: PermissionRecord[];
  policyPreferences: PolicyPreferences;
  uxPreferences: ExtensionUxPreferences;
  terminalPreferences: TerminalSettings;
  settingsProfiles: SettingsProfileState;
}

interface PendingRequest {
  resolve: (response: ResponseEnvelope) => void;
  reject: (error: PortusError) => void;
  timer?: unknown;
}

interface PendingTerminalRequest {
  resolve: (message: TerminalServerMessage) => void;
  reject: (error: Error) => void;
}

const ALLOWLIST_STORAGE_KEY = "portus.permissionAllowlist";
const POLICY_STORAGE_KEY = "portus.policyPreferences";
const UX_STORAGE_KEY = "portus.uxPreferences";
const BRIDGE_PREFERENCE_STORAGE_KEY = "portus.bridgePreference";
const TERMINAL_PREFERENCES_STORAGE_KEY = "portus.terminalPreferences";
const DEFAULT_POLICY_PREFERENCES: PolicyPreferences = PolicyPreferencesSchema.parse({});
const DEFAULT_UX_PREFERENCES: ExtensionUxPreferences = ExtensionUxPreferencesSchema.parse({});
const DEFAULT_TERMINAL_PREFERENCES: TerminalSettings = TerminalSettingsSchema.parse({});
const DEFAULT_SETTINGS_PROFILE_CONTENT: SettingsProfileContent = SettingsProfileContentSchema.parse({
  policyPreferences: DEFAULT_POLICY_PREFERENCES,
  uxPreferences: DEFAULT_UX_PREFERENCES,
  terminalPreferences: DEFAULT_TERMINAL_PREFERENCES,
  autoSave: true
});
const DEFAULT_NATIVE_REQUEST_TIMEOUT_MS = 15000;

function createDefaultSettingsProfileState(): SettingsProfileState {
  return SettingsProfileStateSchema.parse({
    profiles: [
      {
        profileId: "profile_default",
        name: DEFAULT_SETTINGS_PROFILE_NAME,
        builtIn: true,
        readOnly: true
      },
      {
        profileId: "profile_1",
        name: INITIAL_CUSTOM_SETTINGS_PROFILE_NAME,
        builtIn: false,
        readOnly: false
      }
    ],
    activeProfileId: "profile_1",
    activeProfileName: INITIAL_CUSTOM_SETTINGS_PROFILE_NAME,
    activeProfileReadOnly: false,
    dirty: false,
    autoSave: true,
    canCreateProfile: true,
    maxCustomProfiles: DEFAULT_MAX_CUSTOM_SETTINGS_PROFILES,
    content: DEFAULT_SETTINGS_PROFILE_CONTENT
  });
}

function performPortusHistoryNavigation(direction: "back" | "forward"): Record<string, unknown> {
  if (direction === "back") {
    history.back();
    return { ok: true, direction };
  }
  history.forward();
  return { ok: true, direction };
}

function evaluatePortusPageWait(condition: Record<string, unknown>): Record<string, unknown> {
  const normalize = (value: unknown): string => typeof value === "string" ? value.trim().toLowerCase() : "";
  const text = normalize(condition.text);
  const elementQuery = normalize(condition.elementQuery);
  const role = normalize(condition.role);
  const visibleText = document.body?.innerText ?? "";

  if (text && visibleText.toLowerCase().includes(text)) {
    return {
      matched: true,
      details: {
        match: "text",
        text: condition.text
      }
    };
  }

  if (!elementQuery && !role) {
    return { matched: false };
  }

  const candidates = Array.from(document.querySelectorAll("a, button, input, textarea, select, [role], [aria-label], [title]"));
  for (const element of candidates) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const ariaLabel = element.getAttribute("aria-label") ?? "";
    const title = element.getAttribute("title") ?? "";
    const placeholder = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.placeholder : "";
    const candidateText = [
      element.textContent ?? "",
      ariaLabel,
      title,
      placeholder,
      element.getAttribute("href") ?? ""
    ].join(" ").toLowerCase();
    const tagName = element.tagName.toLowerCase();
    const candidateRole = normalize(element.getAttribute("role") ?? (tagName === "a" ? "link" : tagName === "button" ? "button" : ""));
    if (elementQuery && !candidateText.includes(elementQuery)) continue;
    if (role && candidateRole !== role) continue;
    return {
      matched: true,
      details: {
        match: "element",
        role: candidateRole || tagName,
        tagName,
        text: (element.textContent ?? "").trim().slice(0, 200),
        label: (ariaLabel || title || placeholder || (element.textContent ?? "")).trim().slice(0, 200)
      }
    };
  }

  return { matched: false };
}

function capturePortusConsoleMessages(): Record<string, unknown>[] {
  const root = globalThis as typeof globalThis & {
    __portusConsoleMessages?: Record<string, unknown>[];
    __portusConsoleInstalled?: boolean;
  };
  if (!root.__portusConsoleMessages) root.__portusConsoleMessages = [];
  if (!root.__portusConsoleInstalled) {
    root.__portusConsoleInstalled = true;
    for (const level of ["debug", "log", "info", "warn", "error"] as const) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        root.__portusConsoleMessages?.push({
          level,
          text: args.map(formatConsoleArgument).join(" "),
          createdAt: new Date().toISOString(),
          source: "page",
          url: location.href
        });
        original(...args);
      };
    }
  }
  return root.__portusConsoleMessages.slice(-500);
}

function clearPortusConsoleMessages(): Record<string, unknown> {
  const root = globalThis as typeof globalThis & {
    __portusConsoleMessages?: Record<string, unknown>[];
  };
  root.__portusConsoleMessages = [];
  return { cleared: true };
}

function formatConsoleArgument(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class PortusExtensionBridge {
  readonly nativeHostName: string;
  readonly terminalNativeHostName: string;
  readonly browserName: BrowserName;
  readonly extensionVersion: string;
  readonly browserLabel: string | undefined;
  readonly profileLabel: string | undefined;

  private readonly now: () => Date;
  private readonly setTimer: (callback: () => void, timeoutMs: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly setRequestTimer: (callback: () => void, timeoutMs: number) => unknown;
  private readonly clearRequestTimer: (handle: unknown) => void;
  private readonly nativeRequestTimeoutMs: number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly terminalPending = new Map<string, PendingTerminalRequest>();
  private readonly terminalRuntimePorts = new Set<PortusRuntimePort>();
  private readonly statusRuntimePorts = new Set<PortusRuntimePort>();
  private readonly allowlist = new Map<string, PermissionRecord>();
  private policyPreferences: PolicyPreferences = DEFAULT_POLICY_PREFERENCES;
  private uxPreferences: ExtensionUxPreferences = DEFAULT_UX_PREFERENCES;
  private terminalPreferences: TerminalSettings = DEFAULT_TERMINAL_PREFERENCES;
  private settingsProfiles: SettingsProfileState = createDefaultSettingsProfileState();
  private bridgeShouldConnect = true;
  private readonly ready: Promise<void>;
  private port: PortusNativePort | undefined;
  private terminalPort: PortusNativePort | undefined;
  private heartbeatTimer: unknown | undefined;
  private reconnectTimer: unknown | undefined;
  private requestCounter = 1;
  private snapshotCounter = 1;
  private consoleCaptureStartedAt: string | undefined;
  private networkCaptureStartedAt: string | undefined;
  private intentionalDisconnect = false;
  private readonly snapshots = new Map<string, SnapshotStoreEntry>();
  private readonly networkRecords = new Map<string, Record<string, unknown>>();

  bridgeState: BridgeState = "disconnected";
  nativeHostState: NativeHostState = "disconnected";
  terminalNativeHostState: TerminalNativeHostState = "disconnected";
  brokerState: BrokerState = "unknown";
  sidePanelOpen = false;
  permissionState: PermissionState = "unknown";
  browserId: string | null = null;

  constructor(private readonly chromeApi: PortusChromeApi, options: PortusExtensionBridgeOptions = {}) {
    this.nativeHostName = options.nativeHostName ?? "com.portus.browser";
    this.terminalNativeHostName = options.terminalNativeHostName ?? TERMINAL_NATIVE_HOST_NAME;
    this.browserName = options.browserName ?? detectBrowserName();
    this.extensionVersion = options.extensionVersion ?? "0.1.0";
    this.browserLabel = options.browserLabel;
    this.profileLabel = options.profileLabel;
    this.now = options.now ?? (() => new Date());
    this.setTimer = options.setInterval ?? ((callback, timeoutMs) => globalThis.setInterval(callback, timeoutMs));
    this.clearTimer = options.clearInterval ?? ((handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
    this.setRequestTimer = options.setTimeout ?? ((callback, timeoutMs) => globalThis.setTimeout(callback, timeoutMs));
    this.clearRequestTimer = options.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.nativeRequestTimeoutMs = options.nativeRequestTimeoutMs ?? DEFAULT_NATIVE_REQUEST_TIMEOUT_MS;
    this.ready = this.restoreExtensionState();
    this.installTabLifecycleListeners();
    this.installNetworkListeners();
  }

  async initializeBridge(): Promise<PortusExtensionStatus> {
    await this.ready;
    if (!this.bridgeShouldConnect) return this.getStatus();
    try {
      const status = await this.connectBridge();
      this.stopReconnectTimer();
      return status;
    } catch {
      this.scheduleReconnect();
      return this.getStatus();
    }
  }

  async connectBridge(): Promise<PortusExtensionStatus> {
    await this.ready;
    if (this.bridgeState === "connected") return this.getStatus();

    this.bridgeShouldConnect = true;
    await this.persistBridgePreference();
    this.stopReconnectTimer();
    this.bridgeState = "connecting";
    this.nativeHostState = "connecting";
    this.brokerState = "unknown";
    this.intentionalDisconnect = false;
    void this.updateActionState();
    void this.broadcastStatus();

    try {
      this.port = this.chromeApi.runtime.connectNative(this.nativeHostName);
      this.port.onMessage.addListener((message: unknown) => {
        void this.handleNativeMessage(message);
      });
      this.port.onDisconnect.addListener(() => {
        this.handleNativeDisconnect();
      });
      this.nativeHostState = "connected";

      const result = await this.sendNativeRequest("bridge.register", this.registrationPayload());
      const browserId = readString(result, "browserId");
      const heartbeatIntervalMs = readNumber(result, "heartbeatIntervalMs");
      this.browserId = browserId;
      const registeredProfiles = SettingsProfileStateSchema.safeParse(result.settingsProfiles);
      if (registeredProfiles.success) {
        await this.applySettingsProfileState(registeredProfiles.data);
      }
      this.bridgeState = "connected";
      this.brokerState = "connected";
      this.startHeartbeat(heartbeatIntervalMs);
      void this.updateActionState();
      void this.broadcastStatus();
      return this.getStatus();
    } catch (error) {
      this.bridgeState = "error";
      this.nativeHostState = this.port ? this.nativeHostState : "error";
      this.brokerState = "error";
      this.rejectPending(normalizeExtensionError(error));
      void this.updateActionState();
      void this.broadcastStatus();
      throw normalizeExtensionError(error);
    }
  }

  async disconnectBridge(reason = "requested"): Promise<PortusExtensionStatus> {
    await this.ready;
    if (this.bridgeState === "disconnected") return this.getStatus();

    this.bridgeShouldConnect = false;
    await this.persistBridgePreference();
    this.stopReconnectTimer();
    this.bridgeState = "disconnecting";
    this.intentionalDisconnect = true;
    this.stopHeartbeat();
    void this.updateActionState();

    const browserId = this.browserId;
    if (browserId && this.port) {
      try {
        await this.sendNativeRequest("bridge.disconnect", { browserId, reason });
      } catch {
        // Disconnection should still complete locally if the broker is already gone.
      }
    }

    if (this.port) this.port.disconnect();
    this.clearConnectionState();
    void this.updateActionState();
    void this.broadcastStatus();
    return this.getStatus();
  }

  async getStatus(): Promise<PortusExtensionStatus> {
    await this.ready;
    const activeTab = await this.getActiveTab().catch(() => null);
    const activeTabUrl = activeTab?.url ?? null;
    const activeTabOrigin = activeTabUrl ? originFromUrl(activeTabUrl) : null;
    const permissionState = activeTabOrigin === null
      ? "unknown"
      : await this.getOriginPermissionState(activeTabOrigin);

    return {
      bridgeState: this.bridgeState,
      nativeHostState: this.nativeHostState,
      brokerState: this.brokerState,
      sidePanelOpen: this.sidePanelOpen,
      permissionState,
      activeTabOrigin,
      activeTabUrl,
      browserId: this.browserId,
      nativeHostName: this.nativeHostName,
      terminalNativeHostName: this.terminalNativeHostName,
      terminalNativeHostState: this.terminalNativeHostState,
      allowlist: [...this.allowlist.values()],
      policyPreferences: this.policyPreferences,
      uxPreferences: this.uxPreferences,
      terminalPreferences: this.terminalPreferences,
      settingsProfiles: this.settingsProfiles
    };
  }

  private installTabLifecycleListeners(): void {
    this.chromeApi.tabs.onCreated?.addListener((tab) => {
      this.publishTabLifecycleEvent("tab.created", tab);
      void this.broadcastStatus();
    });
    this.chromeApi.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
      const eventTab: ChromeTab = {
        ...tab,
        id: tab.id ?? tabId
      };
      copyDefinedTabField(eventTab, "status", changeInfo.status ?? tab.status);
      copyDefinedTabField(eventTab, "title", changeInfo.title ?? tab.title);
      copyDefinedTabField(eventTab, "url", changeInfo.url ?? tab.url);
      copyDefinedTabField(eventTab, "favIconUrl", changeInfo.favIconUrl ?? tab.favIconUrl);
      copyDefinedTabField(eventTab, "pinned", changeInfo.pinned ?? tab.pinned);
      copyDefinedTabField(eventTab, "discarded", changeInfo.discarded ?? tab.discarded);
      this.publishTabLifecycleEvent("tab.updated", eventTab, tabChangeDetails(changeInfo));
      if (changeInfo.url !== undefined || changeInfo.status !== undefined) void this.broadcastStatus();
    });
    this.chromeApi.tabs.onActivated?.addListener((activeInfo) => {
      void this.getChromeTab(activeInfo.tabId)
        .then((tab) => {
          this.publishTabLifecycleEvent("tab.activated", tab, { windowId: activeInfo.windowId });
          void this.broadcastStatus();
        })
        .catch(() => {
          this.publishBrowserEvent("tab.activated", {
            tabId: activeInfo.tabId,
            windowId: activeInfo.windowId
          }, activeInfo.tabId);
          void this.broadcastStatus();
        });
    });
    this.chromeApi.tabs.onRemoved?.addListener((tabId, removeInfo) => {
      this.publishBrowserEvent("tab.closed", {
        tabId,
        windowId: removeInfo.windowId,
        isWindowClosing: removeInfo.isWindowClosing
      }, tabId);
      void this.broadcastStatus();
    });
  }

  private installNetworkListeners(): void {
    const webRequest = this.chromeApi.webRequest;
    if (!webRequest) return;
    const filter = { urls: ["http://*/*", "https://*/*"] };
    webRequest.onBeforeRequest?.addListener((details) => {
      const tabId = details.tabId ?? -1;
      if (tabId < 0) return;
      const startedAt = isoFromChromeTimestamp(details.timeStamp, this.now());
      if (!this.networkCaptureStartedAt) this.networkCaptureStartedAt = startedAt;
      this.networkRecords.set(details.requestId, {
        requestId: details.requestId,
        tabId,
        url: details.url,
        method: details.method ?? "GET",
        resourceType: details.type,
        startedAt,
        redacted: true
      });
      trimMap(this.networkRecords, 1000);
    }, filter);
    webRequest.onCompleted?.addListener((details) => {
      const record = this.networkRecords.get(details.requestId);
      if (!record) return;
      record.statusCode = details.statusCode;
      record.completedAt = isoFromChromeTimestamp(details.timeStamp, this.now());
      if (details.type) record.resourceType = details.type;
    }, filter);
    webRequest.onErrorOccurred?.addListener((details) => {
      const record = this.networkRecords.get(details.requestId);
      if (!record) return;
      record.error = details.error ?? "request failed";
      record.completedAt = isoFromChromeTimestamp(details.timeStamp, this.now());
    }, filter);
  }

  async listTabs(): Promise<Tab[]> {
    await this.ready;
    const tabs = await promisifyChromeCall<ChromeTab[]>((done) => {
      const result = this.chromeApi.tabs.query({});
      done(result as Promise<ChromeTab[]> | ChromeTab[] | undefined);
    });
    return tabs.map((tab) => this.toPortusTab(tab));
  }

  async getTab(tabId: number): Promise<Tab> {
    await this.ready;
    const tab = await mapChromeTabOperation(tabId, promisifyChromeCall<ChromeTab>((done) => {
      const result = this.chromeApi.tabs.get(tabId);
      done(result as Promise<ChromeTab> | ChromeTab | undefined);
    }));
    return this.toPortusTab(tab);
  }

  async openTab(url: string, active = true, windowId?: number): Promise<Tab> {
    await this.ready;
    const origin = originFromUrl(url);
    if (origin) this.ensureOriginPolicyAllowed(origin);
    const createProperties: Record<string, unknown> = { url, active };
    if (windowId !== undefined) createProperties.windowId = windowId;
    const tab = await promisifyChromeCall<ChromeTab>((done) => {
      const result = this.chromeApi.tabs.create(createProperties);
      done(result as Promise<ChromeTab> | ChromeTab | undefined);
    });
    return this.toPortusTab(tab);
  }

  async navigateTab(tabId: number, url: string): Promise<Tab> {
    await this.ready;
    const origin = originFromUrl(url);
    if (origin) this.ensureOriginPolicyAllowed(origin);
    const tab = await mapChromeTabOperation(tabId, promisifyChromeCall<ChromeTab>((done) => {
      const result = this.chromeApi.tabs.update(tabId, { url });
      done(result as Promise<ChromeTab> | ChromeTab | undefined);
    }));
    return this.toPortusTab(tab);
  }

  async navigateTabHistory(tabId: number, direction: "back" | "forward"): Promise<Tab> {
    await this.ready;
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    await this.ensureTabPermission(targetTab);
    if (!this.chromeApi.scripting) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome scripting API is unavailable."
      });
    }
    await mapChromePermissionOperation("navigate tab history", promisifyChromeCall<Array<{ result?: unknown }>>((done) => {
      const result = this.chromeApi.scripting?.executeScript({
        target: { tabId },
        func: performPortusHistoryNavigation,
        args: [direction]
      });
      done(result as Promise<Array<{ result?: unknown }>> | Array<{ result?: unknown }> | undefined);
    }));
    return this.getTab(tabId);
  }

  async activateTab(tabId: number): Promise<Tab> {
    await this.ready;
    const tab = await mapChromeTabOperation(tabId, promisifyChromeCall<ChromeTab>((done) => {
      const result = this.chromeApi.tabs.update(tabId, { active: true });
      done(result as Promise<ChromeTab> | ChromeTab | undefined);
    }));
    if (this.chromeApi.windows && tab.windowId !== undefined) {
      await promisifyChromeCall<ChromeWindow>((done) => {
        const result = this.chromeApi.windows?.update(tab.windowId, { focused: true });
        done(result as Promise<ChromeWindow> | ChromeWindow | undefined);
      });
    }
    return this.toPortusTab(tab);
  }

  async closeTab(tabId: number): Promise<Record<string, unknown>> {
    await this.ready;
    await mapChromeTabOperation(tabId, promisifyChromeCall<void>((done) => {
      const result = this.chromeApi.tabs.remove(tabId);
      done(result as Promise<void> | void);
    }));
    return { closed: true, tabId };
  }

  async captureScreenshot(tabId?: number): Promise<ScreenshotResult> {
    await this.ready;
    const targetTab = tabId === undefined ? await this.getActiveTab() : await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    const targetTabId = requireTabId(targetTab);
    const previousActiveTab = await this.getActiveTabForWindow(targetTab.windowId);
    const previousActiveTabId = previousActiveTab?.id;
    const activatedTabBeforeCapture = previousActiveTabId !== undefined && previousActiveTabId !== targetTabId;

    if (activatedTabBeforeCapture) await this.activateTab(targetTabId);

    const data = await mapChromePermissionOperation("capture visible tab", promisifyChromeCall<string>((done) => {
      const result = this.chromeApi.tabs.captureVisibleTab(targetTab.windowId, { format: "png" });
      done(result as Promise<string> | string | undefined);
    }));

    const input: Record<string, unknown> = {
      browserId: this.requireBrowserId(),
      tabId: targetTabId,
      capturedAt: this.now().toISOString(),
      mimeType: inferImageMimeType(data),
      data,
      activatedTabBeforeCapture
    };
    if (activatedTabBeforeCapture && previousActiveTabId !== undefined) input.previousActiveTabId = previousActiveTabId;
    return ScreenshotResultSchema.parse(input);
  }

  async captureSnapshot(tabId?: number, filter?: SnapshotFilter): Promise<Snapshot> {
    await this.ready;
    const targetTab = tabId === undefined ? await this.getActiveTab() : await this.getChromeTab(tabId);
    const targetTabId = requireTabId(targetTab);
    this.ensureTabPolicyAllowed(targetTab);
    await this.ensureTabPermission(targetTab);
    const screenshot = await this.captureScreenshot(targetTabId);
    const page = await this.executeSnapshotScript(targetTabId);
    const snapshotInput = {
      snapshotId: createSnapshotId(this.snapshotCounter++),
      browserId: this.requireBrowserId(),
      tabId: targetTabId,
      url: readString(page, "url"),
      title: readString(page, "title"),
      viewport: readViewport(page.viewport),
      screenshot,
      visibleText: typeof page.visibleText === "string" ? page.visibleText : "",
      elements: readElementCandidates(page.elements),
      capturedAt: this.now().toISOString()
    };
    const snapshot = buildSnapshot(typeof page.cleanedDom === "string"
      ? { ...snapshotInput, cleanedDom: page.cleanedDom }
      : snapshotInput);
    const result = filter === undefined ? snapshot : filterSnapshot(snapshot, filter);
    this.snapshots.set(result.snapshotId, { snapshot: result, stale: false });
    return result;
  }

  async performAction(action: "click" | "hover" | "drag" | "type" | "press" | "scroll", payload: Record<string, unknown>): Promise<ActionResult> {
    await this.ready;
    const tabId = readNumber(payload, "tabId");
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    await this.ensureTabPermission(targetTab);
    const browserId = this.requireBrowserId();
    const requestInput: Record<string, unknown> = {
      action,
      browserId,
      tabId
    };
    copyOptional(payload, requestInput, "snapshotId");
    copyOptional(payload, requestInput, "elementId");
    copyOptional(payload, requestInput, "sourceElementId");
    copyOptional(payload, requestInput, "targetElementId");
    copyOptional(payload, requestInput, "text");
    copyOptional(payload, requestInput, "key");
    copyOptional(payload, requestInput, "deltaX");
    copyOptional(payload, requestInput, "deltaY");

    const actionRequest = ActionRequestSchema.parse(requestInput);
    const element = action === "drag"
      ? null
      : resolveActionElement(actionRequest, this.snapshots);
    const sourceElement = action === "drag"
      ? resolveActionElement({ ...actionRequest, elementId: actionRequest.sourceElementId }, this.snapshots)
      : null;
    const targetElement = action === "drag"
      ? resolveActionElement({ ...actionRequest, elementId: actionRequest.targetElementId }, this.snapshots)
      : null;
    const domPayload: Record<string, unknown> = {
      action,
      target: element ? createDomActionTarget(element) : undefined,
      sourceTarget: sourceElement ? createDomActionTarget(sourceElement) : undefined,
      dropTarget: targetElement ? createDomActionTarget(targetElement) : undefined,
      text: typeof payload.text === "string" ? payload.text : undefined,
      key: typeof payload.key === "string" ? payload.key : undefined,
      deltaX: typeof payload.deltaX === "number" ? payload.deltaX : 0,
      deltaY: typeof payload.deltaY === "number" ? payload.deltaY : 600
    };

    if (action === "drag" && this.shouldUseDebuggerBackend()) {
      const debuggerResult = await this.executeDebuggerDragAction(tabId, sourceElement, targetElement);
      markSnapshotsStaleForTab(this.snapshots, browserId, tabId);
      return debuggerResult;
    }

    const result = await this.executeActionScript(tabId, domPayload);
    if (!result.ok) throw createPortusError(result.error);
    markSnapshotsStaleForTab(this.snapshots, browserId, tabId);
    return ActionResultSchema.parse(createDomActionResult(this.now().toISOString(), result.details ?? { action }));
  }

  async fillForm(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ready;
    const tabId = readNumber(payload, "tabId");
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    await this.ensureTabPermission(targetTab);
    const browserId = this.requireBrowserId();
    const request = FillFormRequestSchema.parse({
      action: "fillForm",
      browserId,
      tabId,
      snapshotId: readString(payload, "snapshotId"),
      fields: readFillFormFields(payload),
      partial: readOptionalBoolean(payload, "partial")
    });

    const targets = request.fields.map((field) => ({
      elementId: field.elementId,
      value: field.value,
      target: createDomActionTarget(resolveActionElement({
        action: "type",
        browserId,
        tabId,
        snapshotId: request.snapshotId,
        elementId: field.elementId
      }, this.snapshots) as SnapshotElement)
    }));

    const result = await this.executeActionScript(tabId, {
      action: "fillForm",
      fields: targets
    });
    if (!result.ok) throw createPortusError(result.error);
    markSnapshotsStaleForTab(this.snapshots, browserId, tabId);
    return FillFormResultSchema.parse({
      backend: "content-script-dom",
      completedAt: this.now().toISOString(),
      snapshotInvalidated: true,
      fields: request.fields.map((field) => ({ elementId: field.elementId, ok: true })),
      details: {
        fieldCount: request.fields.length
      }
    });
  }

  async dismissPage(payload: Record<string, unknown>): Promise<DismissResult> {
    await this.ready;
    const tabId = readOptionalNumber(payload, "tabId");
    const kind = DismissKindSchema.parse(readOptionalString(payload, "kind") ?? "any");
    const strategy = DismissStrategySchema.parse(readOptionalString(payload, "strategy") ?? "conservative");
    const dryRun = readOptionalBoolean(payload, "dryRun") ?? false;
    const snapshot = await this.captureSnapshot(tabId);
    const candidate = selectDismissCandidate(snapshot.elements, kind, strategy);

    if (!candidate) {
      throw createPortusError({
        code: "DISMISS_TARGET_NOT_FOUND",
        message: "No safe popup or banner dismissal target was found.",
        details: { kind, strategy, snapshotId: snapshot.snapshotId }
      });
    }

    const result: DismissResult = {
      strategy,
      kind,
      dryRun,
      dismissed: false,
      snapshotId: snapshot.snapshotId,
      elementId: candidate.element.elementId,
      label: candidate.element.label,
      role: candidate.element.role,
      reason: candidate.reason
    };
    const href = readSnapshotElementString(candidate.element, "href");
    if (href) result.href = href;

    if (dryRun) return result;

    const action = await this.performAction("click", {
      tabId: snapshot.tabId,
      snapshotId: snapshot.snapshotId,
      elementId: candidate.element.elementId
    });
    return {
      ...result,
      dismissed: true,
      action
    };
  }

  async waitForPage(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ready;
    const tabId = readNumber(payload, "tabId");
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    await this.ensureTabPermission(targetTab);

    const condition: Record<string, unknown> = {};
    copyOptional(payload, condition, "text");
    copyOptional(payload, condition, "elementQuery");
    copyOptional(payload, condition, "role");
    if (Object.keys(condition).length === 0) {
      throw createPortusError({
        code: "INVALID_MESSAGE",
        message: "page.wait requires text or element query criteria."
      });
    }

    const timeoutMs = readOptionalNumber(payload, "timeoutMs") ?? 30000;
    const startedAt = Date.now();
    let lastDetails: Record<string, unknown> | undefined;
    while (Date.now() - startedAt <= timeoutMs) {
      const evaluation = await this.executePageWaitScript(tabId, condition);
      if (isRecord(evaluation.details)) lastDetails = evaluation.details;
      if (evaluation.matched === true) {
        return WaitResultSchema.parse({
          browserId: this.requireBrowserId(),
          tabId,
          matched: true,
          source: "page-script",
          condition,
          completedAt: this.now().toISOString(),
          url: targetTab.url ?? "",
          title: targetTab.title ?? "",
          ...(lastDetails === undefined ? {} : { details: lastDetails })
        });
      }
      await delay(250);
    }

    throw createPortusError({
      code: "COMMAND_TIMEOUT",
      message: `Timed out waiting for page condition in tab ${tabId}.`,
      retryable: true,
      details: {
        browserId: this.browserId,
        tabId,
        condition,
        ...(lastDetails === undefined ? {} : { lastDetails })
      }
    });
  }

  async handleDialog(action: "accept" | "dismiss", payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ready;
    const tabId = readNumber(payload, "tabId");
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    await this.ensureTabPermission(targetTab);
    this.ensureAdvancedBackendAvailable();
    const text = readOptionalString(payload, "text");
    await this.withDebuggerSession(tabId, async (target) => {
      await this.sendDebuggerCommand(target, "Page.enable");
      await this.sendDebuggerCommand(target, "Page.handleJavaScriptDialog", {
        accept: action === "accept",
        ...(text === undefined ? {} : { promptText: text })
      });
    }, `dialog.${action}`);
    return DialogResultSchema.parse({
      handled: true,
      action,
      backend: "debugger-cdp",
      completedAt: this.now().toISOString(),
      details: {
        tabId
      }
    });
  }

  async listConsoleMessages(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ready;
    const tabId = readNumber(payload, "tabId");
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    await this.ensureTabPermission(targetTab);
    if (!this.consoleCaptureStartedAt) this.consoleCaptureStartedAt = this.now().toISOString();
    const messages = await this.executeConsoleListScript(tabId);
    const limit = readOptionalNumber(payload, "limit") ?? 50;
    return ConsoleListResultSchema.parse({
      messages: messages.slice(Math.max(0, messages.length - limit)),
      captureStartedAt: this.consoleCaptureStartedAt
    });
  }

  async clearConsoleMessages(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ready;
    const tabId = readNumber(payload, "tabId");
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    await this.ensureTabPermission(targetTab);
    await this.executeConsoleClearScript(tabId);
    return { cleared: true, tabId };
  }

  async listNetworkRecords(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ready;
    const tabId = readNumber(payload, "tabId");
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    const limit = readOptionalNumber(payload, "limit") ?? 50;
    const matchingRequests = [...this.networkRecords.values()]
      .filter((record) => record.tabId === tabId);
    const requests = matchingRequests.slice(Math.max(0, matchingRequests.length - limit));
    return NetworkListResultSchema.parse({
      requests,
      captureStartedAt: this.networkCaptureStartedAt
    });
  }

  async getNetworkRecord(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ready;
    const tabId = readNumber(payload, "tabId");
    const requestId = readString(payload, "requestId");
    const record = this.networkRecords.get(requestId);
    if (!record || record.tabId !== tabId) {
      throw createPortusError({
        code: "TARGET_NOT_FOUND",
        message: `Network request is unavailable: ${requestId}.`,
        details: { requestId, tabId }
      });
    }
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    return NetworkGetResultSchema.parse({ request: record });
  }

  async listWindows(): Promise<Record<string, unknown>[]> {
    await this.ready;
    if (!this.chromeApi.windows) return [];
    const windows = await promisifyChromeCall<ChromeWindow[]>((done) => {
      const result = this.chromeApi.windows?.getAll({ populate: false });
      done(result as Promise<ChromeWindow[]> | ChromeWindow[] | undefined);
    });
    return windows.map((window) => ({
      windowId: window.id ?? -1,
      focused: window.focused ?? false,
      state: window.state ?? "normal",
      type: window.type ?? "normal",
      incognito: window.incognito ?? false
    }));
  }

  async requestOriginPermission(origin: string, reason?: string): Promise<PermissionRecord> {
    await this.ready;
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) {
      throw createPortusError({
        code: "PERMISSION_REQUIRED",
        message: `Portus cannot request host permission for ${origin}.`,
        details: { origin }
      });
    }
    const pattern = toHostPermissionPattern(normalizedOrigin);
    this.permissionState = "requested";
    try {
      const granted = await this.requestChromeOriginPermission(pattern);
      if (!granted) {
        this.permissionState = "denied";
        throw createPortusError({
          code: "PERMISSION_REQUIRED",
          message: `Portus does not have permission for ${normalizedOrigin}.`,
          details: { origin: normalizedOrigin }
        });
      }

      const timestamp = this.now().toISOString();
      const input: Record<string, unknown> = {
        origin: normalizedOrigin,
        granted: true,
        source: "extension",
        scope: "origin",
        requestedAt: timestamp,
        grantedAt: timestamp
      };
      if (reason) input.reason = reason;
      const record = PermissionRecordSchema.parse(input);
      this.allowlist.set(normalizedOrigin, record);
      this.permissionState = "granted";
      await this.persistAllowlist();
      return record;
    } catch (error) {
      if (this.permissionState !== "denied") this.permissionState = "error";
      throw normalizeExtensionError(error);
    }
  }

  async revokeOriginPermission(origin: string): Promise<Record<string, unknown>> {
    await this.ready;
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) {
      throw createPortusError({
        code: "PERMISSION_REQUIRED",
        message: `Portus cannot revoke host permission for ${origin}.`,
        details: { origin }
      });
    }
    const pattern = toHostPermissionPattern(normalizedOrigin);
    const revoked = await this.removeChromeOriginPermission(pattern);
    if (revoked) this.allowlist.delete(normalizedOrigin);
    this.permissionState = revoked ? "missing" : "error";
    await this.persistAllowlist();
    return { revoked, origin: normalizedOrigin };
  }

  getPolicyPreferences(): PolicyPreferences {
    return this.policyPreferences;
  }

  getUxPreferences(): ExtensionUxPreferences {
    return this.uxPreferences;
  }

  getTerminalPreferences(): TerminalSettings {
    return this.terminalPreferences;
  }

  getSettingsProfiles(): SettingsProfileState {
    return this.settingsProfiles;
  }

  private createCurrentSettingsProfileContent(autoSave = this.settingsProfiles.autoSave): SettingsProfileContent {
    return SettingsProfileContentSchema.parse({
      policyPreferences: this.policyPreferences,
      uxPreferences: this.uxPreferences,
      terminalPreferences: this.terminalPreferences,
      autoSave
    });
  }

  private async applySettingsProfileState(state: SettingsProfileState): Promise<void> {
    this.settingsProfiles = SettingsProfileStateSchema.parse(state);
    await this.applySettingsProfileContent(this.settingsProfiles.content);
    void this.broadcastStatus();
  }

  private async applySettingsProfileMetadataState(state: SettingsProfileState): Promise<void> {
    const nextState = SettingsProfileStateSchema.parse(state);
    if (nextState.activeProfileId !== this.settingsProfiles.activeProfileId) {
      await this.applySettingsProfileState(nextState);
      return;
    }
    const content = this.createCurrentSettingsProfileContent(this.settingsProfiles.autoSave);
    this.settingsProfiles = SettingsProfileStateSchema.parse({
      ...nextState,
      dirty: this.settingsProfiles.dirty,
      autoSave: this.settingsProfiles.autoSave,
      content
    });
    void this.broadcastStatus();
  }

  private async applySettingsProfileContent(content: SettingsProfileContent, applyTerminalToHost = this.terminalPort !== undefined): Promise<void> {
    const parsed = SettingsProfileContentSchema.parse(content);
    const terminal = TerminalSettingsSchema.parse(parsed.terminalPreferences);
    await this.importPolicyPreferences(parsed.policyPreferences, false, false);
    await this.importUxPreferences(parsed.uxPreferences, false);
    await this.setTerminalPreferences(terminal, applyTerminalToHost, false);
  }

  private async prepareSettingsProfileEdit(): Promise<void> {
    if (!this.settingsProfiles.activeProfileReadOnly) return;
    if (!this.port || this.bridgeState !== "connected") {
      const customCount = this.settingsProfiles.profiles.filter((profile) => !profile.readOnly).length;
      if (customCount >= this.settingsProfiles.maxCustomProfiles) {
        throw createPortusError({
          code: "CONFIG_INVALID",
          message: "The maximum number of settings profiles has been reached."
        });
      }
      const existingNames = new Set(this.settingsProfiles.profiles.map((profile) => profile.name));
      const existingIds = new Set(this.settingsProfiles.profiles.map((profile) => profile.profileId));
      let index = 1;
      while (existingNames.has(`Profile_${index}`)) index += 1;
      const profileName = `Profile_${index}`;
      let profileId = `profile_${index}`;
      let suffix = 2;
      while (existingIds.has(profileId)) {
        profileId = `profile_${index}_${suffix}`;
        suffix += 1;
      }
      this.settingsProfiles = SettingsProfileStateSchema.parse({
        ...this.settingsProfiles,
        profiles: [
          ...this.settingsProfiles.profiles,
          { profileId, name: profileName, builtIn: false, readOnly: false }
        ],
        activeProfileId: profileId,
        activeProfileName: profileName,
        activeProfileReadOnly: false,
        autoSave: true,
        dirty: true,
        canCreateProfile: customCount + 1 < this.settingsProfiles.maxCustomProfiles,
        content: DEFAULT_SETTINGS_PROFILE_CONTENT
      });
      return;
    }
    const result = await this.sendNativeRequest("settings.profile.create", {
      browserName: this.browserName
    });
    const nextState = SettingsProfileStateSchema.parse(result.settingsProfiles);
    this.settingsProfiles = nextState;
    await this.applySettingsProfileContent(nextState.content);
  }

  private async afterSettingsProfileChanged(syncProfile = true): Promise<void> {
    if (!syncProfile || this.settingsProfiles.activeProfileReadOnly) return;
    const content = this.createCurrentSettingsProfileContent();
    this.settingsProfiles = SettingsProfileStateSchema.parse({
      ...this.settingsProfiles,
      dirty: !this.settingsProfiles.autoSave,
      content
    });
    if (this.settingsProfiles.autoSave) {
      if (this.port && this.bridgeState === "connected") {
        this.sendNativeOneWayRequest("settings.profile.save", {
          browserName: this.browserName,
          profileId: this.settingsProfiles.activeProfileId,
          content
        });
      } else {
        void this.saveActiveSettingsProfile(content);
      }
      return;
    }
    void this.broadcastStatus();
  }

  private async saveActiveSettingsProfile(content = this.createCurrentSettingsProfileContent()): Promise<SettingsProfileState> {
    if (this.settingsProfiles.activeProfileReadOnly) return this.settingsProfiles;
    if (!this.port || this.bridgeState !== "connected") {
      this.settingsProfiles = SettingsProfileStateSchema.parse({
        ...this.settingsProfiles,
        dirty: false,
        autoSave: content.autoSave,
        content
      });
      void this.broadcastStatus();
      return this.settingsProfiles;
    }
    const result = await this.sendNativeRequest("settings.profile.save", {
      browserName: this.browserName,
      profileId: this.settingsProfiles.activeProfileId,
      content
    });
    const nextState = SettingsProfileStateSchema.parse(result.settingsProfiles);
    await this.applySettingsProfileState(nextState);
    return this.settingsProfiles;
  }

  private async selectSettingsProfile(profileId: string): Promise<SettingsProfileState> {
    const result = await this.sendNativeRequest("settings.profile.select", {
      browserName: this.browserName,
      profileId
    });
    const nextState = SettingsProfileStateSchema.parse(result.settingsProfiles);
    await this.applySettingsProfileState(nextState);
    return this.settingsProfiles;
  }

  private async createSettingsProfile(): Promise<SettingsProfileState> {
    const result = await this.sendNativeRequest("settings.profile.create", {
      browserName: this.browserName
    });
    const nextState = SettingsProfileStateSchema.parse(result.settingsProfiles);
    await this.applySettingsProfileState(nextState);
    return this.settingsProfiles;
  }

  private async renameActiveSettingsProfile(name: string): Promise<SettingsProfileState> {
    const nextName = SettingsProfileNameSchema.parse(name.trim());
    const result = await this.sendNativeRequest("settings.profile.rename", {
      browserName: this.browserName,
      profileId: this.settingsProfiles.activeProfileId,
      name: nextName
    });
    const nextState = SettingsProfileStateSchema.parse(result.settingsProfiles);
    await this.applySettingsProfileMetadataState(nextState);
    return this.settingsProfiles;
  }

  private async deleteActiveSettingsProfile(): Promise<SettingsProfileState> {
    const result = await this.sendNativeRequest("settings.profile.delete", {
      browserName: this.browserName,
      profileId: this.settingsProfiles.activeProfileId
    });
    const nextState = SettingsProfileStateSchema.parse(result.settingsProfiles);
    if (nextState.activeProfileId === this.settingsProfiles.activeProfileId) {
      await this.applySettingsProfileMetadataState(nextState);
    } else {
      await this.applySettingsProfileState(nextState);
    }
    return this.settingsProfiles;
  }

  private async resetActiveSettingsProfile(): Promise<SettingsProfileState> {
    if (!this.port || this.bridgeState !== "connected") {
      const content = DEFAULT_SETTINGS_PROFILE_CONTENT;
      this.settingsProfiles = SettingsProfileStateSchema.parse({
        ...this.settingsProfiles,
        dirty: false,
        autoSave: content.autoSave,
        content
      });
      await this.applySettingsProfileContent(content, false);
      void this.broadcastStatus();
      return this.settingsProfiles;
    }
    const result = await this.sendNativeRequest("settings.profile.reset", {
      browserName: this.browserName,
      profileId: this.settingsProfiles.activeProfileId
    });
    const nextState = SettingsProfileStateSchema.parse(result.settingsProfiles);
    await this.applySettingsProfileState(nextState);
    return this.settingsProfiles;
  }

  private async setSettingsProfileAutoSave(autoSave: boolean): Promise<SettingsProfileState> {
    await this.prepareSettingsProfileEdit();
    const content = this.createCurrentSettingsProfileContent(autoSave);
    this.settingsProfiles = SettingsProfileStateSchema.parse({
      ...this.settingsProfiles,
      autoSave,
      content,
      dirty: !autoSave
    });
    if (autoSave) {
      await this.saveActiveSettingsProfile(content);
      return this.settingsProfiles;
    }
    void this.broadcastStatus();
    return this.settingsProfiles;
  }

  private async exportSettingsProfiles(): Promise<Record<string, unknown>> {
    const catalog = this.port && this.bridgeState === "connected"
      ? SettingsProfileCatalogSchema.parse((await this.sendNativeRequest("settings.profiles.export", {})).catalog)
      : this.createLocalSettingsProfileCatalog();
    return {
      version: 1,
      kind: "portus.settingsProfiles",
      catalog
    };
  }

  private createLocalSettingsProfileCatalog(): SettingsProfileCatalog {
    const now = this.now().toISOString();
    const currentContent = this.createCurrentSettingsProfileContent();
    return SettingsProfileCatalogSchema.parse({
      version: 1,
      maxCustomProfiles: this.settingsProfiles.maxCustomProfiles,
      profiles: this.settingsProfiles.profiles.map((profile) => ({
        ...profile,
        content: profile.profileId === this.settingsProfiles.activeProfileId ? currentContent : DEFAULT_SETTINGS_PROFILE_CONTENT,
        createdAt: now,
        updatedAt: now
      })),
      activeProfileByBrowserType: {
        [this.browserName]: this.settingsProfiles.activeProfileId
      }
    });
  }

  async setTerminalPreferences(input: unknown, applyToHost = true, syncProfile = true): Promise<TerminalSettings> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    const next = TerminalSettingsSchema.parse(input);
    const disabling = this.terminalPreferences.enabled && !next.enabled;
    this.terminalPreferences = next;
    if (!syncProfile) await this.persistTerminalPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    if (!applyToHost) return this.terminalPreferences;
    if (disabling) {
      if (this.terminalPort) {
        try {
          await this.sendTerminalClientMessage({
            type: "terminal.settings.set",
            requestId: createTerminalRequestId(),
            payload: { settings: this.terminalPreferences }
          });
        } catch {
          // The user preference still wins if the terminal host is already unavailable.
        }
      }
      await this.disconnectTerminalTransport();
      return this.terminalPreferences;
    }
    if (this.terminalPreferences.enabled) {
      await this.sendTerminalClientMessage({
        type: "terminal.settings.set",
        requestId: createTerminalRequestId(),
        payload: { settings: this.terminalPreferences }
      });
    }
    return this.terminalPreferences;
  }

  async restoreDefaultTerminalPreferences(applyToHost = true, syncProfile = true): Promise<TerminalSettings> {
    return this.setTerminalPreferences(DEFAULT_TERMINAL_PREFERENCES, applyToHost, syncProfile);
  }

  async addPolicyOrigin(
    kind: "allow" | "block",
    origin: string,
    source: "extension" | "cli" | "config" = "extension",
    reason?: string,
    syncBroker = source === "extension",
    syncProfile = syncBroker
  ): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    const entry = this.createPolicyEntry(origin, source, reason);
    const allowed = new Map(this.policyPreferences.allowedOrigins.map((item) => [item.origin, item]));
    const blocked = new Map(this.policyPreferences.blockedOrigins.map((item) => [item.origin, item]));

    if (kind === "allow") {
      allowed.set(entry.origin, entry);
    } else {
      blocked.set(entry.origin, entry);
    }

    this.policyPreferences = PolicyPreferencesSchema.parse({
      ...this.policyPreferences,
      allowedOrigins: [...allowed.values()],
      blockedOrigins: [...blocked.values()]
    });
    if (!syncProfile) await this.persistPolicyPreferences();
    if (syncBroker) void this.syncPolicyPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.policyPreferences;
  }

  async removePolicyOrigin(kind: "allow" | "block", origin: string, syncBroker = true, syncProfile = syncBroker): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) throw invalidOriginError(origin);

    const allowed = new Map(this.policyPreferences.allowedOrigins.map((item) => [item.origin, item]));
    const blocked = new Map(this.policyPreferences.blockedOrigins.map((item) => [item.origin, item]));
    if (kind === "allow") allowed.delete(normalizedOrigin);
    else blocked.delete(normalizedOrigin);

    this.policyPreferences = PolicyPreferencesSchema.parse({
      ...this.policyPreferences,
      allowedOrigins: [...allowed.values()],
      blockedOrigins: [...blocked.values()]
    });
    if (!syncProfile) await this.persistPolicyPreferences();
    if (syncBroker) void this.syncPolicyPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.policyPreferences;
  }

  async clearPolicyOrigins(kind: "allow" | "block", syncBroker = true, syncProfile = syncBroker): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.policyPreferences = PolicyPreferencesSchema.parse({
      ...this.policyPreferences,
      ...(kind === "allow" ? { allowedOrigins: [] } : { blockedOrigins: [] })
    });
    if (!syncProfile) await this.persistPolicyPreferences();
    if (syncBroker) void this.syncPolicyPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.policyPreferences;
  }

  async setSessionStepRetentionLimit(limit: number, syncBroker = true, syncProfile = syncBroker): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.policyPreferences = PolicyPreferencesSchema.parse({
      ...this.policyPreferences,
      sessionStepRetentionLimit: limit
    });
    if (!syncProfile) await this.persistPolicyPreferences();
    if (syncBroker) void this.syncPolicyPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.policyPreferences;
  }

  async setOriginPolicyEnabled(enabled: boolean, syncBroker = true, syncProfile = syncBroker): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.policyPreferences = PolicyPreferencesSchema.parse({
      ...this.policyPreferences,
      originPolicyEnabled: enabled
    });
    if (!syncProfile) await this.persistPolicyPreferences();
    if (syncBroker) void this.syncPolicyPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.policyPreferences;
  }

  async setPolicyMode(mode: PolicyMode, syncBroker = true, syncProfile = syncBroker): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.policyPreferences = PolicyPreferencesSchema.parse({
      ...this.policyPreferences,
      policyMode: mode
    });
    if (!syncProfile) await this.persistPolicyPreferences();
    if (syncBroker) void this.syncPolicyPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.policyPreferences;
  }

  async setCommandPolicyEnabled(commandType: CommandType, enabled: boolean, syncBroker = true, syncProfile = syncBroker): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.policyPreferences = PolicyPreferencesSchema.parse({
      ...this.policyPreferences,
      commandPolicy: {
        ...DEFAULT_COMMAND_POLICY,
        ...this.policyPreferences.commandPolicy,
        [commandType]: enabled
      }
    });
    if (!syncProfile) await this.persistPolicyPreferences();
    if (syncBroker) void this.syncPolicyPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.policyPreferences;
  }

  async setAdvancedBackendEnabled(enabled: boolean, syncBroker = true, syncProfile = syncBroker): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.policyPreferences = PolicyPreferencesSchema.parse({
      ...this.policyPreferences,
      advancedBackendEnabled: enabled
    });
    if (!syncProfile) await this.persistPolicyPreferences();
    if (syncBroker) void this.syncPolicyPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.policyPreferences;
  }

  async importPolicyPreferences(input: unknown, syncBroker = true, syncProfile = syncBroker): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.policyPreferences = PolicyPreferencesSchema.parse(input);
    if (!syncProfile) await this.persistPolicyPreferences();
    if (syncBroker) void this.syncPolicyPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.policyPreferences;
  }

  async restoreDefaultPolicyPreferences(syncBroker = true, syncProfile = syncBroker): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.policyPreferences = PolicyPreferencesSchema.parse({});
    if (!syncProfile) await this.persistPolicyPreferences();
    if (syncBroker) void this.syncPolicyPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.policyPreferences;
  }

  async setDefaultPanelView(defaultPanelView: ExtensionUxPreferences["defaultPanelView"], syncProfile = true): Promise<ExtensionUxPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.uxPreferences = ExtensionUxPreferencesSchema.parse({
      ...this.uxPreferences,
      defaultPanelView
    });
    if (!syncProfile) await this.persistUxPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    void this.broadcastStatus();
    return this.uxPreferences;
  }

  async setIconClickBehavior(iconClickBehavior: IconClickBehavior, syncProfile = true): Promise<ExtensionUxPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.uxPreferences = ExtensionUxPreferencesSchema.parse({
      ...this.uxPreferences,
      iconClickBehavior
    });
    if (!syncProfile) await this.persistUxPreferences();
    await this.applySidePanelBehavior();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.uxPreferences;
  }

  async importUxPreferences(input: unknown, syncProfile = true): Promise<ExtensionUxPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.uxPreferences = ExtensionUxPreferencesSchema.parse(input);
    if (!syncProfile) await this.persistUxPreferences();
    await this.applySidePanelBehavior();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.uxPreferences;
  }

  async restoreDefaultUxPreferences(syncProfile = true): Promise<ExtensionUxPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.uxPreferences = ExtensionUxPreferencesSchema.parse({});
    if (!syncProfile) await this.persistUxPreferences();
    await this.applySidePanelBehavior();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.uxPreferences;
  }

  async openSidePanel(): Promise<Record<string, unknown>> {
    await this.ready;
    if (!this.chromeApi.sidePanel?.open) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome side panel API is unavailable."
      });
    }
    const activeTab = await this.getActiveTab().catch(() => null);
    const windowId = activeTab?.windowId;
    if (windowId === undefined) {
      throw createPortusError({
        code: "TARGET_NOT_FOUND",
        message: "No active browser window is available for the side panel."
      });
    }
    await promisifyChromeCall<void>((done) => {
      const result = this.chromeApi.sidePanel?.open({ windowId });
      done(result as Promise<void> | void);
    });
    this.sidePanelOpen = true;
    return { opened: true };
  }

  async closeSidePanel(): Promise<Record<string, unknown>> {
    await this.ready;
    if (!this.chromeApi.sidePanel?.close) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome side panel close API is unavailable."
      });
    }
    const activeTab = await this.getActiveTab().catch(() => null);
    const windowId = activeTab?.windowId;
    if (windowId === undefined) {
      throw createPortusError({
        code: "TARGET_NOT_FOUND",
        message: "No active browser window is available for the side panel."
      });
    }
    await promisifyChromeCall<void>((done) => {
      const result = this.chromeApi.sidePanel?.close?.({ windowId });
      done(result as Promise<void> | void);
    });
    this.sidePanelOpen = false;
    return { closed: true };
  }

  installRuntimeMessageHandlers(): void {
    this.chromeApi.runtime.onConnect?.addListener((port) => {
      this.handleRuntimePortConnect(port);
    });
    this.chromeApi.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
      void this.handleRuntimeMessage(message)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: normalizeExtensionError(error) }));
      return true;
    });
  }

  installSidePanelBehavior(): void {
    this.chromeApi.sidePanel?.onOpened?.addListener?.(() => {
      this.sidePanelOpen = true;
      if (this.terminalPreferences.enabled) void this.connectTerminalTransport().catch(() => undefined);
      void this.broadcastStatus();
    });
    this.chromeApi.sidePanel?.onClosed?.addListener?.(() => {
      this.sidePanelOpen = false;
      void this.broadcastStatus();
    });
    void this.ready
      .then(() => this.applySidePanelBehavior())
      .then(() => this.updateActionState())
      .catch(() => undefined);
  }

  async handleRuntimeMessage(message: unknown): Promise<Record<string, unknown>> {
    if (!isRecord(message) || typeof message.type !== "string") {
      throw createPortusError({ code: "INVALID_MESSAGE", message: "Invalid extension runtime message." });
    }

    switch (message.type) {
      case "portus.status":
        return { status: await this.getStatus() };
      case "portus.bridge.connect":
        return { status: await this.connectBridge() };
      case "portus.bridge.disconnect":
        return { status: await this.disconnectBridge("runtime-message") };
      case "portus.tabs.list":
        return { tabs: await this.listTabs() };
      case "portus.windows.list":
        return { windows: await this.listWindows() };
      case "portus.screenshot.capture":
        return { screenshot: await this.captureScreenshot(readOptionalNumber(message, "tabId")) };
      case "portus.snapshot.capture":
        return { snapshot: await this.captureSnapshot(readOptionalNumber(message, "tabId"), readOptionalSnapshotFilter(message)) };
      case "portus.permission.request": {
        const permission = await this.requestOriginPermission(readString(message, "origin"), readOptionalString(message, "reason"));
        return { permission, status: await this.getStatus() };
      }
      case "portus.permission.revoke": {
        const revoked = await this.revokeOriginPermission(readString(message, "origin"));
        return { ...revoked, status: await this.getStatus() };
      }
      case "portus.policy.get":
        return { policy: this.getPolicyPreferences() };
      case "portus.policy.mode.set": {
        const policy = await this.setPolicyMode(PolicyModeSchema.parse(readString(message, "mode")));
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.allow.add": {
        const policy = await this.addPolicyOrigin("allow", readString(message, "origin"), "extension", readOptionalString(message, "reason"));
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.allow.remove": {
        const policy = await this.removePolicyOrigin("allow", readString(message, "origin"));
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.allow.clear": {
        const policy = await this.clearPolicyOrigins("allow");
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.block.add": {
        const policy = await this.addPolicyOrigin("block", readString(message, "origin"), "extension", readOptionalString(message, "reason"));
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.block.remove": {
        const policy = await this.removePolicyOrigin("block", readString(message, "origin"));
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.block.clear": {
        const policy = await this.clearPolicyOrigins("block");
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.retention.set": {
        const policy = await this.setSessionStepRetentionLimit(readNumber(message, "limit"));
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.enabled.set": {
        const policy = await this.setOriginPolicyEnabled(readBoolean(message, "enabled"));
        return { policy, status: await this.getStatus() };
      }
      case "portus.command-policy.set": {
        const policy = await this.setCommandPolicyEnabled(
          CommandTypeSchema.parse(readString(message, "commandType")),
          readBoolean(message, "enabled")
        );
        return {
          policy,
          status: await this.getStatus()
        };
      }
      case "portus.advanced-backend.set": {
        const policy = await this.setAdvancedBackendEnabled(readBoolean(message, "enabled"));
        return { policy, status: await this.getStatus() };
      }
      case "portus.settings-profile.select": {
        const settingsProfiles = await this.selectSettingsProfile(readString(message, "profileId"));
        return { settingsProfiles, status: await this.getStatus() };
      }
      case "portus.settings-profile.create": {
        const settingsProfiles = await this.createSettingsProfile();
        return { settingsProfiles, status: await this.getStatus() };
      }
      case "portus.settings-profile.rename": {
        const settingsProfiles = await this.renameActiveSettingsProfile(readString(message, "name"));
        return { settingsProfiles, status: await this.getStatus() };
      }
      case "portus.settings-profile.delete": {
        const settingsProfiles = await this.deleteActiveSettingsProfile();
        return { settingsProfiles, status: await this.getStatus() };
      }
      case "portus.settings-profile.save": {
        const settingsProfiles = await this.saveActiveSettingsProfile();
        return { settingsProfiles, status: await this.getStatus() };
      }
      case "portus.settings-profile.reset": {
        const settingsProfiles = await this.resetActiveSettingsProfile();
        return { settingsProfiles, status: await this.getStatus() };
      }
      case "portus.settings-profile.auto-save.set": {
        const settingsProfiles = await this.setSettingsProfileAutoSave(readBoolean(message, "enabled"));
        return { settingsProfiles, status: await this.getStatus() };
      }
      case "portus.settings.export":
        return {
          settings: await this.exportSettingsProfiles(),
          settingsProfiles: this.getSettingsProfiles(),
          policy: this.getPolicyPreferences(),
          ux: this.getUxPreferences(),
          terminal: this.getTerminalPreferences()
        };
      case "portus.settings.import":
        return await this.importSettings(message);
      case "portus.settings.reset":
        await this.resetActiveSettingsProfile();
        return { policy: this.getPolicyPreferences(), ux: this.getUxPreferences(), terminal: this.getTerminalPreferences(), status: await this.getStatus() };
      case "portus.terminal.settings.get":
        return { terminal: this.getTerminalPreferences() };
      case "portus.terminal.settings.set":
        return { terminal: await this.setTerminalPreferences(readRecord(message, "settings")) };
      case "portus.terminal.settings.reset":
        return { terminal: await this.restoreDefaultTerminalPreferences() };
      case "portus.ux.default-panel-view.set":
        return { ux: await this.setDefaultPanelView(SidePanelDefaultViewSchema.parse(readString(message, "view"))) };
      case "portus.ux.icon-click-behavior.set":
        return { ux: await this.setIconClickBehavior(IconClickBehaviorSchema.parse(readString(message, "behavior"))) };
      case "portus.sidepanel.open":
        return await this.openSidePanel();
      case "portus.sidepanel.close":
        return await this.closeSidePanel();
      default:
        throw createPortusError({
          code: "INVALID_MESSAGE",
          message: `Unsupported extension runtime message type: ${message.type}.`
        });
    }
  }

  async connectTerminalTransport(): Promise<TerminalNativeHostState> {
    await this.ready;
    if (this.terminalNativeHostState === "connected") return this.terminalNativeHostState;
    this.terminalNativeHostState = "connecting";
    try {
      this.terminalPort = this.chromeApi.runtime.connectNative(this.terminalNativeHostName);
      this.terminalPort.onMessage.addListener((message: unknown) => {
        this.handleTerminalNativeMessage(message);
      });
      this.terminalPort.onDisconnect.addListener(() => {
        this.handleTerminalNativeDisconnect();
      });
      this.terminalNativeHostState = "connected";
      return this.terminalNativeHostState;
    } catch (error) {
      this.terminalNativeHostState = "error";
      this.rejectTerminalPending(error instanceof Error ? error : new Error("Terminal Native Host is unavailable."));
      throw normalizeExtensionError(error);
    }
  }

  async disconnectTerminalTransport(): Promise<TerminalNativeHostState> {
    await this.ready;
    this.rejectTerminalPending(new Error("Terminal Native Host disconnected."));
    if (this.terminalPort) this.terminalPort.disconnect();
    this.terminalPort = undefined;
    this.terminalNativeHostState = "disconnected";
    return this.terminalNativeHostState;
  }

  async sendTerminalClientMessage(message: TerminalClientMessage): Promise<TerminalServerMessage | null> {
    await this.connectTerminalTransport();
    const parsed = TerminalClientMessageSchema.parse(message);
    const port = this.terminalPort;
    if (!port) throw createPortusError({ code: "NATIVE_HOST_UNAVAILABLE", message: "Portus Terminal Native Host is not connected.", retryable: true });
    if (!parsed.requestId) {
      port.postMessage(parsed);
      return null;
    }
    return new Promise((resolve, reject) => {
      this.terminalPending.set(parsed.requestId!, { resolve, reject });
      port.postMessage(parsed);
    });
  }

  private handleRuntimePortConnect(port: PortusRuntimePort): void {
    if (port.name === "portus.status") {
      this.statusRuntimePorts.add(port);
      port.onDisconnect.addListener(() => {
        this.statusRuntimePorts.delete(port);
      });
      void this.postStatus(port);
      return;
    }
    if (port.name !== "portus.terminal") return;
    this.terminalRuntimePorts.add(port);
    port.onMessage.addListener((message: unknown) => {
      const parsed = TerminalClientMessageSchema.safeParse(message);
      if (!parsed.success) {
        port.postMessage({
          type: "terminal.session.error",
          payload: { code: "INVALID_MESSAGE", message: "Invalid terminal message." }
        });
        return;
      }
      void this.sendTerminalClientMessage(parsed.data).catch((error) => {
        port.postMessage({
          type: "terminal.session.error",
          requestId: parsed.data.requestId,
          terminalId: "terminalId" in parsed.data ? parsed.data.terminalId : undefined,
          payload: { code: "TERMINAL_UNAVAILABLE", message: error instanceof Error ? error.message : "Terminal transport failed.", retryable: true }
        });
      });
    });
    port.onDisconnect.addListener(() => {
      this.terminalRuntimePorts.delete(port);
    });
    if (this.terminalPreferences.enabled) void this.connectTerminalTransport().catch(() => undefined);
  }

  private handleTerminalNativeMessage(input: unknown): void {
    const parsed = TerminalServerMessageSchema.safeParse(input);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.requestId) {
      const pending = this.terminalPending.get(message.requestId);
      if (pending) {
        this.terminalPending.delete(message.requestId);
        pending.resolve(message);
      }
    }
    for (const port of this.terminalRuntimePorts) port.postMessage(message);
  }

  private handleTerminalNativeDisconnect(): void {
    this.terminalPort = undefined;
    this.terminalNativeHostState = "disconnected";
    this.rejectTerminalPending(new Error("Terminal Native Host disconnected."));
  }

  private rejectTerminalPending(error: Error): void {
    for (const pending of this.terminalPending.values()) pending.reject(error);
    this.terminalPending.clear();
  }

  private async handleNativeMessage(input: unknown): Promise<void> {
    const response = ResponseEnvelopeSchema.safeParse(input);
    if (response.success) {
      this.acceptNativeResponse(response.data);
      return;
    }

    const request = RequestEnvelopeSchema.safeParse(input);
    if (!request.success) {
      return;
    }

    const result = await this.dispatchNativeRequest(request.data)
      .then((value) => createOkResponse(request.data.requestId, value))
      .catch((error) => createErrorResponse(request.data.requestId, normalizeExtensionError(error)));
    this.port?.postMessage(result);
    if (request.data.type === "bridge.disconnect" && result.ok) {
      this.completeNativeRequestedDisconnect();
    }
  }

  private acceptNativeResponse(response: ResponseEnvelope): void {
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    if (pending.timer !== undefined) this.clearRequestTimer(pending.timer);
    pending.resolve(response);
  }

  private async dispatchNativeRequest(request: RequestEnvelope): Promise<Record<string, unknown>> {
    const commandType = canonicalCommandType(request.type);
    if (commandType) this.ensureCommandPolicyAllows(commandType);

    switch (request.type) {
      case "tab.list":
      case "tabs.list":
        return { tabs: await this.listTabs() };
      case "tab.get":
      case "tabs.get":
        return { tab: await this.getTab(readNumber(request.payload, "tabId")) };
      case "tab.open":
      case "tabs.open":
        return { tab: await this.openTab(readString(request.payload, "url"), readOptionalBoolean(request.payload, "active") ?? true, readOptionalNumber(request.payload, "windowId")) };
      case "tab.navigate":
      case "tabs.navigate":
        return { tab: await this.navigateTab(readNumber(request.payload, "tabId"), readString(request.payload, "url")) };
      case "tab.history.back":
        return { tab: await this.navigateTabHistory(readNumber(request.payload, "tabId"), "back") };
      case "tab.history.forward":
        return { tab: await this.navigateTabHistory(readNumber(request.payload, "tabId"), "forward") };
      case "tab.activate":
      case "tabs.activate":
        return { tab: await this.activateTab(readNumber(request.payload, "tabId")) };
      case "tab.close":
      case "tabs.close":
        return await this.closeTab(readNumber(request.payload, "tabId"));
      case "window.list":
      case "windows.list":
        return { windows: await this.listWindows() };
      case "screenshot.capture":
        return { screenshot: await this.captureScreenshot(readOptionalNumber(request.payload, "tabId")) };
      case "snapshot.capture":
        return { snapshot: await this.captureSnapshot(readOptionalNumber(request.payload, "tabId"), readOptionalSnapshotFilter(request.payload)) };
      case "page.wait":
        return { wait: await this.waitForPage({ ...request.payload, timeoutMs: request.timeoutMs }) };
      case "action.click":
        return { action: await this.performAction("click", request.payload) };
      case "action.hover":
        return { action: await this.performAction("hover", request.payload) };
      case "action.drag":
        return { action: await this.performAction("drag", request.payload) };
      case "action.fillForm":
        return { fillForm: await this.fillForm(request.payload) };
      case "action.type":
        return { action: await this.performAction("type", request.payload) };
      case "action.press":
        return { action: await this.performAction("press", request.payload) };
      case "action.scroll":
        return { action: await this.performAction("scroll", request.payload) };
      case "page.dismiss":
        return { dismiss: await this.dismissPage(request.payload) };
      case "dialog.dismiss":
        return { dialog: await this.handleDialog("dismiss", request.payload) };
      case "dialog.accept":
        return { dialog: await this.handleDialog("accept", request.payload) };
      case "console.list":
        return { console: await this.listConsoleMessages(request.payload) };
      case "console.clear":
        return await this.clearConsoleMessages(request.payload);
      case "network.list":
        return { network: await this.listNetworkRecords(request.payload) };
      case "network.get":
        return { network: await this.getNetworkRecord(request.payload) };
      case "permission.list":
        return { permissions: [...this.allowlist.values()] };
      case "permission.request":
        return { permission: await this.requestOriginPermission(readString(request.payload, "origin"), readOptionalString(request.payload, "reason")) };
      case "permission.revoke":
        return await this.revokeOriginPermission(readString(request.payload, "origin"));
      case "policy.get":
        return { policy: this.getPolicyPreferences() };
      case "policy.allow.add":
        return { policy: await this.addPolicyOrigin("allow", readString(request.payload, "origin"), "cli", readOptionalString(request.payload, "reason"), false) };
      case "policy.allow.remove":
        return { policy: await this.removePolicyOrigin("allow", readString(request.payload, "origin"), false) };
      case "policy.block.add":
        return { policy: await this.addPolicyOrigin("block", readString(request.payload, "origin"), "cli", readOptionalString(request.payload, "reason"), false) };
      case "policy.block.remove":
        return { policy: await this.removePolicyOrigin("block", readString(request.payload, "origin"), false) };
      case "policy.retention.set":
        return { policy: await this.setSessionStepRetentionLimit(readNumber(request.payload, "limit"), false) };
      case "settings.profile.apply-selection":
      case "settings.profile.apply-saved-content": {
        const settingsProfiles = SettingsProfileStateSchema.parse(request.payload.settingsProfiles);
        await this.applySettingsProfileState(settingsProfiles);
        return { status: await this.getStatus() };
      }
      case "settings.profile.apply-metadata": {
        const settingsProfiles = SettingsProfileStateSchema.parse(request.payload.settingsProfiles);
        await this.applySettingsProfileMetadataState(settingsProfiles);
        return { status: await this.getStatus() };
      }
      case "bridge.disconnect":
        return { status: this.prepareNativeRequestedDisconnect(readOptionalString(request.payload, "reason") ?? "cli-requested") };
      default:
        throw createPortusError({
          code: "CAPABILITY_UNAVAILABLE",
          message: `Extension command is unavailable: ${request.type}.`
        });
    }
  }

  private sendNativeRequest(type: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const port = this.port;
    if (!port) {
      return Promise.reject(createPortusError({
        code: "NATIVE_HOST_UNAVAILABLE",
        message: "Portus Native Host is not connected.",
        retryable: true
      }));
    }

    const request = RequestEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: this.createRequestId(),
      kind: "request",
      type,
      payload
    });

    return new Promise((resolve, reject) => {
      const timer = this.setRequestTimer(() => {
        this.pending.delete(request.requestId);
        reject(createPortusError({
          code: "COMMAND_TIMEOUT",
          message: `Native request timed out after ${this.nativeRequestTimeoutMs}ms.`,
          retryable: true,
          details: {
            requestId: request.requestId,
            type,
            timeoutMs: this.nativeRequestTimeoutMs
          }
        }));
      }, this.nativeRequestTimeoutMs);
      this.pending.set(request.requestId, {
        resolve: (response) => {
          if (response.ok) resolve(response.result);
          else reject(response.error);
        },
        reject,
        timer
      });
      port.postMessage(request);
    });
  }

  private sendNativeOneWayRequest(type: string, payload: Record<string, unknown>): void {
    const port = this.port;
    if (!port) return;
    const request = RequestEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: this.createRequestId(),
      kind: "request",
      type,
      payload
    });
    try {
      port.postMessage(request);
    } catch {
      this.brokerState = "error";
      void this.broadcastStatus();
    }
  }

  private prepareNativeRequestedDisconnect(reason: string): PortusExtensionStatus {
    this.bridgeState = "disconnecting";
    this.intentionalDisconnect = true;
    this.stopHeartbeat();
    this.brokerState = reason === "cli-requested" ? "connected" : this.brokerState;
    return {
      bridgeState: this.bridgeState,
      nativeHostState: this.nativeHostState,
      brokerState: this.brokerState,
      sidePanelOpen: this.sidePanelOpen,
      permissionState: this.permissionState,
      activeTabOrigin: null,
      activeTabUrl: null,
      browserId: this.browserId,
      nativeHostName: this.nativeHostName,
      terminalNativeHostName: this.terminalNativeHostName,
      terminalNativeHostState: this.terminalNativeHostState,
      allowlist: [...this.allowlist.values()],
      policyPreferences: this.policyPreferences,
      uxPreferences: this.uxPreferences,
      terminalPreferences: this.terminalPreferences,
      settingsProfiles: this.settingsProfiles
    };
  }

  private completeNativeRequestedDisconnect(): void {
    if (this.port) this.port.disconnect();
    this.clearConnectionState();
    void this.updateActionState();
    void this.broadcastStatus();
  }

  private startHeartbeat(heartbeatIntervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = this.setTimer(() => {
      if (!this.browserId || this.bridgeState !== "connected") return;
      void this.sendNativeRequest("bridge.heartbeat", {
        browserId: this.browserId,
        bridgeStatus: "connected",
        sentAt: this.now().toISOString()
      }).catch(() => {
        this.handleBridgeTransportFailure();
      });
    }, heartbeatIntervalMs);
  }

  private async syncPolicyPreferences(): Promise<void> {
    if (!this.browserId || !this.port || this.bridgeState !== "connected") return;
    try {
      await this.sendNativeRequest("policy.sync", {
        browserId: this.browserId,
        policyPreferences: this.policyPreferences
      });
      this.brokerState = "connected";
    } catch {
      this.brokerState = "error";
    }
  }

  private async importSettings(message: Record<string, unknown>): Promise<Record<string, unknown>> {
    const profileCatalog = this.readImportedSettingsProfileCatalog(message);
    if (profileCatalog) {
      await this.sendNativeRequest("settings.profiles.import", { catalog: profileCatalog });
      const stateResult = await this.sendNativeRequest("settings.profile.state", { browserName: this.browserName });
      const settingsProfiles = SettingsProfileStateSchema.parse(stateResult.settingsProfiles);
      await this.applySettingsProfileState(settingsProfiles);
      return { settingsProfiles, status: await this.getStatus() };
    }

    const hasPolicy = Object.prototype.hasOwnProperty.call(message, "policyPreferences");
    const hasUx = Object.prototype.hasOwnProperty.call(message, "uxPreferences");
    const hasTerminal = Object.prototype.hasOwnProperty.call(message, "terminalPreferences");
    if (!hasPolicy && !hasUx && !hasTerminal) {
      throw createPortusError({
        code: "INVALID_MESSAGE",
        message: "Imported settings must include policyPreferences, uxPreferences, or terminalPreferences."
      });
    }

    const parsedPolicy = hasPolicy ? PolicyPreferencesSchema.parse(readRecord(message, "policyPreferences")) : undefined;
    const parsedUx = hasUx ? ExtensionUxPreferencesSchema.parse(readRecord(message, "uxPreferences")) : undefined;
    const parsedTerminal = hasTerminal ? TerminalSettingsSchema.parse(readRecord(message, "terminalPreferences")) : undefined;
    const policy = parsedPolicy ? await this.importPolicyPreferences(parsedPolicy) : this.getPolicyPreferences();
    const ux = parsedUx ? await this.importUxPreferences(parsedUx) : this.getUxPreferences();
    const terminal = parsedTerminal ? await this.setTerminalPreferences(parsedTerminal, false) : this.getTerminalPreferences();
    return { policy, ux, terminal };
  }

  private readImportedSettingsProfileCatalog(message: Record<string, unknown>): SettingsProfileCatalog | null {
    const directCatalog = SettingsProfileCatalogSchema.safeParse(message.catalog);
    if (directCatalog.success) return directCatalog.data;

    const settings = isRecord(message.settings) ? message.settings : undefined;
    if (!settings) return null;
    const settingsCatalog = SettingsProfileCatalogSchema.safeParse(settings.catalog);
    if (settingsCatalog.success) return settingsCatalog.data;
    return null;
  }

  private async applySidePanelBehavior(): Promise<void> {
    if (!this.chromeApi.sidePanel?.setPanelBehavior) return;
    await promisifyChromeCall<void>((done) => {
      const result = this.chromeApi.sidePanel?.setPanelBehavior?.({
        openPanelOnActionClick: this.uxPreferences.iconClickBehavior === "side-panel"
      });
      done(result as Promise<void> | void);
    });
  }

  private async updateActionState(): Promise<void> {
    const action = this.chromeApi.action;
    if (!action) return;
    const label = actionLabelForBridgeState(this.bridgeState);
    await promisifyChromeCall<void>((done) => {
      const result = action.setTitle({ title: `Portus: ${label}` });
      done(result as Promise<void> | void);
    }).catch(() => undefined);
    if (action.setBadgeText) {
      await promisifyChromeCall<void>((done) => {
        const result = action.setBadgeText?.({ text: actionBadgeTextForBridgeState(this.bridgeState) });
        done(result as Promise<void> | void);
      }).catch(() => undefined);
    }
    if (action.setBadgeBackgroundColor) {
      await promisifyChromeCall<void>((done) => {
        const result = action.setBadgeBackgroundColor?.({ color: actionBadgeColorForBridgeState(this.bridgeState) });
        done(result as Promise<void> | void);
      }).catch(() => undefined);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === undefined) return;
    this.clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private scheduleReconnect(): void {
    if (!this.bridgeShouldConnect || this.reconnectTimer !== undefined || this.bridgeState === "connected" || this.bridgeState === "connecting") return;
    this.reconnectTimer = this.setTimer(() => {
      if (!this.bridgeShouldConnect || this.bridgeState === "connected" || this.bridgeState === "connecting") {
        this.stopReconnectTimer();
        return;
      }
      void this.initializeBridge();
    }, 3000);
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer === undefined) return;
    this.clearTimer(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private handleNativeDisconnect(): void {
    this.rejectPending(createPortusError({
      code: "NATIVE_HOST_UNAVAILABLE",
      message: "Portus Native Host disconnected.",
      retryable: true
    }));
    this.stopHeartbeat();
    if (this.intentionalDisconnect) return;
    this.bridgeState = "error";
    this.nativeHostState = "disconnected";
    this.brokerState = "unavailable";
    this.browserId = null;
    void this.updateActionState();
    void this.broadcastStatus();
    this.scheduleReconnect();
  }

  private handleBridgeTransportFailure(): void {
    if (this.bridgeState !== "connected") return;
    this.stopHeartbeat();
    this.bridgeState = "error";
    this.brokerState = "unavailable";
    this.browserId = null;
    void this.updateActionState();
    void this.broadcastStatus();
    if (this.port) {
      this.port.disconnect();
      this.port = undefined;
    }
    this.scheduleReconnect();
  }

  private async broadcastStatus(): Promise<void> {
    if (this.statusRuntimePorts.size === 0) return;
    const status = await this.getStatus();
    for (const port of this.statusRuntimePorts) {
      try {
        port.postMessage({ type: "portus.status.updated", status });
      } catch {
        this.statusRuntimePorts.delete(port);
      }
    }
  }

  private async postStatus(port: PortusRuntimePort): Promise<void> {
    try {
      port.postMessage({ type: "portus.status.updated", status: await this.getStatus() });
    } catch {
      this.statusRuntimePorts.delete(port);
    }
  }

  private clearConnectionState(): void {
    this.rejectPending(createPortusError({
      code: "BRIDGE_DISCONNECTED",
      message: "Portus Bridge disconnected.",
      retryable: true
    }));
    this.port = undefined;
    this.browserId = null;
    this.bridgeState = "disconnected";
    this.nativeHostState = "disconnected";
    this.brokerState = "unknown";
    this.intentionalDisconnect = false;
  }

  private rejectPending(error: PortusError): void {
    for (const pending of this.pending.values()) {
      if (pending.timer !== undefined) this.clearRequestTimer(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private registrationPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      browserName: this.browserName,
      extensionVersion: this.extensionVersion,
      extensionId: this.chromeApi.runtime.id ?? "portus-extension-development",
      bridgeStatus: "connected",
      capabilities: this.chromeApi.debugger
        ? ["tabs", "windows", "screenshots", "snapshots", "actions", "advanced-debugger", "permissions", "events"]
        : ["tabs", "windows", "screenshots", "snapshots", "actions", "permissions", "events"],
      policyPreferences: this.policyPreferences,
      settingsProfileContent: this.createCurrentSettingsProfileContent()
    };
    if (this.browserLabel) payload.browserLabel = this.browserLabel;
    if (this.profileLabel) payload.profileLabel = this.profileLabel;
    return payload;
  }

  private publishTabLifecycleEvent(
    type: "tab.created" | "tab.updated" | "tab.activated",
    tab: ChromeTab,
    details: Record<string, unknown> = {}
  ): void {
    if (tab.id === undefined) return;
    const portusTab = this.toPortusTab(tab);
    this.publishBrowserEvent(type, {
      ...details,
      tab: portusTab,
      tabId: portusTab.tabId,
      windowId: portusTab.windowId,
      url: portusTab.url,
      title: portusTab.title,
      status: portusTab.status
    }, portusTab.tabId);
  }

  private publishBrowserEvent(
    type: "tab.created" | "tab.updated" | "tab.activated" | "tab.closed" | "advanced.backend.attached" | "advanced.backend.detached" | "advanced.backend.failed",
    payload: Record<string, unknown>,
    tabId?: number
  ): void {
    if (this.bridgeState !== "connected" || !this.browserId || !this.port) return;
    void this.sendNativeRequest("event.publish", {
      browserId: this.browserId,
      type,
      tabId,
      payload
    }).catch(() => {
      // Browser lifecycle events are best-effort and must not interrupt user navigation.
    });
  }

  private publishAdvancedBackendEvent(
    type: "advanced.backend.attached" | "advanced.backend.detached" | "advanced.backend.failed",
    tabId: number,
    payload: Record<string, unknown>
  ): void {
    this.publishBrowserEvent(type, {
      backend: "debugger-cdp",
      tabId,
      ...payload
    }, tabId);
  }

  private toPortusTab(tab: ChromeTab): Tab {
    const input: Record<string, unknown> = {
      browserId: this.browserId ?? "br_000000",
      tabId: tab.id ?? -1,
      windowId: tab.windowId,
      index: tab.index,
      active: tab.active,
      pinned: tab.pinned ?? false,
      discarded: tab.discarded ?? false,
      title: tab.title ?? "",
      url: tab.url ?? ""
    };
    if (tab.favIconUrl) input.favIconUrl = tab.favIconUrl;
    if (tab.status) input.status = tab.status;
    return TabSchema.parse(input);
  }

  private async getChromeTab(tabId: number): Promise<ChromeTab> {
    return mapChromeTabOperation(tabId, promisifyChromeCall<ChromeTab>((done) => {
      const result = this.chromeApi.tabs.get(tabId);
      done(result as Promise<ChromeTab> | ChromeTab | undefined);
    }));
  }

  private async getActiveTab(): Promise<ChromeTab> {
    const tabs = await promisifyChromeCall<ChromeTab[]>((done) => {
      const result = this.chromeApi.tabs.query({ active: true, currentWindow: true });
      done(result as Promise<ChromeTab[]> | ChromeTab[] | undefined);
    });
    const tab = tabs[0];
    if (!tab) {
      throw createPortusError({
        code: "TAB_NOT_FOUND",
        message: "No active tab is available."
      });
    }
    return tab;
  }

  private async getActiveTabForWindow(windowId: number): Promise<ChromeTab | undefined> {
    const tabs = await promisifyChromeCall<ChromeTab[]>((done) => {
      const result = this.chromeApi.tabs.query({ active: true, windowId });
      done(result as Promise<ChromeTab[]> | ChromeTab[] | undefined);
    });
    return tabs[0];
  }

  private requireBrowserId(): string {
    if (!this.browserId) {
      throw createPortusError({
        code: "BROWSER_SESSION_UNAVAILABLE",
        message: "Browser session is unavailable."
      });
    }
    return this.browserId;
  }

  private async ensureTabPermission(tab: ChromeTab): Promise<void> {
    const origin = getTabOrigin(tab);
    const record = this.allowlist.get(origin);
    if (record?.granted) return;
    if (this.chromeApi.permissions?.contains) {
      const granted = await promisifyChromeCall<boolean>((done) => {
        const result = this.chromeApi.permissions?.contains({ origins: [toHostPermissionPattern(origin)] });
        done(result as Promise<boolean> | boolean | undefined);
      });
      if (granted) return;
    }
    throw createPortusError({
      code: "PERMISSION_REQUIRED",
      message: `Host permission is required for ${origin}. Use the Portus Browser extension popup to request permission.`,
      details: { origin }
    });
  }

  private ensureTabPolicyAllowed(tab: ChromeTab): void {
    const origin = getTabOrigin(tab);
    this.ensureOriginPolicyAllowed(origin);
  }

  private ensureOriginPolicyAllowed(origin: string): void {
    if (this.policyPreferences.originPolicyEnabled === false) return;
    if (this.policyPreferences.policyMode === "blocklist") {
      if (this.policyPreferences.blockedOrigins.some((entry) => policyOriginMatches(entry.origin, origin))) {
        throw createPortusError({
          code: "ORIGIN_BLOCKED",
          message: `Portus policy blocks browser control for ${origin}.`,
          details: { origin }
        });
      }
      return;
    }

    if (this.policyPreferences.allowedOrigins.some((entry) => policyOriginMatches(entry.origin, origin))) return;

    throw createPortusError({
      code: "ORIGIN_BLOCKED",
      message: `Portus policy does not allow browser control for ${origin}.`,
      details: { origin }
    });
  }

  private ensureCommandPolicyAllows(commandType: CommandType): void {
    if (this.policyPreferences.commandPolicy[commandType] !== false) return;
    throw createPortusError({
      code: "COMMAND_DISABLED_BY_POLICY",
      message: `Portus policy disables command ${commandType}.`,
      details: { commandType }
    });
  }

  private async executeSnapshotScript(tabId: number): Promise<Record<string, unknown>> {
    if (!this.chromeApi.scripting) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome scripting API is unavailable."
      });
    }
    const results = await mapChromePermissionOperation("execute snapshot script", promisifyChromeCall<Array<{ result?: unknown }>>((done) => {
      const result = this.chromeApi.scripting?.executeScript({
        target: { tabId },
        func: capturePortusSnapshotPayload
      });
      done(result as Promise<Array<{ result?: unknown }>> | Array<{ result?: unknown }> | undefined);
    }));
    const page = results[0]?.result;
    if (!isRecord(page)) {
      throw createPortusError({
        code: "ACTION_FAILED",
        message: "Snapshot script returned an invalid result."
      });
    }
    return page;
  }

  private async executePageWaitScript(tabId: number, condition: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.chromeApi.scripting) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome scripting API is unavailable."
      });
    }
    const results = await mapChromePermissionOperation("execute page wait script", promisifyChromeCall<Array<{ result?: unknown }>>((done) => {
      const result = this.chromeApi.scripting?.executeScript({
        target: { tabId },
        func: evaluatePortusPageWait,
        args: [condition]
      });
      done(result as Promise<Array<{ result?: unknown }>> | Array<{ result?: unknown }> | undefined);
    }));
    const waitResult = results[0]?.result;
    if (!isRecord(waitResult) || typeof waitResult.matched !== "boolean") {
      throw createPortusError({
        code: "ACTION_FAILED",
        message: "Page wait script returned an invalid result."
      });
    }
    return waitResult;
  }

  private async executeConsoleListScript(tabId: number): Promise<Record<string, unknown>[]> {
    if (!this.chromeApi.scripting) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome scripting API is unavailable."
      });
    }
    const results = await mapChromePermissionOperation("execute console capture script", promisifyChromeCall<Array<{ result?: unknown }>>((done) => {
      const result = this.chromeApi.scripting?.executeScript({
        target: { tabId },
        func: capturePortusConsoleMessages,
        world: "MAIN"
      });
      done(result as Promise<Array<{ result?: unknown }>> | Array<{ result?: unknown }> | undefined);
    }));
    const messages = results[0]?.result;
    return Array.isArray(messages) ? messages.filter(isRecord) : [];
  }

  private async executeConsoleClearScript(tabId: number): Promise<void> {
    if (!this.chromeApi.scripting) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome scripting API is unavailable."
      });
    }
    await mapChromePermissionOperation("execute console clear script", promisifyChromeCall<Array<{ result?: unknown }>>((done) => {
      const result = this.chromeApi.scripting?.executeScript({
        target: { tabId },
        func: clearPortusConsoleMessages,
        world: "MAIN"
      });
      done(result as Promise<Array<{ result?: unknown }>> | Array<{ result?: unknown }> | undefined);
    }));
  }

  private async executeActionScript(tabId: number, payload: Record<string, unknown>): Promise<{
    ok: true;
    details?: Record<string, unknown>;
  } | {
    ok: false;
    error: PortusError;
  }> {
    if (!this.chromeApi.scripting) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome scripting API is unavailable."
      });
    }
    const results = await mapChromePermissionOperation("execute action script", promisifyChromeCall<Array<{ result?: unknown }>>((done) => {
      const result = this.chromeApi.scripting?.executeScript({
        target: { tabId },
        func: performPortusDomAction,
        args: [payload]
      });
      done(result as Promise<Array<{ result?: unknown }>> | Array<{ result?: unknown }> | undefined);
    }));
    const actionResult = results[0]?.result;
    if (!isRecord(actionResult) || typeof actionResult.ok !== "boolean") {
      throw createPortusError({
        code: "ACTION_FAILED",
        message: "Action script returned an invalid result."
      });
    }
    if (actionResult.ok) {
      const success: {
        ok: true;
        details?: Record<string, unknown>;
      } = {
        ok: true,
      };
      if (isRecord(actionResult.details)) success.details = actionResult.details;
      return success;
    }
    const error = PortusErrorSchema.safeParse(actionResult.error);
    return {
      ok: false,
      error: error.success ? error.data : createPortusError({
        code: "ACTION_FAILED",
        message: "DOM action failed."
      })
    };
  }

  private shouldUseDebuggerBackend(): boolean {
    return this.policyPreferences.advancedBackendEnabled === true;
  }

  private ensureAdvancedBackendAvailable(): void {
    if (this.policyPreferences.advancedBackendEnabled !== true) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Advanced debugger backend is disabled. Enable it in the Portus Browser side panel."
      });
    }
    if (!this.chromeApi.debugger) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome debugger API is unavailable."
      });
    }
  }

  private async executeDebuggerDragAction(
    tabId: number,
    sourceElement: SnapshotElement | null,
    targetElement: SnapshotElement | null
  ): Promise<ActionResult> {
    this.ensureAdvancedBackendAvailable();
    if (!sourceElement || !targetElement) {
      throw createPortusError({
        code: "SNAPSHOT_STALE",
        message: "Drag source or target is unavailable in the current snapshot."
      });
    }

    const source = centerOfBounds(sourceElement.bounds);
    const target = centerOfBounds(targetElement.bounds);
    await this.withDebuggerSession(tabId, async (debuggerTarget) => {
      await this.sendDebuggerCommand(debuggerTarget, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: source.x,
        y: source.y,
        button: "none"
      });
      await this.sendDebuggerCommand(debuggerTarget, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: source.x,
        y: source.y,
        button: "left",
        buttons: 1,
        clickCount: 1
      });
      await this.sendDebuggerCommand(debuggerTarget, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: target.x,
        y: target.y,
        button: "left",
        buttons: 1
      });
      await this.sendDebuggerCommand(debuggerTarget, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: target.x,
        y: target.y,
        button: "left",
        buttons: 0,
        clickCount: 1
      });
    }, "action.drag");

    return ActionResultSchema.parse({
      backend: "debugger-cdp",
      completedAt: this.now().toISOString(),
      snapshotInvalidated: true,
      details: {
        action: "drag",
        sourceElementId: sourceElement.elementId,
        targetElementId: targetElement.elementId,
        source,
        target
      }
    });
  }

  private async withDebuggerSession<T>(
    tabId: number,
    operation: (target: ChromeDebuggerTarget) => Promise<T>,
    reason: string
  ): Promise<T> {
    this.ensureAdvancedBackendAvailable();
    const target = { tabId };
    let attached = false;
    try {
      await this.attachDebugger(target);
      attached = true;
      this.publishAdvancedBackendEvent("advanced.backend.attached", tabId, { reason });
      try {
        return await operation(target);
      } catch (error) {
        this.publishAdvancedBackendEvent("advanced.backend.failed", tabId, {
          reason,
          error: error instanceof Error ? error.message : "debugger command failed"
        });
        throw error;
      }
    } finally {
      if (attached) {
        try {
          await this.detachDebugger(target);
          this.publishAdvancedBackendEvent("advanced.backend.detached", tabId, { reason });
        } catch {
          this.publishAdvancedBackendEvent("advanced.backend.failed", tabId, {
            reason,
            error: "debugger detach failed"
          });
        }
      }
    }
  }

  private async attachDebugger(target: ChromeDebuggerTarget): Promise<void> {
    await mapChromeDebuggerOperation("attach debugger", promisifyChromeCall<void>((done) => {
      const result = this.chromeApi.debugger?.attach(target, "1.3");
      done(result as Promise<void> | void);
    }));
  }

  private async detachDebugger(target: ChromeDebuggerTarget): Promise<void> {
    await mapChromeDebuggerOperation("detach debugger", promisifyChromeCall<void>((done) => {
      const result = this.chromeApi.debugger?.detach(target);
      done(result as Promise<void> | void);
    }));
  }

  private async sendDebuggerCommand(target: ChromeDebuggerTarget, method: string, commandParams?: Record<string, unknown>): Promise<unknown> {
    return await mapChromeDebuggerOperation(method, promisifyChromeCall<unknown>((done) => {
      const result = this.chromeApi.debugger?.sendCommand(target, method, commandParams);
      done(result as Promise<unknown> | unknown | undefined);
    }));
  }

  private createRequestId(): string {
    const suffix = `${this.now().getTime().toString(36)}_${this.requestCounter++}`;
    return `req_${suffix}`;
  }

  private async requestChromeOriginPermission(pattern: string): Promise<boolean> {
    if (!this.chromeApi.permissions) return false;
    return promisifyChromeCall<boolean>((done) => {
      const result = this.chromeApi.permissions?.request({ origins: [pattern] });
      done(result as Promise<boolean> | boolean | undefined);
    });
  }

  private async getOriginPermissionState(origin: string): Promise<PermissionState> {
    if (this.allowlist.has(origin)) return "granted";
    if (!this.chromeApi.permissions) return "missing";
    try {
      const granted = await promisifyChromeCall<boolean>((done) => {
        const result = this.chromeApi.permissions?.contains({ origins: [toHostPermissionPattern(origin)] });
        done(result as Promise<boolean> | boolean | undefined);
      });
      return granted ? "granted" : "missing";
    } catch {
      return "error";
    }
  }

  private async removeChromeOriginPermission(pattern: string): Promise<boolean> {
    if (!this.chromeApi.permissions) return false;
    return promisifyChromeCall<boolean>((done) => {
      const result = this.chromeApi.permissions?.remove({ origins: [pattern] });
      done(result as Promise<boolean> | boolean | undefined);
    });
  }

  private createPolicyEntry(
    origin: string,
    source: "extension" | "cli" | "config",
    reason?: string
  ): PolicyOriginEntry {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) throw invalidOriginError(origin);
    const input: Record<string, unknown> = {
      origin: normalizedOrigin,
      source,
      updatedAt: this.now().toISOString()
    };
    if (reason) input.reason = reason;
    return PolicyOriginEntrySchema.parse(input);
  }

  private async restoreExtensionState(): Promise<void> {
    await this.restoreAllowlist();
    await this.restorePolicyPreferences();
    await this.restoreUxPreferences();
    await this.restoreTerminalPreferences();
    await this.restoreBridgePreference();
    await this.updateActionState();
  }

  private async restoreAllowlist(): Promise<void> {
    const storage = this.chromeApi.storage?.local;
    if (!storage) return;
    const stored = await promisifyChromeCall<Record<string, unknown>>((done) => {
      const result = storage.get(ALLOWLIST_STORAGE_KEY);
      done(result as Promise<Record<string, unknown>> | Record<string, unknown> | undefined);
    });
    const records = stored[ALLOWLIST_STORAGE_KEY];
    if (!Array.isArray(records)) return;
    for (const record of records) {
      const parsed = PermissionRecordSchema.safeParse(record);
      if (parsed.success) this.allowlist.set(parsed.data.origin, parsed.data);
    }
  }

  private async persistAllowlist(): Promise<void> {
    const storage = this.chromeApi.storage?.local;
    if (!storage) return;
    await promisifyChromeCall<void>((done) => {
      const result = storage.set({ [ALLOWLIST_STORAGE_KEY]: [...this.allowlist.values()] });
      done(result as Promise<void> | void);
    });
  }

  private async restorePolicyPreferences(): Promise<void> {
    const storage = this.chromeApi.storage?.local;
    if (!storage) return;
    const stored = await promisifyChromeCall<Record<string, unknown>>((done) => {
      const result = storage.get(POLICY_STORAGE_KEY);
      done(result as Promise<Record<string, unknown>> | Record<string, unknown> | undefined);
    });
    const parsed = PolicyPreferencesSchema.safeParse(stored[POLICY_STORAGE_KEY]);
    if (parsed.success) this.policyPreferences = parsed.data;
  }

  private async persistPolicyPreferences(): Promise<void> {
    const storage = this.chromeApi.storage?.local;
    if (!storage) return;
    await promisifyChromeCall<void>((done) => {
      const result = storage.set({ [POLICY_STORAGE_KEY]: this.policyPreferences });
      done(result as Promise<void> | void);
    });
  }

  private async restoreUxPreferences(): Promise<void> {
    const storage = this.chromeApi.storage?.local;
    if (!storage) return;
    const stored = await promisifyChromeCall<Record<string, unknown>>((done) => {
      const result = storage.get(UX_STORAGE_KEY);
      done(result as Promise<Record<string, unknown>> | Record<string, unknown> | undefined);
    });
    const parsed = ExtensionUxPreferencesSchema.safeParse(stored[UX_STORAGE_KEY]);
    if (parsed.success) this.uxPreferences = parsed.data;
  }

  private async persistUxPreferences(): Promise<void> {
    const storage = this.chromeApi.storage?.local;
    if (!storage) return;
    await promisifyChromeCall<void>((done) => {
      const result = storage.set({ [UX_STORAGE_KEY]: this.uxPreferences });
      done(result as Promise<void> | void);
    });
  }

  private async restoreTerminalPreferences(): Promise<void> {
    const storage = this.chromeApi.storage?.local;
    if (!storage) return;
    const stored = await promisifyChromeCall<Record<string, unknown>>((done) => {
      const result = storage.get(TERMINAL_PREFERENCES_STORAGE_KEY);
      done(result as Promise<Record<string, unknown>> | Record<string, unknown> | undefined);
    });
    const parsed = TerminalSettingsSchema.safeParse(stored[TERMINAL_PREFERENCES_STORAGE_KEY]);
    if (parsed.success) this.terminalPreferences = parsed.data;
  }

  private async persistTerminalPreferences(): Promise<void> {
    const storage = this.chromeApi.storage?.local;
    if (!storage) return;
    await promisifyChromeCall<void>((done) => {
      const result = storage.set({ [TERMINAL_PREFERENCES_STORAGE_KEY]: this.terminalPreferences });
      done(result as Promise<void> | void);
    });
  }

  private async restoreBridgePreference(): Promise<void> {
    const storage = this.chromeApi.storage?.local;
    if (!storage) return;
    const stored = await promisifyChromeCall<Record<string, unknown>>((done) => {
      const result = storage.get(BRIDGE_PREFERENCE_STORAGE_KEY);
      done(result as Promise<Record<string, unknown>> | Record<string, unknown> | undefined);
    });
    const value = stored[BRIDGE_PREFERENCE_STORAGE_KEY];
    if (typeof value === "boolean") this.bridgeShouldConnect = value;
  }

  private async persistBridgePreference(): Promise<void> {
    const storage = this.chromeApi.storage?.local;
    if (!storage) return;
    await promisifyChromeCall<void>((done) => {
      const result = storage.set({ [BRIDGE_PREFERENCE_STORAGE_KEY]: this.bridgeShouldConnect });
      done(result as Promise<void> | void);
    });
  }
}

export function createPortusExtensionBridge(
  chromeApi: PortusChromeApi = readGlobalChromeApi(),
  options: PortusExtensionBridgeOptions = {}
): PortusExtensionBridge {
  return new PortusExtensionBridge(chromeApi, options);
}

export function detectBrowserName(input: {
  userAgent?: string;
  navigator?: { userAgent?: string; brave?: unknown };
} = {}): BrowserName {
  const navigatorLike = input.navigator ?? globalThis.navigator;
  const userAgent = input.userAgent ?? navigatorLike?.userAgent ?? "";
  if (/\bEdg\//.test(userAgent)) return "Edge";
  if (navigatorLike && "brave" in navigatorLike && navigatorLike.brave !== undefined) return "Brave";
  if (/\bChrome\//.test(userAgent) || /\bChromium\//.test(userAgent)) return "Chrome";
  return "Chrome";
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

function normalizeExtensionError(error: unknown): PortusError {
  if (isPortusError(error)) return error;
  if (error instanceof Error) {
    return createPortusError({
      code: "INTERNAL_ERROR",
      message: error.message
    });
  }
  return createPortusError({
    code: "INTERNAL_ERROR",
    message: "Unexpected extension failure."
  });
}

function isPortusError(error: unknown): error is PortusError {
  return isRecord(error) && typeof error.code === "string" && typeof error.message === "string";
}

function actionLabelForBridgeState(state: BridgeState): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "connecting":
    case "disconnecting":
      return "Connecting";
    case "error":
      return "Error";
    default:
      return "Disconnected";
  }
}

function actionBadgeTextForBridgeState(state: BridgeState): string {
  switch (state) {
    case "connected":
      return "ON";
    case "connecting":
    case "disconnecting":
      return "...";
    case "error":
      return "ERR";
    default:
      return "";
  }
}

function actionBadgeColorForBridgeState(state: BridgeState): string {
  switch (state) {
    case "connected":
      return "#176a35";
    case "connecting":
    case "disconnecting":
      return "#745200";
    case "error":
      return "#9c2b20";
    default:
      return "#5d6973";
  }
}

async function mapChromeTabOperation<T>(tabId: number, operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (isPortusError(error)) throw error;
    throw createPortusError({
      code: "TAB_NOT_FOUND",
      message: `Tab ${tabId} is unavailable.`,
      details: {
        tabId,
        reason: error instanceof Error ? error.message : "Chrome tab operation failed."
      }
    });
  }
}

async function mapChromePermissionOperation<T>(operation: string, operationPromise: Promise<T>): Promise<T> {
  try {
    return await operationPromise;
  } catch (error) {
    if (isPortusError(error)) throw error;
    throw createPortusError({
      code: "PERMISSION_REQUIRED",
      message: `Chrome blocked ${operation}. Use the Portus Browser extension popup to request permission for the active origin.`,
      details: {
        operation,
        reason: error instanceof Error ? error.message : "Chrome operation failed."
      }
    });
  }
}

async function mapChromeDebuggerOperation<T>(operation: string, operationPromise: Promise<T>): Promise<T> {
  try {
    return await operationPromise;
  } catch (error) {
    if (isPortusError(error)) throw error;
    throw createPortusError({
      code: "CAPABILITY_UNAVAILABLE",
      message: `Chrome debugger operation failed: ${operation}.`,
      details: {
        operation,
        reason: error instanceof Error ? error.message : "Chrome debugger operation failed."
      }
    });
  }
}

async function promisifyChromeCall<T>(invoke: (done: (value: Promise<T> | T | undefined) => void) => void): Promise<T> {
  let value: Promise<T> | T | undefined;
  invoke((nextValue) => {
    value = nextValue;
  });
  if (value && typeof (value as Promise<T>).then === "function") {
    return await value;
  }
  return value as T;
}

function centerOfBounds(bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };
}

function readGlobalChromeApi(): PortusChromeApi {
  const maybeChrome = (globalThis as { chrome?: unknown }).chrome;
  if (!maybeChrome || typeof maybeChrome !== "object") {
    throw createPortusError({
      code: "NATIVE_HOST_UNAVAILABLE",
      message: "Chrome extension API is unavailable."
    });
  }
  return maybeChrome as PortusChromeApi;
}

function toHostPermissionPattern(origin: string): string {
  if (origin.endsWith("/*")) return origin;
  const parsed = new URL(origin);
  return `${parsed.origin}/*`;
}

function normalizeOrigin(value: string): string | null {
  const pattern = normalizePolicyOriginPattern(value);
  if (pattern) return pattern;
  try {
    return originFromUrl(value);
  } catch {
    return null;
  }
}

function invalidOriginError(origin: string): PortusError {
  return createPortusError({
    code: "INVALID_MESSAGE",
    message: `Expected http or https origin: ${origin}.`,
    details: { origin }
  });
}

function originFromUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizePolicyOriginPattern(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  const wildcard = normalized.match(/^(?:(https?):\/\/)?\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/);
  if (!wildcard) return null;
  return wildcard[1] ? `${wildcard[1]}://*.${wildcard[2]}` : `*.${wildcard[2]}`;
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

function createTerminalRequestId(): string {
  return `treq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw createPortusError({
      code: "INVALID_MESSAGE",
      message: `Expected string field: ${key}.`
    });
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw createPortusError({
      code: "INVALID_MESSAGE",
      message: `Expected optional string field: ${key}.`
    });
  }
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw createPortusError({
      code: "INVALID_MESSAGE",
      message: `Expected number field: ${key}.`
    });
  }
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw createPortusError({
      code: "INVALID_MESSAGE",
      message: `Expected boolean field: ${key}.`
    });
  }
  return value;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    throw createPortusError({
      code: "INVALID_MESSAGE",
      message: `Expected optional number field: ${key}.`
    });
  }
  return value;
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw createPortusError({
      code: "INVALID_MESSAGE",
      message: `Expected optional boolean field: ${key}.`
    });
  }
  return value;
}

function readFillFormFields(record: Record<string, unknown>): Array<{ elementId: string; value: string }> {
  const value = record.fields;
  if (!Array.isArray(value)) {
    throw createPortusError({
      code: "INVALID_MESSAGE",
      message: "Expected fill form fields array."
    });
  }
  return value.map((field) => {
    if (!isRecord(field) || typeof field.elementId !== "string" || typeof field.value !== "string") {
      throw createPortusError({
        code: "INVALID_MESSAGE",
        message: "Each fill form field requires elementId and value."
      });
    }
    return { elementId: field.elementId, value: field.value };
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readOptionalSnapshotFilter(record: Record<string, unknown>): SnapshotFilter | undefined {
  const value = record.filter;
  if (value === undefined) return undefined;
  return SnapshotFilterSchema.parse(value);
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw createPortusError({
      code: "INVALID_MESSAGE",
      message: `Expected object field: ${key}.`
    });
  }
  return value;
}

function copyOptional(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  if (source[key] !== undefined) target[key] = source[key];
}

function isoFromChromeTimestamp(timeStamp: number | undefined, fallback: Date): string {
  if (typeof timeStamp === "number" && Number.isFinite(timeStamp)) return new Date(timeStamp).toISOString();
  return fallback.toISOString();
}

function trimMap<K, V>(map: Map<K, V>, limit: number): void {
  while (map.size > limit) {
    const first = map.keys().next();
    if (first.done) return;
    map.delete(first.value);
  }
}

function copyDefinedTabField<K extends keyof ChromeTab>(target: ChromeTab, key: K, value: ChromeTab[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function tabChangeDetails(changeInfo: ChromeTabChangeInfo): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  copyOptional(changeInfo as Record<string, unknown>, details, "status");
  copyOptional(changeInfo as Record<string, unknown>, details, "title");
  copyOptional(changeInfo as Record<string, unknown>, details, "url");
  copyOptional(changeInfo as Record<string, unknown>, details, "favIconUrl");
  copyOptional(changeInfo as Record<string, unknown>, details, "pinned");
  copyOptional(changeInfo as Record<string, unknown>, details, "discarded");
  return details;
}

function canonicalCommandType(type: string): CommandType | null {
  const aliases: Record<string, CommandType> = {
    "tabs.list": "tab.list",
    "tabs.get": "tab.get",
    "tabs.open": "tab.open",
    "tabs.navigate": "tab.navigate",
    "tabs.history.back": "tab.history.back",
    "tabs.history.forward": "tab.history.forward",
    "tabs.activate": "tab.activate",
    "tabs.close": "tab.close"
  };
  const candidate = aliases[type] ?? type;
  const parsed = CommandTypeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function requireTabId(tab: ChromeTab): number {
  if (typeof tab.id !== "number") {
    throw createPortusError({
      code: "TAB_NOT_FOUND",
      message: "Tab id is unavailable."
    });
  }
  return tab.id;
}

function inferImageMimeType(data: string): string {
  const match = /^data:([^;,]+)/.exec(data);
  return match?.[1] ?? "image/png";
}

function getTabOrigin(tab: ChromeTab): string {
  if (!tab.url) {
    throw createPortusError({
      code: "PERMISSION_REQUIRED",
      message: "Tab URL is unavailable for permission validation."
    });
  }
  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw createPortusError({
        code: "PERMISSION_REQUIRED",
        message: `Host permission is unavailable for ${url.protocol} pages.`,
        details: { url: tab.url }
      });
    }
    return url.origin;
  } catch (error) {
    if (isPortusError(error)) throw error;
    throw createPortusError({
      code: "PERMISSION_REQUIRED",
      message: "Tab URL is invalid for permission validation.",
      details: { url: tab.url }
    });
  }
}

function readViewport(value: unknown): { width: number; height: number; deviceScaleFactor: number } {
  if (!isRecord(value)) {
    throw createPortusError({
      code: "ACTION_FAILED",
      message: "Snapshot viewport is invalid."
    });
  }
  return {
    width: readNumber(value, "width"),
    height: readNumber(value, "height"),
    deviceScaleFactor: readNumber(value, "deviceScaleFactor")
  };
}

function readElementCandidates(value: unknown): SnapshotElementCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((element) => {
    const candidate: SnapshotElementCandidate = {
      role: typeof element.role === "string" && element.role.length > 0 ? element.role : "generic",
      label: typeof element.label === "string" ? element.label : "",
      text: typeof element.text === "string" ? element.text : "",
      bounds: readBounds(element.bounds),
      state: isRecord(element.state) ? element.state : {}
    };
    if (typeof element.selectorHint === "string") candidate.selectorHint = element.selectorHint;
    if (typeof element.tagName === "string") candidate.tagName = element.tagName;
    if (typeof element.disabled === "boolean") candidate.disabled = element.disabled;
    if (typeof element.editable === "boolean") candidate.editable = element.editable;
    const extendedCandidate = candidate as SnapshotElementCandidate & Record<string, unknown>;
    if (typeof element.href === "string") extendedCandidate.href = element.href;
    if (typeof element.inputType === "string") extendedCandidate.inputType = element.inputType;
    if (typeof element.name === "string") extendedCandidate.name = element.name;
    if (typeof element.placeholder === "string") extendedCandidate.placeholder = element.placeholder;
    return candidate;
  });
}

function createDomActionTarget(element: SnapshotElement): Record<string, unknown> {
  const extendedElement = element as SnapshotElement & Record<string, unknown>;
  const target: Record<string, unknown> = {
    elementId: element.elementId,
    role: element.role,
    label: element.label,
    text: element.text,
    bounds: element.bounds,
    state: element.state
  };
  if (element.selectorHint !== undefined) target.selectorHint = element.selectorHint;
  if (element.tagName !== undefined) target.tagName = element.tagName;
  if (element.disabled !== undefined) target.disabled = element.disabled;
  if (element.editable !== undefined) target.editable = element.editable;
  if (typeof extendedElement.href === "string") target.href = extendedElement.href;
  if (typeof extendedElement.inputType === "string") target.inputType = extendedElement.inputType;
  if (typeof extendedElement.name === "string") target.name = extendedElement.name;
  if (typeof extendedElement.placeholder === "string") target.placeholder = extendedElement.placeholder;
  return target;
}

type DismissCandidate = {
  element: SnapshotElement;
  score: number;
  reason: string;
};

function selectDismissCandidate(elements: SnapshotElement[], kind: DismissKind, strategy: DismissStrategy): DismissCandidate | null {
  let best: DismissCandidate | null = null;
  for (const element of elements) {
    const candidate = scoreDismissCandidate(element, kind, strategy);
    if (!candidate) continue;
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best;
}

function scoreDismissCandidate(element: SnapshotElement, kind: DismissKind, strategy: DismissStrategy): DismissCandidate | null {
  if (element.disabled === true) return null;
  const text = normalizeDismissText(`${element.label} ${element.text}`.trim());
  if (!text) return null;
  const role = normalizeDismissText(element.role);
  const href = readSnapshotElementString(element, "href");
  const isLink = role === "link" || href !== "";
  const isButtonLike = role === "button" || role === "checkbox" || !isLink;
  if (!isButtonLike) return null;

  const acceptMatch = matchDismissPhrase(text, ACCEPT_DISMISS_PHRASES);
  const conservativeMatch = matchDismissPhrase(text, CONSERVATIVE_DISMISS_PHRASES);
  const neutralMatch = matchDismissPhrase(text, NEUTRAL_DISMISS_PHRASES);
  const closeMatch = matchDismissPhrase(text, CLOSE_DISMISS_PHRASES);
  const cookieContext = hasCookieContext(text);
  const popupContext = cookieContext || hasPopupContext(text);

  if (kind === "cookie" && !cookieContext && !acceptMatch?.cookie && !conservativeMatch?.cookie) return null;
  if (kind === "popup" && cookieContext && !closeMatch && !neutralMatch) return null;

  if (strategy === "conservative" && acceptMatch) return null;

  let score = 0;
  let reason = "";
  if (conservativeMatch) {
    score = conservativeMatch.score;
    reason = conservativeMatch.reason;
  } else if (closeMatch) {
    score = closeMatch.score;
    reason = closeMatch.reason;
  } else if (neutralMatch) {
    score = neutralMatch.score;
    reason = neutralMatch.reason;
  } else if (strategy === "accept" && acceptMatch) {
    score = acceptMatch.score;
    reason = acceptMatch.reason;
  } else {
    return null;
  }

  if (kind === "cookie" && cookieContext) score += 20;
  if (kind === "popup" && popupContext) score += 10;
  if (element.role === "button") score += 10;
  if (href) score -= 25;
  if (text.length <= 3 && (text === "x" || text === "×")) score += 5;

  return { element, score, reason };
}

function readSnapshotElementString(element: SnapshotElement, key: string): string {
  const value = (element as SnapshotElement & Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function matchDismissPhrase(text: string, phrases: DismissPhrase[]): DismissPhrase | null {
  for (const phrase of phrases) {
    if (phrase.exact ? text === phrase.match : text.includes(phrase.match)) return phrase;
  }
  return null;
}

function hasCookieContext(text: string): boolean {
  return /\b(cookie|cookies|privacy|consent|necessary|tracking|preferences)\b/.test(text);
}

function hasPopupContext(text: string): boolean {
  return /\b(popup|modal|newsletter|sign in|subscribe|notification|offer)\b/.test(text);
}

function normalizeDismissText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

type DismissPhrase = {
  match: string;
  score: number;
  reason: string;
  exact?: boolean;
  cookie?: boolean;
};

const CONSERVATIVE_DISMISS_PHRASES: DismissPhrase[] = [
  { match: "reject all", score: 130, reason: "cookie-reject-control", cookie: true },
  { match: "reject", score: 120, reason: "cookie-reject-control", cookie: true },
  { match: "decline all", score: 130, reason: "cookie-decline-control", cookie: true },
  { match: "decline", score: 115, reason: "cookie-decline-control", cookie: true },
  { match: "only necessary", score: 125, reason: "cookie-necessary-only-control", cookie: true },
  { match: "necessary only", score: 125, reason: "cookie-necessary-only-control", cookie: true },
  { match: "essential only", score: 120, reason: "cookie-essential-only-control", cookie: true },
  { match: "continue without accepting", score: 115, reason: "cookie-continue-without-accepting-control", cookie: true }
];

const CLOSE_DISMISS_PHRASES: DismissPhrase[] = [
  { match: "close", score: 105, reason: "close-control" },
  { match: "dismiss", score: 100, reason: "dismiss-control" },
  { match: "no thanks", score: 100, reason: "no-thanks-control" },
  { match: "not now", score: 95, reason: "not-now-control" },
  { match: "maybe later", score: 90, reason: "maybe-later-control" },
  { match: "×", score: 85, reason: "close-icon-control", exact: true },
  { match: "x", score: 70, reason: "close-icon-control", exact: true }
];

const NEUTRAL_DISMISS_PHRASES: DismissPhrase[] = [
  { match: "got it", score: 80, reason: "got-it-control" },
  { match: "ok", score: 65, reason: "ok-control", exact: true },
  { match: "okay", score: 65, reason: "ok-control", exact: true },
  { match: "continue", score: 55, reason: "continue-control" }
];

const ACCEPT_DISMISS_PHRASES: DismissPhrase[] = [
  { match: "accept all", score: 120, reason: "cookie-accept-control", cookie: true },
  { match: "allow all", score: 110, reason: "cookie-accept-control", cookie: true },
  { match: "agree and continue", score: 105, reason: "cookie-accept-control", cookie: true },
  { match: "i agree", score: 100, reason: "cookie-accept-control", cookie: true },
  { match: "accept", score: 90, reason: "cookie-accept-control", cookie: true },
  { match: "allow", score: 80, reason: "allow-control" }
];

function readBounds(value: unknown): { x: number; y: number; width: number; height: number } {
  if (!isRecord(value)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: typeof value.x === "number" ? value.x : 0,
    y: typeof value.y === "number" ? value.y : 0,
    width: typeof value.width === "number" ? value.width : 0,
    height: typeof value.height === "number" ? value.height : 0
  };
}

function capturePortusSnapshotPayload(): Record<string, unknown> {
  const candidates = Array.from(document.querySelectorAll("button,a[href],input,textarea,select,[role],[contenteditable],[tabindex],[onclick]"));
  const elements = candidates
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && bounds.width > 0
        && bounds.height > 0
        && bounds.bottom >= 0
        && bounds.right >= 0
        && bounds.top <= window.innerHeight
        && bounds.left <= window.innerWidth;
    })
    .slice(0, 100)
    .map((element) => {
      const bounds = element.getBoundingClientRect();
      const tagName = element.tagName.toLowerCase();
      const input = element instanceof HTMLInputElement ? element : null;
      const role = element.getAttribute("role") ?? roleForElement(element);
      const editable = tagName === "textarea"
        || tagName === "select"
        || element.isContentEditable
        || (input !== null && input.type !== "button" && input.type !== "submit" && input.type !== "checkbox" && input.type !== "radio");
      return {
        role,
        label: labelForElement(element),
        text: visibleElementText(element),
        bounds: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height
        },
        state: {
          checked: input?.checked ?? undefined,
          value: editable ? (input?.value ?? "") : undefined
        },
        selectorHint: selectorForElement(element),
        tagName,
        disabled: "disabled" in element ? Boolean((element as HTMLButtonElement).disabled) : false,
        editable,
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        inputType: input?.type,
        name: input?.name || undefined,
        placeholder: input?.placeholder || undefined
      };
    });

  return {
    url: location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      deviceScaleFactor: window.devicePixelRatio || 1
    },
    visibleText: (document.body?.innerText ?? "").slice(0, 20000),
    elements
  };

  function roleForElement(element: HTMLElement): string {
    const tagName = element.tagName.toLowerCase();
    if (tagName === "a") return "link";
    if (tagName === "button") return "button";
    if (tagName === "textarea") return "textbox";
    if (tagName === "select") return "combobox";
    if (tagName === "input") {
      const input = element as HTMLInputElement;
      if (input.type === "checkbox") return "checkbox";
      if (input.type === "radio") return "radio";
      if (input.type === "submit" || input.type === "button") return "button";
      return "textbox";
    }
    return "generic";
  }

  function labelForElement(element: HTMLElement): string {
    const aria = element.getAttribute("aria-label");
    if (aria) return aria.trim();
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean).join(" ");
      if (text) return text;
    }
    if (element instanceof HTMLInputElement && element.labels && element.labels.length > 0) {
      const text = Array.from(element.labels).map((label) => label.textContent?.trim() ?? "").filter(Boolean).join(" ");
      if (text) return text;
    }
    return element.getAttribute("title")?.trim() ?? visibleElementText(element);
  }

  function visibleElementText(element: HTMLElement): string {
    if (element instanceof HTMLInputElement) return element.value || element.placeholder || "";
    return (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 500);
  }

  function selectorForElement(element: HTMLElement): string {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const parts: string[] = [];
    let current: HTMLElement | null = element;
    while (current && current !== document.body && parts.length < 5) {
      const tagName = current.tagName.toLowerCase();
      const siblings = Array.from(current.parentElement?.children ?? []).filter((sibling) => sibling.tagName === current?.tagName);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tagName}:nth-of-type(${Math.max(index, 1)})`);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }
}

function performPortusDomAction(payload: Record<string, unknown>): Record<string, unknown> {
  try {
    const action = typeof payload.action === "string" ? payload.action : "";
    const target = isPlainRecord(payload.target) ? payload.target : null;
    const resolution = target ? resolveLiveActionElement(target) : { element: null, score: 0 };
    if (target && !resolution.element) {
      return actionError("SNAPSHOT_STALE", "Element target no longer matches the current DOM.");
    }
    const element = resolution.element;

    if (action === "click") {
      if (!element) return actionError("SNAPSHOT_STALE", "Click requires an element target.");
      element.focus();
      element.click();
      return { ok: true, details: { action, targetValidated: true, targetScore: resolution.score } };
    }

    if (action === "hover") {
      if (!element) return actionError("SNAPSHOT_STALE", "Hover requires an element target.");
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const bounds = element.getBoundingClientRect();
      const clientX = bounds.left + bounds.width / 2;
      const clientY = bounds.top + bounds.height / 2;
      element.focus();
      const pointerOptions = { bubbles: true, cancelable: true, clientX, clientY, pointerId: 1, pointerType: "mouse", isPrimary: true };
      const mouseOptions = { bubbles: true, cancelable: true, clientX, clientY };
      if (typeof PointerEvent !== "undefined") {
        element.dispatchEvent(new PointerEvent("pointerover", pointerOptions));
        element.dispatchEvent(new PointerEvent("pointerenter", pointerOptions));
        element.dispatchEvent(new PointerEvent("pointermove", pointerOptions));
      }
      element.dispatchEvent(new MouseEvent("mouseover", mouseOptions));
      element.dispatchEvent(new MouseEvent("mouseenter", mouseOptions));
      element.dispatchEvent(new MouseEvent("mousemove", mouseOptions));
      return { ok: true, details: { action, targetValidated: true, targetScore: resolution.score } };
    }

    if (action === "drag") {
      const sourceTarget = isPlainRecord(payload.sourceTarget) ? payload.sourceTarget : null;
      const dropTarget = isPlainRecord(payload.dropTarget) ? payload.dropTarget : null;
      const source = sourceTarget ? resolveLiveActionElement(sourceTarget) : { element: null, score: 0 };
      const destination = dropTarget ? resolveLiveActionElement(dropTarget) : { element: null, score: 0 };
      if (!source.element || !destination.element) return actionError("SNAPSHOT_STALE", "Drag source or target no longer matches the current DOM.");
      source.element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      destination.element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const sourceBounds = source.element.getBoundingClientRect();
      const targetBounds = destination.element.getBoundingClientRect();
      const startX = sourceBounds.left + sourceBounds.width / 2;
      const startY = sourceBounds.top + sourceBounds.height / 2;
      const endX = targetBounds.left + targetBounds.width / 2;
      const endY = targetBounds.top + targetBounds.height / 2;
      source.element.focus();
      const dataTransfer = typeof DataTransfer !== "undefined" ? new DataTransfer() : undefined;
      dispatchDragEvent(source.element, "dragstart", startX, startY, dataTransfer);
      dispatchPointerMouse(source.element, "down", startX, startY);
      dispatchPointerMouse(destination.element, "move", endX, endY);
      dispatchDragEvent(destination.element, "dragenter", endX, endY, dataTransfer);
      dispatchDragEvent(destination.element, "dragover", endX, endY, dataTransfer);
      dispatchDragEvent(destination.element, "drop", endX, endY, dataTransfer);
      dispatchPointerMouse(destination.element, "up", endX, endY);
      dispatchDragEvent(source.element, "dragend", endX, endY, dataTransfer);
      return {
        ok: true,
        details: {
          action,
          sourceValidated: true,
          targetValidated: true,
          sourceScore: source.score,
          targetScore: destination.score
        }
      };
    }

    if (action === "fillForm") {
      const fields = Array.isArray(payload.fields) ? payload.fields : [];
      const resolved = fields.map((field) => {
        if (!isPlainRecord(field) || !isPlainRecord(field.target) || typeof field.value !== "string" || typeof field.elementId !== "string") {
          return { ok: false as const, error: actionError("ACTION_FAILED", "Invalid fill form field."), elementId: "" };
        }
        const match = resolveLiveActionElement(field.target);
        if (!match.element) return { ok: false as const, error: actionError("SNAPSHOT_STALE", "Fill form target no longer matches the current DOM."), elementId: field.elementId };
        if (!isEditableElement(match.element)) return { ok: false as const, error: actionError("ACTION_UNSUPPORTED", "Fill form target is not editable."), elementId: field.elementId };
        return { ok: true as const, element: match.element, value: field.value, elementId: field.elementId, score: match.score };
      });
      const firstFailure = resolved.find((field) => !field.ok);
      if (firstFailure && !firstFailure.ok) return firstFailure.error;
      for (const field of resolved) {
        if (!field.ok) continue;
        setEditableValue(field.element, field.value);
      }
      return {
        ok: true,
        details: {
          action,
          fieldCount: resolved.length,
          targetValidated: true
        }
      };
    }

    if (action === "type") {
      if (!element) return actionError("SNAPSHOT_STALE", "Type requires an element target.");
      const text = typeof payload.text === "string" ? payload.text : "";
      if (element instanceof HTMLInputElement) {
        if (element.type === "file") return actionError("ACTION_UNSUPPORTED", "File inputs require trusted user input.");
        element.focus();
        element.value = text;
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, details: { action, textLength: text.length, targetValidated: true, targetScore: resolution.score } };
      }
      if (element instanceof HTMLTextAreaElement) {
        element.focus();
        element.value = text;
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, details: { action, textLength: text.length, targetValidated: true, targetScore: resolution.score } };
      }
      if (element.isContentEditable) {
        element.focus();
        element.textContent = text;
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        return { ok: true, details: { action, textLength: text.length, targetValidated: true, targetScore: resolution.score } };
      }
      return actionError("ACTION_UNSUPPORTED", "Target is not editable.");
    }

    if (action === "press") {
      const key = typeof payload.key === "string" ? payload.key : "";
      if (!key) return actionError("ACTION_FAILED", "Key is required.");
      const target = element ?? document.activeElement ?? document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
      return { ok: true, details: { action, key, targetValidated: Boolean(element), targetScore: resolution.score } };
    }

    if (action === "scroll") {
      const deltaX = typeof payload.deltaX === "number" ? payload.deltaX : 0;
      const deltaY = typeof payload.deltaY === "number" ? payload.deltaY : 600;
      if (element) element.scrollBy({ left: deltaX, top: deltaY, behavior: "instant" });
      else window.scrollBy({ left: deltaX, top: deltaY, behavior: "instant" });
      return { ok: true, details: { action, deltaX, deltaY, targetValidated: Boolean(element), targetScore: resolution.score } };
    }

    return actionError("ACTION_UNSUPPORTED", `Unsupported action: ${action}.`);
  } catch (error) {
    return actionError("ACTION_FAILED", error instanceof Error ? error.message : "DOM action failed.");
  }

  function actionError(code: string, message: string): Record<string, unknown> {
    return {
      ok: false,
      error: {
        code,
        message
      }
    };
  }

  function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function dispatchPointerMouse(element: HTMLElement, phase: "down" | "move" | "up", clientX: number, clientY: number): void {
    const pointerName = phase === "down" ? "pointerdown" : phase === "up" ? "pointerup" : "pointermove";
    const mouseName = phase === "down" ? "mousedown" : phase === "up" ? "mouseup" : "mousemove";
    const pointerOptions = { bubbles: true, cancelable: true, clientX, clientY, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const mouseOptions = { bubbles: true, cancelable: true, clientX, clientY };
    if (typeof PointerEvent !== "undefined") element.dispatchEvent(new PointerEvent(pointerName, pointerOptions));
    element.dispatchEvent(new MouseEvent(mouseName, mouseOptions));
  }

  function dispatchDragEvent(element: HTMLElement, type: string, clientX: number, clientY: number, dataTransfer?: DataTransfer): void {
    if (typeof DragEvent === "undefined") {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }));
      return;
    }
    const event = new DragEvent(type, { bubbles: true, cancelable: true, clientX, clientY, dataTransfer: dataTransfer ?? null });
    element.dispatchEvent(event);
  }

  function isEditableElement(element: HTMLElement): boolean {
    if (element instanceof HTMLInputElement) return element.type !== "file";
    return element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element.isContentEditable;
  }

  function setEditableValue(element: HTMLElement, value: string): void {
    element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (element instanceof HTMLSelectElement) {
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
  }

function resolveLiveActionElement(target: Record<string, unknown>): { element: HTMLElement | null; score: number } {
    const candidates = collectActionCandidates(target);
    let best: { element: HTMLElement; score: number } | null = null;
    for (const candidate of candidates) {
      const score = scoreActionCandidate(candidate, target);
      if (score === null) continue;
      if (!best || score > best.score) best = { element: candidate, score };
    }
    if (!best || best.score < 60) return { element: null, score: best?.score ?? 0 };
    return best;
  }

  function collectActionCandidates(target: Record<string, unknown>): HTMLElement[] {
    const candidates: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();
    const selectorHint = typeof target.selectorHint === "string" ? target.selectorHint : "";
    if (selectorHint) {
      try {
        for (const element of Array.from(document.querySelectorAll(selectorHint))) addCandidate(element);
      } catch {
        // Selector hints are best-effort and may be invalid on the live page.
      }
    }

    const bounds = readTargetBounds(target.bounds);
    if (bounds) {
      const points: Array<[number, number]> = [
        [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2],
        [bounds.x + Math.min(8, bounds.width / 2), bounds.y + Math.min(8, bounds.height / 2)],
        [bounds.x + Math.max(bounds.width - 8, bounds.width / 2), bounds.y + Math.min(8, bounds.height / 2)]
      ];
      for (const [x, y] of points) {
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
        for (const element of document.elementsFromPoint(x, y)) {
          let current: Element | null = element;
          while (current && current !== document.body) {
            addCandidate(current);
            current = current.parentElement;
          }
        }
      }
    }

    if (candidates.length === 0) {
      for (const element of Array.from(document.querySelectorAll("button,a[href],input,textarea,select,[role],[contenteditable],[tabindex],[onclick]"))) {
        addCandidate(element);
      }
    }
    return candidates;

    function addCandidate(element: Element): void {
      if (!(element instanceof HTMLElement) || seen.has(element)) return;
      seen.add(element);
      candidates.push(element);
    }
  }

  function scoreActionCandidate(element: HTMLElement, target: Record<string, unknown>): number | null {
    if (!isVisibleActionCandidate(element)) return null;
    const targetDisabled = typeof target.disabled === "boolean" ? target.disabled : undefined;
    if (targetDisabled === false && "disabled" in element && Boolean((element as HTMLButtonElement).disabled)) return null;

    let score = 0;
    const targetTag = normalizeToken(target.tagName);
    const liveTag = element.tagName.toLowerCase();
    if (targetTag && targetTag === liveTag) score += 20;
    else if (targetTag && isCompatibleTag(targetTag, liveTag)) score += 8;

    const targetRole = normalizeToken(target.role);
    const liveRole = normalizeToken(element.getAttribute("role") ?? roleForActionElement(element));
    if (targetRole && targetRole === liveRole) score += 20;

    const targetHref = typeof target.href === "string" ? target.href : "";
    if (targetHref) {
      const liveHref = hrefForActionElement(element);
      if (!liveHref || normalizeUrl(liveHref) !== normalizeUrl(targetHref)) return null;
      score += 50;
    }

    const targetInputType = normalizeToken(target.inputType);
    if (targetInputType && element instanceof HTMLInputElement) {
      if (normalizeToken(element.type) !== targetInputType) return null;
      score += 15;
    }

    const targetName = normalizeText(typeof target.name === "string" ? target.name : "");
    if (targetName && element instanceof HTMLInputElement && normalizeText(element.name) === targetName) score += 10;

    const targetPlaceholder = normalizeText(typeof target.placeholder === "string" ? target.placeholder : "");
    if (targetPlaceholder && element instanceof HTMLInputElement && normalizeText(element.placeholder) === targetPlaceholder) score += 10;

    const targetLabel = normalizeText(typeof target.label === "string" ? target.label : "");
    const targetText = normalizeText(typeof target.text === "string" ? target.text : "");
    const liveLabel = normalizeText(labelForActionElement(element));
    const liveText = normalizeText(visibleActionText(element));
    const expectedText = targetLabel || targetText;
    if (expectedText) {
      if (liveLabel === expectedText || liveText === expectedText) score += 45;
      else if (liveLabel.includes(expectedText) || expectedText.includes(liveLabel) || liveText.includes(expectedText) || expectedText.includes(liveText)) score += 25;
      else return null;
    }

    const targetBounds = readTargetBounds(target.bounds);
    if (targetBounds) {
      const liveBounds = element.getBoundingClientRect();
      const targetCenterX = targetBounds.x + targetBounds.width / 2;
      const targetCenterY = targetBounds.y + targetBounds.height / 2;
      const liveCenterX = liveBounds.x + liveBounds.width / 2;
      const liveCenterY = liveBounds.y + liveBounds.height / 2;
      const distance = Math.hypot(targetCenterX - liveCenterX, targetCenterY - liveCenterY);
      const tolerance = Math.max(32, Math.max(targetBounds.width, targetBounds.height) * 0.35);
      if (distance <= tolerance) score += 35;
      else if (distance <= tolerance * 2) score += 10;
      else return null;
    }

    return score;
  }

  function isVisibleActionCandidate(element: HTMLElement): boolean {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && bounds.width > 0
      && bounds.height > 0
      && bounds.bottom >= 0
      && bounds.right >= 0
      && bounds.top <= window.innerHeight
      && bounds.left <= window.innerWidth;
  }

  function roleForActionElement(element: HTMLElement): string {
    const tagName = element.tagName.toLowerCase();
    if (tagName === "a") return "link";
    if (tagName === "button") return "button";
    if (tagName === "textarea") return "textbox";
    if (tagName === "select") return "combobox";
    if (tagName === "input") {
      const input = element as HTMLInputElement;
      if (input.type === "checkbox") return "checkbox";
      if (input.type === "radio") return "radio";
      if (input.type === "submit" || input.type === "button") return "button";
      return "textbox";
    }
    return "generic";
  }

  function hrefForActionElement(element: HTMLElement): string {
    if (element instanceof HTMLAnchorElement) return element.href;
    const anchor = element.closest("a[href]");
    return anchor instanceof HTMLAnchorElement ? anchor.href : "";
  }

  function labelForActionElement(element: HTMLElement): string {
    const aria = element.getAttribute("aria-label");
    if (aria) return aria.trim();
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean).join(" ");
      if (text) return text;
    }
    if (element instanceof HTMLInputElement && element.labels && element.labels.length > 0) {
      const text = Array.from(element.labels).map((label) => label.textContent?.trim() ?? "").filter(Boolean).join(" ");
      if (text) return text;
    }
    return element.getAttribute("title")?.trim() ?? visibleActionText(element);
  }

  function visibleActionText(element: HTMLElement): string {
    if (element instanceof HTMLInputElement) return element.value || element.placeholder || "";
    return (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 500);
  }

  function readTargetBounds(value: unknown): { x: number; y: number; width: number; height: number } | null {
    if (!isPlainRecord(value)) return null;
    const x = typeof value.x === "number" ? value.x : null;
    const y = typeof value.y === "number" ? value.y : null;
    const width = typeof value.width === "number" ? value.width : null;
    const height = typeof value.height === "number" ? value.height : null;
    if (x === null || y === null || width === null || height === null) return null;
    return { x, y, width, height };
  }

  function isCompatibleTag(targetTag: string, liveTag: string): boolean {
    if (targetTag === "a") return liveTag !== "input" && liveTag !== "textarea" && liveTag !== "select";
    return targetTag === liveTag;
  }

  function normalizeText(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
  }

  function normalizeToken(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function normalizeUrl(value: string): string {
    try {
      return new URL(value, location.href).href;
    } catch {
      return value;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const portusExtensionApp = {
  name: "portus-extension",
  packageName: "@portus/extension",
  phase: "chrome-extension-bridge"
} as const;
