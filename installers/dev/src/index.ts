#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, posix as pathPosix, win32 as pathWin32 } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DEFAULT_PORTUS_CONFIG } from "@portus/config";
import { DEFAULT_TERMINAL_WORKING_DIRECTORY, TERMINAL_NATIVE_HOST_NAME } from "@portus/terminal";
import { z } from "zod";

const execFile = promisify(execFileCallback);

export const BrowserFamilySchema = z.enum(["chrome", "edge", "brave", "chromium"]);
export const InstallerPlatformSchema = z.enum(["win32", "linux", "darwin"]);
export const ChromeExtensionIdSchema = z.string().regex(/^[a-p]{32}$/);
export const ChromeExtensionOriginSchema = z.string().regex(/^chrome-extension:\/\/[a-p]{32}\/$/);
export const NativeHostNameSchema = z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/);
export const NativeHostRoleSchema = z.enum(["browser-control", "terminal"]);

export const NativeHostManifestSchema = z.object({
  name: NativeHostNameSchema,
  description: z.string().min(1),
  path: z.string().min(1),
  type: z.literal("stdio"),
  allowed_origins: z.array(ChromeExtensionOriginSchema).min(1)
}).strict();

export const RegistryPlanSchema = z.object({
  hive: z.literal("HKCU"),
  browser: BrowserFamilySchema,
  key: z.string().min(1),
  valueName: z.literal("(Default)"),
  value: z.string().min(1),
  command: z.array(z.string()).min(1)
}).strict();

export const NativeHostRegistrationPlanSchema = z.object({
  type: z.enum(["registry", "manifest-file"]),
  command: z.array(z.string()).optional()
}).strict();

export const NativeHostInstallPlanSchema = z.object({
  role: NativeHostRoleSchema,
  platform: InstallerPlatformSchema,
  browser: BrowserFamilySchema,
  manifestPath: z.string().min(1),
  nativeHostPath: z.string().min(1),
  nativeHostEntryPointPath: z.string().min(1),
  nativeHostLauncher: z.string().min(1),
  nativeHostExecutableMode: z.number().int().nullable(),
  nativeHostManifest: NativeHostManifestSchema,
  registration: NativeHostRegistrationPlanSchema,
  registry: RegistryPlanSchema.optional()
}).strict();

export const TerminalSessionFolderPlanSchema = z.object({
  defaultWorkingDirectory: z.literal(DEFAULT_TERMINAL_WORKING_DIRECTORY),
  path: z.string().min(1),
  requiredForInstall: z.literal(false)
}).strict();

export const DevInstallPlanSchema = z.object({
  browser: BrowserFamilySchema,
  platform: InstallerPlatformSchema,
  dryRun: z.boolean(),
  repoRoot: z.string().min(1),
  extensionId: ChromeExtensionIdSchema,
  extensionOrigin: ChromeExtensionOriginSchema,
  extensionDirectory: z.string().min(1),
  manifestPath: z.string().min(1),
  nativeHostPath: z.string().min(1),
  nativeHostManifest: NativeHostManifestSchema,
  registry: RegistryPlanSchema.optional(),
  nativeHosts: z.array(NativeHostInstallPlanSchema).length(2),
  terminalSessionFolder: TerminalSessionFolderPlanSchema,
  warnings: z.array(z.string())
}).strict();

export const DevInstallDiagnosticSchema = z.object({
  code: z.enum([
    "NATIVE_HOST_MANIFEST_PRESENT",
    "NATIVE_HOST_MANIFEST_VALID",
    "NATIVE_HOST_PATH_PRESENT",
    "NATIVE_HOST_ENTRYPOINT_PRESENT",
    "EXTENSION_DIRECTORY_PRESENT",
    "EXTENSION_ORIGIN_ALLOWED",
    "TERMINAL_SESSION_DIRECTORY_PRESENT",
    "BROKER_CHECK_REQUIRED",
    "BRIDGE_CHECK_REQUIRED",
    "PERMISSION_CHECK_REQUIRED"
  ]),
  ok: z.boolean(),
  message: z.string().min(1),
  target: z.string().min(1).optional()
}).strict();

export const DevInstallResultSchema = z.object({
  ok: z.boolean(),
  dryRun: z.boolean(),
  plan: DevInstallPlanSchema,
  diagnostics: z.array(DevInstallDiagnosticSchema),
  applied: z.boolean()
}).strict();

