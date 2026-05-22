---
name: portus-browser
description: Onboard an AI agent to use Portus Browser CLI (`portus-browser`) for controlling one or several visible, user-approved browser sessions. Use when an agent needs to browse, inspect tabs, open or navigate pages, take screenshots or snapshots, click/type/scroll/hover/drag, dismiss popups, wait for page state, inspect console/network data, use saved browser recipes, or recover from Portus Browser CLI errors.
---

# Portus Browser

## Core Rule

Use `portus-browser` to operate the user's visible browser through Portus Broker and Portus Extension. Do not talk directly to browser internals, extension storage, Chrome DevTools, or local Portus files unless the user explicitly asks for development work.

Prefer JSON output for agent work:

```powershell
portus-browser browsers --json
```

Use table output only when showing the user a simple status.

## First Check

Before browsing, list connected browsers:

```powershell
portus-browser browsers --json
```

Interpretation:

- One or more browsers: continue.
- Empty list: tell the user to connect the Bridge from the Portus extension.
- `BROKER_UNAVAILABLE`: tell the user the local Portus Broker is not running.
- `BRIDGE_DISCONNECTED`: tell the user the extension Bridge is disconnected.

Do not keep trying browser actions when no browser is available.

## Targeting

Use browser display indexes for quick interactive work:

```powershell
--browser 1
```

Use stable ids from JSON when scripting longer workflows:

```powershell
--browser br_001
```

For tabs:

```powershell
portus-browser tabs --browser 1 --json
portus-browser tab --browser 1 --tab-id <tabId> --json
portus-browser tab --browser 1 --index 2 --json
```

Rules:

- `--browser 1` means the first browser in the current `browsers` output.
- Tab indexes can change. Prefer `--tab-id` after tab discovery.
- Action commands require the target browser and tab.

## Multi-Browser Usage

When more than one browser is connected, choose the target browser deliberately.

Rules:

- Run `portus-browser browsers --json` before choosing a browser.
- If the user names a browser type such as Chrome, Edge, or Brave, select the connected browser row whose browser name or label matches.
- If the user does not specify which browser to use and more than one browser is connected, ask which browser to use before taking action.
- Do not omit `--browser` when multiple browsers are connected. Default target selection may not match the user's intended browser.
- Keep a separate working context per browser: `browserId`, active `tabId`, current URL, and latest `snapshotId`.
- Never reuse a `tabId`, `snapshotId`, or `elementId` from one browser with another browser.
- Refresh `portus-browser browsers --json` before resolving display indexes if the browser list may have changed.
- Prefer stable `browserId` values for longer multi-browser tasks because display indexes are only current-list conveniences.

Example:

```powershell
portus-browser browsers --json
portus-browser tabs --browser br_chrome_001 --json
portus-browser tabs --browser br_edge_001 --json
```

For side-by-side comparisons:

1. Open or identify the target tab in each browser.
2. Store each browser's `browserId` and tab's `tabId` separately.
3. Snapshot or screenshot each browser separately.
4. Report which result came from which browser.

Settings profiles are GUI-managed. The CLI uses the current effective settings of each browser session and does not switch or edit profile selection.

## Navigation

Open a new tab:

```powershell
portus-browser open https://example.com --browser 1 --json
```

Open in the background:

```powershell
portus-browser open https://example.com --browser 1 --background --json
```

Reuse an existing tab:

```powershell
portus-browser navigate --browser 1 --tab-id <tabId> https://example.com --json
```

Use history:

```powershell
portus-browser back --browser 1 --tab-id <tabId> --json
portus-browser forward --browser 1 --tab-id <tabId> --json
```

After navigation, wait instead of sleeping:

```powershell
portus-browser wait --browser 1 --tab-id <tabId> --state complete --json
portus-browser wait --browser 1 --tab-id <tabId> --url-contains example --json
portus-browser wait --browser 1 --tab-id <tabId> --text "Reviews" --json
portus-browser wait --browser 1 --tab-id <tabId> --element-query "Search" --role textbox --json
```

