import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TERMINAL_PROFILE_ID,
  DEFAULT_TERMINAL_WORKING_DIRECTORY,
  TERMINAL_NATIVE_HOST_NAME,
  TERMINAL_OUTPUT_CHUNK_MAX_LENGTH,
  TerminalClientMessageSchema,
  TerminalOutputChunkSchema,
  TerminalProfileSchema,
  TerminalServerMessageSchema,
  TerminalSettingsSchema,
  TerminalSessionMetadataSchema
} from "../dist/index.js";

const createdAt = "2026-05-05T12:00:00.000Z";

function validProfile(overrides = {}) {
  return {
    profileId: "pwsh",
    label: "PowerShell 7",
    kind: "shell",
    command: "pwsh.exe",
    args: ["-NoLogo"],
    detected: true,
    source: "detected",
    embeddedPtySupported: true,
    capabilities: {
      portusTabs: true,
      shellMultiplexer: false,
      externalGuiTabs: false
    },
    ...overrides
  };
}

function validSession(overrides = {}) {
  return {
    terminalId: "term_abc123",
    profileId: "pwsh",
    title: "PowerShell 7",
    cwd: "C:\Users\carlo\Downloads\portus-session",
    status: "running",
    createdAt,
    lastActiveAt: createdAt,
    cols: 100,
    rows: 30,
    ...overrides
  };
}

test("terminal constants describe the separate terminal channel", () => {
  assert.equal(TERMINAL_NATIVE_HOST_NAME, "com.portus.browser.terminal");
  assert.equal(DEFAULT_TERMINAL_PROFILE_ID, "auto");
  assert.equal(DEFAULT_TERMINAL_WORKING_DIRECTORY, "Downloads/portus-session");
});

test("terminal settings use Phase 0 defaults and normalize empty startup command", () => {
  const defaults = TerminalSettingsSchema.parse({});
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.defaultProfileId, "auto");
  assert.equal(defaults.manualTerminalPath, null);
  assert.equal(defaults.startupCommand, null);
  assert.equal(defaults.defaultWorkingDirectory, "Downloads/portus-session");
  assert.equal(defaults.fontSize, 16);
  assert.equal(defaults.maxSessions, 5);

  const parsed = TerminalSettingsSchema.parse({ startupCommand: "" });
  assert.equal(parsed.startupCommand, null);
});

test("terminal profiles require embedded PTY support and reject GUI tab capabilities", () => {
  assert.equal(TerminalProfileSchema.safeParse(validProfile()).success, true);
  assert.equal(TerminalProfileSchema.safeParse(validProfile({ embeddedPtySupported: false })).success, false);
  assert.equal(TerminalProfileSchema.safeParse(validProfile({
    capabilities: { portusTabs: true, shellMultiplexer: false, externalGuiTabs: true }
  })).success, false);
});

test("terminal session metadata validates runtime shape", () => {
  const parsed = TerminalSessionMetadataSchema.parse(validSession());
  assert.equal(parsed.terminalId, "term_abc123");
  assert.equal(parsed.status, "running");
  assert.equal(TerminalSessionMetadataSchema.safeParse(validSession({ terminalId: "abc" })).success, false);
  assert.equal(TerminalSessionMetadataSchema.safeParse(validSession({ cols: 0 })).success, false);
});

test("client messages validate by message type", () => {
  assert.equal(TerminalClientMessageSchema.safeParse({
    type: "terminal.session.create",
    requestId: "treq_create1",
    payload: { profileId: "pwsh", cols: 100, rows: 30 }
  }).success, true);

  assert.equal(TerminalClientMessageSchema.safeParse({
    type: "terminal.session.input",
    terminalId: "term_abc123",
    payload: { data: "dir\r" }
  }).success, true);

  assert.equal(TerminalClientMessageSchema.safeParse({
    type: "browser.list",
    payload: {}
  }).success, false);

  assert.equal(TerminalClientMessageSchema.safeParse({
    type: "terminal.session.resize",
    terminalId: "term_abc123",
    payload: { cols: 0, rows: 30 }
  }).success, false);
});

test("server messages validate output, sessions, and errors", () => {
  assert.equal(TerminalServerMessageSchema.safeParse({
    type: "terminal.session.output",
    terminalId: "term_abc123",
    payload: { data: "PS> " }
  }).success, true);

  assert.equal(TerminalServerMessageSchema.safeParse({
    type: "terminal.sessions",
    payload: { sessions: [validSession()], activeTerminalId: "term_abc123" }
  }).success, true);

  assert.equal(TerminalServerMessageSchema.safeParse({
    type: "terminal.session.error",
    terminalId: "term_abc123",
    payload: { code: "TERMINAL_UNAVAILABLE", message: "Terminal backend is unavailable.", retryable: true }
  }).success, true);
});

test("terminal output chunks are bounded", () => {
  assert.equal(TerminalOutputChunkSchema.safeParse({ data: "x".repeat(TERMINAL_OUTPUT_CHUNK_MAX_LENGTH) }).success, true);
  assert.equal(TerminalOutputChunkSchema.safeParse({ data: "x".repeat(TERMINAL_OUTPUT_CHUNK_MAX_LENGTH + 1) }).success, false);
});
