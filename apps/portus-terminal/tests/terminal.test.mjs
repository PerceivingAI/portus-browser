import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { PassThrough } from "node:stream";
import { encodeNativeMessage, tryReadNativeMessageFrame } from "@portus/native-messaging";
import {
  ShellDetector,
  TerminalManager,
  WorkingDirectoryResolver,
  createTerminalNativeHost
} from "../dist/index.js";
import { NodePtyAdapter, sanitizePtyEnv } from "../dist/ptyAdapter.js";

class FakeProbe {
  constructor(commands, distributions = []) {
    this.commands = new Set(commands);
    this.distributions = distributions;
  }

  exists(command) {
    return this.commands.has(command);
  }

  listWslDistributions() {
    return this.distributions;
  }
}

class FakeFileSystem {
  constructor(existing = []) {
    this.directories = new Set(existing);
    this.created = [];
  }

  async ensureDirectory(directory) {
    this.directories.add(directory);
    this.created.push(directory);
  }

  async isDirectory(directory) {
    return this.directories.has(directory);
  }
}

class FakePtyProcess {
  constructor(options) {
    this.options = options;
    this.writes = [];
    this.resizes = [];
    this.killed = false;
    this.dataListeners = [];
    this.exitListeners = [];
  }

  write(data) {
    this.writes.push(data);
  }

  resize(cols, rows) {
    this.resizes.push({ cols, rows });
  }

  kill() {
    this.killed = true;
  }

  onData(listener) {
    this.dataListeners.push(listener);
  }

  onExit(listener) {
    this.exitListeners.push(listener);
  }

  emitData(data) {
    for (const listener of this.dataListeners) listener(data);
  }

  emitExit(exitCode) {
    for (const listener of this.exitListeners) listener({ exitCode });
  }
}

class FakePtyAdapter {
  constructor() {
    this.processes = [];
  }

  spawn(options) {
    const pty = new FakePtyProcess(options);
    this.processes.push(pty);
    return pty;
  }
}