## Inspecting Pages

Use snapshots to find actionable elements:

```powershell
portus-browser snapshot --browser 1 --tab-id <tabId> --json
```

Use filtered snapshots when the goal has a known label, role, domain, or section:

```powershell
portus-browser snapshot --browser 1 --tab-id <tabId> --query "reviews" --json
portus-browser snapshot --browser 1 --tab-id <tabId> --role link --query "wikipedia" --json
portus-browser snapshot --browser 1 --tab-id <tabId> --role button --query "dismiss" --json
portus-browser snapshot --browser 1 --tab-id <tabId> --interactive-only --max-elements 100 --json
```

Use screenshots for visual ambiguity:

```powershell
portus-browser screenshot --browser 1 --tab-id <tabId> --json
```

Rules:

- Snapshot output contains `snapshotId` and `elementId` values.
- Element ids are scoped to the snapshot that produced them.
- If the page changes, scrolls, navigates, hovers, or updates, take a fresh snapshot before acting.
- If a filtered snapshot misses the target, broaden the filter, use a full snapshot, scroll and re-snapshot, or use a screenshot.

## Acting On Elements

Click:

```powershell
portus-browser click --browser 1 --tab-id <tabId> --snapshot <snapshotId> --element <elementId> --json
```

Type:

```powershell
portus-browser type --browser 1 --tab-id <tabId> --snapshot <snapshotId> --element <elementId> "text to type" --json
```

Press a key:

```powershell
portus-browser press --browser 1 --tab-id <tabId> Enter --json
portus-browser press --browser 1 --tab-id <tabId> Tab --element <elementId> --snapshot <snapshotId> --json
```

Scroll:

```powershell
portus-browser scroll --browser 1 --tab-id <tabId> --y 600 --json
portus-browser scroll --browser 1 --tab-id <tabId> --element <elementId> --snapshot <snapshotId> --y 600 --json
```

Hover:

```powershell
portus-browser hover --browser 1 --tab-id <tabId> --snapshot <snapshotId> --element <elementId> --json
```

Drag:

```powershell
portus-browser drag --browser 1 --tab-id <tabId> --snapshot <snapshotId> --from <sourceElementId> --to <targetElementId> --json
```

After any action, verify with `wait`, `tabs`, `snapshot`, or `screenshot`.

## Popups, Cookie Banners, And Dialogs

Dismiss DOM popups and cookie banners conservatively:

```powershell
portus-browser dismiss --browser 1 --tab-id <tabId> --json
portus-browser dismiss --browser 1 --tab-id <tabId> --kind cookie --dry-run --json
```

Rules:

- Conservative dismiss prefers close, reject, decline, only necessary, no thanks, and similar controls.
- Do not use accept-style cookie dismissal unless the user explicitly asks.
- If the target is uncertain, use `--dry-run` first.

Use browser dialog commands only for native JavaScript dialogs:

```powershell
portus-browser dialog dismiss --browser 1 --tab-id <tabId> --json
portus-browser dialog accept --browser 1 --tab-id <tabId> --text "value" --json
```

Dialog commands require the user to enable the advanced debugger backend and command policy.

## Console And Network Diagnostics

Use these when debugging a page or verifying app behavior:

```powershell
portus-browser console list --browser 1 --tab-id <tabId> --limit 50 --json
portus-browser console clear --browser 1 --tab-id <tabId> --json
portus-browser network list --browser 1 --tab-id <tabId> --limit 50 --json
portus-browser network get --browser 1 --tab-id <tabId> <requestId> --json
```

Do not use diagnostics as a substitute for user-visible verification when the user asked about rendered behavior.

## Policy And Permissions

The user controls Portus policy from the extension UI. Do not pre-check or second-guess policy before executing a direct user request. Try the command and report policy errors plainly.

Useful read/list commands:

```powershell
portus-browser permissions list --browser 1 --json
portus-browser policy allow list --browser 1 --json
portus-browser policy block list --browser 1 --json
portus-browser policy retention get --browser 1 --json
```