export type BrowserFamily = z.infer<typeof BrowserFamilySchema>;
export type InstallerPlatform = z.infer<typeof InstallerPlatformSchema>;
export type NativeHostManifest = z.infer<typeof NativeHostManifestSchema>;
export type NativeHostInstallPlan = z.infer<typeof NativeHostInstallPlanSchema>;
export type DevInstallPlan = z.infer<typeof DevInstallPlanSchema>;
export type DevInstallDiagnostic = z.infer<typeof DevInstallDiagnosticSchema>;
export type DevInstallResult = z.infer<typeof DevInstallResultSchema>;

export interface CreateDevInstallPlanOptions {
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  platform?: InstallerPlatform;
  browser?: BrowserFamily;
  extensionId: string;
  manifestPath?: string;
  nativeHostPath?: string;
  terminalManifestPath?: string;
  terminalNativeHostPath?: string;
  terminalSessionDirectory?: string;
  dryRun?: boolean;
}

export interface RunDevInstallOptions extends CreateDevInstallPlanOptions {
  apply?: boolean;
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
  fileExists?: (path: string) => Promise<boolean>;
  ensureDirectory?: (path: string) => Promise<void>;
  exec?: (file: string, args: string[]) => Promise<void>;
  setExecutableMode?: (path: string, mode: number) => Promise<void>;
}

export interface CliCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ParsedArgs {
  command: string;
  flags: Map<string, string | boolean>;
}

export function createChromeExtensionOrigin(extensionId: string): string {
  return `chrome-extension://${ChromeExtensionIdSchema.parse(extensionId)}/`;
}

export function createNativeHostManifest(options: {
  hostName?: string;
  nativeHostPath: string;
  allowedOrigins: string[];
  description?: string;
}): NativeHostManifest {
  return NativeHostManifestSchema.parse({
    name: options.hostName ?? DEFAULT_PORTUS_CONFIG.nativeHost.name,
    description: options.description ?? "Portus Browser Native Messaging Host",
    path: options.nativeHostPath,
    type: "stdio",
    allowed_origins: options.allowedOrigins
  });
}

export function getChromeNativeMessagingRegistryKey(hostName = DEFAULT_PORTUS_CONFIG.nativeHost.name): string {
  return getNativeMessagingRegistryKey("chrome", hostName);
}

export function getNativeMessagingRegistryKey(browser: BrowserFamily, hostName = DEFAULT_PORTUS_CONFIG.nativeHost.name): string {
  const parsedHostName = NativeHostNameSchema.parse(hostName);
  switch (BrowserFamilySchema.parse(browser)) {
    case "chrome":
      return `Software\\Google\\Chrome\\NativeMessagingHosts\\${parsedHostName}`;
    case "edge":
      return `Software\\Microsoft\\Edge\\NativeMessagingHosts\\${parsedHostName}`;
    case "brave":
      return `Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${parsedHostName}`;
    case "chromium":
      return `Software\\Chromium\\NativeMessagingHosts\\${parsedHostName}`;
  }
}

