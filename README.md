# Portus Browser

Portus Browser lets a user and an AI agent (Codex, Pi, Claude Code, and others) co-navigate one or more visible browser sessions from the terminal.

Any agent in your system can use the `portus-browser` CLI. Portus routes commands through a local Broker and browser Extension, allowing each browser to use its own settings profile, navigation policy, command policy, and terminal settings.

## What Portus Browser Does

Portus Browser lets an agent:

- list connected browsers
- list and inspect tabs
- open and navigate pages
- click, type, press keys, scroll, hover, and drag
- take page snapshots and screenshots
- inspect console and network data
- use saved browser recipes
- work across multiple Chrome, Edge, and Chromium windows at the same time.

Portus Browser is local first and the Broker runs on the user's machine.

## Access And Policy

The Extension permanently requests Chrome host access for normal web pages through `"<all_urls>"`; there is no site-by-site Chrome permission request or revoke workflow. While the Bridge is connected, Portus navigation policy and command policy are the authorization boundary for agent actions.

Navigation rules can match a URL by scheme, authority, wildcard host, exact URL, or URL prefix. Portus does not impose a built-in scheme restriction: users decide which browser-supported URLs to allow or block. A denied URL returns `NAVIGATION_BLOCKED`; protected pages and other targets the browser cannot expose return `BROWSER_ACCESS_DENIED`.

## Quick Start

From the repo root:

1. Install deps and build:

```powershell
pnpm install --frozen-lockfile
pnpm build
```

2. Start Portus Broker and keep that terminal open:

```powershell
pnpm --filter @portus/broker exec node dist/index.js
```

3. In your browser, load the extension from `apps/portus-extension` (Developer mode -> Load unpacked), then copy the extension ID.

4. Install native host for that browser and extension ID:

```powershell
pnpm --filter @portus/dev-installer exec node dist/index.js apply --browser chrome --extension-id <extension-id>
```

5. Reload the extension (or restart browser), open the extension popup, and click Connect Bridge.

6. In a second terminal, verify connection:

```powershell
pnpm --filter @portus/browser-cli exec portus-browser browsers --json
```

If the list is empty, the Bridge is not connected yet in the extension popup.

## Main Parts

- Extension: the browser extension UI, popup, side panel, Settings view, Terminal view, and browser bridge.
- Broker: the local command router and source of truth for saved settings profiles.
- Browser CLI: the terminal command agents use. The command is `portus-browser`.
- Native hosts: local browser native messaging programs used by the Extension.
- Portus Browser skill: onboarding instructions that teach an AI agent how to use the CLI safely.


![Portus Browser GUI views](assets/gui_views.png)


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

- `docs/INSTALL.md`: build, install, access disclosure, and run instructions.
- `docs/SETTINGS_PROFILES.md`: settings profiles and policy behavior.
- `docs/TROUBLESHOOTING.md`: common setup, policy, and browser-access checks.
- `AGENT_SKILL.md`: how to install and use the Portus Browser skill.
