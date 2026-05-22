import type { CommandType } from "@portus/protocol";

export const commandGroups: Array<{ title: string; commands: Array<{ type: CommandType; label: string }> }> = [
  {
    title: "Navigation",
    commands: [
      { type: "browser.list", label: "List Browsers" },
      { type: "tab.list", label: "List Tabs" },
      { type: "tab.get", label: "Read Tab" },
      { type: "tab.open", label: "Open URL" },
      { type: "tab.navigate", label: "Navigate Tab" },
      { type: "tab.history.back", label: "Back" },
      { type: "tab.history.forward", label: "Forward" },
      { type: "tab.wait", label: "Wait for Tab" },
      { type: "tab.activate", label: "Activate Tab" },
      { type: "tab.close", label: "Close Tab" }
    ]
  },
  {
    title: "Page Actions",
    commands: [
      { type: "action.click", label: "Click" },
      { type: "action.hover", label: "Hover" },
      { type: "action.drag", label: "Drag" },
      { type: "action.fillForm", label: "Fill Form" },
      { type: "action.type", label: "Type" },
      { type: "action.press", label: "Press Key" },
      { type: "action.scroll", label: "Scroll" },
      { type: "page.dismiss", label: "Dismiss Popups" }
    ]
  },
  {
    title: "Page Inspection",
    commands: [
      { type: "screenshot.capture", label: "Screenshot" },
      { type: "snapshot.capture", label: "Snapshot" },
      { type: "page.wait", label: "Wait for Page" }
    ]
  },
  {
    title: "Recipes",
    commands: [
      { type: "recipe.list", label: "List Recipes" },
      { type: "recipe.get", label: "Get Recipe" },
      { type: "recipe.search", label: "Search Recipes" },
      { type: "recipe.resolve", label: "Resolve Recipe" }
    ]
  },
  {
    title: "Events",
    commands: [
      { type: "event.subscribe", label: "Watch Live Events" },
      { type: "events.recent", label: "Read Recent Events" },
      { type: "session.steps", label: "Read Session Steps" }
    ]
  },
  {
    title: "Portus Policy",
    commands: [
      { type: "policy.block.add", label: "Add Block Origin" },
      { type: "policy.block.remove", label: "Remove Block Origin" },
      { type: "policy.allow.add", label: "Add Allow Origin" },
      { type: "policy.allow.remove", label: "Remove Allow Origin" },
      { type: "policy.retention.set", label: "Set Session Steps" },
      { type: "policy.get", label: "Read Policy" }
    ]
  },
  {
    title: "Chrome Permissions",
    commands: [
      { type: "permission.list", label: "List Permissions" }
    ]
  },
  {
    title: "Bridge",
    commands: [
      { type: "bridge.disconnect", label: "Disconnect Bridge From CLI" }
    ]
  },
  {
    title: "Dialogs",
    commands: [
      { type: "dialog.dismiss", label: "Dismiss Dialogs" },
      { type: "dialog.accept", label: "Accept Dialogs" }
    ]
  },
  {
    title: "Diagnostics",
    commands: [
      { type: "console.list", label: "List Console" },
      { type: "console.clear", label: "Clear Console" },
      { type: "network.list", label: "List Network" },
      { type: "network.get", label: "Read Network Request" }
    ]
  }
];