export function createRegistryPlan(hostName: string, manifestPath: string, browser: BrowserFamily = "chrome"): z.infer<typeof RegistryPlanSchema> {
  const parsedBrowser = BrowserFamilySchema.parse(browser);
  const key = `HKCU\\${getNativeMessagingRegistryKey(parsedBrowser, hostName)}`;
  return RegistryPlanSchema.parse({
    hive: "HKCU",
    browser: parsedBrowser,
    key,
    valueName: "(Default)",
    value: manifestPath,
    command: ["reg.exe", "ADD", key, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"]
  });
}

export function resolveTerminalSessionDirectory(
  input: string | undefined = DEFAULT_TERMINAL_WORKING_DIRECTORY,
  env: Record<string, string | undefined> = process.env,
  platform: InstallerPlatform = InstallerPlatformSchema.parse(process.platform)
): string {
  if (isTargetAbsolute(input, platform)) return resolveInstallPath(input, platform);
  if (input !== DEFAULT_TERMINAL_WORKING_DIRECTORY) return resolveInstallPath(input, platform);

  const home = env.USERPROFILE ?? env.HOME;
  if (!home) throw new Error("Cannot resolve Downloads/portus-session without USERPROFILE or HOME.");
  return joinTargetPath(platform, home, "Downloads", "portus-session");
}

export function createDevInstallPlan(options: CreateDevInstallPlanOptions): DevInstallPlan {
  const platform = InstallerPlatformSchema.parse(options.platform ?? process.platform);
  const repoRoot = resolveRepoRoot(options.repoRoot, options.env, platform);
  const browser = BrowserFamilySchema.parse(options.browser ?? "chrome");
  const extensionId = ChromeExtensionIdSchema.parse(options.extensionId);
  const extensionOrigin = createChromeExtensionOrigin(extensionId);
  const nativeHostPath = resolveInstallPath(options.nativeHostPath ?? getDefaultNativeHostLauncherPath(repoRoot, "browser-control", platform), platform);
  const manifestPath = resolveInstallPath(options.manifestPath ?? getDefaultNativeHostManifestPath({
    browser,
    env: options.env,
    hostName: DEFAULT_PORTUS_CONFIG.nativeHost.name,
    platform,
    repoRoot
  }), platform);
  const terminalNativeHostPath = resolveInstallPath(options.terminalNativeHostPath ?? getDefaultNativeHostLauncherPath(repoRoot, "terminal", platform), platform);
  const terminalManifestPath = resolveInstallPath(options.terminalManifestPath ?? getDefaultNativeHostManifestPath({
    browser,
    env: options.env,
    hostName: TERMINAL_NATIVE_HOST_NAME,
    platform,
    repoRoot
  }), platform);
  const terminalSessionDirectory = resolveTerminalSessionDirectory(options.terminalSessionDirectory, options.env, platform);

  const browserControlHost = createNativeHostInstallPlan({
    role: "browser-control",
    browser,
    platform,
    repoRoot,
    hostName: DEFAULT_PORTUS_CONFIG.nativeHost.name,
    description: "Portus Browser Control Native Messaging Host",
    nativeHostPath,
    manifestPath,
    extensionOrigin
  });
  const terminalHost = createNativeHostInstallPlan({
    role: "terminal",
    browser,
    platform,
    repoRoot,
    hostName: TERMINAL_NATIVE_HOST_NAME,
    description: "Portus Browser Terminal Native Messaging Host",
    nativeHostPath: terminalNativeHostPath,
    manifestPath: terminalManifestPath,
    extensionOrigin
  });

  const warnings: string[] = [];

  return DevInstallPlanSchema.parse({
    browser,
    platform,
    dryRun: options.dryRun ?? true,
    repoRoot,
    extensionId,
    extensionOrigin,
    extensionDirectory: joinTargetPath(platform, repoRoot, "apps", "portus-extension"),
    manifestPath: browserControlHost.manifestPath,
    nativeHostPath: browserControlHost.nativeHostPath,
    nativeHostManifest: browserControlHost.nativeHostManifest,
    registry: browserControlHost.registry,
    nativeHosts: [browserControlHost, terminalHost],
    terminalSessionFolder: {
      defaultWorkingDirectory: DEFAULT_TERMINAL_WORKING_DIRECTORY,
      path: terminalSessionDirectory,
      requiredForInstall: false
    },
    warnings
  });
}

export function resolveRepoRoot(
  repoRoot?: string,
  env: Record<string, string | undefined> = process.env,
  platform: InstallerPlatform = InstallerPlatformSchema.parse(process.platform)
): string {
  return resolveInstallPath(repoRoot ?? env.INIT_CWD ?? process.cwd(), platform);
}

export async function runDevInstall(options: RunDevInstallOptions): Promise<DevInstallResult> {
  const apply = options.apply === true;
  const plan = createDevInstallPlan({
    ...options,
    dryRun: !apply
  });
  let terminalDirectoryError: string | undefined;

  if (apply) {
    const writeText = options.writeTextFile ?? defaultWriteTextFile;
    const execCommand = options.exec ?? defaultExec;
    const ensureDirectory = options.ensureDirectory ?? defaultEnsureDirectory;
    const setExecutableMode = options.setExecutableMode ?? defaultSetExecutableMode;

    for (const host of plan.nativeHosts) {
      await writeText(host.nativeHostPath, host.nativeHostLauncher);
      if (host.nativeHostExecutableMode !== null) {
        await setExecutableMode(host.nativeHostPath, host.nativeHostExecutableMode);
      }
      await writeText(host.manifestPath, `${JSON.stringify(host.nativeHostManifest, null, 2)}\n`);
      if (host.registry) {
        const [file, ...args] = host.registry.command;
        if (!file) throw new Error("Registry command is empty.");
        await execCommand(file, args);
      }
    }

    try {
      await ensureDirectory(plan.terminalSessionFolder.path);
    } catch (error) {
      terminalDirectoryError = error instanceof Error ? error.message : "Terminal session folder could not be created.";
    }
  }

  const diagnostics = await diagnoseDevInstall(plan, {
    ...options,
    ...(terminalDirectoryError === undefined ? {} : { terminalDirectoryError })
  });
  return DevInstallResultSchema.parse({
    ok: diagnostics.every((item) => item.ok),
    dryRun: plan.dryRun,
    plan,
    diagnostics,
    applied: apply
  });
}

export async function diagnoseDevInstall(
  plan: DevInstallPlan,
  options: Pick<RunDevInstallOptions, "readTextFile" | "fileExists"> & { terminalDirectoryError?: string } = {}
): Promise<DevInstallDiagnostic[]> {
  const fileExists = options.fileExists ?? defaultFileExists;
  const readText = options.readTextFile ?? readFileUtf8;
  const extensionDirectoryExists = await fileExists(plan.extensionDirectory);
  const terminalDirectoryExists = options.terminalDirectoryError === undefined
    ? await fileExists(plan.terminalSessionFolder.path)
    : false;
  const diagnostics: DevInstallDiagnostic[] = [];

  for (const host of plan.nativeHosts) {
    const manifestExists = await fileExists(host.manifestPath);
    const nativeHostExists = await fileExists(host.nativeHostPath);
    const nativeHostEntryPointExists = await fileExists(host.nativeHostEntryPointPath);
    let manifestValid = false;
    let originAllowed = false;

    if (manifestExists) {
      try {
        const parsed = NativeHostManifestSchema.parse(JSON.parse(await readText(host.manifestPath)) as unknown);
        manifestValid = parsed.name === host.nativeHostManifest.name && parsed.path === host.nativeHostManifest.path;
        originAllowed = parsed.allowed_origins.includes(plan.extensionOrigin);
      } catch {
        manifestValid = false;
      }
    }

    diagnostics.push(
      diagnostic("NATIVE_HOST_MANIFEST_PRESENT", manifestExists, manifestExists
        ? `${host.role} Native Messaging host manifest exists.`
        : `${host.role} Native Messaging host manifest is missing.`, host.role),
      diagnostic("NATIVE_HOST_MANIFEST_VALID", manifestValid, manifestValid
        ? `${host.role} Native Messaging host manifest is valid.`
        : `${host.role} Native Messaging host manifest is missing or invalid.`, host.role),
      diagnostic("NATIVE_HOST_PATH_PRESENT", nativeHostExists, nativeHostExists
        ? `${host.role} Native Host path exists.`
        : `${host.role} Native Host path is missing.`, host.role),
      diagnostic("NATIVE_HOST_ENTRYPOINT_PRESENT", nativeHostEntryPointExists, nativeHostEntryPointExists
        ? `${host.role} Native Host built entrypoint exists.`
        : `${host.role} Native Host built entrypoint is missing. Run pnpm build before installing native hosts.`, host.role),
      diagnostic("EXTENSION_ORIGIN_ALLOWED", originAllowed, originAllowed
        ? `${host.role} extension origin is allowed by the Native Messaging manifest.`
        : `${host.role} extension origin is not allowed by the Native Messaging manifest.`, host.role)
    );
  }

  diagnostics.push(
    diagnostic("EXTENSION_DIRECTORY_PRESENT", extensionDirectoryExists, extensionDirectoryExists
      ? "Unpacked extension directory exists."
      : "Unpacked extension directory is missing."),
    diagnostic("TERMINAL_SESSION_DIRECTORY_PRESENT", terminalDirectoryExists, terminalDirectoryExists
      ? "Terminal default session folder exists."
      : `Terminal default session folder is missing or unavailable. ${options.terminalDirectoryError ?? "The terminal backend can still create it on first startup, or the user can choose another folder."}`),
    diagnostic("BROKER_CHECK_REQUIRED", true, "Verify Broker runtime with portus-browser browsers after starting Broker."),
    diagnostic("BRIDGE_CHECK_REQUIRED", true, "Verify Bridge visibility by connecting and disconnecting the extension Bridge in Chrome."),
    diagnostic("PERMISSION_CHECK_REQUIRED", true, "Verify page permissions when running screenshot, snapshot, and action commands.")
  );

  return diagnostics;
}

export async function runDevInstallerCli(argv: string[], options: Omit<RunDevInstallOptions, "extensionId" | "apply"> = {}): Promise<CliCommandResult> {
  try {
    const parsed = parseArgs(argv);
    const extensionId = readRequiredStringFlag(parsed, "extension-id");
    const manifestPath = readOptionalStringFlag(parsed, "manifest-path");
    const nativeHostPath = readOptionalStringFlag(parsed, "native-host-path");
    const terminalManifestPath = readOptionalStringFlag(parsed, "terminal-manifest-path");
    const terminalNativeHostPath = readOptionalStringFlag(parsed, "terminal-native-host-path");
    const terminalSessionDirectory = readOptionalStringFlag(parsed, "terminal-session-directory");
    const repoRoot = readOptionalStringFlag(parsed, "repo-root") ?? options.repoRoot;
    const browserInput = readOptionalStringFlag(parsed, "browser");
    const platformInput = readOptionalStringFlag(parsed, "platform");
    const browser = browserInput === undefined ? options.browser : BrowserFamilySchema.parse(browserInput);
    const platform = platformInput === undefined ? options.platform : InstallerPlatformSchema.parse(platformInput);
    const apply = parsed.command === "apply" || hasFlag(parsed, "apply");
    const plan = createDevInstallPlan({
      extensionId,
      ...(browser === undefined ? {} : { browser }),
      ...(platform === undefined ? {} : { platform }),
      ...(repoRoot === undefined ? {} : { repoRoot }),
      ...(manifestPath === undefined ? {} : { manifestPath }),
      ...(nativeHostPath === undefined ? {} : { nativeHostPath }),
      ...(terminalManifestPath === undefined ? {} : { terminalManifestPath }),
      ...(terminalNativeHostPath === undefined ? {} : { terminalNativeHostPath }),
      ...(terminalSessionDirectory === undefined ? {} : { terminalSessionDirectory }),
      dryRun: !apply
    });

    if (parsed.command === "plan") {
      return ok(renderOutput(parsed, { ok: true, plan }));
    }

    if (parsed.command !== "apply" && parsed.command !== "diagnose") {
      throw new Error(`Unknown installer command: ${parsed.command}.`);
    }

    const diagnostics = parsed.command === "diagnose" ? await diagnoseDevInstall(plan, options) : undefined;
    const result = parsed.command === "diagnose"
      ? DevInstallResultSchema.parse({
        ok: diagnostics?.every((item) => item.ok) ?? false,
        dryRun: true,
        plan,
        diagnostics,
        applied: false
      })
      : await runDevInstall({
        ...options,
        extensionId,
        ...(browser === undefined ? {} : { browser }),
        ...(platform === undefined ? {} : { platform }),
        ...(repoRoot === undefined ? {} : { repoRoot }),
        ...(manifestPath === undefined ? {} : { manifestPath }),
        ...(nativeHostPath === undefined ? {} : { nativeHostPath }),
        ...(terminalManifestPath === undefined ? {} : { terminalManifestPath }),
        ...(terminalNativeHostPath === undefined ? {} : { terminalNativeHostPath }),
        ...(terminalSessionDirectory === undefined ? {} : { terminalSessionDirectory }),
        apply
      });

    return ok(renderOutput(parsed, result));
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : "Installer failed."}\n`
    };
  }
}

function createNativeHostInstallPlan(options: {
  role: z.infer<typeof NativeHostRoleSchema>;
  browser: BrowserFamily;
  platform: InstallerPlatform;
  repoRoot: string;
  hostName: string;
  description: string;
  nativeHostPath: string;
  manifestPath: string;
  extensionOrigin: string;
}): NativeHostInstallPlan {
  const nativeHostManifest = createNativeHostManifest({
    hostName: options.hostName,
    description: options.description,
    nativeHostPath: options.nativeHostPath,
    allowedOrigins: [options.extensionOrigin]
  });
  const registry = options.platform === "win32"
    ? createRegistryPlan(nativeHostManifest.name, options.manifestPath, options.browser)
    : undefined;
  const registration = NativeHostRegistrationPlanSchema.parse({
    type: options.platform === "win32" ? "registry" : "manifest-file",
    ...(registry === undefined ? {} : { command: registry.command })
  });
  const nativeHostEntryPointPath = getNativeHostEntryPointPath(options.repoRoot, options.role, options.platform);

  return NativeHostInstallPlanSchema.parse({
    role: options.role,
    platform: options.platform,
    browser: options.browser,
    manifestPath: options.manifestPath,
    nativeHostPath: options.nativeHostPath,
    nativeHostEntryPointPath,
    nativeHostLauncher: createNativeHostLauncher({
      entryPoint: nativeHostEntryPointPath,
      platform: options.platform
    }),
    nativeHostExecutableMode: options.platform === "win32" ? null : 0o755,
    nativeHostManifest,
    registration,
    ...(registry === undefined ? {} : { registry })
  });
}

function getDefaultNativeHostManifestPath(options: {
  browser: BrowserFamily;
  env: Record<string, string | undefined> | undefined;
  hostName: string;
  platform: InstallerPlatform;
  repoRoot: string;
}): string {
  const manifestFileName = options.platform === "win32"
    ? `${NativeHostNameSchema.parse(options.hostName)}.${options.browser}.json`
    : `${NativeHostNameSchema.parse(options.hostName)}.json`;
  return joinTargetPath(
    options.platform,
    getNativeMessagingManifestDirectory(options.browser, options.platform, options.repoRoot, options.env),
    manifestFileName
  );
}

function getNativeMessagingManifestDirectory(
  browser: BrowserFamily,
  platform: InstallerPlatform,
  repoRoot: string,
  env: Record<string, string | undefined> | undefined
): string {
  if (platform === "win32") return joinTargetPath(platform, repoRoot, ".portus", "native-messaging");

  const home = getHomeDirectory(env);
  if (platform === "darwin") {
    switch (browser) {
      case "chrome":
        return joinTargetPath(platform, home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
      case "edge":
        return joinTargetPath(platform, home, "Library", "Application Support", "Microsoft Edge", "NativeMessagingHosts");
      case "brave":
        return joinTargetPath(platform, home, "Library", "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts");
      case "chromium":
        return joinTargetPath(platform, home, "Library", "Application Support", "Chromium", "NativeMessagingHosts");
    }
  }

  const configHome = env?.XDG_CONFIG_HOME ?? joinTargetPath(platform, home, ".config");
  switch (browser) {
    case "chrome":
      return joinTargetPath(platform, configHome, "google-chrome", "NativeMessagingHosts");
    case "edge":
      return joinTargetPath(platform, configHome, "microsoft-edge", "NativeMessagingHosts");
    case "brave":
      return joinTargetPath(platform, configHome, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts");
    case "chromium":
      return joinTargetPath(platform, configHome, "chromium", "NativeMessagingHosts");
  }
}

function getDefaultNativeHostLauncherPath(
  repoRoot: string,
  role: z.infer<typeof NativeHostRoleSchema>,
  platform: InstallerPlatform
): string {
  const executableName = role === "browser-control" ? "portus-native-host" : "portus-terminal-native-host";
  return joinTargetPath(platform, repoRoot, ".portus", "native-hosts", `${executableName}${platform === "win32" ? ".cmd" : ""}`);
}

function createNativeHostLauncher(options: {
  entryPoint: string;
  platform: InstallerPlatform;
}): string {
  const nodePath = process.execPath;

  if (options.platform === "win32") {
    return [
      "@echo off",
      `\"${nodePath}\" \"${options.entryPoint}\" %*`
    ].join("\r\n") + "\r\n";
  }

  return [
    "#!/bin/sh",
    `exec \"${nodePath}\" \"${options.entryPoint}\" \"$@\"`
  ].join("\n") + "\n";
}

