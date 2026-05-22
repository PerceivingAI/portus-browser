# Build, Install, And Run

These steps assume you cloned the public `portus-browser` repository.

## Requirements

Install:

- Node.js 20 or newer
- pnpm 9
- one supported Chromium-based browser: Chrome, Edge, Brave, or Chromium

## Build The Workspace

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm build
```

This builds every workspace package.

To build only the extension:

```powershell
pnpm --filter @portus/extension build
```

The extension build output is written under:

```text
apps/portus-extension/dist
```

The extension manifest stays at:

```text
apps/portus-extension/manifest.json
```

When loading the extension, select `apps/portus-extension`, not `apps/portus-extension/dist`.

The Broker build output is written under:

```text
apps/portus-broker/dist
```

To build only the Broker:

```powershell
pnpm --filter @portus/broker build
```

Optional verification:

```powershell
pnpm test
```

## Load The Extension

Open the extensions page in the target browser:

- Chrome: `chrome://extensions`
- Edge: `edge://extensions`
- Brave: `brave://extensions`
- Chromium: `chrome://extensions`

Then:

1. Enable Developer mode.
2. Click Load unpacked.
3. Select `apps/portus-extension`.
4. Copy the extension ID shown by the browser.

Do this separately for every browser type you want to use.

The extension can only run after `pnpm build`, because the manifest points to built files under `apps/portus-extension/dist`.

## Run The Broker

The Broker is the local process that receives CLI commands and routes them to connected browser sessions.

Start it manually from the repository root:

```powershell
node apps/portus-broker/dist/index.js
```

Leave that terminal open while using Portus Browser.

Stop it with `Ctrl+C`.

After it starts, it prints the local endpoint it is listening on.

You can also run the package bin after building:

```powershell
pnpm --filter @portus/broker exec portus-broker
```

The browser-control native host can auto-start the Broker when the extension connects, but for setup and debugging, starting the Broker manually makes failures clearer.

In another terminal, check Broker status:

```powershell
node apps/portus-browser-cli/dist/index.js broker status --json
```

## Install Native Hosts

Run this after `pnpm build`.

Use the extension ID from the browser where you loaded the extension.

Plan the install first:

```powershell
node installers/dev/dist/index.js plan --browser chrome --extension-id <extension-id>
```

Apply it:

```powershell
node installers/dev/dist/index.js apply --browser chrome --extension-id <extension-id>
```

Diagnose it:

```powershell
node installers/dev/dist/index.js diagnose --browser chrome --extension-id <extension-id>
```

Supported `--browser` values:

- `chrome`
- `edge`
- `brave`
- `chromium`

If you install the extension in more than one browser type, run the native host install once per browser type with that browser's extension ID.

Examples:

```powershell
node installers/dev/dist/index.js apply --browser edge --extension-id <edge-extension-id>
node installers/dev/dist/index.js apply --browser brave --extension-id <brave-extension-id>
```

After applying native host registration, reload the extension or restart the browser.

## Connect The Browser

In the browser:

1. Click the Portus Browser extension icon.
2. Connect the Bridge.
3. Open the panel if you want to use Settings or Terminal.

From the terminal, check connected browsers:

```powershell
node apps/portus-browser-cli/dist/index.js browsers --json
```

If the CLI reports no browsers, the Bridge is not connected in the extension.

## Run The CLI

Direct command from the repo:

```powershell
node apps/portus-browser-cli/dist/index.js browsers --json
```

Equivalent workspace bin form:

```powershell
pnpm --filter @portus/browser-cli exec portus-browser browsers --json
```

Use JSON output for agent work. It is easier to parse and safer for multi-step tasks.
