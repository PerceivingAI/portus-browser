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

## A Command Is Blocked By Policy

`NAVIGATION_BLOCKED` means the active browser profile's navigation policy denied the destination or current URL. Check the Allowed and Blocked rules, each rule's match type, and the selected blocklist/allowlist mode in Settings.

`COMMAND_DISABLED_BY_POLICY` means that command is disabled under **CLI Commands** in Settings.

`COMMAND_REJECTED_BY_USER` means the command required one-time approval and the pending request was rejected in the Extension UI. `COMMAND_TIMEOUT` can mean that an approval request was not decided before the command timeout. Open the Extension popup or side panel, review the exact browser and sanitized target summary, then approve or reject the pending request. Do not retry a rejected command as a workaround.

Portus does not use a separate Chrome site-permission request workflow. Do not look for a permission prompt or retry a removed `permissions` CLI command.

## File upload is denied

`COMMAND_DISABLED_BY_POLICY` means **Upload Files** is disabled under **CLI Commands** in the active settings profile.

`UPLOAD_PATH_DENIED` means the Broker has no allowed upload roots, the path is missing or is not a regular file, or the resolved path falls outside every allowed root.

Check that:

1. `PORTUS_UPLOAD_ALLOWED_ROOTS` was set in the environment used to start the Broker.
2. Each configured root is an existing absolute directory.
3. The Broker was restarted after changing the environment variable.
4. The selected file resolves under one of those roots.

Do not approve a broader directory than the upload workflow requires.


## Browser Access Is Denied

`BROWSER_ACCESS_DENIED` means the browser or Extension cannot control the target. Protected browser pages, missing tab URLs, unavailable host access, and Chrome API access failures can produce this error.

Select another tab or URL only when doing so still matches the user's intended task. Do not replace a requested non-HTTP(S) URL merely because of its scheme; Portus navigation policy supports user-controlled rules for any browser-supported scheme.

## Startup Command Runs When It Should Not

The default startup command is empty.

In Settings, leave `Startup Command (Optional)` empty if no command should run when a terminal starts.

Use a value such as `codex` only when you want Portus to send that startup command to the terminal.
