# Portus Browser Public Docs

Portus Browser lets a user and an AI agent co-navigate one or more visible browser sessions from the terminal.

The user keeps the browser visible and approved. The agent uses the `portus-browser` CLI and Portus routes commands through a local Broker and the browser Extension.

## What Portus Browser Does

Portus Browser lets an agent:

- list connected browsers
- list and inspect tabs
- open and navigate pages
- click, type, press keys, scroll, hover, and drag
- take page snapshots and screenshots
- inspect console and network data
- use saved browser recipes
- work across Chrome, Edge, Brave, and Chromium

Portus Browser is local first and the Broker runs on the user's machine. Browser actions go through the installed Extension and native messaging hosts.

## Quick Start

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm build
node apps/portus-broker/dist/index.js
```

Then load `apps/portus-extension` as an unpacked extension in the target browser, install native hosts for that browser's extension ID, connect the Bridge from the extension popup, and check:

```powershell
node apps/portus-browser-cli/dist/index.js browsers --json
```

## Main Parts

- Portus Extension: the browser extension UI, popup, side panel, Settings view, Terminal view, and browser bridge.
- Portus Broker: the local command router and source of truth for saved settings profiles.
- Portus Browser CLI: the terminal command agents use. The command is `portus-browser`.
- Native hosts: local browser native messaging programs used by the Extension.
- Portus Browser skill: onboarding instructions that teach an AI agent how to use the CLI safely.

## Supported Browsers

Portus Browser targets Chromium-based browsers:

- Google Chrome
- Microsoft Edge
- Brave
- Chromium

The extension must be installed separately in each browser type you want to use.

## Supported Platforms

The code is intended to work on:

- Windows
- Linux
- macOS

Native messaging registration is platform-specific. Use the installer command for each browser type and extension ID.

## Public Docs Map

- `docs/INSTALL.md`: build, install, and run instructions.
- `docs/USAGE.md`: CLI and multi-browser usage.
- `docs/SETTINGS_PROFILES.md`: security profiles and settings behavior.
- `docs/TROUBLESHOOTING.md`: common setup checks.
- `AGENT_SKILL.md`: how to install and use the Portus Browser skill.