function getNativeHostEntryPointPath(
  repoRoot: string,
  role: z.infer<typeof NativeHostRoleSchema>,
  platform: InstallerPlatform
): string {
  return role === "browser-control"
    ? joinTargetPath(platform, repoRoot, "apps", "portus-native-host", "dist", "bin.js")
    : joinTargetPath(platform, repoRoot, "apps", "portus-terminal", "dist", "bin.js");
}

function joinTargetPath(platform: InstallerPlatform, ...segments: string[]): string {
  return platform === "win32" ? pathWin32.join(...segments) : pathPosix.join(...segments);
}

function resolveInstallPath(path: string, platform: InstallerPlatform): string {
  return platform === "win32" ? pathWin32.resolve(path) : pathPosix.resolve(path);
}

function isTargetAbsolute(path: string, platform: InstallerPlatform): boolean {
  return platform === "win32" ? pathWin32.isAbsolute(path) : pathPosix.isAbsolute(path);
}

function getHomeDirectory(env: Record<string, string | undefined> | undefined): string {
  const home = env?.HOME ?? env?.USERPROFILE ?? process.env.HOME ?? process.env.USERPROFILE;
  if (!home) throw new Error("Cannot resolve native messaging manifest directory without HOME or USERPROFILE.");
  return home;
}

