# Settings Profiles

Settings profiles are central to multi-browser and multi-window use.

They let the user keep different security and terminal settings without deleting values every time they change tasks.

## What A Profile Contains

A settings profile's content contains the user-modifiable values in the Settings view:

- auto-save setting
- terminal enable setting
- selected terminal
- manual terminal path
- optional startup command
- origin policy enable setting
- allowlist URLs
- blocklist URLs
- command policy settings
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

## Origin Policy

Origin Policy is the agent-authorization boundary for URL access.

The Extension permanently has Chrome host access for normal web pages through `"<all_urls>"`. Portus does not maintain a second site-by-site Chrome permission model and does not request or revoke host access when policy lists change.

The Settings view includes:

- `Enable Policies`
- `Clear URLs`
- `Blocklist` and `Allowlist` modes
- Allowed and Blocked origin lists
- per-command controls under `CLI Commands`

`Enable Policies` is on by default. In blocklist mode, an origin is allowed unless it matches the Blocked list. In allowlist mode, an origin is blocked unless it matches the Allowed list. Turning policy off bypasses both URL lists without deleting them or disabling command policy.

The popup and Settings view report the current origin as `Agent Access`: `allowed`, `blocked`, `disabled`, or `unsupported`.

`Clear URLs` clears all URLs from the currently selected allow or block list after confirmation. These settings are part of the active settings profile.

## Rename And Delete

Custom profiles can be renamed and deleted from the GUI.

`Default_Profile` cannot be renamed or deleted.

Deleting profiles is manual only.

Resetting or restoring defaults does not rename or delete a profile. It only resets the current profile's setting values.

Renaming and deleting profiles cannot be done through the CLI.

## Import And Export

Settings import and export work with profiles.

Export includes the profile catalog and profile names.

Import accepts the profile catalog shape used by the current app.

