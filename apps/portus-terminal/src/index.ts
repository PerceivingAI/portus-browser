import { access, mkdir, stat } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import path from "node:path";
import { DEFAULT_PORTUS_CONFIG, TerminalConfigSchema, type TerminalConfig } from "@portus/config";
import { NativeMessageFrameError, decodeNativeMessageFrame, encodeNativeMessage, tryReadNativeMessageFrame } from "@portus/native-messaging";
import { NodePtyAdapter } from "./ptyAdapter.js";
import {
  DEFAULT_TERMINAL_WORKING_DIRECTORY,
  TerminalClientMessageSchema,
  TerminalErrorPayloadSchema,
  TerminalServerMessageSchema,
  TerminalProfileSchema,
  TerminalSessionMetadataSchema,
  type TerminalClientMessage,
  type TerminalErrorPayload,
  type TerminalProfile,
  type TerminalProfileId,
  type TerminalSessionMetadata,
  type TerminalServerMessage,
  type TerminalSettings
} from "@portus/terminal";

export interface PtySpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string | undefined>;
}

export interface PtyExitEvent {
  exitCode: number | null;
}

export interface PtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: PtyExitEvent) => void): void;
}

export interface PtyAdapter {
  spawn(options: PtySpawnOptions): PtyProcess;
}

export interface CommandProbe {
  exists(command: string): Promise<boolean> | boolean;
  listWslDistributions?(): Promise<string[]> | string[];
}

export interface FileSystemAdapter {
  ensureDirectory(directory: string): Promise<void>;
  isDirectory(directory: string): Promise<boolean>;
}

export class NodeFileSystemAdapter implements FileSystemAdapter {
  async ensureDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true });
  }

  async isDirectory(directory: string): Promise<boolean> {
    try {
      const entry = await stat(directory);
      return entry.isDirectory();
    } catch {
      return false;
    }
  }
}

export class PathCommandProbe implements CommandProbe {
  constructor(private readonly env: Record<string, string | undefined> = readProcessEnv()) {}

  async exists(command: string): Promise<boolean> {
    if (path.isAbsolute(command)) return canAccess(command);
    const pathValue = this.env.PATH ?? this.env.Path ?? this.env.path ?? "";
    const extensions = process.platform === "win32"
      ? (this.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
    for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
      for (const extension of extensions) {
        const commandName = process.platform === "win32" && path.extname(command) === ""
          ? `${command}${extension.toLowerCase()}`
          : command;
        const candidate = path.join(directory, commandName);
        if (await canAccess(candidate)) return true;
        if (process.platform === "win32" && path.extname(command) === "") {
          const upperCandidate = path.join(directory, `${command}${extension.toUpperCase()}`);
          if (await canAccess(upperCandidate)) return true;
        }
      }
    }
    return false;
  }
}

export interface WorkingDirectoryResolverOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  fileSystem?: FileSystemAdapter;
}

export class WorkingDirectoryResolver {
  private readonly env: Record<string, string | undefined>;
  private readonly platform: NodeJS.Platform;
  private readonly fileSystem: FileSystemAdapter;

  constructor(options: WorkingDirectoryResolverOptions = {}) {
    this.env = options.env ?? readProcessEnv();
    this.platform = options.platform ?? process.platform;
    this.fileSystem = options.fileSystem ?? new NodeFileSystemAdapter();
  }

  async resolve(input: string = DEFAULT_TERMINAL_WORKING_DIRECTORY): Promise<string> {
    const directory = input === DEFAULT_TERMINAL_WORKING_DIRECTORY
      ? this.defaultSessionDirectory()
      : input;
    if (!path.isAbsolute(directory)) {
      throw terminalError("TERMINAL_UNAVAILABLE", `Terminal working directory must be absolute: ${directory}.`, { directory });
    }
    if (input === DEFAULT_TERMINAL_WORKING_DIRECTORY) {
      await this.fileSystem.ensureDirectory(directory);
    }
    if (!await this.fileSystem.isDirectory(directory)) {
      throw terminalError("TERMINAL_UNAVAILABLE", `Terminal working directory is unavailable: ${directory}.`, { directory });
    }
    return directory;
  }