function diagnostic(code: DevInstallDiagnostic["code"], ok: boolean, message: string, target?: string): DevInstallDiagnostic {
  return DevInstallDiagnosticSchema.parse({
    code,
    ok,
    message,
    ...(target === undefined ? {} : { target })
  });
}

async function defaultWriteTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFileUtf8(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

async function defaultExec(file: string, args: string[]): Promise<void> {
  await execFile(file, args);
}

async function defaultSetExecutableMode(path: string, mode: number): Promise<void> {
  await chmod(path, mode);
}

async function defaultEnsureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  let command = "plan";
  let commandSeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token.startsWith("--")) {
      const flag = token.slice(2);
      const [name, inlineValue] = flag.split("=", 2);
      if (!name) throw new Error("Invalid flag.");
      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--") && flagTakesValue(name)) {
        flags.set(name, next);
        index += 1;
      } else {
        flags.set(name, true);
      }
      continue;
    }

    if (commandSeen) throw new Error("Only one installer command is supported.");
    command = token;
    commandSeen = true;
  }

  return { command, flags };
}

function flagTakesValue(name: string): boolean {
  return [
    "extension-id",
    "browser",
    "manifest-path",
    "native-host-path",
    "platform",
    "repo-root",
    "terminal-manifest-path",
    "terminal-native-host-path",
    "terminal-session-directory",
    "output"
  ].includes(name);
}