Policy write commands exist but may be disabled by command policy:

```powershell
portus-browser policy allow add https://example.com --browser 1 --reason "User approved" --json
portus-browser policy block add https://example.com --browser 1 --reason "User requested block" --json
portus-browser policy retention set 25 --browser 1 --json
```

Do not try to manage Settings profiles through the CLI. Profile management is GUI-only.

## Events And History

Use these when the user asks what happened or wants live activity:

```powershell
portus-browser watch --browser 1 --json
portus-browser events recent --browser 1 --limit 20 --json
portus-browser session steps --browser 1 --limit 20 --json
```

These commands may be disabled by command policy.

## Recipes

Use recipes when the user asks for a saved workflow or when a named workflow may already exist:

```powershell
portus-browser recipes list --json
portus-browser recipes search "hotel reviews" --json
portus-browser recipes use <recipe-id-or-query> --json
```

After reading a recipe, execute normal Portus CLI browser commands. Recipes do not directly operate the browser by themselves.

## Common Workflows

Open and inspect a page:

```powershell
portus-browser browsers --json
portus-browser open https://example.com --browser 1 --json
portus-browser wait --browser 1 --tab-id <tabId> --state complete --json
portus-browser snapshot --browser 1 --tab-id <tabId> --json
```

Click a known button:

```powershell
portus-browser snapshot --browser 1 --tab-id <tabId> --role button --query "continue" --json
portus-browser click --browser 1 --tab-id <tabId> --snapshot <snapshotId> --element <elementId> --json
portus-browser wait --browser 1 --tab-id <tabId> --state complete --json
```

Fill a form:

```powershell
portus-browser snapshot --browser 1 --tab-id <tabId> --role textbox --query "email" --json
portus-browser type --browser 1 --tab-id <tabId> --snapshot <snapshotId> --element <emailElementId> "user@example.com" --json
portus-browser snapshot --browser 1 --tab-id <tabId> --role textbox --query "password" --json
portus-browser type --browser 1 --tab-id <tabId> --snapshot <snapshotId> --element <passwordElementId> "<password>" --json
```

Search result selection:

1. Open or navigate to search page.
2. Search or type query.
3. Wait for result text.
4. Take a filtered snapshot with `--role link --query <domain-or-title>`.
5. Click the exact result from the fresh snapshot.
6. Verify the final URL or page text.

## Error Recovery

When a command returns an error, preserve the exact error code and message in your response.

Common next steps:

- `BROKER_UNAVAILABLE`: ask the user to start Portus Broker.
- `BROWSER_SESSION_UNAVAILABLE`: ask the user to connect a browser Bridge.
- `BRIDGE_DISCONNECTED`: ask the user to connect the extension Bridge.
- `COMMAND_DISABLED_BY_POLICY`: tell the user the command is disabled in Settings.
- `ORIGIN_BLOCKED`: tell the user the active policy blocked the origin.
- `PERMISSION_REQUIRED`: tell the user browser host permission is required.
- `TAB_NOT_FOUND`: refresh `tabs` and target a current tab id.
- `TARGET_NOT_FOUND`: refresh `browsers` or `tabs`, then retry with current ids.
- `COMMAND_TIMEOUT`: verify page state, then retry only if the action is safe.
- `SNAPSHOT_STALE`: take a new snapshot and select the target again.

Do not silently bypass policy, ask the user to weaken settings, or switch to unrelated automation unless the user explicitly asks.

## Safety Rules

- Do not submit forms, purchases, payments, account changes, or destructive actions without clear user approval.
- Do not enter passwords, tokens, payment data, or personal data unless the user explicitly provided it for that destination.
- Prefer `dismiss --dry-run` before ambiguous popup dismissal.
- Prefer conservative cookie dismissal.
- If visual state matters, verify with screenshot or fresh snapshot before claiming completion.
- If manual user action is needed, say exactly what the user must do and stop.
