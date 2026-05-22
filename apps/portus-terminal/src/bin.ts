#!/usr/bin/env node

import { runTerminalNativeHost } from "./index.js";

try {
  await runTerminalNativeHost();
} catch (error) {
  const message = error instanceof Error ? error.message : "Portus Terminal Native Host failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
