# Troubleshooting

## The CLI Shows No Browsers

Check:

1. `pnpm build` completed successfully.
2. The Broker is running, or the native host can auto-start it.
3. The extension is loaded from `apps/portus-extension`.
4. The extension Bridge is connected.
5. Native host registration was applied for that browser type.
6. The browser was restarted or the extension was reloaded after native host registration.

Start the Broker manually:

```powershell
node apps/portus-broker/dist/index.js
```

Check Broker status from another terminal:

```powershell
node apps/portus-browser-cli/dist/index.js broker status --json
```

Run:

```powershell
node installers/dev/dist/index.js diagnose --browser chrome --extension-id <extension-id>
```

Use the correct `--browser` value and extension ID for the target browser.

## Native Host Diagnostics Fail

Run `pnpm build` again.

The installer expects built files under:

- `apps/portus-native-host/dist`
- `apps/portus-terminal/dist`

Then rerun:

```powershell
node installers/dev/dist/index.js apply --browser chrome --extension-id <extension-id>
node installers/dev/dist/index.js diagnose --browser chrome --extension-id <extension-id>
```

## Multiple Browsers Are Connected

Always choose the browser explicitly:

```powershell
node apps/portus-browser-cli/dist/index.js browsers --json
node apps/portus-browser-cli/dist/index.js tabs --browser <browser-id> --json
```

Do not assume `--browser 1` is still the same browser after windows open or close.

## Settings Look Wrong In One Browser

Check which profile is active in that browser's popup or Settings view.

Remember:

- active profile selection syncs by browser type
- saved profile content syncs by profile
- unsaved local changes do not propagate
- `Default_Profile` is read-only

## Startup Command Runs When It Should Not

The default startup command is empty.

In Settings, leave `Startup Command (Optional)` empty if no command should run when a terminal starts.

Use a value such as `codex` only when you want Portus to send that startup command to the terminal.
