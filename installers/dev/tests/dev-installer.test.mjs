import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeHostManifestSchema,
  createChromeExtensionOrigin,
  createDevInstallPlan,
  createNativeHostManifest,
  createRegistryPlan,
  diagnoseDevInstall,
  runDevInstall,
  runDevInstallerCli,
  resolveRepoRoot,
  resolveTerminalSessionDirectory
} from "../dist/index.js";

const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("creates Chrome extension origins and native host manifests", () => {
  const origin = createChromeExtensionOrigin(extensionId);
  assert.equal(origin, `chrome-extension://${extensionId}/`);
  assert.throws(() => createChromeExtensionOrigin("bad"));

  const manifest = createNativeHostManifest({
    nativeHostPath: "C:\\Portus\\portus-native-host.exe",
    allowedOrigins: [origin]
  });

  assert.deepEqual(NativeHostManifestSchema.parse(manifest), {
    name: "com.portus.browser",
    description: "Portus Browser Native Messaging Host",
    path: "C:\\Portus\\portus-native-host.exe",
    type: "stdio",
    allowed_origins: [origin]
  });
});

test("creates a Chrome HKCU registry plan", () => {
  const registry = createRegistryPlan("com.portus.browser", "C:\\Portus\\manifest.json");

  assert.equal(registry.hive, "HKCU");
  assert.equal(registry.browser, "chrome");
  assert.equal(registry.key, "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.portus.browser");
  assert.deepEqual(registry.command, [
    "reg.exe",
    "ADD",
    "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.portus.browser",
    "/ve",
    "/t",
    "REG_SZ",
    "/d",
    "C:\\Portus\\manifest.json",
    "/f"
  ]);
});

test("creates a dry-run development install plan", () => {
  const plan = createDevInstallPlan({
    repoRoot: "C:\\repo\\portus-browser-dev",
    platform: "win32",
    extensionId
  });

  assert.equal(plan.browser, "chrome");
  assert.equal(plan.platform, "win32");
  assert.equal(plan.dryRun, true);
  assert.equal(plan.extensionOrigin, `chrome-extension://${extensionId}/`);
  assert.match(plan.manifestPath, /com\.portus\.browser\.chrome\.json$/);
  assert.match(plan.nativeHostPath, /portus-native-host\.cmd$/);
  assert.equal(plan.nativeHostManifest.allowed_origins[0], plan.extensionOrigin);
  assert.deepEqual(plan.nativeHosts.map((host) => host.role), ["browser-control", "terminal"]);
  assert.equal(plan.nativeHosts[0].nativeHostManifest.name, "com.portus.browser");
  assert.equal(plan.nativeHosts[1].nativeHostManifest.name, "com.portus.browser.terminal");
  assert.match(plan.nativeHosts[1].manifestPath, /com\.portus\.browser\.terminal\.chrome\.json$/);
  assert.match(plan.nativeHosts[1].nativeHostPath, /portus-terminal-native-host\.cmd$/);
  assert.match(plan.terminalSessionFolder.path, /Downloads[\\/]portus-session$/);
  assert.equal(plan.terminalSessionFolder.requiredForInstall, false);
  assert.equal(plan.nativeHosts[0].registration.type, "registry");
  assert.equal(plan.nativeHosts[0].registry.browser, "chrome");
  assert.equal(plan.warnings.length, 0);
});

