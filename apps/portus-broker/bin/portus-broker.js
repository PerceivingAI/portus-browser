#!/usr/bin/env node

import { startBrokerCli } from "../dist/index.js";

startBrokerCli().catch((error) => {
  const message = error instanceof Error ? error.message : "Portus Broker failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
