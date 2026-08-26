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
  NavigationRuleMatchSchema,
  NavigationRuleSchema,
  NavigationUrlSchema,
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
  ShadowPathSchema,
  SnapshotFilterSchema,
  SnapshotSchema,
  TabSchema,
  WaitResultSchema,
  createPortusError,
  navigationPolicyAllowsUrl,
  navigationRuleKey,
  migrateLegacyPolicyPreferences,
  migrateLegacySettingsProfileCatalog,
  migrateLegacyTerminalPreferences,
  normalizeNavigationRulePattern,
  normalizeNavigationUrl,
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
  type NavigationRule,
  type NavigationRuleMatch,
  type NavigationRulePattern,
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
import { createDomActionResult, markSnapshotsStaleForTab, resolveActionElement, type SnapshotStoreEntry } from "@portus/actions";
import { buildSnapshot, createSnapshotId, filterSnapshot, type SnapshotElementCandidate } from "@portus/snapshots";

export type BridgeState = "disconnected" | "connecting" | "connected" | "disconnecting" | "error";
export type NativeHostState = "disconnected" | "connecting" | "connected" | "error";
export type TerminalNativeHostState = NativeHostState | "unresponsive";
export type BrokerState = "unknown" | "connected" | "unavailable" | "error";

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

interface DomExecutionTarget {
  frameId: number;
  documentId: string;
}

export interface ChromeScriptInjectionResult {
  frameId: number;
  documentId: string;
  result?: unknown;
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
      target: {
        tabId: number;
        allFrames?: boolean;
        frameIds?: number[];
        documentIds?: string[];
      };
      func?: (...args: never[]) => unknown;
      files?: string[];
      args?: unknown[];
      world?: "ISOLATED" | "MAIN";
    }): Promise<ChromeScriptInjectionResult[]> | void;
  };
  windows?: {
    getAll(getInfo?: Record<string, unknown>): Promise<ChromeWindow[]> | void;
    update(windowId: number, updateInfo: Record<string, unknown>): Promise<ChromeWindow> | void;
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
  terminalRequestTimeoutMs?: number;
}

export interface PortusExtensionStatus {
  bridgeState: BridgeState;
  nativeHostState: NativeHostState;
  brokerState: BrokerState;
  sidePanelOpen: boolean;
  activeTabUrl: string | null;
  browserId: string | null;
  nativeHostName: string;
  terminalNativeHostName: string;
  terminalNativeHostState: TerminalNativeHostState;
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
  reject: (error: Error | PortusError) => void;
  timer?: unknown;
}

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
const DEFAULT_TERMINAL_REQUEST_TIMEOUT_MS = 15000;
const SNAPSHOT_COLLECTION_LIMIT = 10000;
const COMPOSED_DOM_RUNTIME_FILE = "dist/composed-dom-runtime.js";

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

