import { spawn, type IPty } from "node-pty";
import { TerminalErrorPayloadSchema, type TerminalErrorPayload } from "@portus/terminal";
import type { PtyAdapter, PtyExitEvent, PtyProcess, PtySpawnOptions } from "./index.js";

export class NodePtyAdapter implements PtyAdapter {
  spawn(options: PtySpawnOptions): PtyProcess {
    try {
      const pty = spawn(options.command, options.args, {
        name: terminalName(),
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env: sanitizePtyEnv(options.env),
        useConpty: process.platform === "win32"
      });
      return new NodePtyProcess(pty);
    } catch (error) {
      throw terminalError(
        "TERMINAL_UNAVAILABLE",
        error instanceof Error ? `Failed to start terminal: ${error.message}` : "Failed to start terminal.",
        { command: options.command, cwd: options.cwd }
      );
    }
  }
}

class NodePtyProcess implements PtyProcess {
  constructor(private readonly pty: IPty) {}

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  kill(): void {
    this.pty.kill();
  }

  onData(listener: (data: string) => void): void {
    this.pty.onData(listener);
  }

  onExit(listener: (event: PtyExitEvent) => void): void {
    this.pty.onExit((event) => {
      listener({ exitCode: event.exitCode });
    });
  }
}

export function sanitizePtyEnv(env: Record<string, string | undefined>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") sanitized[key] = value;
  }
  return sanitized;
}

function terminalName(): string {
  return process.platform === "win32" ? "xterm-256color" : process.env.TERM || "xterm-256color";
}

function terminalError(code: TerminalErrorPayload["code"], message: string, details?: Record<string, unknown>): Error & { terminal: TerminalErrorPayload } {
  const terminal = TerminalErrorPayloadSchema.parse({ code, message, ...(details === undefined ? {} : { details }) });
  const error = new Error(terminal.message) as Error & { terminal: TerminalErrorPayload };
  error.name = code;
  error.terminal = terminal;
  return error;
}