  defaultSessionDirectory(): string {
    const home = this.platform === "win32"
      ? this.env.USERPROFILE ?? this.env.HOME
      : this.env.HOME ?? this.env.USERPROFILE;
    if (!home) throw terminalError("TERMINAL_UNAVAILABLE", "Cannot resolve the user Downloads folder for terminal sessions.");
    return path.join(home, "Downloads", "portus-session");
  }
}

export interface ShellDetectorOptions {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  probe?: CommandProbe;
}

export class ShellDetector {
  private readonly platform: NodeJS.Platform;
  private readonly env: Record<string, string | undefined>;
  private readonly probe: CommandProbe;

  constructor(options: ShellDetectorOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? readProcessEnv();
    this.probe = options.probe ?? new PathCommandProbe(this.env);
  }

  async detect(settings: Pick<TerminalSettings, "manualTerminalPath"> = { manualTerminalPath: null }): Promise<TerminalProfile[]> {
    const profiles: TerminalProfile[] = [];
    if (settings.manualTerminalPath) {
      profiles.push(createProfile({
        profileId: "manual",
        label: path.basename(settings.manualTerminalPath),
        kind: "custom",
        command: settings.manualTerminalPath,
        source: "manual",
        detected: true
      }));
    }

    if (this.platform === "win32") {
      await this.detectWindows(profiles);
    } else {
      await this.detectUnix(profiles);
    }

    return dedupeProfiles(profiles);
  }

  private async detectWindows(profiles: TerminalProfile[]): Promise<void> {
    await this.addIfExists(profiles, "powershell", "Windows PowerShell", "shell", "powershell.exe", ["-NoLogo"]);
    await this.addIfExists(profiles, "pwsh", "PowerShell 7", "shell", "pwsh.exe", ["-NoLogo"]);
    await this.addIfExists(profiles, "cmd", "Command Prompt", "shell", "cmd.exe", []);
    if (await this.probe.exists("wsl.exe")) {
      profiles.push(createProfile({ profileId: "wsl-default", label: "WSL Default", kind: "wsl", command: "wsl.exe", args: [], source: "detected", detected: true }));
      const distributions = await this.probe.listWslDistributions?.() ?? [];
      for (const distribution of distributions.filter((item) => item.trim().length > 0)) {
        profiles.push(createProfile({
          profileId: `wsl:${profileIdPart(distribution)}`,
          label: `WSL: ${distribution}`,
          kind: "wsl",
          command: "wsl.exe",
          args: ["-d", distribution],
          source: "detected",
          detected: true
        }));
      }
    }
    for (const gitBash of [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe"
    ]) {
      if (await this.probe.exists(gitBash)) {
        profiles.push(createProfile({ profileId: "git-bash", label: "Git Bash", kind: "shell", command: gitBash, args: ["--login"], source: "detected", detected: true }));
        break;
      }
    }
  }

  private async detectUnix(profiles: TerminalProfile[]): Promise<void> {
    const shell = this.env.SHELL;
    if (shell && await this.probe.exists(shell)) {
      profiles.push(createProfile({ profileId: profileIdPart(path.basename(shell)), label: path.basename(shell), kind: "shell", command: shell, source: "detected", detected: true }));
    }
    for (const candidate of ["bash", "zsh", "fish", "sh", "tmux", "screen"]) {
      await this.addIfExists(profiles, candidate, candidate, candidate === "tmux" || candidate === "screen" ? "custom" : "shell", candidate, []);
    }
  }

  private async addIfExists(
    profiles: TerminalProfile[],
    profileId: string,
    label: string,
    kind: TerminalProfile["kind"],
    command: string,
    args: string[]
  ): Promise<void> {
    if (!await this.probe.exists(command)) return;
    profiles.push(createProfile({ profileId, label, kind, command, args, source: "detected", detected: true }));
  }
}

export interface TerminalSessionClient {
  onOutput(data: string, session: TerminalSession): void;
  onExit?(event: PtyExitEvent, session: TerminalSession): void;
}

export interface TerminalSessionOptions {
  terminalId: string;
  profile: TerminalProfile;
  cwd: string;
  cols: number;
  rows: number;
  now: () => Date;
  pty: PtyProcess;
}

export class TerminalSession {
  readonly terminalId: string;
  readonly profile: TerminalProfile;
  readonly cwd: string;
  readonly createdAt: string;
  private readonly now: () => Date;
  private readonly pty: PtyProcess;
  private readonly clients = new Set<TerminalSessionClient>();
  private status: TerminalSessionMetadata["status"] = "running";
  private lastActiveAtValue: string;
  private exitCodeValue: number | null | undefined;
  private colsValue: number;
  private rowsValue: number;