export function evaluatePortusPageWait(condition: Record<string, unknown>): Record<string, unknown> {
  type WaitShadowPath = Array<{ hostSelectorHint: string; rootType: "open" | "closed" }>;
  type WaitComposedEntry = {
    element: Element;
    root: Document | ShadowRoot;
    selectorHint: string;
    shadowPath?: WaitShadowPath;
  };

  const normalize = (value: unknown): string => typeof value === "string" ? value.trim().toLowerCase() : "";
  const text = normalize(condition.text);
  const elementQuery = normalize(condition.elementQuery);
  const role = normalize(condition.role);
  const runtime = (globalThis as typeof globalThis & {
    __portusComposedDom?: {
      collect(root?: Document | ShadowRoot): WaitComposedEntry[];
    };
  }).__portusComposedDom;
  if (!runtime || typeof runtime.collect !== "function") {
    throw new Error("Portus composed-DOM runtime is unavailable.");
  }

  const entries = runtime.collect(document);
  if (text) {
    const lightText = document.body?.textContent ?? "";
    if (lightText.toLowerCase().includes(text)) {
      return {
        matched: true,
        details: {
          match: "text",
          text: condition.text
        }
      };
    }

    const seenRoots = new Set<ShadowRoot>();
    for (const entry of entries) {
      if (!(entry.root instanceof ShadowRoot) || seenRoots.has(entry.root)) continue;
      seenRoots.add(entry.root);
      const shadowText = entry.root.textContent ?? "";
      if (!shadowText.toLowerCase().includes(text)) continue;
      return {
        matched: true,
        details: {
          match: "text",
          text: condition.text,
          shadowDepth: entry.shadowPath?.length ?? 0,
          ...(entry.shadowPath === undefined ? {} : { shadowPath: entry.shadowPath })
        }
      };
    }
  }

  if (!elementQuery && !role) {
    return { matched: false };
  }

  const candidateSelector = "a, button, input, textarea, select, [role], [aria-label], [title]";
  for (const entry of entries) {
    const element = entry.element;
    if (!element.matches(candidateSelector)) continue;
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
        label: (ariaLabel || title || placeholder || (element.textContent ?? "")).trim().slice(0, 200),
        selectorHint: entry.selectorHint,
        shadowDepth: entry.shadowPath?.length ?? 0,
        ...(entry.shadowPath === undefined ? {} : { shadowPath: entry.shadowPath })
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
  private readonly terminalRequestTimeoutMs: number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly terminalPending = new Map<string, PendingTerminalRequest>();
  private readonly terminalRuntimePorts = new Set<PortusRuntimePort>();
  private readonly statusRuntimePorts = new Set<PortusRuntimePort>();
  private readonly policyVisibleTabIds = new Set<number>();
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
  private connectPromise: Promise<PortusExtensionStatus> | undefined;
  private terminalConnectPromise: Promise<TerminalNativeHostState> | undefined;
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
    this.terminalRequestTimeoutMs = options.terminalRequestTimeoutMs ?? DEFAULT_TERMINAL_REQUEST_TIMEOUT_MS;
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
    if (this.connectPromise) return this.connectPromise;

    const connection = this.connectBridgeOnce();
    this.connectPromise = connection;
    try {
      return await connection;
    } finally {
      if (this.connectPromise === connection) this.connectPromise = undefined;
    }
  }

  private async connectBridgeOnce(): Promise<PortusExtensionStatus> {
    this.bridgeShouldConnect = true;
    await this.persistBridgePreference();
    this.stopReconnectTimer();
    this.bridgeState = "connecting";
    this.nativeHostState = "connecting";
    this.brokerState = "unknown";
    this.intentionalDisconnect = false;
    void this.updateActionState();
    void this.broadcastStatus();

    let connectedPort: PortusNativePort | undefined;
    try {
      const port = this.chromeApi.runtime.connectNative(this.nativeHostName);
      connectedPort = port;
      this.port = port;
      port.onMessage.addListener((message: unknown) => {
        void this.handleNativeMessage(message, port);
      });
      port.onDisconnect.addListener(() => {
        this.handleNativeDisconnect(port);
      });
      this.nativeHostState = "connected";

      const result = await this.sendNativeRequest("bridge.register", this.registrationPayload());
      if (this.port !== connectedPort) {
        throw createPortusError({
          code: "BRIDGE_DISCONNECTED",
          message: "Portus Bridge disconnected during registration.",
          retryable: true
        });
      }
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
      if (connectedPort && this.port === connectedPort) {
        this.port = undefined;
        try {
          connectedPort.disconnect();
        } catch {
          // The failed native port may already be disconnected.
        }
      }
      this.stopHeartbeat();
      this.browserId = null;
      if (this.bridgeShouldConnect) {
        this.bridgeState = "error";
        this.nativeHostState = "error";
        this.brokerState = "error";
      } else {
        this.bridgeState = "disconnected";
        this.nativeHostState = "disconnected";
        this.brokerState = "unknown";
      }
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

    return {
      bridgeState: this.bridgeState,
      nativeHostState: this.nativeHostState,
      brokerState: this.brokerState,
      sidePanelOpen: this.sidePanelOpen,
      activeTabUrl,
      browserId: this.browserId,
      nativeHostName: this.nativeHostName,
      terminalNativeHostName: this.terminalNativeHostName,
      terminalNativeHostState: this.terminalNativeHostState,
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
          void this.broadcastStatus();
        });
    });
    this.chromeApi.tabs.onRemoved?.addListener((tabId, removeInfo) => {
      if (this.policyVisibleTabIds.delete(tabId)) {
        this.publishBrowserEvent("tab.closed", {
          tabId,
          windowId: removeInfo.windowId,
          isWindowClosing: removeInfo.isWindowClosing
        }, tabId);
      }
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
    const visibleTabs: Tab[] = [];
    for (const tab of tabs) {
      if (!this.isTabVisibleToAgent(tab)) {
        if (tab.id !== undefined) this.policyVisibleTabIds.delete(tab.id);
        continue;
      }
      if (tab.id !== undefined) this.policyVisibleTabIds.add(tab.id);
      visibleTabs.push(this.toPortusTab(tab));
    }
    return visibleTabs;
  }

  async getTab(tabId: number): Promise<Tab> {
    await this.ready;
    const tab = await mapChromeTabOperation(tabId, promisifyChromeCall<ChromeTab>((done) => {
      const result = this.chromeApi.tabs.get(tabId);
      done(result as Promise<ChromeTab> | ChromeTab | undefined);
    }));
    this.ensureTabMetadataPolicyAllowed(tab);
    return this.toPortusTab(tab);
  }

  async openTab(url: string, active = true, windowId?: number): Promise<Tab> {
    await this.ready;
    const normalizedUrl = readNavigationUrl(url);
    this.ensureNavigationPolicyAllowed(normalizedUrl);
    const createProperties: Record<string, unknown> = { url: normalizedUrl, active };
    if (windowId !== undefined) createProperties.windowId = windowId;
    const tab = await promisifyChromeCall<ChromeTab>((done) => {
      const result = this.chromeApi.tabs.create(createProperties);
      done(result as Promise<ChromeTab> | ChromeTab | undefined);
    });
    return this.toPortusTab(tab);
  }

  async navigateTab(tabId: number, url: string): Promise<Tab> {
    await this.ready;
    const normalizedUrl = readNavigationUrl(url);
    this.ensureNavigationPolicyAllowed(normalizedUrl);
    const tab = await mapChromeTabOperation(tabId, promisifyChromeCall<ChromeTab>((done) => {
      const result = this.chromeApi.tabs.update(tabId, { url: normalizedUrl });
      done(result as Promise<ChromeTab> | ChromeTab | undefined);
    }));
    return this.toPortusTab(tab);
  }

  async navigateTabHistory(tabId: number, direction: "back" | "forward"): Promise<Tab> {
    await this.ready;
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    if (!this.chromeApi.scripting) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome scripting API is unavailable."
      });
    }
    await mapChromeAccessOperation("navigate tab history", promisifyChromeCall<Array<{ result?: unknown }>>((done) => {
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
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabMetadataPolicyAllowed(targetTab);
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
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabMetadataPolicyAllowed(targetTab);
    await mapChromeTabOperation(tabId, promisifyChromeCall<void>((done) => {
      const result = this.chromeApi.tabs.remove(tabId);
      done(result as Promise<void> | void);
    }));
    this.policyVisibleTabIds.delete(tabId);
    return { closed: true, tabId };
  }

  async captureScreenshot(tabId?: number, useDebugger?: boolean): Promise<ScreenshotResult> {
    await this.ready;
    const targetTab = tabId === undefined ? await this.getActiveTab() : await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    const targetTabId = requireTabId(targetTab);
    const previousActiveTab = await this.getActiveTabForWindow(targetTab.windowId);
    const previousActiveTabId = previousActiveTab?.id;
    const activatedTabBeforeCapture = previousActiveTabId !== undefined && previousActiveTabId !== targetTabId;

    if (activatedTabBeforeCapture) await this.activateTab(targetTabId);

    let data: string;
    if (useDebugger) {
      data = await this.captureDebuggerScreenshotData(targetTabId);
    } else {
      const capturePromise = mapChromeAccessOperation("capture visible tab", promisifyChromeCall<string>((done) => {
        const result = this.chromeApi.tabs.captureVisibleTab(targetTab.windowId, { format: "png" });
        done(result as Promise<string> | string | undefined);
      }));

      data = await Promise.race([
        capturePromise,
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Timeout capturing visible tab.")), 4000))
      ]);
    }

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

  private async captureDebuggerScreenshotData(tabId: number): Promise<string> {
    return await this.withDebuggerSession(tabId, async (debuggerTarget) => {
      const cdpResult = await this.sendDebuggerCommand(debuggerTarget, "Page.captureScreenshot", { format: "png" });
      if (!cdpResult || typeof cdpResult !== "object" || !("data" in cdpResult) || typeof cdpResult.data !== "string") {
        throw new Error("Debugger screenshot failed to return valid image data.");
      }
      return "data:image/png;base64," + cdpResult.data;
    }, "debugger-screenshot");
  }

  async captureSnapshot(tabId?: number, filter?: SnapshotFilter, useDebugger?: boolean): Promise<Snapshot> {
    await this.ready;
    const targetTab = tabId === undefined ? await this.getActiveTab() : await this.getChromeTab(tabId);
    const targetTabId = requireTabId(targetTab);
    this.ensureTabPolicyAllowed(targetTab);
    let screenshot: ScreenshotResult;
    try {
      screenshot = await this.captureScreenshot(targetTabId, useDebugger);
    } catch (error) {
      screenshot = {
        browserId: this.requireBrowserId(),
        tabId: targetTabId,
        capturedAt: this.now().toISOString(),
        mimeType: "image/png",
        data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        activatedTabBeforeCapture: false
      };
    }
    const page = await this.executeSnapshotScript(targetTabId, filter);
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
      capturedAt: this.now().toISOString(),
      ...(typeof page.candidateCount === "number" && Number.isInteger(page.candidateCount) && page.candidateCount >= 0
        ? { candidateCount: page.candidateCount }
        : {}),
      ...(typeof page.matchedElementCount === "number" && Number.isInteger(page.matchedElementCount) && page.matchedElementCount >= 0
        ? { matchedElementCount: page.matchedElementCount }
        : {}),
      ...(typeof page.truncated === "boolean" ? { truncated: page.truncated } : {})
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

    if (action === "drag" && sourceElement && targetElement && sourceElement.documentId !== targetElement.documentId) {
      throw createPortusError({
        code: "ACTION_UNSUPPORTED",
        message: "Cross-frame drag is not supported as a single atomic DOM action.",
        details: {
          sourceFrameId: sourceElement.frameId,
          sourceDocumentId: sourceElement.documentId,
          targetFrameId: targetElement.frameId,
          targetDocumentId: targetElement.documentId
        }
      });
    }

    if (action === "drag" && this.shouldUseDebuggerBackend() && sourceElement?.frameId === 0 && targetElement?.frameId === 0) {
      const debuggerResult = await this.executeDebuggerDragAction(tabId, sourceElement, targetElement);
      markSnapshotsStaleForTab(this.snapshots, browserId, tabId);
      return debuggerResult;
    }

    const executionElement = action === "drag" ? sourceElement : element;
    const executionTarget = executionElement ? snapshotElementExecutionTarget(executionElement) : undefined;
    const result = await this.executeActionScript(tabId, domPayload, executionTarget);
    if (!result.ok) throw createPortusError(result.error);
    markSnapshotsStaleForTab(this.snapshots, browserId, tabId);
    return ActionResultSchema.parse(createDomActionResult(this.now().toISOString(), result.details ?? { action }));
  }

  async fillForm(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ready;
    const tabId = readNumber(payload, "tabId");
    const targetTab = await this.getChromeTab(tabId);
    this.ensureTabPolicyAllowed(targetTab);
    const browserId = this.requireBrowserId();
    const request = FillFormRequestSchema.parse({
      action: "fillForm",
      browserId,
      tabId,
      snapshotId: readString(payload, "snapshotId"),
      fields: readFillFormFields(payload),
      partial: readOptionalBoolean(payload, "partial")
    });

    const partial = request.partial === true;
    type ResolvedFillTarget = {
      index: number;
      elementId: string;
      value: string;
      target?: Record<string, unknown>;
      executionTarget?: DomExecutionTarget;
      error?: PortusError;
    };
    const targets: ResolvedFillTarget[] = request.fields.map((field, index) => {
      try {
        const element = resolveActionElement({
          action: "type",
          browserId,
          tabId,
          snapshotId: request.snapshotId,
          elementId: field.elementId
        }, this.snapshots) as SnapshotElement;
        return {
          index,
          elementId: field.elementId,
          value: field.value,
          target: createDomActionTarget(element),
          executionTarget: snapshotElementExecutionTarget(element)
        };
      } catch (error) {
        if (!partial) throw error;
        return {
          index,
          elementId: field.elementId,
          value: field.value,
          error: normalizeExtensionError(error)
        };
      }
    });

    let fieldResults: unknown[];
    if (!partial) {
      const executionTargets = targets.map((target) => target.executionTarget).filter((target): target is DomExecutionTarget => target !== undefined);
      const documentIds = new Set(executionTargets.map((target) => target.documentId));
      if (documentIds.size !== 1) {
        throw createPortusError({
          code: "ACTION_UNSUPPORTED",
          message: "Atomic fill-form cannot span multiple frame documents. Use --partial for multi-frame forms.",
          details: { documentCount: documentIds.size }
        });
      }
      const executionTarget = executionTargets[0];
      if (!executionTarget) {
        throw createPortusError({ code: "SNAPSHOT_STALE", message: "Fill form has no available snapshot targets." });
      }
      const result = await this.executeActionScript(tabId, {
        action: "fillForm",
        fields: targets.map((target) => ({ elementId: target.elementId, value: target.value, target: target.target })),
        partial: false
      }, executionTarget);
      if (!result.ok) throw createPortusError(result.error);
      const scriptFieldResults = result.details?.fields;
      fieldResults = Array.isArray(scriptFieldResults)
        ? scriptFieldResults
        : request.fields.map((field) => ({ elementId: field.elementId, ok: true }));
    } else {
      const resultsByIndex: unknown[] = new Array(request.fields.length);
      const groups = new Map<string, {
        executionTarget: DomExecutionTarget;
        fields: Array<{ index: number; elementId: string; value: string; target: Record<string, unknown> }>;
      }>();

      for (const target of targets) {
        if (target.error) {
          resultsByIndex[target.index] = { elementId: target.elementId, ok: false, error: target.error };
          continue;
        }
        if (!target.target || !target.executionTarget) {
          resultsByIndex[target.index] = {
            elementId: target.elementId,
            ok: false,
            error: createPortusError({ code: "ACTION_FAILED", message: "Fill form target is incomplete." })
          };
          continue;
        }
        const group = groups.get(target.executionTarget.documentId) ?? {
          executionTarget: target.executionTarget,
          fields: []
        };
        group.fields.push({ index: target.index, elementId: target.elementId, value: target.value, target: target.target });
        groups.set(target.executionTarget.documentId, group);
      }

      for (const group of groups.values()) {
        try {
          const result = await this.executeActionScript(tabId, {
            action: "fillForm",
            fields: group.fields.map((field) => ({ elementId: field.elementId, value: field.value, target: field.target })),
            partial: true
          }, group.executionTarget);
          if (!result.ok) {
            for (const field of group.fields) {
              resultsByIndex[field.index] = { elementId: field.elementId, ok: false, error: result.error };
            }
            continue;
          }
          const scriptFieldResults = result.details?.fields;
          if (!Array.isArray(scriptFieldResults) || scriptFieldResults.length !== group.fields.length) {
            const error = createPortusError({
              code: "ACTION_FAILED",
              message: "Partial fill form action did not return complete per-field results."
            });
            for (const field of group.fields) {
              resultsByIndex[field.index] = { elementId: field.elementId, ok: false, error };
            }
            continue;
          }
          group.fields.forEach((field, index) => {
            const scriptResult = scriptFieldResults[index];
            resultsByIndex[field.index] = isRecord(scriptResult)
              ? scriptResult
              : {
                elementId: field.elementId,
                ok: false,
                error: createPortusError({ code: "ACTION_FAILED", message: "Partial fill form field result is invalid." })
              };
          });
        } catch (error) {
          const normalized = normalizeExtensionError(error);
          for (const field of group.fields) {
            resultsByIndex[field.index] = { elementId: field.elementId, ok: false, error: normalized };
          }
        }
      }
      fieldResults = resultsByIndex;
    }

    const succeeded = fieldResults.filter((field) => isRecord(field) && field.ok === true).length;
    const failed = fieldResults.length - succeeded;
    const snapshotInvalidated = succeeded > 0;

    const fillFormResult = FillFormResultSchema.parse({
      backend: "content-script-dom",
      completedAt: this.now().toISOString(),
      snapshotInvalidated,
      fields: fieldResults,
      details: {
        fieldCount: request.fields.length,
        succeeded,
        failed,
        partial
      }
    });
    if (fillFormResult.snapshotInvalidated) markSnapshotsStaleForTab(this.snapshots, browserId, tabId);
    return fillFormResult;
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
    this.ensureDebuggerApiAvailable();
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
      version: 2,
      kind: "portus.settingsProfiles",
      catalog
    };
  }

  private createLocalSettingsProfileCatalog(): SettingsProfileCatalog {
    const now = this.now().toISOString();
    const currentContent = this.createCurrentSettingsProfileContent();
    return SettingsProfileCatalogSchema.parse({
      version: 2,
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

  async addNavigationRule(
    kind: "allow" | "block",
    match: NavigationRuleMatch,
    value: string,
    source: "extension" | "cli" | "config" = "extension",
    reason?: string,
    syncBroker = source === "extension",
    syncProfile = syncBroker
  ): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    const entry = this.createNavigationRule(match, value, source, reason);
    const allowed = new Map(this.policyPreferences.allowedNavigationRules.map((item) => [navigationRuleKey(item), item]));
    const blocked = new Map(this.policyPreferences.blockedNavigationRules.map((item) => [navigationRuleKey(item), item]));

    if (kind === "allow") {
      allowed.set(navigationRuleKey(entry), entry);
    } else {
      blocked.set(navigationRuleKey(entry), entry);
    }

    this.policyPreferences = PolicyPreferencesSchema.parse({
      ...this.policyPreferences,
      allowedNavigationRules: [...allowed.values()],
      blockedNavigationRules: [...blocked.values()]
    });
    if (!syncProfile) await this.persistPolicyPreferences();
    if (syncBroker) void this.syncPolicyPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.policyPreferences;
  }

  async removeNavigationRule(
    kind: "allow" | "block",
    match: NavigationRuleMatch,
    value: string,
    syncBroker = true,
    syncProfile = syncBroker
  ): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    let rule: NavigationRulePattern;
    try {
      rule = normalizeNavigationRulePattern(match, value);
    } catch {
      throw invalidNavigationRuleError(match, value);
    }

    const allowed = new Map(this.policyPreferences.allowedNavigationRules.map((item) => [navigationRuleKey(item), item]));
    const blocked = new Map(this.policyPreferences.blockedNavigationRules.map((item) => [navigationRuleKey(item), item]));
    if (kind === "allow") allowed.delete(navigationRuleKey(rule));
    else blocked.delete(navigationRuleKey(rule));

    this.policyPreferences = PolicyPreferencesSchema.parse({
      ...this.policyPreferences,
      allowedNavigationRules: [...allowed.values()],
      blockedNavigationRules: [...blocked.values()]
    });
    if (!syncProfile) await this.persistPolicyPreferences();
    if (syncBroker) void this.syncPolicyPreferences();
    if (syncProfile) await this.afterSettingsProfileChanged();
    return this.policyPreferences;
  }

  async clearNavigationRules(kind: "allow" | "block", syncBroker = true, syncProfile = syncBroker): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.policyPreferences = PolicyPreferencesSchema.parse({
      ...this.policyPreferences,
      ...(kind === "allow" ? { allowedNavigationRules: [] } : { blockedNavigationRules: [] })
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

  async setNavigationPolicyEnabled(enabled: boolean, syncBroker = true, syncProfile = syncBroker): Promise<PolicyPreferences> {
    await this.ready;
    if (syncProfile) await this.prepareSettingsProfileEdit();
    this.policyPreferences = PolicyPreferencesSchema.parse({
      ...this.policyPreferences,
      navigationPolicyEnabled: enabled
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
      case "portus.policy.get":
        return { policy: this.getPolicyPreferences() };
      case "portus.policy.mode.set": {
        const policy = await this.setPolicyMode(PolicyModeSchema.parse(readString(message, "mode")));
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.allow.add": {
        const policy = await this.addNavigationRule(
          "allow",
          readNavigationRuleMatch(message),
          readString(message, "value"),
          "extension",
          readOptionalString(message, "reason")
        );
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.allow.remove": {
        const policy = await this.removeNavigationRule("allow", readNavigationRuleMatch(message), readString(message, "value"));
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.allow.clear": {
        const policy = await this.clearNavigationRules("allow");
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.block.add": {
        const policy = await this.addNavigationRule(
          "block",
          readNavigationRuleMatch(message),
          readString(message, "value"),
          "extension",
          readOptionalString(message, "reason")
        );
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.block.remove": {
        const policy = await this.removeNavigationRule("block", readNavigationRuleMatch(message), readString(message, "value"));
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.block.clear": {
        const policy = await this.clearNavigationRules("block");
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.retention.set": {
        const policy = await this.setSessionStepRetentionLimit(readNumber(message, "limit"));
        return { policy, status: await this.getStatus() };
      }
      case "portus.policy.enabled.set": {
        const policy = await this.setNavigationPolicyEnabled(readBoolean(message, "enabled"));
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
      case "portus.terminal.restart":
        return { status: await this.restartTerminalTransport() };
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
    if (this.terminalPort && (this.terminalNativeHostState === "connected" || this.terminalNativeHostState === "unresponsive")) {
      return this.terminalNativeHostState;
    }
    if (this.terminalConnectPromise) return this.terminalConnectPromise;

    const connection = this.connectTerminalTransportOnce();
    this.terminalConnectPromise = connection;
    try {
      return await connection;
    } finally {
      if (this.terminalConnectPromise === connection) this.terminalConnectPromise = undefined;
    }
  }

  private async connectTerminalTransportOnce(): Promise<TerminalNativeHostState> {
    this.terminalNativeHostState = "connecting";
    let connectedPort: PortusNativePort | undefined;
    try {
      const port = this.chromeApi.runtime.connectNative(this.terminalNativeHostName);
      connectedPort = port;
      this.terminalPort = port;
      port.onMessage.addListener((message: unknown) => {
        this.handleTerminalNativeMessage(message, port);
      });
      port.onDisconnect.addListener(() => {
        this.handleTerminalNativeDisconnect(port);
      });
      this.terminalNativeHostState = "connected";
      return this.terminalNativeHostState;
    } catch (error) {
      if (connectedPort && this.terminalPort === connectedPort) {
        this.terminalPort = undefined;
        try {
          connectedPort.disconnect();
        } catch {
          // The failed native port may already be disconnected.
        }
      }
      this.terminalNativeHostState = "error";
      this.rejectTerminalPending(error instanceof Error ? error : new Error("Terminal Native Host is unavailable."));
      throw normalizeExtensionError(error);
    }
  }

  async disconnectTerminalTransport(): Promise<TerminalNativeHostState> {
    await this.ready;
    this.rejectTerminalPending(new Error("Terminal Native Host disconnected."));
    const port = this.terminalPort;
    this.terminalPort = undefined;
    if (port) port.disconnect();
    this.terminalNativeHostState = "disconnected";
    void this.broadcastStatus();
    return this.terminalNativeHostState;
  }

  async restartTerminalTransport(): Promise<PortusExtensionStatus> {
    await this.ready;
    this.rejectTerminalPending(new Error("Terminal Native Host is restarting."));
    const port = this.terminalPort;
    this.terminalPort = undefined;
    this.terminalNativeHostState = "disconnected";
    if (port) port.disconnect();
    void this.broadcastStatus();
    if (this.terminalPreferences.enabled) await this.connectTerminalTransport();
    void this.broadcastStatus();
    return this.getStatus();
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
    if (this.terminalPending.has(parsed.requestId)) {
      throw createPortusError({
        code: "INVALID_MESSAGE",
        message: `Terminal request id is already pending: ${parsed.requestId}.`
      });
    }
    return new Promise((resolve, reject) => {
      const requestId = parsed.requestId!;
      const timer = this.setRequestTimer(() => {
        const pending = this.terminalPending.get(requestId);
        if (!pending) return;
        this.terminalPending.delete(requestId);
        this.terminalNativeHostState = "unresponsive";
        pending.reject(createPortusError({
          code: "COMMAND_TIMEOUT",
          message: `Terminal request timed out after ${this.terminalRequestTimeoutMs}ms.`,
          retryable: true,
          details: { requestId, type: parsed.type, timeoutMs: this.terminalRequestTimeoutMs }
        }));
        void this.broadcastStatus();
      }, this.terminalRequestTimeoutMs);
      this.terminalPending.set(requestId, { resolve, reject, timer });
      try {
        port.postMessage(parsed);
      } catch (error) {
        this.terminalPending.delete(requestId);
        this.clearRequestTimer(timer);
        reject(error instanceof Error ? error : new Error("Terminal Native Host transport failed."));
      }
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
        const normalized = normalizeExtensionError(error);
        port.postMessage({
          type: "terminal.session.error",
          requestId: parsed.data.requestId,
          terminalId: "terminalId" in parsed.data ? parsed.data.terminalId : undefined,
          payload: {
            code: normalized.code === "COMMAND_TIMEOUT" ? "COMMAND_TIMEOUT" : normalized.code === "INVALID_MESSAGE" ? "INVALID_MESSAGE" : "TERMINAL_UNAVAILABLE",
            message: normalized.message,
            retryable: normalized.retryable
          }
        });
      });
    });
    port.onDisconnect.addListener(() => {
      this.terminalRuntimePorts.delete(port);
    });
    if (this.terminalPreferences.enabled) void this.connectTerminalTransport().catch(() => undefined);
  }

  private handleTerminalNativeMessage(input: unknown, sourcePort: PortusNativePort): void {
    if (this.terminalPort !== sourcePort) return;
    const parsed = TerminalServerMessageSchema.safeParse(input);
    if (!parsed.success) return;
    const message = parsed.data;
    if (this.terminalNativeHostState === "unresponsive") {
      this.terminalNativeHostState = "connected";
      void this.broadcastStatus();
    }
    if (message.requestId) {
      const pending = this.terminalPending.get(message.requestId);
      if (pending) {
        this.terminalPending.delete(message.requestId);
        if (pending.timer !== undefined) this.clearRequestTimer(pending.timer);
        pending.resolve(message);
      }
    }
    for (const port of this.terminalRuntimePorts) port.postMessage(message);
  }

  private handleTerminalNativeDisconnect(disconnectedPort: PortusNativePort): void {
    if (this.terminalPort !== disconnectedPort) return;
    this.terminalPort = undefined;
    this.terminalNativeHostState = "disconnected";
    this.rejectTerminalPending(new Error("Terminal Native Host disconnected."));
    void this.broadcastStatus();
  }

  private rejectTerminalPending(error: Error): void {
    for (const pending of this.terminalPending.values()) {
      if (pending.timer !== undefined) this.clearRequestTimer(pending.timer);
      pending.reject(error);
    }
    this.terminalPending.clear();
  }

  private async handleNativeMessage(input: unknown, sourcePort: PortusNativePort): Promise<void> {
    if (this.port !== sourcePort) return;
    const response = ResponseEnvelopeSchema.safeParse(input);
    if (response.success) {
      this.acceptNativeResponse(response.data);
      return;
    }

    const request = RequestEnvelopeSchema.safeParse(input);
    if (!request.success) return;

    const result = await this.dispatchNativeRequest(request.data)
      .then((value) => createOkResponse(request.data.requestId, value))
      .catch((error) => createErrorResponse(request.data.requestId, normalizeExtensionError(error)));
    if (this.port !== sourcePort) return;
    try {
      sourcePort.postMessage(result);
    } catch {
      if (request.data.type === "bridge.disconnect" && result.ok) {
        this.completeNativeRequestedDisconnect();
      } else {
        this.handleBridgeTransportFailure();
      }
      return;
    }
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
        return { screenshot: await this.captureScreenshot(readOptionalNumber(request.payload, "tabId"), readOptionalBoolean(request.payload, "useDebugger")) };
      case "snapshot.capture":
        return { snapshot: await this.captureSnapshot(readOptionalNumber(request.payload, "tabId"), readOptionalSnapshotFilter(request.payload), readOptionalBoolean(request.payload, "useDebugger")) };
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
      case "policy.get":
        return { policy: this.getPolicyPreferences() };
      case "policy.allow.add":
        return { policy: await this.addNavigationRule("allow", readNavigationRuleMatch(request.payload), readString(request.payload, "value"), "cli", readOptionalString(request.payload, "reason"), false) };
      case "policy.allow.remove":
        return { policy: await this.removeNavigationRule("allow", readNavigationRuleMatch(request.payload), readString(request.payload, "value"), false) };
      case "policy.block.add":
        return { policy: await this.addNavigationRule("block", readNavigationRuleMatch(request.payload), readString(request.payload, "value"), "cli", readOptionalString(request.payload, "reason"), false) };
      case "policy.block.remove":
        return { policy: await this.removeNavigationRule("block", readNavigationRuleMatch(request.payload), readString(request.payload, "value"), false) };
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
      try {
        port.postMessage(request);
      } catch (error) {
        this.pending.delete(request.requestId);
        this.clearRequestTimer(timer);
        reject(normalizeExtensionError(error));
      }
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
      activeTabUrl: null,
      browserId: this.browserId,
      nativeHostName: this.nativeHostName,
      terminalNativeHostName: this.terminalNativeHostName,
      terminalNativeHostState: this.terminalNativeHostState,
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

    const parsedPolicy = hasPolicy
      ? PolicyPreferencesSchema.parse(migrateLegacyPolicyPreferences(readRecord(message, "policyPreferences")))
      : undefined;
    const parsedUx = hasUx ? ExtensionUxPreferencesSchema.parse(readRecord(message, "uxPreferences")) : undefined;
    const parsedTerminal = hasTerminal
      ? TerminalSettingsSchema.parse(migrateLegacyTerminalPreferences(readRecord(message, "terminalPreferences")))
      : undefined;
    const policy = parsedPolicy ? await this.importPolicyPreferences(parsedPolicy) : this.getPolicyPreferences();
    const ux = parsedUx ? await this.importUxPreferences(parsedUx) : this.getUxPreferences();
    const terminal = parsedTerminal ? await this.setTerminalPreferences(parsedTerminal, false) : this.getTerminalPreferences();
    return { policy, ux, terminal };
  }

  private readImportedSettingsProfileCatalog(message: Record<string, unknown>): SettingsProfileCatalog | null {
    const directCatalog = SettingsProfileCatalogSchema.safeParse(migrateLegacySettingsProfileCatalog(message.catalog));
    if (directCatalog.success) return directCatalog.data;

    const settings = isRecord(message.settings) ? message.settings : undefined;
    if (!settings) return null;
    const settingsCatalog = SettingsProfileCatalogSchema.safeParse(migrateLegacySettingsProfileCatalog(settings.catalog));
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

  private handleNativeDisconnect(disconnectedPort: PortusNativePort): void {
    if (this.port !== disconnectedPort) return;
    this.port = undefined;
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
    const port = this.port;
    this.port = undefined;
    if (port) port.disconnect();
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
        ? ["tabs", "windows", "screenshots", "snapshots", "actions", "advanced-debugger", "policy", "events"]
        : ["tabs", "windows", "screenshots", "snapshots", "actions", "policy", "events"],
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
    if (!this.isTabVisibleToAgent(tab)) {
      this.policyVisibleTabIds.delete(tab.id);
      return;
    }
    this.policyVisibleTabIds.add(tab.id);
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


  private ensureTabPolicyAllowed(tab: ChromeTab): void {
    const url = requireTabUrl(tab);
    this.ensureNavigationPolicyAllowed(url);
    ensureBrowserPageAccess(url);
    if (tab.id !== undefined) this.policyVisibleTabIds.add(tab.id);
  }

  private ensureTabMetadataPolicyAllowed(tab: ChromeTab): void {
    if (tab.url) this.ensureNavigationPolicyAllowed(tab.url);
    if (tab.id !== undefined) this.policyVisibleTabIds.add(tab.id);
  }

  private isTabVisibleToAgent(tab: ChromeTab): boolean {
    if (!tab.url) return true;
    return navigationPolicyAllowsUrl(tab.url, this.policyPreferences);
  }

  private ensureNavigationPolicyAllowed(url: string): void {
    if (navigationPolicyAllowsUrl(url, this.policyPreferences)) return;
    const message = this.policyPreferences.policyMode === "blocklist"
      ? `Portus navigation policy blocks ${url}.`
      : `Portus navigation policy does not allow ${url}.`;
    throw createPortusError({
      code: "NAVIGATION_BLOCKED",
      message,
      details: { url }
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

  private async installComposedDomRuntime(tabId: number): Promise<void> {
    if (!this.chromeApi.scripting) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome scripting API is unavailable."
      });
    }
    await mapChromeAccessOperation("install composed DOM runtime", promisifyChromeCall<ChromeScriptInjectionResult[]>((done) => {
      const result = this.chromeApi.scripting?.executeScript({
        target: { tabId, allFrames: true },
        files: [COMPOSED_DOM_RUNTIME_FILE]
      });
      done(result as Promise<ChromeScriptInjectionResult[]> | ChromeScriptInjectionResult[] | undefined);
    }));
  }

  private async executeSnapshotScript(tabId: number, filter?: SnapshotFilter): Promise<Record<string, unknown>> {
    if (!this.chromeApi.scripting) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome scripting API is unavailable."
      });
    }

    const collectionFilter = createSnapshotCollectionFilter(filter);
    await this.installComposedDomRuntime(tabId);

    const results = await mapChromeAccessOperation("execute snapshot script", promisifyChromeCall<ChromeScriptInjectionResult[]>((done) => {
      const result = this.chromeApi.scripting?.executeScript({
        target: { tabId, allFrames: true },
        func: capturePortusSnapshotPayload,
        args: [collectionFilter, SNAPSHOT_COLLECTION_LIMIT]
      });
      done(result as Promise<ChromeScriptInjectionResult[]> | ChromeScriptInjectionResult[] | undefined);
    }));

    if (results.length === 0) {
      throw createPortusError({
        code: "ACTION_FAILED",
        message: "Snapshot script returned no frame results."
      });
    }

    const frames = results.map((injection) => {
      if (!Number.isInteger(injection.frameId) || injection.frameId < 0 || typeof injection.documentId !== "string" || injection.documentId.length === 0 || !isRecord(injection.result)) {
        throw createPortusError({
          code: "ACTION_FAILED",
          message: "Snapshot script returned invalid frame metadata."
        });
      }
      return {
        frameId: injection.frameId,
        documentId: injection.documentId,
        page: injection.result
      };
    });
    const mainFrame = frames.find((frame) => frame.frameId === 0);
    if (!mainFrame) {
      throw createPortusError({
        code: "ACTION_FAILED",
        message: "Snapshot script did not return the main frame."
      });
    }

    const elements: Record<string, unknown>[] = [];
    let candidateCount = 0;
    let matchedElementCount = 0;
    let frameTruncated = false;
    for (const frame of frames) {
      const pageElements = Array.isArray(frame.page.elements) ? frame.page.elements.filter(isRecord) : [];
      candidateCount += readNonnegativeInteger(frame.page.candidateCount) ?? pageElements.length;
      matchedElementCount += readNonnegativeInteger(frame.page.matchedElementCount) ?? pageElements.length;
      frameTruncated = frameTruncated || frame.page.truncated === true;
      for (const element of pageElements) {
        elements.push({ ...element, frameId: frame.frameId, documentId: frame.documentId });
      }
    }

    const requestedLimit = Math.min(filter?.maxElements ?? SNAPSHOT_COLLECTION_LIMIT, SNAPSHOT_COLLECTION_LIMIT);
    const truncated = frameTruncated || matchedElementCount > requestedLimit;
    const visibleText = frames
      .map((frame) => typeof frame.page.visibleText === "string" ? frame.page.visibleText : "")
      .filter(Boolean)
      .join("\n")
      .slice(0, 100000);

    return {
      url: readString(mainFrame.page, "url"),
      title: readString(mainFrame.page, "title"),
      viewport: mainFrame.page.viewport,
      visibleText,
      elements: elements.slice(0, SNAPSHOT_COLLECTION_LIMIT),
      candidateCount,
      matchedElementCount,
      truncated
    };
  }

  private async executePageWaitScript(tabId: number, condition: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.chromeApi.scripting) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome scripting API is unavailable."
      });
    }
    await this.installComposedDomRuntime(tabId);
    const results = await mapChromeAccessOperation("execute page wait script", promisifyChromeCall<ChromeScriptInjectionResult[]>((done) => {
      const result = this.chromeApi.scripting?.executeScript({
        target: { tabId, allFrames: true },
        func: evaluatePortusPageWait,
        args: [condition]
      });
      done(result as Promise<ChromeScriptInjectionResult[]> | ChromeScriptInjectionResult[] | undefined);
    }));

    let sawValidResult = false;
    for (const injection of results) {
      const waitResult = injection.result;
      if (!isRecord(waitResult) || typeof waitResult.matched !== "boolean") continue;
      sawValidResult = true;
      if (waitResult.matched !== true) continue;
      return {
        ...waitResult,
        details: {
          ...(isRecord(waitResult.details) ? waitResult.details : {}),
          frameId: injection.frameId,
          documentId: injection.documentId
        }
      };
    }
    if (!sawValidResult) {
      throw createPortusError({
        code: "ACTION_FAILED",
        message: "Page wait script returned no valid frame results."
      });
    }
    return { matched: false };
  }

  private async executeConsoleListScript(tabId: number): Promise<Record<string, unknown>[]> {
    if (!this.chromeApi.scripting) {
      throw createPortusError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "Chrome scripting API is unavailable."
      });
    }
    const results = await mapChromeAccessOperation("execute console capture script", promisifyChromeCall<Array<{ result?: unknown }>>((done) => {
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
    await mapChromeAccessOperation("execute console clear script", promisifyChromeCall<Array<{ result?: unknown }>>((done) => {
      const result = this.chromeApi.scripting?.executeScript({
        target: { tabId },
        func: clearPortusConsoleMessages,
        world: "MAIN"
      });
      done(result as Promise<Array<{ result?: unknown }>> | Array<{ result?: unknown }> | undefined);
    }));
  }

  private async executeActionScript(
    tabId: number,
    payload: Record<string, unknown>,
    executionTarget?: DomExecutionTarget
  ): Promise<{
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

    let results: ChromeScriptInjectionResult[];
    try {
      results = await mapChromeAccessOperation("execute action script", promisifyChromeCall<ChromeScriptInjectionResult[]>((done) => {
        const result = this.chromeApi.scripting?.executeScript({
          target: executionTarget
            ? { tabId, documentIds: [executionTarget.documentId] }
            : { tabId, frameIds: [0] },
          func: performPortusDomAction,
          args: [payload]
        });
        done(result as Promise<ChromeScriptInjectionResult[]> | ChromeScriptInjectionResult[] | undefined);
      }));
    } catch (error) {
      if (executionTarget) {
        throw createPortusError({
          code: "SNAPSHOT_STALE",
          message: "Snapshot document is no longer available for the action.",
          details: {
            tabId,
            frameId: executionTarget.frameId,
            documentId: executionTarget.documentId,
            reason: isPortusError(error) ? error.message : error instanceof Error ? error.message : "Document-targeted action failed."
          }
        });
      }
      throw error;
    }

    const injection = results[0];
    if (!injection || (executionTarget && (injection.frameId !== executionTarget.frameId || injection.documentId !== executionTarget.documentId))) {
      throw createPortusError({
        code: "SNAPSHOT_STALE",
        message: "Action executed in a different document than the snapshot target.",
        details: executionTarget ? {
          expectedFrameId: executionTarget.frameId,
          expectedDocumentId: executionTarget.documentId,
          actualFrameId: injection?.frameId,
          actualDocumentId: injection?.documentId
        } : {}
      });
    }

    const actionResult = injection.result;
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

  private ensureDebuggerApiAvailable(): void {
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
    this.ensureDebuggerApiAvailable();
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
    this.ensureDebuggerApiAvailable();
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


  private createNavigationRule(
    match: NavigationRuleMatch,
    value: string,
    source: "extension" | "cli" | "config",
    reason?: string
  ): NavigationRule {
    let rule: NavigationRulePattern;
    try {
      rule = normalizeNavigationRulePattern(match, value);
    } catch {
      throw invalidNavigationRuleError(match, value);
    }
    return NavigationRuleSchema.parse({
      ...rule,
      source,
      updatedAt: this.now().toISOString(),
      ...(reason === undefined ? {} : { reason })
    });
  }

  private async restoreExtensionState(): Promise<void> {
    await this.restorePolicyPreferences();
    await this.restoreUxPreferences();
    await this.restoreTerminalPreferences();
    await this.restoreBridgePreference();
    await this.updateActionState();
  }


  private async restorePolicyPreferences(): Promise<void> {
    const storage = this.chromeApi.storage?.local;
    if (!storage) return;
    const stored = await promisifyChromeCall<Record<string, unknown>>((done) => {
      const result = storage.get(POLICY_STORAGE_KEY);
      done(result as Promise<Record<string, unknown>> | Record<string, unknown> | undefined);
    });
    const input = stored[POLICY_STORAGE_KEY];
    const migrated = migrateLegacyPolicyPreferences(input);
    const parsed = PolicyPreferencesSchema.safeParse(migrated);
    if (parsed.success) {
      this.policyPreferences = parsed.data;
      if (migrated !== input) await this.persistPolicyPreferences();
    }
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
    const current = stored[TERMINAL_PREFERENCES_STORAGE_KEY];
    const migrated = migrateLegacyTerminalPreferences(current);
    const parsed = TerminalSettingsSchema.safeParse(migrated);
    if (!parsed.success) return;
    this.terminalPreferences = parsed.data;
    if (migrated !== current) await this.persistTerminalPreferences();
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

async function mapChromeAccessOperation<T>(operation: string, operationPromise: Promise<T>): Promise<T> {
  try {
    return await operationPromise;
  } catch (error) {
    if (isPortusError(error)) throw error;
    throw createPortusError({
      code: "BROWSER_ACCESS_DENIED",
      message: `Chrome denied access while attempting to ${operation}.`,
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


function readNavigationUrl(value: string): string {
  const parsed = NavigationUrlSchema.safeParse(value);
  if (!parsed.success) {
    throw createPortusError({
      code: "INVALID_MESSAGE",
      message: `Expected an absolute navigation URL: ${value}.`,
      details: { url: value }
    });
  }
  return normalizeNavigationUrl(parsed.data);
}

function readNavigationRuleMatch(record: Record<string, unknown>): NavigationRuleMatch {
  const parsed = NavigationRuleMatchSchema.safeParse(record.match);
  if (parsed.success) return parsed.data;
  throw createPortusError({
    code: "INVALID_MESSAGE",
    message: "Expected navigation rule match type.",
    details: { match: record.match }
  });
}

function invalidNavigationRuleError(match: NavigationRuleMatch, value: string): PortusError {
  return createPortusError({
    code: "INVALID_MESSAGE",
    message: `Invalid ${match} navigation rule: ${value}.`,
    details: { match, value }
  });
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

function requireTabUrl(tab: ChromeTab): string {
  if (!tab.url) {
    throw createPortusError({
      code: "BROWSER_ACCESS_DENIED",
      message: "Tab URL is unavailable for browser access validation."
    });
  }
  const parsed = NavigationUrlSchema.safeParse(tab.url);
  if (!parsed.success) {
    throw createPortusError({
      code: "BROWSER_ACCESS_DENIED",
      message: "Tab URL is invalid for browser access validation.",
      details: { url: tab.url }
    });
  }
  return normalizeNavigationUrl(parsed.data);
}

function ensureBrowserPageAccess(value: string): void {
  const url = new URL(value);
  if (url.protocol === "http:" || url.protocol === "https:") return;
  throw createPortusError({
    code: "BROWSER_ACCESS_DENIED",
    message: `Browser access is unavailable for ${url.protocol} pages.`,
    details: { url: value }
  });
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

function createSnapshotCollectionFilter(filter?: SnapshotFilter): Record<string, unknown> | null {
  if (!filter) return null;
  const collectionFilter: Record<string, unknown> = {};
  if (filter.query !== undefined) collectionFilter.query = filter.query;
  if (filter.role !== undefined) collectionFilter.role = filter.role;
  if (filter.interactiveOnly === true) collectionFilter.interactiveOnly = true;
  return Object.keys(collectionFilter).length === 0 ? null : collectionFilter;
}

function readNonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function snapshotElementExecutionTarget(element: SnapshotElement): DomExecutionTarget {
  return {
    frameId: element.frameId,
    documentId: element.documentId
  };
}

function readElementCandidates(value: unknown): SnapshotElementCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((element) => {
    const frameId = readNonnegativeInteger(element.frameId);
    const documentId = typeof element.documentId === "string" && element.documentId.length > 0 ? element.documentId : null;
    if (frameId === null || documentId === null) {
      throw createPortusError({
        code: "ACTION_FAILED",
        message: "Snapshot element is missing frame or document identity."
      });
    }
    const candidate: SnapshotElementCandidate = {
      frameId,
      documentId,
      role: typeof element.role === "string" && element.role.length > 0 ? element.role : "generic",
      label: typeof element.label === "string" ? element.label : "",
      text: typeof element.text === "string" ? element.text : "",
      bounds: readBounds(element.bounds),
      state: isRecord(element.state) ? element.state : {}
    };
    if (typeof element.selectorHint === "string") candidate.selectorHint = element.selectorHint;
    if (element.shadowPath !== undefined) {
      const shadowPath = ShadowPathSchema.safeParse(element.shadowPath);
      if (!shadowPath.success) {
        throw createPortusError({
          code: "ACTION_FAILED",
          message: "Snapshot element has an invalid shadow path."
        });
      }
      candidate.shadowPath = shadowPath.data;
    }

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
    frameId: element.frameId,
    documentId: element.documentId,
    role: element.role,
    label: element.label,
    text: element.text,
    bounds: element.bounds,
    state: element.state
  };
  if (element.selectorHint !== undefined) target.selectorHint = element.selectorHint;
  if (element.shadowPath !== undefined) target.shadowPath = element.shadowPath;

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

export function capturePortusSnapshotPayload(
  filterInput: Record<string, unknown> | null = null,
  collectionLimit = 10000
): Record<string, unknown> {
  const runtime = (globalThis as typeof globalThis & {
    __portusComposedDom?: {
      collect(root?: Document | ShadowRoot): Array<{
        element: Element;
        root: Document | ShadowRoot;
        selectorHint: string;
        shadowPath?: Array<{ hostSelectorHint: string; rootType: "open" | "closed" }>;
      }>;
    };
  }).__portusComposedDom;
  if (!runtime || typeof runtime.collect !== "function") {
    throw new Error("Portus composed-DOM runtime is unavailable.");
  }

  const candidateSelector = "button,a[href],input,textarea,select,[role],[contenteditable],[tabindex]:not([tabindex^=\"-\"]),[onclick]";
  const candidates = runtime.collect(document)
    .filter((entry) => entry.element instanceof HTMLElement && entry.element.matches(candidateSelector))
    .filter((entry) => {
      const element = entry.element as HTMLElement;
      if (element.offsetWidth === 0 || element.offsetHeight === 0) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const bounds = element.getBoundingClientRect();
      return bounds.bottom >= 0
        && bounds.right >= 0
        && bounds.top <= window.innerHeight
        && bounds.left <= window.innerWidth;
    });

  const candidateCount = candidates.length;
  let elements = candidates.map((entry) => {
    const element = entry.element as HTMLElement;
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
      selectorHint: entry.selectorHint,
      ...(entry.shadowPath === undefined ? {} : { shadowPath: entry.shadowPath }),
      tagName,
      disabled: "disabled" in element ? Boolean((element as HTMLButtonElement).disabled) : false,
      editable,
      href: element instanceof HTMLAnchorElement ? element.href : undefined,
      inputType: input?.type,
      name: input?.name || undefined,
      placeholder: input?.placeholder || undefined
    };
  });

  const query = typeof filterInput?.query === "string" ? normalizeSearchText(filterInput.query) : "";
  const roleFilter = typeof filterInput?.role === "string" ? filterInput.role.trim().toLowerCase() : "";
  const interactiveOnly = filterInput?.interactiveOnly === true;
  if (query) elements = elements.filter((element) => elementMatchesQuery(element, query));
  if (roleFilter) elements = elements.filter((element) => element.role.toLowerCase() === roleFilter);
  if (interactiveOnly) elements = elements.filter(isLikelyInteractiveElement);

  const matchedElementCount = elements.length;
  const safeCollectionLimit = Number.isInteger(collectionLimit) && collectionLimit > 0 ? collectionLimit : 10000;
  const requestedMax = typeof filterInput?.maxElements === "number"
    && Number.isInteger(filterInput.maxElements)
    && filterInput.maxElements > 0
    ? filterInput.maxElements
    : safeCollectionLimit;
  const effectiveLimit = Math.min(requestedMax, safeCollectionLimit);
  const truncated = matchedElementCount > effectiveLimit;
  elements = elements.slice(0, effectiveLimit);

  return {
    url: location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      deviceScaleFactor: window.devicePixelRatio || 1
    },
    visibleText: (document.body?.textContent ?? "").slice(0, 20000),
    elements,
    candidateCount,
    matchedElementCount,
    truncated
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
      const root = element.getRootNode() as Node & { getElementById?: (id: string) => Element | null };
      const getById = typeof root.getElementById === "function"
        ? (id: string) => root.getElementById?.(id) ?? null
        : (id: string) => document.getElementById(id);
      const text = labelledBy.split(/\s+/).map((id) => getById(id)?.textContent?.trim() ?? "").filter(Boolean).join(" ");
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
    const rawText = (element.textContent || "").slice(0, 1000);
    return rawText.trim().replace(/\s+/g, " ").slice(0, 500);
  }

  function elementMatchesQuery(element: typeof elements[number], normalizedQuery: string): boolean {
    const haystack = [
      element.label,
      element.text,
      element.role,
      element.href ?? "",
      element.inputType ?? "",
      element.name ?? "",
      element.placeholder ?? "",
      element.selectorHint,
      element.tagName
    ].map(normalizeSearchText).join(" ");
    return haystack.includes(normalizedQuery);
  }

  function isLikelyInteractiveElement(element: typeof elements[number]): boolean {
    if (element.disabled === true) return false;
    if (element.editable === true) return true;
    const role = element.role.toLowerCase();
    if ([
      "button",
      "link",
      "textbox",
      "searchbox",
      "combobox",
      "checkbox",
      "radio",
      "switch",
      "tab",
      "menuitem",
      "option",
      "slider",
      "spinbutton"
    ].includes(role)) return true;
    return element.tagName === "a"
      || element.tagName === "button"
      || element.tagName === "input"
      || element.tagName === "textarea"
      || element.tagName === "select";
  }

  function normalizeSearchText(value: string): string {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
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
      const partial = payload.partial === true;
      const resolved = fields.map((field) => {
        if (!isPlainRecord(field) || typeof field.value !== "string" || typeof field.elementId !== "string") {
          return { ok: false as const, error: portusActionError("ACTION_FAILED", "Invalid fill form field."), elementId: "" };
        }
        if (isPlainRecord(field.error) && typeof field.error.code === "string" && typeof field.error.message === "string") {
          return { ok: false as const, error: field.error, elementId: field.elementId };
        }
        if (!isPlainRecord(field.target)) {
          return { ok: false as const, error: portusActionError("ACTION_FAILED", "Fill form field is missing a target."), elementId: field.elementId };
        }
        const match = resolveLiveActionElement(field.target);
        if (!match.element) {
          return {
            ok: false as const,
            error: portusActionError("SNAPSHOT_STALE", "Fill form target no longer matches the current DOM."),
            elementId: field.elementId
          };
        }
        if (!isEditableElement(match.element)) {
          return {
            ok: false as const,
            error: portusActionError("ACTION_UNSUPPORTED", "Fill form target is not editable."),
            elementId: field.elementId
          };
        }
        return { ok: true as const, element: match.element, value: field.value, elementId: field.elementId, score: match.score };
      });

      if (!partial) {
        const firstFailure = resolved.find((field) => !field.ok);
        if (firstFailure && !firstFailure.ok) return { ok: false, error: firstFailure.error };
        for (const field of resolved) {
          if (!field.ok) continue;
          setEditableValue(field.element, field.value);
        }
        return {
          ok: true,
          details: {
            action,
            fieldCount: resolved.length,
            targetValidated: true,
            partial: false,
            fields: resolved.map((field) => ({ elementId: field.elementId, ok: true }))
          }
        };
      }

      const fieldResults = resolved.map((field) => {
        if (!field.ok) return { elementId: field.elementId, ok: false, error: field.error };
        try {
          setEditableValue(field.element, field.value);
          return { elementId: field.elementId, ok: true };
        } catch (error) {
          return {
            elementId: field.elementId,
            ok: false,
            error: portusActionError("ACTION_FAILED", error instanceof Error ? error.message : "Failed to fill form field.")
          };
        }
      });
      return {
        ok: true,
        details: {
          action,
          fieldCount: resolved.length,
          targetValidated: fieldResults.every((field) => field.ok),
          partial: true,
          fields: fieldResults
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
      error: portusActionError(code, message)
    };
  }

  function portusActionError(code: string, message: string): Record<string, unknown> {
    return { code, message };
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
    const rawText = (element.textContent || "").slice(0, 1000);
    return rawText.trim().replace(/\s+/g, " ").slice(0, 500);
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
