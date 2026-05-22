import type { PortusError } from "@portus/protocol";
import type { PortusExtensionStatus } from "../index.js";

export interface RuntimePort {
  name: string;
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void; removeListener?(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void; removeListener?(listener: () => void): void };
}

interface RuntimeSuccess {
  ok: true;
  result: {
    status?: PortusExtensionStatus;
    policy?: unknown;
    ux?: unknown;
    settings?: unknown;
    terminal?: unknown;
    permission?: unknown;
    revoked?: unknown;
  };
}

interface RuntimeFailure {
  ok: false;
  error: PortusError;
}

export type RuntimeResponse = RuntimeSuccess | RuntimeFailure;

declare const chrome: {
  runtime: {
    lastError?: { message?: string };
    sendMessage(message: unknown, callback: (response: unknown) => void): void;
    connect(connectInfo: { name: string }): RuntimePort;
  };
  storage?: {
    local?: {
      get(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> | void;
    };
  };
  sidePanel?: {
    open(options: { windowId?: number; tabId?: number }): Promise<void> | void;
    close?(options: { windowId?: number; tabId?: number }): Promise<void> | void;
  };
  windows?: {
    getCurrent(): Promise<{ id?: number }> | void;
  };
};

declare const window: {
  close(): void;
};

export function sendRuntimeMessage(message: unknown): Promise<RuntimeSuccess> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      const runtimeError = chrome.runtime.lastError?.message;
      if (runtimeError) return reject(new Error(runtimeError));
      if (!isRuntimeResponse(response)) return reject(new Error("Invalid extension runtime response."));
      if (!response.ok) return reject(new Error(response.error.message));
      resolve(response);
    });
  });
}

export function connectRuntimePort(name: string): RuntimePort {
  return chrome.runtime.connect({ name });
}

export async function readLocalStorageValue(key: string): Promise<unknown> {
  if (!chrome.storage?.local?.get) return undefined;
  const result = await promisifyChromeCall<Record<string, unknown>>((done) => {
    const value = chrome.storage?.local?.get(key);
    done(value as Promise<Record<string, unknown>> | Record<string, unknown> | undefined);
  });
  return result?.[key];
}

export async function openSidePanelFromPopupGesture(): Promise<void> {
  if (!chrome.sidePanel?.open) {
    throw new Error("Chrome side panel API is unavailable.");
  }
  const currentWindow = chrome.windows?.getCurrent ? await promisifyChromeCall<{ id?: number }>((done) => {
    const result = chrome.windows?.getCurrent();
    done(result as Promise<{ id?: number }> | { id?: number } | undefined);
  }) : undefined;
  await promisifyChromeCall<void>((done) => {
    const options = currentWindow?.id === undefined ? {} : { windowId: currentWindow.id };
    const result = chrome.sidePanel?.open(options);
    done(result as Promise<void> | void);
  });
}

export async function closeSidePanelFromPopupGesture(): Promise<void> {
  if (!chrome.sidePanel?.close) {
    throw new Error("Chrome side panel close API is unavailable.");
  }
  const currentWindow = chrome.windows?.getCurrent ? await promisifyChromeCall<{ id?: number }>((done) => {
    const result = chrome.windows?.getCurrent();
    done(result as Promise<{ id?: number }> | { id?: number } | undefined);
  }) : undefined;
  await promisifyChromeCall<void>((done) => {
    const options = currentWindow?.id === undefined ? {} : { windowId: currentWindow.id };
    const result = chrome.sidePanel?.close?.(options);
    done(result as Promise<void> | void);
  });
}

export function closeWindow(): void {
  window.close();
}

export function readStatus(response: RuntimeSuccess): PortusExtensionStatus {
  const status = response.result.status;
  if (!status) throw new Error("Extension response did not include status.");
  return status;
}

export function readStatusMessage(message: unknown): PortusExtensionStatus | null {
  if (!isRecord(message) || message.type !== "portus.status.updated" || !isRecord(message.status)) return null;
  return message.status as unknown as PortusExtensionStatus;
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

function isRuntimeResponse(value: unknown): value is RuntimeResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (value.ok) return isRecord(value.result);
  return isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
