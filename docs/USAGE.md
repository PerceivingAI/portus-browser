# Using Portus Browser

The CLI command is:

```powershell
portus-browser
```

From the source repo, you can run it through Node:

```powershell
node apps/portus-browser-cli/dist/index.js <command>
```

## First Check

List connected browsers:

```powershell
node apps/portus-browser-cli/dist/index.js browsers --json
```

If no browser is listed, open the extension popup and connect the Bridge.

## Multi-Browser Work

Portus Browser can work with multiple visible browser sessions at the same time.

Example:

- Chrome is connected.
- Edge is connected.
- Brave is connected.
- The agent chooses the target browser with `--browser`.

Always list browsers before choosing a target:

```powershell
node apps/portus-browser-cli/dist/index.js browsers --json
```

Use the browser ID from that output:

```powershell
node apps/portus-browser-cli/dist/index.js tabs --browser <browser-id> --json
```

Display indexes such as `--browser 1` are useful for quick work, but browser IDs are better for longer tasks.

## Common Commands

Open a page:

```powershell
node apps/portus-browser-cli/dist/index.js open https://example.com --browser <browser-id> --json
```

List tabs:

```powershell
node apps/portus-browser-cli/dist/index.js tabs --browser <browser-id> --json
```

Navigate an existing tab:

```powershell
node apps/portus-browser-cli/dist/index.js navigate https://example.com --browser <browser-id> --tab-id <tab-id> --json
```

Wait for a page:

```powershell
node apps/portus-browser-cli/dist/index.js wait --browser <browser-id> --tab-id <tab-id> --state complete --json
```

Take a snapshot:

```powershell
node apps/portus-browser-cli/dist/index.js snapshot --browser <browser-id> --tab-id <tab-id> --json
```

Click an element from a snapshot:

```powershell
node apps/portus-browser-cli/dist/index.js click --browser <browser-id> --tab-id <tab-id> --snapshot <snapshot-id> --element <element-id> --json
```

Type text:

```powershell
node apps/portus-browser-cli/dist/index.js type --browser <browser-id> --tab-id <tab-id> --snapshot <snapshot-id> --element <element-id> "text" --json
```

Take a screenshot:

```powershell
node apps/portus-browser-cli/dist/index.js screenshot --browser <browser-id> --tab-id <tab-id> --json
```

## Rules For Agents

- Use `--json`.
- Choose a browser explicitly when more than one browser is connected.
- Keep browser IDs, tab IDs, snapshot IDs, and element IDs separate per browser.
- Do not reuse an element ID after the page changes. Take a new snapshot.
- Do not use the CLI to edit settings profiles. Profiles are GUI-managed.
- The CLI uses the current effective settings of the target browser session.

## Terminal View

The Settings view includes Terminal settings.

The startup command is optional. The field label is `Startup Command (Optional)`. A valid example is `codex`.

If the startup command is empty, Portus starts the selected terminal without sending a startup command.

