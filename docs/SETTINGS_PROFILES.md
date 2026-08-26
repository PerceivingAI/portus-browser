# Settings Profiles

Settings profiles are central to multi-browser and multi-window use.

They let the user keep different security, interaction, panel, and terminal settings without deleting values every time they change tasks.

## What A Profile Contains

A settings profile's content contains the user-modifiable values in the Settings view:

- auto-save setting
- terminal enable setting
- selected terminal
- manual terminal path
- optional startup command
- navigation policy enable setting
- allowed navigation rules
- blocked navigation rules
- command policy settings
- Advanced Debugger Backend preference
- retention settings
- panel and extension-icon preferences

The active profile selection and profile name are profile metadata, not values nested inside the profile content.

The only forgiving setting when applying a profile is the selected terminal. A profile can name a terminal that does not exist on another computer. In that case, the UI can fall back to an available terminal. The profile content still stores the original terminal setting.

## Built-In Profiles

Portus ships with:

- `Default_Profile`
- `Profile_1`

`Default_Profile` is read-only and contains default values.

`Profile_1` is active by default and also starts with default values. The user can edit it immediately.

The startup command default is empty for both built-in profiles.

## Auto-Save And Save

The Settings view has:

- a profile dropdown
- an `Auto-save` checkbox
- a `Save` button

Auto-save is part of the active profile.

If Auto-save is on, changes to a custom profile save immediately.

If Auto-save is off, changes are used by the current browser instance but are not saved until the user clicks Save.

Unsaved local changes do not propagate to other windows or browser types.

## Default_Profile Behavior

`Default_Profile` cannot be edited.

If the user selects `Default_Profile`, the UI applies default values.

If the user changes a setting while `Default_Profile` is active, Portus creates the next available custom profile name, such as `Profile_2`, and the edit applies there.

## Browser Type Sync

Active profile selection is synced by browser type.

Examples:

- Chrome window 1 and Chrome window 2 share the active Chrome profile selection.
- Edge has its own active Edge profile selection.
- Brave has its own active Brave profile selection.

Changing the active profile in Chrome does not force Edge or Brave to switch active profiles.

## Saved Profile Content Sync

Saved profile content is Broker-owned.

If Chrome and Edge are both using `Profile_2`, and Edge saves a change to `Profile_2`, Chrome receives the saved `Profile_2` content because it is using that same profile.

If Chrome has unsaved local changes, those unsaved changes are not part of the saved profile until the user saves.

The Broker does not use profile management as a separate runtime policy system. Runtime commands use the current effective settings of the target browser session.

## Navigation Policy

Navigation Policy is the user-controlled agent-authorization boundary for browser URLs.

The Extension permanently has Chrome host access for normal web pages through `"<all_urls>"`. Portus does not maintain a second site-by-site Chrome permission model and does not request or revoke host access when policy rules change.

The Settings view includes:

- `Enable Policy`
- `Clear Rules`
- `Blocklist` and `Allowlist` modes
- a `Match` selector and `Value` field
- Allowed and Blocked rule lists
- per-command controls under `CLI Commands`

Rule match types are:

- `Scheme`: every URL with the selected scheme, such as `file:`
- `Authority`: every URL with the selected scheme, host, and port, such as `https://example.com`
- `Host Wildcard`: an apex host and its subdomains, optionally constrained to a scheme, such as `*.example.com` or `https://*.example.com`
- `Exact URL`: one complete normalized URL, such as `chrome://settings/`
- `URL Prefix`: every normalized URL beginning with a value, such as `file:///C:/Projects/`

Portus does not impose a built-in HTTP(S)-only or scheme allowlist. The user controls the rules, and the browser remains the final authority on URLs it supports or protects.

`Enable Policy` is on by default. In blocklist mode, a URL is allowed unless it matches a Blocked rule. In allowlist mode, a URL is blocked unless it matches an Allowed rule. Turning navigation policy off bypasses both rule lists without deleting them or disabling command policy.

The popup and Settings view report `Agent Access` for the current URL as `allowed`, `blocked`, `disabled`, or `unsupported`.

`Clear Rules` clears the currently selected allow or block rule list after confirmation. These settings are part of the active settings profile.

## Advanced Debugger Backend

The Settings view includes **Advanced Debugger Backend** with the **Prefer Debugger/CDP Backend** preference. It is off by default and is stored in the active settings profile.

When enabled, Portus prefers browser-level CDP input for supported top-level actions such as click, hover, targeted key presses, text entry, scrolling, and same-document drag. This can provide interaction behavior closer to real browser input.

The preference does not force every action through CDP. Portus deliberately keeps child-frame actions and cases that require exact DOM semantics on the Shadow-aware DOM backend. Inaccessible closed Shadow DOM can use the debugger as a specialized reachability fallback when normal closed-root access is unavailable. Explicit debugger operations, such as debugger-backed screenshots and native browser-dialog handling, do not depend on this preference.

Chrome may show debugger-style warnings while CDP is attached. Turning the preference off returns eligible ordinary actions to their normal DOM behavior; it does not disable Portus snapshots, regular actions, or explicit debugger commands.

## Rename And Delete

Custom profiles can be renamed and deleted from the GUI.

`Default_Profile` cannot be renamed or deleted.

Deleting profiles is manual only.

Resetting or restoring defaults does not rename or delete a profile. It only resets the current profile's setting values.

Renaming and deleting profiles cannot be done through the CLI.

## Import And Export

Settings import and export work with profiles.

Export includes the profile catalog and profile names.

Import accepts the version 2 profile catalog shape used by the current app. Portus migrates persisted version 1 origin lists to version 2 authority and wildcard-host navigation rules when loading existing local state.