test("creates browser-specific macOS and Linux native messaging plans", () => {
  const linuxPlan = createDevInstallPlan({
    browser: "edge",
    platform: "linux",
    repoRoot: "/repo/portus-browser-dev",
    extensionId,
    env: {
      HOME: "/home/carlo"
    }
  });

  assert.equal(linuxPlan.browser, "edge");
  assert.equal(linuxPlan.platform, "linux");
  assert.equal(linuxPlan.nativeHosts[0].manifestPath, "/home/carlo/.config/microsoft-edge/NativeMessagingHosts/com.portus.browser.json");
  assert.equal(linuxPlan.nativeHosts[0].nativeHostPath, "/repo/portus-browser-dev/.portus/native-hosts/portus-native-host");
  assert.equal(linuxPlan.nativeHosts[0].nativeHostEntryPointPath, "/repo/portus-browser-dev/apps/portus-native-host/dist/bin.js");
  assert.equal(linuxPlan.nativeHosts[0].nativeHostExecutableMode, 0o755);
  assert.equal(linuxPlan.nativeHosts[0].registration.type, "manifest-file");
  assert.equal(linuxPlan.nativeHosts[0].registry, undefined);
  assert.match(linuxPlan.nativeHosts[0].nativeHostLauncher, /^#!\/bin\/sh/);

  const macPlan = createDevInstallPlan({
    browser: "brave",
    platform: "darwin",
    repoRoot: "/repo/portus-browser-dev",
    extensionId,
    env: {
      HOME: "/Users/carlo"
    }
  });

  assert.equal(macPlan.nativeHosts[0].manifestPath, "/Users/carlo/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.portus.browser.json");
});

test("uses INIT_CWD as repo root when pnpm exec runs from the package directory", () => {
  const repoRoot = resolveRepoRoot(undefined, {
    INIT_CWD: "C:\\repo\\portus-browser-dev"
  });
  assert.equal(repoRoot, "C:\\repo\\portus-browser-dev");

  const plan = createDevInstallPlan({
    extensionId,
    env: {
      INIT_CWD: "C:\\repo\\portus-browser-dev",
      USERPROFILE: "C:\\Users\\carlo"
    }
  });
  assert.equal(plan.repoRoot, "C:\\repo\\portus-browser-dev");
  assert.equal(plan.extensionDirectory, "C:\\repo\\portus-browser-dev\\apps\\portus-extension");
});

test("diagnoses manifest, native host, extension, and origin state", async () => {
  const plan = createDevInstallPlan({
    repoRoot: "C:\\repo\\portus-browser-dev",
    platform: "win32",
    extensionId
  });
  const existing = new Set([
    plan.extensionDirectory,
    plan.terminalSessionFolder.path,
    ...plan.nativeHosts.flatMap((host) => [host.manifestPath, host.nativeHostPath, host.nativeHostEntryPointPath])
  ]);
  const manifestByPath = new Map(plan.nativeHosts.map((host) => [host.manifestPath, JSON.stringify(host.nativeHostManifest)]));

  const diagnostics = await diagnoseDevInstall(plan, {
    fileExists: async (path) => existing.has(path),
    readTextFile: async (path) => manifestByPath.get(path) ?? "{}"
  });

  assert.equal(diagnostics.every((item) => item.ok), true);
  assert.deepEqual(diagnostics.map((item) => item.code), [
    "NATIVE_HOST_MANIFEST_PRESENT",
    "NATIVE_HOST_MANIFEST_VALID",
    "NATIVE_HOST_PATH_PRESENT",
    "NATIVE_HOST_ENTRYPOINT_PRESENT",
    "EXTENSION_ORIGIN_ALLOWED",
    "NATIVE_HOST_MANIFEST_PRESENT",
    "NATIVE_HOST_MANIFEST_VALID",
    "NATIVE_HOST_PATH_PRESENT",
    "NATIVE_HOST_ENTRYPOINT_PRESENT",
    "EXTENSION_ORIGIN_ALLOWED",
    "EXTENSION_DIRECTORY_PRESENT",
    "TERMINAL_SESSION_DIRECTORY_PRESENT",
    "BROKER_CHECK_REQUIRED",
    "BRIDGE_CHECK_REQUIRED",
    "PERMISSION_CHECK_REQUIRED"
  ]);
  assert.deepEqual(diagnostics.filter((item) => item.target).map((item) => item.target), [
    "browser-control",
    "browser-control",
    "browser-control",
    "browser-control",
    "browser-control",
    "terminal",
    "terminal",
    "terminal",
    "terminal",
    "terminal"
  ]);
});

test("reports invalid or missing native messaging registration state", async () => {
  const plan = createDevInstallPlan({
    repoRoot: "C:\\repo\\portus-browser-dev",
    platform: "win32",
    extensionId
  });

  const diagnostics = await diagnoseDevInstall(plan, {
    fileExists: async () => false,
    readTextFile: async () => "{}"
  });

  assert.equal(diagnostics.find((item) => item.code === "NATIVE_HOST_MANIFEST_PRESENT").ok, false);
  assert.equal(diagnostics.find((item) => item.code === "EXTENSION_ORIGIN_ALLOWED").ok, false);
});

test("dry-run does not write manifest or apply registry", async () => {
  const writes = [];
  const execs = [];
  const result = await runDevInstall({
    repoRoot: "C:\\repo\\portus-browser-dev",
    extensionId,
    writeTextFile: async (path, content) => {
      writes.push({ path, content });
    },
    exec: async (file, args) => {
      execs.push({ file, args });
    },
    fileExists: async () => false,
    readTextFile: async () => "{}"
  });

  assert.equal(result.applied, false);
  assert.equal(result.dryRun, true);
  assert.equal(writes.length, 0);
  assert.equal(execs.length, 0);
});

test("apply writes manifest and executes the registry command", async () => {
  const writes = [];
  const execs = [];
  const writtenManifests = new Map();
  const result = await runDevInstall({
    repoRoot: "C:\\repo\\portus-browser-dev",
    platform: "win32",
    extensionId,
    apply: true,
    writeTextFile: async (path, content) => {
      writes.push({ path, content });
      writtenManifests.set(path, content);
    },
    exec: async (file, args) => {
      execs.push({ file, args });
    },
    fileExists: async () => true,
    readTextFile: async (path) => writtenManifests.get(path) ?? "{}"
  });

  assert.equal(result.applied, true);
  assert.equal(result.dryRun, false);
  assert.equal(writes.length, 4);
  assert.equal(execs.length, 2);
  assert.equal(execs[0].file, "reg.exe");
  assert.equal(execs[1].file, "reg.exe");
  const manifestWrites = writes.filter((write) => write.path.endsWith(".json"));
  assert.deepEqual(manifestWrites.map((write) => JSON.parse(write.content).name), ["com.portus.browser", "com.portus.browser.terminal"]);
  assert.equal(JSON.parse(manifestWrites[0].content).allowed_origins[0], `chrome-extension://${extensionId}/`);
});

test("Linux apply writes launchers and manifests without registry commands", async () => {
  const writes = [];
  const execs = [];
  const chmods = [];
  const writtenManifests = new Map();
  const result = await runDevInstall({
    browser: "chromium",
    platform: "linux",
    repoRoot: "/repo/portus-browser-dev",
    extensionId,
    env: {
      HOME: "/home/carlo"
    },
    apply: true,
    writeTextFile: async (path, content) => {
      writes.push({ path, content });
      if (path.endsWith(".json")) writtenManifests.set(path, content);
    },
    setExecutableMode: async (path, mode) => {
      chmods.push({ path, mode });
    },
    exec: async (file, args) => {
      execs.push({ file, args });
    },
    fileExists: async () => true,
    readTextFile: async (path) => writtenManifests.get(path) ?? "{}"
  });

  assert.equal(result.applied, true);
  assert.equal(writes.length, 4);
  assert.equal(chmods.length, 2);
  assert.equal(chmods[0].mode, 0o755);
  assert.equal(execs.length, 0);
  assert.equal(result.plan.nativeHosts[0].registration.type, "manifest-file");
});


test("resolves the default terminal session folder from the user profile", () => {
  const folder = resolveTerminalSessionDirectory(undefined, {
    USERPROFILE: "C:\\Users\\carlo"
  });

  assert.equal(folder, "C:\\Users\\carlo\\Downloads\\portus-session");
});

test("apply keeps native host registration when terminal session folder creation fails", async () => {
  const writes = [];
  const execs = [];
  const writtenManifests = new Map();
  const result = await runDevInstall({
    repoRoot: "C:\\repo\\portus-browser-dev",
    platform: "win32",
    extensionId,
    terminalSessionDirectory: "C:\\Users\\carlo\\Downloads\\portus-session",
    apply: true,
    writeTextFile: async (path, content) => {
      writes.push({ path, content });
      writtenManifests.set(path, content);
    },
    exec: async (file, args) => {
      execs.push({ file, args });
    },
    ensureDirectory: async () => {
      throw new Error("access denied");
    },
    fileExists: async (path) => {
      const plan = createDevInstallPlan({
        repoRoot: "C:\\repo\\portus-browser-dev",
        platform: "win32",
        extensionId,
        terminalSessionDirectory: "C:\\Users\\carlo\\Downloads\\portus-session"
      });
      return path === plan.extensionDirectory || plan.nativeHosts.some((host) => path === host.manifestPath || path === host.nativeHostPath);
    },
    readTextFile: async (path) => writtenManifests.get(path) ?? "{}"
  });

  assert.equal(result.applied, true);
  assert.equal(writes.length, 4);
  assert.equal(execs.length, 2);
  assert.equal(result.diagnostics.find((item) => item.code === "TERMINAL_SESSION_DIRECTORY_PRESENT").ok, false);
  assert.match(result.diagnostics.find((item) => item.code === "TERMINAL_SESSION_DIRECTORY_PRESENT").message, /access denied/);
});

test("CLI renders plan JSON without applying registry changes", async () => {
  const result = await runDevInstallerCli(["plan", "--extension-id", extensionId, "--json"], {
    repoRoot: "C:\\repo\\portus-browser-dev"
  });

  assert.equal(result.exitCode, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.plan.extensionId, extensionId);
});