  constructor(options: TerminalSessionOptions) {
    this.terminalId = options.terminalId;
    this.profile = options.profile;
    this.cwd = options.cwd;
    this.now = options.now;
    this.pty = options.pty;
    this.colsValue = options.cols;
    this.rowsValue = options.rows;
    this.createdAt = this.now().toISOString();
    this.lastActiveAtValue = this.createdAt;
    this.pty.onData((data) => {
      this.touch();
      for (const client of this.clients) client.onOutput(data, this);
    });
    this.pty.onExit((event) => {
      this.status = "exited";
      this.exitCodeValue = event.exitCode;
      this.touch();
      for (const client of this.clients) client.onExit?.(event, this);
    });
  }

  attach(client: TerminalSessionClient): void {
    this.clients.add(client);
    this.touch();
  }

  detach(client: TerminalSessionClient): void {
    this.clients.delete(client);
  }

  write(data: string): void {
    if (this.status !== "running") throw terminalError("PTY_EXITED", `Terminal session is not running: ${this.terminalId}.`, { terminalId: this.terminalId });
    this.pty.write(data);
    this.touch();
  }

  resize(cols: number, rows: number): void {
    if (this.status !== "running") return;
    this.colsValue = cols;
    this.rowsValue = rows;
    this.pty.resize(cols, rows);
    this.touch();
  }

  close(): void {
    if (this.status === "closed") return;
    this.status = "closed";
    this.pty.kill();
    this.touch();
  }

  metadata(): TerminalSessionMetadata {
    return TerminalSessionMetadataSchema.parse({
      terminalId: this.terminalId,
      profileId: this.profile.profileId,
      title: this.profile.label,
      cwd: this.cwd,
      status: this.status,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAtValue,
      cols: this.colsValue,
      rows: this.rowsValue,
      ...(this.exitCodeValue === undefined ? {} : { exitCode: this.exitCodeValue })
    });
  }

  get lastActiveAt(): string {
    return this.lastActiveAtValue;
  }

  private touch(): void {
    this.lastActiveAtValue = this.now().toISOString();
  }
}

export interface TerminalManagerOptions {
  config?: Partial<TerminalConfig>;
  ptyAdapter: PtyAdapter;
  shellDetector?: ShellDetector;
  workingDirectoryResolver?: WorkingDirectoryResolver;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

export class TerminalManager {
  private settings: TerminalSettings;
  private readonly ptyAdapter: PtyAdapter;
  private readonly shellDetector: ShellDetector;
  private readonly workingDirectoryResolver: WorkingDirectoryResolver;
  private readonly now: () => Date;
  private readonly env: Record<string, string | undefined>;
  private readonly sessions = new Map<string, TerminalSession>();
  private profiles: TerminalProfile[] = [];
  private nextSessionNumber = 1;
  private activeTerminalIdValue: string | null = null;
  private defaultSessionPromise: Promise<TerminalSession> | null = null;

  constructor(options: TerminalManagerOptions) {
    this.settings = TerminalConfigSchema.parse({ ...DEFAULT_PORTUS_CONFIG.terminal, ...options.config });
    this.ptyAdapter = options.ptyAdapter;
    this.shellDetector = options.shellDetector ?? new ShellDetector();
    this.workingDirectoryResolver = options.workingDirectoryResolver ?? new WorkingDirectoryResolver();
    this.now = options.now ?? (() => new Date());
    this.env = options.env ?? readProcessEnv();
  }

  get currentSettings(): TerminalSettings {
    return this.settings;
  }

  get activeTerminalId(): string | null {
    return this.activeTerminalIdValue;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.settings = TerminalConfigSchema.parse({ ...this.settings, enabled });
    if (!enabled) {
      this.closeAllSessions();
      this.profiles = [];
      this.activeTerminalIdValue = null;
      return;
    }
    await this.ensureReady();
  }

  async updateSettings(settings: Partial<TerminalConfig>): Promise<TerminalSettings> {
    const wasEnabled = this.settings.enabled;
    this.settings = TerminalConfigSchema.parse({ ...this.settings, ...settings });
    if (wasEnabled && !this.settings.enabled) {
      this.closeAllSessions();
      this.profiles = [];
      this.activeTerminalIdValue = null;
    } else if (this.settings.enabled) {
      this.profiles = [];
    }
    return this.settings;
  }

