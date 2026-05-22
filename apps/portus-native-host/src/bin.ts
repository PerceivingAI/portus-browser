#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runNativeHost } from "./index.js";

export interface BrokerStarterDependencies {
  access?: (path: string) => Promise<void>;
  brokerEntry?: string;
  nodePath?: string;
  spawn?: (
    file: string,
    args: string[],
    options: {
      detached: true;
      stdio: "ignore";
      windowsHide: true;
    }
  ) => { unref(): void };
}

export function createDefaultBrokerStarter(dependencies: BrokerStarterDependencies = {}): () => Promise<void> {
  return async () => {
    const brokerEntry = dependencies.brokerEntry ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "portus-broker", "dist", "index.js");
    const accessFile = dependencies.access ?? access;
    const spawnProcess = dependencies.spawn ?? spawn;
    await accessFile(brokerEntry);
    const child = spawnProcess(dependencies.nodePath ?? process.execPath, [brokerEntry], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  };
}

export async function runNativeHostCli(): Promise<void> {
  try {
    await runNativeHost({
      startBroker: createDefaultBrokerStarter()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Portus Native Host failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runNativeHostCli();
}
