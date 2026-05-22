# Agent Skill

Portus Browser includes a skill that teaches an AI agent how to use the `portus-browser` CLI.

The skill is stored at:

```text
skills/portus-browser
```

## Install The Skill

After the public repo is available on GitHub, install it with:

```powershell
npx skills add https://github.com/PerceivingAI/portus-browser/tree/main/skills/portus-browser
```

If your agent tool uses a different skill installer, point it at the same repo path:

```text
https://github.com/PerceivingAI/portus-browser/tree/main/skills/portus-browser
```

## What The Skill Teaches

The skill tells an agent to:

- start with `portus-browser browsers --json`
- use JSON output
- choose the correct browser when more than one browser is connected
- keep separate browser, tab, snapshot, and element IDs
- use snapshots before actions
- verify actions with waits, screenshots, or new snapshots
- respect current browser settings and policies
- avoid switching or editing GUI settings profiles from the CLI

## What The Skill Does Not Do

The skill does not install Portus Browser.

The user still needs to:

- build the repo
- load the extension
- install native hosts
- connect the Bridge

The skill only helps the agent operate Portus Browser correctly after setup.