  async ensureReady(cols = 100, rows = 30): Promise<TerminalSession | null> {
    if (!this.settings.enabled) return null;
    await this.listProfiles(true);
    return this.ensureDefaultSession({ cols, rows });
  }

  async listProfiles(refresh = false): Promise<TerminalProfile[]> {
    if (!this.settings.enabled) return [];
    if (this.profiles.length > 0 && !refresh) return this.profiles;
    this.profiles = await this.shellDetector.detect({ manualTerminalPath: this.settings.manualTerminalPath });
    return this.profiles;
  }

  listSessions(): TerminalSessionMetadata[] {
    return [...this.sessions.values()].map((session) => session.metadata());
  }

  async ensureDefaultSession(input: { profileId?: TerminalProfileId; cwd?: string; cols: number; rows: number }): Promise<TerminalSession> {
    const profiles = await this.listProfiles();
    const profile = this.resolveSessionProfile(profiles, input.profileId);
    const sessionInput = { ...input, profileId: profile.profileId };
    const existing = this.findReusableSession(sessionInput);
    if (existing) {
      this.activeTerminalIdValue = existing.terminalId;
      return existing;
    }
    if (this.defaultSessionPromise) return this.defaultSessionPromise;
    this.defaultSessionPromise = this.createSession(sessionInput)
      .finally(() => {
        this.defaultSessionPromise = null;
      });
    return this.defaultSessionPromise;
  }

  async createSession(input: { profileId?: TerminalProfileId; cwd?: string; cols: number; rows: number }): Promise<TerminalSession> {
    if (!this.settings.enabled) throw terminalError("TERMINAL_UNAVAILABLE", "Terminal is disabled.", { enabled: false });
    if (this.sessions.size >= this.settings.maxSessions) {
      throw terminalError("TERMINAL_UNAVAILABLE", "Maximum terminal session count reached.", { maxSessions: this.settings.maxSessions });
    }
    const profiles = await this.listProfiles();
    const profile = this.resolveSessionProfile(profiles, input.profileId);
    const cwd = await this.workingDirectoryResolver.resolve(input.cwd ?? this.settings.defaultWorkingDirectory);
    const pty = this.ptyAdapter.spawn({
      command: profile.command,
      args: profile.args,
      cwd,
      cols: input.cols,
      rows: input.rows,
      env: this.env
    });
    const session = new TerminalSession({
      terminalId: this.createTerminalId(),
      profile,
      cwd,
      cols: input.cols,
      rows: input.rows,
      now: this.now,
      pty
    });
    this.sessions.set(session.terminalId, session);
    this.activeTerminalIdValue = session.terminalId;
    if (this.settings.startupCommand) session.write(`${this.settings.startupCommand}\r`);
    return session;
  }

  getSession(terminalId: string): TerminalSession {
    const session = this.sessions.get(terminalId);
    if (!session) throw terminalError("SESSION_NOT_FOUND", `Terminal session is unavailable: ${terminalId}.`, { terminalId });
    return session;
  }

  writeInput(terminalId: string, data: string): void {
    this.getSession(terminalId).write(data);
  }

  resizeSession(terminalId: string, cols: number, rows: number): void {
    this.getSession(terminalId).resize(cols, rows);
  }

  closeSession(terminalId: string): void {
    const session = this.getSession(terminalId);
    session.close();
    this.sessions.delete(terminalId);
    if (this.activeTerminalIdValue === terminalId) this.activeTerminalIdValue = this.sessions.keys().next().value ?? null;
  }

  closeAllSessions(): void {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
    this.activeTerminalIdValue = null;
    this.defaultSessionPromise = null;
  }

  cleanupIdleSessions(): string[] {
    const closed: string[] = [];
    const cutoff = this.now().getTime() - this.settings.idleTimeoutMs;
    for (const session of this.sessions.values()) {
      if (new Date(session.lastActiveAt).getTime() <= cutoff) {
        closed.push(session.terminalId);
      }
    }
    for (const terminalId of closed) this.closeSession(terminalId);
    return closed;
  }

  private createTerminalId(): string {
    return `term_${String(this.nextSessionNumber++).padStart(6, "0")}`;
  }