function fixedClock(...dates) {
  const values = dates.length > 0 ? dates : ["2026-05-05T12:00:00.000Z"];
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

function windowsManager(options = {}) {
  const home = "C:\\Users\\carlo";
  const cwd = path.join(home, "Downloads", "portus-session");
  const fileSystem = new FakeFileSystem([cwd]);
  const ptyAdapter = new FakePtyAdapter();
  const shellDetector = new ShellDetector({
    platform: "win32",
    probe: new FakeProbe(["powershell.exe", "pwsh.exe", "cmd.exe", "wsl.exe"], ["Ubuntu"]),
    env: { USERPROFILE: home }
  });
  const workingDirectoryResolver = new WorkingDirectoryResolver({
    platform: "win32",
    env: { USERPROFILE: home },
    fileSystem
  });
  return {
    fileSystem,
    ptyAdapter,
    manager: new TerminalManager({
      ptyAdapter,
      shellDetector,
      workingDirectoryResolver,
      env: { USERPROFILE: home },
      now: fixedClock("2026-05-05T12:00:00.000Z", "2026-05-05T12:00:01.000Z", "2026-05-05T12:00:02.000Z"),
      ...options
    })
  };
}

test("detects Windows terminal profiles and WSL distributions", async () => {
  const detector = new ShellDetector({
    platform: "win32",
    probe: new FakeProbe(["powershell.exe", "pwsh.exe", "cmd.exe", "wsl.exe", "C:\\Program Files\\Git\\bin\\bash.exe"], ["Ubuntu", "Debian"]),
    env: { USERPROFILE: "C:\\Users\\carlo" }
  });
  const profiles = await detector.detect({ manualTerminalPath: "C:\\Tools\\CustomShell.exe" });
  assert.deepEqual(profiles.map((profile) => profile.profileId), [
    "manual",
    "powershell",
    "pwsh",
    "cmd",
    "wsl-default",
    "wsl:ubuntu",
    "wsl:debian",
    "git-bash"
  ]);
  assert.equal(profiles[0].command, "C:\\Tools\\CustomShell.exe");
});

test("resolves and creates the default Downloads portus-session directory", async () => {
  const fileSystem = new FakeFileSystem();
  const resolver = new WorkingDirectoryResolver({
    platform: "win32",
    env: { USERPROFILE: "C:\\Users\\carlo" },
    fileSystem
  });
  const directory = await resolver.resolve();
  assert.equal(directory, path.join("C:\\Users\\carlo", "Downloads", "portus-session"));
  assert.deepEqual(fileSystem.created, [directory]);
});

test("creates a default terminal session and runs the optional startup command", async () => {
  const { manager, ptyAdapter } = windowsManager({
    config: { startupCommand: "codex" }
  });
  const session = await manager.ensureReady(120, 40);
  assert.ok(session);
  assert.equal(session.terminalId, "term_000001");
  assert.equal(manager.activeTerminalId, "term_000001");
  assert.equal(ptyAdapter.processes.length, 1);
  assert.equal(ptyAdapter.processes[0].options.command, "powershell.exe");
  assert.deepEqual(ptyAdapter.processes[0].options.args, ["-NoLogo"]);
  assert.equal(ptyAdapter.processes[0].options.cols, 120);
  assert.equal(ptyAdapter.processes[0].options.rows, 40);
  assert.deepEqual(ptyAdapter.processes[0].writes, ["codex\r"]);
  assert.equal(manager.listSessions()[0].status, "running");
});

test("forwards input, output, resize, and exit through the session wrapper", async () => {
  const { manager, ptyAdapter } = windowsManager({ config: { startupCommand: null } });
  const session = await manager.createSession({ profileId: "pwsh", cols: 80, rows: 24 });
  const outputs = [];
  const exits = [];
  session.attach({
    onOutput(data) {
      outputs.push(data);
    },
    onExit(event) {
      exits.push(event.exitCode);
    }
  });

  manager.writeInput(session.terminalId, "dir\r");
  manager.resizeSession(session.terminalId, 100, 30);
  ptyAdapter.processes[0].emitData("PS> ");
  ptyAdapter.processes[0].emitExit(0);

  assert.deepEqual(ptyAdapter.processes[0].writes, ["dir\r"]);
  assert.deepEqual(ptyAdapter.processes[0].resizes, [{ cols: 100, rows: 30 }]);
  assert.deepEqual(outputs, ["PS> "]);
  assert.deepEqual(exits, [0]);
  assert.equal(manager.listSessions()[0].status, "exited");
});

test("enforces max sessions and profile availability", async () => {
  const { manager } = windowsManager({ config: { maxSessions: 1 } });
  await manager.createSession({ profileId: "powershell", cols: 80, rows: 24 });
  assert.throws(() => manager.getSession("term_missing"), /Terminal session is unavailable/);
  await assert.rejects(() => manager.createSession({ profileId: "pwsh", cols: 80, rows: 24 }), /Maximum terminal session count reached/);

  const other = windowsManager({ config: { defaultProfileId: "missing" } });
  const fallback = await other.manager.ensureReady();
  assert.equal(fallback.profile.profileId, "powershell");
  assert.equal(other.manager.currentSettings.defaultProfileId, "missing");
  await assert.rejects(() => other.manager.createSession({ profileId: "missing", cols: 80, rows: 24 }), /Terminal profile is unavailable/);
});

test("disabling terminal kills sessions and enabling starts the default session", async () => {
  const { manager, ptyAdapter } = windowsManager();
  await manager.ensureReady();
  assert.equal(ptyAdapter.processes.length, 1);
  await manager.setEnabled(false);
  assert.equal(ptyAdapter.processes[0].killed, true);
  assert.deepEqual(manager.listSessions(), []);
  assert.equal(await manager.ensureReady(), null);

  await manager.setEnabled(true);
  assert.equal(ptyAdapter.processes.length, 2);
  assert.equal(manager.activeTerminalId, "term_000002");
});

test("concurrent reusable default session requests create one PTY", async () => {
  const { manager, ptyAdapter } = windowsManager();
  const [first, second] = await Promise.all([
    manager.ensureDefaultSession({ profileId: "powershell", cols: 100, rows: 30 }),
    manager.ensureDefaultSession({ profileId: "powershell", cols: 100, rows: 30 })
  ]);

  assert.equal(first.terminalId, second.terminalId);
  assert.equal(ptyAdapter.processes.length, 1);
  assert.equal(manager.listSessions().length, 1);
});

test("cleanupIdleSessions closes inactive sessions", async () => {
  let current = new Date("2026-05-05T12:00:00.000Z");
  const { manager, ptyAdapter } = windowsManager({
    config: { idleTimeoutMs: 1000 },
    now: () => current
  });
  const session = await manager.ensureReady();
  current = new Date("2026-05-05T12:00:02.000Z");
  assert.deepEqual(manager.cleanupIdleSessions(), [session.terminalId]);
  assert.equal(ptyAdapter.processes[0].killed, true);
  assert.deepEqual(manager.listSessions(), []);
});

test("detaching a terminal client does not refresh session activity", async () => {
  let current = new Date("2026-05-05T12:00:00.000Z");
  const { manager } = windowsManager({
    now: () => current
  });
  const session = await manager.ensureReady();
  current = new Date("2026-05-05T12:00:01.000Z");
  const client = { onOutput() {} };
  session.attach(client);
  const lastActiveAt = session.lastActiveAt;

  current = new Date("2026-05-05T12:00:02.000Z");
  session.detach(client);

  assert.equal(session.lastActiveAt, lastActiveAt);
});


test("production PTY adapter sanitizes env and maps spawn failures", () => {
  assert.deepEqual(sanitizePtyEnv({ PATH: "C:/Tools", EMPTY: undefined, TERM: "xterm" }), {
    PATH: "C:/Tools",
    TERM: "xterm"
  });

  const adapter = new NodePtyAdapter();
  assert.throws(() => adapter.spawn({
    command: "C:/definitely/missing/portus-terminal.exe",
    args: [],
    cwd: "C:/",
    cols: 80,
    rows: 24,
    env: {}
  }), (error) => {
    assert.equal(error.terminal.code, "TERMINAL_UNAVAILABLE");
    assert.equal(error.terminal.details.command, "C:/definitely/missing/portus-terminal.exe");
    return true;
  });
});

test("terminal native host streams session events over native messaging", async () => {
  const { host, input, output, pty } = await startTerminalHostFixture();
  try {
    await readNativeMessage(output);
    input.write(encodeNativeMessage({ type: "terminal.session.create", requestId: "treq_001", payload: { cols: 100, rows: 30 } }));
    const created = await readNativeMessage(output);
    assert.equal(created.type, "terminal.session.created");
    const terminalId = created.terminalId;

    input.write(encodeNativeMessage({ type: "terminal.session.attach", requestId: "treq_002", terminalId, payload: {} }));
    const attached = await readNativeMessage(output);
    assert.equal(attached.type, "terminal.session.attached");

    pty.emitData("hello");
    const streamed = await readNativeMessage(output);
    assert.equal(streamed.type, "terminal.session.output");
    assert.equal(streamed.terminalId, terminalId);
    assert.equal(streamed.payload.data, "hello");

    input.write(encodeNativeMessage({ type: "terminal.session.input", terminalId, payload: { data: "pwd\r" } }));
    assert.equal(pty.writes.at(-1), "pwd\r");
  } finally {
    host.stop();
  }
});

test("terminal native host reusable create returns the same running default session", async () => {
  const { host, input, output } = await startTerminalHostFixture();
  try {
    await readNativeMessage(output);
    input.write(encodeNativeMessage({ type: "terminal.session.create", requestId: "treq_001", payload: { profileId: "powershell", cols: 100, rows: 30, reuseExisting: true } }));
    const first = await readNativeMessage(output);
    input.write(encodeNativeMessage({ type: "terminal.session.create", requestId: "treq_002", payload: { profileId: "powershell", cols: 100, rows: 30, reuseExisting: true } }));
    const second = await readNativeMessage(output);

    assert.equal(first.type, "terminal.session.created");
    assert.equal(second.type, "terminal.session.created");
    assert.equal(first.terminalId, second.terminalId);
    assert.equal(host.manager.listSessions().length, 1);
  } finally {
    host.stop();
  }
});

test("terminal native host returns stable errors for invalid terminal messages", async () => {
  const { host, input, output } = await startTerminalHostFixture();
  try {
    await readNativeMessage(output);
    input.write(encodeNativeMessage({ type: "terminal.session.input", terminalId: "term_missing", payload: { data: "x" } }));
    const message = await readNativeMessage(output);
    assert.equal(message.type, "terminal.session.error");
    assert.equal(message.payload.code, "SESSION_NOT_FOUND");
    assert.equal(message.terminalId, "term_missing");
  } finally {
    host.stop();
  }
});

test("terminal native host idle cleanup closes sessions and emits updated session list", async () => {
  let current = new Date("2026-04-28T00:00:00.000Z");
  let cleanupCallback;
  const { host, output, pty } = await startTerminalHostFixture({
    config: { idleTimeoutMs: 1000 },
    now: () => current,
    setInterval(callback) {
      cleanupCallback = callback;
      return "cleanup-timer";
    },
    clearInterval() {}
  });
  try {
    await readNativeMessage(output);
    await host.manager.ensureReady();
    current = new Date("2026-04-28T00:00:02.000Z");
    cleanupCallback();
    const sessions = await readNativeMessage(output);
    assert.equal(sessions.type, "terminal.sessions");
    assert.deepEqual(sessions.payload.sessions, []);
    assert.equal(pty.killed, true);
  } finally {
    host.stop();
  }
});

test("terminal native host shutdown closes all sessions", async () => {
  const { host, output, pty } = await startTerminalHostFixture();
  await readNativeMessage(output);
  await host.manager.ensureReady();

  host.stop();

  assert.equal(pty.killed, true);
  assert.deepEqual(host.manager.listSessions(), []);
});

async function startTerminalHostFixture(options = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const pty = new FakePtyProcess();
  const host = createTerminalNativeHost({
    input,
    output,
    now: options.now ?? (() => new Date("2026-04-28T00:00:00.000Z")),
    config: options.config,
    cleanupIntervalMs: options.cleanupIntervalMs,
    setInterval: options.setInterval,
    clearInterval: options.clearInterval,
    ptyAdapter: { spawn: () => pty },
    shellDetector: new ShellDetector({
      platform: "win32",
      probe: new FakeProbe(["powershell.exe"]),
      env: { USERPROFILE: "C:/Users/test" }
    }),
    workingDirectoryResolver: new WorkingDirectoryResolver({
      platform: "win32",
      homeDirectory: "C:/Users/test",
      fileSystem: new FakeFileSystem(["C:/Users/test/Downloads/portus-session"])
    })
  });
  await host.start();
  return { host, input, output, pty };
}

function readNativeMessage(output) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      const read = tryReadNativeMessageFrame(buffer);
      if (!read) return;
      output.off("data", onData);
      output.off("error", reject);
      resolve(read.payload);
    };
    output.on("data", onData);
    output.once("error", reject);
  });
}