function readRequiredStringFlag(parsed: ParsedArgs, name: string): string {
  const value = readOptionalStringFlag(parsed, name);
  if (value === undefined) throw new Error(`--${name} is required.`);
  return value;
}

function readOptionalStringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${name} requires a value.`);
  return value;
}

function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.get(name) === true;
}

function renderOutput(parsed: ParsedArgs, value: unknown): string {
  if (hasFlag(parsed, "json") || readOptionalStringFlag(parsed, "output") === "json") {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
  const result = DevInstallResultSchema.safeParse(value);
  if (result.success) return renderDiagnostics(result.data);
  const plan = DevInstallPlanSchema.safeParse((value as { plan?: unknown }).plan);
  if (plan.success) return renderPlan(plan.data);
  return `${JSON.stringify(value, null, 2)}\n`;
}

function renderPlan(plan: DevInstallPlan): string {
  return [
    `browser: ${plan.browser}`,
    `platform: ${plan.platform}`,
    `dryRun: ${plan.dryRun}`,
    `extensionOrigin: ${plan.extensionOrigin}`,
    `terminalSessionFolder: ${plan.terminalSessionFolder.path}`,
    ...plan.nativeHosts.flatMap((host) => [
      `${host.role}.manifestPath: ${host.manifestPath}`,
      `${host.role}.nativeHostPath: ${host.nativeHostPath}`,
      `${host.role}.registration: ${host.registration.type}`,
      ...(host.registry ? [`${host.role}.registryCommand: ${host.registry.command.join(" ")}`] : [])
    ]),
    ...plan.warnings.map((warning) => `warning: ${warning}`)
  ].join("\n") + "\n";
}

function renderDiagnostics(result: DevInstallResult): string {
  const rows = result.diagnostics.map((item) => `${item.ok ? "ok" : "fail"} ${item.target ? `${item.target}.` : ""}${item.code}: ${item.message}`);
  return `${renderPlan(result.plan)}${rows.join("\n")}\n`;
}

function ok(stdout: string): CliCommandResult {
  return {
    exitCode: 0,
    stdout,
    stderr: ""
  };
}

async function main(): Promise<void> {
  const result = await runDevInstallerCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

const currentModulePath = fileURLToPath(import.meta.url);
if (process.argv[1] === currentModulePath) {
  void main();
}