  private findRunningSession(): TerminalSession | undefined {
    const existing = this.activeTerminalIdValue ? this.sessions.get(this.activeTerminalIdValue) : undefined;
    if (existing && existing.metadata().status === "running") return existing;
    return [...this.sessions.values()].find((candidate) => candidate.metadata().status === "running");
  }

  private findReusableSession(input: { profileId?: TerminalProfileId; cwd?: string }): TerminalSession | undefined {
    const desiredProfileId = input.profileId ?? this.settings.defaultProfileId;
    const desiredCwd = input.cwd;
    const running = this.findRunningSession();
    if (running && running.profile.profileId === desiredProfileId && (desiredCwd === undefined || running.cwd === desiredCwd)) return running;
    return [...this.sessions.values()].find((candidate) => {
      const metadata = candidate.metadata();
      return metadata.status === "running"
        && candidate.profile.profileId === desiredProfileId
        && (desiredCwd === undefined || candidate.cwd === desiredCwd);
    });
  }

  private resolveSessionProfile(profiles: TerminalProfile[], requestedProfileId: TerminalProfileId | undefined): TerminalProfile {
    const desiredProfileId = requestedProfileId ?? this.settings.defaultProfileId;
    const desiredProfile = profiles.find((candidate) => candidate.profileId === desiredProfileId);
    if (desiredProfile) return desiredProfile;
    if (requestedProfileId === undefined && profiles[0]) return profiles[0];
    throw terminalError("PROFILE_NOT_FOUND", `Terminal profile is unavailable: ${desiredProfileId}.`, { profileId: desiredProfileId });
  }
}


export interface TerminalNativeHostOptions extends Omit<TerminalManagerOptions, "ptyAdapter"> {
  input?: Readable;
  output?: Writable;
  manager?: TerminalManager;
  ptyAdapter?: PtyAdapter;
  cleanupIntervalMs?: number;
  setInterval?: (callback: () => void, timeoutMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export class TerminalNativeHost implements TerminalSessionClient {
  readonly manager: TerminalManager;
  private input?: Readable;
  private output?: Writable;
  private nativeBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private readonly attachedTerminalIds = new Set<string>();
  private readonly cleanupIntervalMs: number;
  private readonly setTimer: (callback: () => void, timeoutMs: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private cleanupTimer: unknown | undefined;
  private stopped = false;

  constructor(options: TerminalNativeHostOptions) {
    this.manager = options.manager ?? new TerminalManager({ ...options, ptyAdapter: options.ptyAdapter ?? new NodePtyAdapter() });
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60000;
    this.setTimer = options.setInterval ?? ((callback, timeoutMs) => globalThis.setInterval(callback, timeoutMs));
    this.clearTimer = options.clearInterval ?? ((handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
    if (options.input && options.output) this.attach(options.input, options.output);
  }

  attach(input: Readable, output: Writable): void {
    this.input = input;
    this.output = output;
    input.once("end", () => this.stop());
    input.once("close", () => this.stop());
    input.on("data", (chunk: Buffer | string) => {
      this.acceptNativeData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
  }

  async start(): Promise<void> {
    this.startIdleCleanup();
    this.writeMessage(this.sessionsMessage());
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopIdleCleanup();
    this.detachAll();
    this.manager.closeAllSessions();
  }

  onOutput(data: string, session: TerminalSession): void {
    for (const chunk of chunkTerminalOutput(data)) {
      this.writeMessage({
        type: "terminal.session.output",
        terminalId: session.terminalId,
        payload: { data: chunk }
      });
    }
  }

  onExit(event: PtyExitEvent, session: TerminalSession): void {
    this.writeMessage({
      type: "terminal.session.exit",
      terminalId: session.terminalId,
      payload: { exitCode: event.exitCode }
    });
  }

  private acceptNativeData(chunk: Buffer): void {
    this.nativeBuffer = Buffer.concat([this.nativeBuffer, chunk]);
    try {
      let read = tryReadNativeMessageFrame(this.nativeBuffer);
      while (read) {
        this.nativeBuffer = read.remaining;
        void this.handleClientMessage(read.payload);
        read = tryReadNativeMessageFrame(this.nativeBuffer);
      }
    } catch (error) {
      this.nativeBuffer = Buffer.alloc(0);
      this.writeMessage(this.errorMessage(normalizeTerminalHostError(error)));
    }
  }

  private async handleClientMessage(input: unknown): Promise<void> {
    const parsed = TerminalClientMessageSchema.safeParse(input);
    if (!parsed.success) {
      this.writeMessage(this.errorMessage({
        code: "INVALID_MESSAGE",
        message: "Invalid terminal message.",
        details: { issues: parsed.error.issues.map((issue: { message: string }) => issue.message) }
      }));
      return;
    }

    try {
      const response = await this.dispatchClientMessage(parsed.data);
      if (response) this.writeMessage(response);
    } catch (error) {
      this.writeMessage(this.errorMessage(normalizeTerminalHostError(error), parsed.data));
    }
  }

  private async dispatchClientMessage(message: TerminalClientMessage): Promise<TerminalServerMessage | null> {
    switch (message.type) {
      case "terminal.settings.get":
        return { type: "terminal.settings", requestId: message.requestId, payload: { settings: this.manager.currentSettings } };
      case "terminal.settings.set": {
        const settings = await this.manager.updateSettings(message.payload.settings);
        this.syncAttachedSessions();
        return { type: "terminal.settings", requestId: message.requestId, payload: { settings } };
      }
      case "terminal.profiles.list":
        return { type: "terminal.profiles", requestId: message.requestId, payload: { profiles: await this.manager.listProfiles(true) } };
      case "terminal.sessions.list":
        return this.sessionsMessage(message.requestId);
      case "terminal.session.create": {
        const createInput: { profileId?: TerminalProfileId; cwd?: string; cols: number; rows: number } = {
          cols: message.payload.cols,
          rows: message.payload.rows,
          ...(message.payload.profileId === undefined ? {} : { profileId: message.payload.profileId }),
          ...(message.payload.cwd === undefined ? {} : { cwd: message.payload.cwd })
        };
        const session = message.payload.reuseExisting
          ? await this.manager.ensureDefaultSession(createInput)
          : await this.manager.createSession(createInput);
        this.attachSession(session);
        return { type: "terminal.session.created", requestId: message.requestId, terminalId: session.terminalId, payload: { session: session.metadata() } };
      }
      case "terminal.session.attach": {
        const session = this.manager.getSession(message.terminalId);
        this.attachSession(session);
        return { type: "terminal.session.attached", requestId: message.requestId, terminalId: session.terminalId, payload: { session: session.metadata() } };
      }
      case "terminal.session.detach": {
        this.detachSession(message.terminalId);
        return { type: "terminal.session.detached", requestId: message.requestId, terminalId: message.terminalId, payload: {} };
      }
      case "terminal.session.input":
        this.manager.writeInput(message.terminalId, message.payload.data);
        return message.requestId ? this.sessionsMessage(message.requestId) : null;
      case "terminal.session.resize":
        this.manager.resizeSession(message.terminalId, message.payload.cols, message.payload.rows);
        return message.requestId ? this.sessionsMessage(message.requestId) : null;
      case "terminal.session.close":
        this.detachSession(message.terminalId);
        this.manager.closeSession(message.terminalId);
        return this.sessionsMessage(message.requestId);
    }
  }

  private attachSession(session: TerminalSession): void {
    if (this.attachedTerminalIds.has(session.terminalId)) return;
    session.attach(this);
    this.attachedTerminalIds.add(session.terminalId);
  }

  private detachSession(terminalId: string): void {
    if (!this.attachedTerminalIds.delete(terminalId)) return;
    this.manager.getSession(terminalId).detach(this);
  }

  private detachAll(): void {
    for (const terminalId of [...this.attachedTerminalIds]) {
      try {
        this.detachSession(terminalId);
      } catch {
        this.attachedTerminalIds.delete(terminalId);
      }
    }
  }

  private syncAttachedSessions(): void {
    for (const terminalId of [...this.attachedTerminalIds]) {
      try {
        this.manager.getSession(terminalId);
      } catch {
        this.attachedTerminalIds.delete(terminalId);
      }
    }
  }

  private startIdleCleanup(): void {
    if (this.cleanupTimer !== undefined) return;
    this.cleanupTimer = this.setTimer(() => {
      const closed = this.manager.cleanupIdleSessions();
      this.syncAttachedSessions();
      if (closed.length > 0) this.writeMessage(this.sessionsMessage());
    }, this.cleanupIntervalMs);
  }

  private stopIdleCleanup(): void {
    if (this.cleanupTimer === undefined) return;
    this.clearTimer(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }

  private sessionsMessage(requestId?: string): TerminalServerMessage {
    return {
      type: "terminal.sessions",
      requestId,
      payload: {
        sessions: this.manager.listSessions(),
        activeTerminalId: this.manager.activeTerminalId
      }
    };
  }

  private errorMessage(error: TerminalErrorPayload, message?: TerminalClientMessage): TerminalServerMessage {
    return {
      type: "terminal.session.error",
      requestId: message?.requestId,
      terminalId: terminalIdFromClientMessage(message),
      payload: error
    };
  }

  private writeMessage(message: TerminalServerMessage): void {
    if (!this.output) return;
    this.output.write(encodeNativeMessage(TerminalServerMessageSchema.parse(message) as never));
  }
}

export async function runTerminalNativeHost(options: TerminalNativeHostOptions = {}): Promise<TerminalNativeHost> {
  const host = new TerminalNativeHost({
    ...options,
    input: options.input ?? process.stdin,
    output: options.output ?? process.stdout
  });
  await host.start();
  return host;
}

export function createTerminalNativeHost(options: TerminalNativeHostOptions = {}): TerminalNativeHost {
  return new TerminalNativeHost(options);
}

function terminalIdFromClientMessage(message: TerminalClientMessage | undefined): string | undefined {
  if (!message) return undefined;
  return "terminalId" in message ? message.terminalId : undefined;
}

function normalizeTerminalHostError(error: unknown): TerminalErrorPayload {
  const maybeTerminal = error as { terminal?: TerminalErrorPayload };
  if (maybeTerminal.terminal) return TerminalErrorPayloadSchema.parse(maybeTerminal.terminal);
  if (error instanceof NativeMessageFrameError) {
    return TerminalErrorPayloadSchema.parse({ code: "INVALID_MESSAGE", message: error.message });
  }
  if (error instanceof SyntaxError) {
    return TerminalErrorPayloadSchema.parse({ code: "INVALID_MESSAGE", message: "Invalid terminal JSON message." });
  }
  return TerminalErrorPayloadSchema.parse({
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Terminal backend failed."
  });
}

function chunkTerminalOutput(data: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < data.length; index += 64 * 1024) {
    chunks.push(data.slice(index, index + 64 * 1024));
  }
  return chunks.length > 0 ? chunks : [""];
}

export function decodeTerminalNativeFrameForTest(frame: Buffer): TerminalClientMessage | TerminalServerMessage {
  return decodeNativeMessageFrame(frame) as unknown as TerminalClientMessage | TerminalServerMessage;
}

export function createTerminalManager(options: TerminalManagerOptions): TerminalManager {
  return new TerminalManager(options);
}

function createProfile(input: {
  profileId: string;
  label: string;
  kind: TerminalProfile["kind"];
  command: string;
  args?: string[];
  source: TerminalProfile["source"];
  detected: boolean;
}): TerminalProfile {
  return TerminalProfileSchema.parse({
    profileId: input.profileId,
    label: input.label,
    kind: input.kind,
    command: input.command,
    args: input.args ?? [],
    detected: input.detected,
    source: input.source,
    embeddedPtySupported: true,
    capabilities: {
      portusTabs: true,
      shellMultiplexer: input.command === "tmux" || input.command === "screen",
      externalGuiTabs: false
    }
  });
}

function dedupeProfiles(profiles: TerminalProfile[]): TerminalProfile[] {
  const seen = new Set<string>();
  const result: TerminalProfile[] = [];
  for (const profile of profiles) {
    if (seen.has(profile.profileId)) continue;
    seen.add(profile.profileId);
    result.push(profile);
  }
  return result;
}

function profileIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "") || "profile";
}

function terminalError(code: TerminalErrorPayload["code"], message: string, details?: Record<string, unknown>): Error & { terminal: TerminalErrorPayload } {
  const terminal = TerminalErrorPayloadSchema.parse({ code, message, ...(details === undefined ? {} : { details }) });
  const error = new Error(terminal.message) as Error & { terminal: TerminalErrorPayload };
  error.name = code;
  error.terminal = terminal;
  return error;
}

async function canAccess(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function readProcessEnv(): Record<string, string | undefined> {
  return { ...process.env };
}
