import * as React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_COMMAND_POLICY, type CommandType } from "@portus/protocol";
import type { PortusExtensionStatus } from "../../src/index.js";

const runtimeMock = vi.hoisted(() => ({
  controller: null as GuiRuntimeController | null
}));

vi.mock("../../src/gui/chromeApi.js", () => ({
  closeSidePanelFromPopupGesture: () => runtimeMock.controller?.closeSidePanelFromPopupGesture(),
  closeWindow: () => runtimeMock.controller?.closeWindow(),
  connectRuntimePort: (name: string) => runtimeMock.controller?.connectRuntimePort(name),
  isRecord: (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value),
  openSidePanelFromPopupGesture: () => runtimeMock.controller?.openSidePanelFromPopupGesture(),
  readLocalStorageValue: (key: string) => runtimeMock.controller?.readLocalStorageValue(key),
  readStatus: (response: RuntimeSuccess) => {
    if (!response.result.status) throw new Error("Extension response did not include status.");
    return response.result.status;
  },
  readStatusMessage: (message: unknown) => {
    if (!isRecord(message) || message.type !== "portus.status.updated" || !isRecord(message.status)) return null;
    return message.status as PortusExtensionStatus;
  },
  sendRuntimeMessage: (message: Record<string, unknown>) => runtimeMock.controller?.sendRuntimeMessage(message)
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class TerminalStub {
    loadAddon(): void {}
    open(): void {}
    write(): void {}
    dispose(): void {}
    onData(): { dispose(): void } {
      return { dispose: () => undefined };
    }
    onResize(): { dispose(): void } {
      return { dispose: () => undefined };
    }
  }
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddonStub {
    fit(): void {}
  }
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class WebLinksAddonStub {}
}));

import { PopupApp } from "../../src/popup.js";
import { SidePanelApp } from "../../src/sidepanel.js";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.body.removeAttribute("data-scroll-locked");
  document.body.style.pointerEvents = "";
  runtimeMock.controller = null;
  vi.clearAllMocks();
});

beforeEach(() => {
  runtimeMock.controller = new GuiRuntimeController();
});

describe("Settings view rendered GUI", () => {
  test("renders Settings between Bridge and Panel with profile controls", async () => {
    render(<SidePanelApp />);

    const bridgeHeading = await screen.findByRole("heading", { name: "Bridge" });
    const settingsHeading = screen.getByRole("heading", { name: "Settings" });
    const panelHeading = screen.getByRole("heading", { name: "Panel" });

    expect(bridgeHeading.compareDocumentPosition(settingsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(settingsHeading.compareDocumentPosition(panelHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText("Profiles")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Auto-save" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Terminal" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Enable Terminal" })).toBeChecked();
    expect(screen.getAllByRole("button", { name: "Defaults" }).length).toBeGreaterThanOrEqual(1);
  });

  test("selects existing profiles and creates the next profile from the dropdown", async () => {
    const user = userEvent.setup();
    runtime().setStatus(createStatus({
      profiles: [
        profile("profile_default", "Default_Profile", true),
        profile("profile_1", "Profile_1"),
        profile("profile_2", "Work_Profile")
      ]
    }));
    render(<SidePanelApp />);

    await selectProfile(user, "Work_Profile");
    expect(runtime().messages).toContainEqual({ type: "portus.settings-profile.select", profileId: "profile_2" });
    expect(screen.getByRole("combobox", { name: "Profile" })).toHaveTextContent("Work_Profile");

    await selectProfile(user, "+");
    expect(runtime().messages).toContainEqual({ type: "portus.settings-profile.create" });
    expect(screen.getByRole("combobox", { name: "Profile" })).toHaveTextContent("Profile_2");
  });

  test("disables profile creation at the custom profile limit", async () => {
    const user = userEvent.setup();
    runtime().setStatus(createStatus({
      profiles: [
        profile("profile_default", "Default_Profile", true),
        ...Array.from({ length: 10 }, (_, index) => profile(`profile_${index + 1}`, `Profile_${index + 1}`))
      ],
      activeProfileId: "profile_10",
      maxCustomProfiles: 10
    }));
    render(<SidePanelApp />);

    const combo = await screen.findByRole("combobox", { name: "Profile" });
    await user.hover(combo);
    expect((await screen.findAllByText("Maximum of 10 profiles reached")).length).toBeGreaterThan(0);
    await user.click(combo);

    expect(screen.getByRole("option", { name: "+" })).toHaveAttribute("data-disabled");
  });

  test("uses auto-save and dirty state from the rendered controls", async () => {
    const user = userEvent.setup();
    render(<SidePanelApp />);

    await user.click(await screen.findByRole("checkbox", { name: "Auto-save" }));
    expect(runtime().messages).toContainEqual({ type: "portus.settings-profile.auto-save.set", enabled: false });
    expect(screen.getByRole("checkbox", { name: "Auto-save" })).not.toBeChecked();

    const retention = screen.getByLabelText("Retained Steps");
    await user.clear(retention);
    await user.type(retention, "44");
    await user.tab();

    expect(runtime().messages).toContainEqual({ type: "portus.policy.retention.set", limit: 44 });
    expect(screen.getByRole("combobox", { name: "Profile" })).toHaveTextContent("Profile_1*");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(runtime().messages).toContainEqual({ type: "portus.settings-profile.save" });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Profile" })).toHaveTextContent("Profile_1"));
  });

  test("keeps Default_Profile read-only and moves edits to the next custom profile", async () => {
    const user = userEvent.setup();
    runtime().setStatus(createStatus({ activeProfileId: "profile_default" }));
    render(<SidePanelApp />);

    expect(await screen.findByRole("combobox", { name: "Profile" })).toHaveTextContent("Default_Profile");
    expect(screen.getByRole("checkbox", { name: "Auto-save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();

    const retention = screen.getByLabelText("Retained Steps");
    await user.clear(retention);
    await user.type(retention, "31");
    await user.tab();

    expect(runtime().messages).toContainEqual({ type: "portus.policy.retention.set", limit: 31 });
    expect(screen.getByRole("combobox", { name: "Profile" })).toHaveTextContent("Profile_2");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Auto-save" })).toBeEnabled();
  });

  test("renames a custom profile without changing settings content or dirty state", async () => {
    const user = userEvent.setup();
    runtime().setStatus(createStatus({
      policyPreferences: { sessionStepRetentionLimit: 77 },
      profiles: [
        profile("profile_default", "Default_Profile", true),
        profile("profile_1", "Profile_1"),
        profile("profile_2", "Duplicate")
      ]
    }));
    render(<SidePanelApp />);

    await user.click(await screen.findByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename Profile" });
    const input = within(dialog).getByLabelText("Profile Name");
    expect(input).toHaveValue("Profile_1");

    await user.clear(input);
    await user.type(input, "Duplicate");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.getByText("Profile name already exists.")).toBeInTheDocument();
    expect(runtime().messages.some((message) => message.type === "portus.settings-profile.rename")).toBe(false);

    await user.clear(input);
    await user.type(input, "Work_Profile");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(runtime().messages).toContainEqual({ type: "portus.settings-profile.rename", name: "Work_Profile" });
    expect(screen.getByRole("combobox", { name: "Profile" })).toHaveTextContent("Work_Profile");
    expect(screen.getByLabelText("Retained Steps")).toHaveValue(77);
    expect(screen.getByRole("combobox", { name: "Profile" })).not.toHaveTextContent("*");
    expect(runtime().status.settingsProfiles.profiles).toHaveLength(3);
  });

  test("deletes only through explicit confirmation and falls back to a remaining custom profile", async () => {
    const user = userEvent.setup();
    runtime().setStatus(createStatus({
      activeProfileId: "profile_2",
      profiles: [
        profile("profile_default", "Default_Profile", true),
        profile("profile_1", "Profile_1"),
        profile("profile_2", "Work_Profile")
      ]
    }));
    render(<SidePanelApp />);

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog", { name: "Delete Work_Profile?" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(runtime().messages.some((message) => message.type === "portus.settings-profile.delete")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete Profile" }));

    expect(runtime().messages).toContainEqual({ type: "portus.settings-profile.delete" });
    expect(screen.getByRole("combobox", { name: "Profile" })).toHaveTextContent("Profile_1");
    expect(runtime().status.settingsProfiles.profiles.some((item) => item.profileId === "profile_2")).toBe(false);
  });

  test("Restore Defaults resets values without renaming or deleting profiles", async () => {
    const user = userEvent.setup();
    runtime().setStatus(createStatus({
      activeProfileName: "Work_Profile",
      policyPreferences: { sessionStepRetentionLimit: 77 },
      profiles: [
        profile("profile_default", "Default_Profile", true),
        profile("profile_1", "Work_Profile")
      ]
    }));
    render(<SidePanelApp />);

    await user.click(await screen.findByRole("button", { name: "Restore Defaults" }));

    expect(runtime().messages).toContainEqual({ type: "portus.settings.reset" });
    expect(screen.getByRole("combobox", { name: "Profile" })).toHaveTextContent("Work_Profile");
    expect(screen.getByLabelText("Retained Steps")).toHaveValue(10);
    expect(runtime().status.settingsProfiles.profiles).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("Work_Profile reset to default values.");
  });

  test("Origin Policy enable and Clear URLs controls are wired through confirmation", async () => {
    const user = userEvent.setup();
    runtime().setStatus(createStatus({
      policyPreferences: {
        policyMode: "blocklist",
        blockedOrigins: [{ origin: "https://blocked.example", reason: "test", createdAt: "2026-05-21T00:00:00.000Z" }],
        allowedOrigins: [{ origin: "https://allowed.example", reason: "test", createdAt: "2026-05-21T00:00:00.000Z" }]
      }
    }));
    render(<SidePanelApp />);

    await user.click(await screen.findByRole("checkbox", { name: "Enable Policies" }));
    expect(runtime().messages).toContainEqual({ type: "portus.policy.enabled.set", enabled: false });
    expect(screen.getByText("https://blocked.example")).toBeInTheDocument();
    expect(screen.getByText("https://allowed.example")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear URLs" }));
    expect(screen.getByRole("dialog", { name: "Clear 1 blocklist URL?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear URLs" }));

    expect(runtime().messages).toContainEqual({ type: "portus.policy.block.clear" });
    expect(screen.queryByText("https://blocked.example")).not.toBeInTheDocument();
    expect(screen.getByText("https://allowed.example")).toBeInTheDocument();
  });

  test("command policy controls remain independent from Enable Policies", async () => {
    const user = userEvent.setup();
    render(<SidePanelApp />);

    await user.click(await screen.findByRole("button", { name: "Navigation" }));
    const openUrl = screen.getByRole("checkbox", { name: "Open URL" });
    expect(openUrl).toBeEnabled();

    await user.click(screen.getByRole("checkbox", { name: "Enable Policies" }));
    expect(runtime().messages).toContainEqual({ type: "portus.policy.enabled.set", enabled: false });
    expect(openUrl).toBeEnabled();

    await user.click(openUrl);
    expect(runtime().messages).toContainEqual({
      type: "portus.command-policy.set",
      commandType: "tab.open",
      enabled: false
    });
  });

  test("terminal Settings controls save profile-owned terminal settings", async () => {
    const user = userEvent.setup();
    render(<SidePanelApp />);

    await user.click(await screen.findByRole("checkbox", { name: "Enable Terminal" }));
    expect(runtime().messages.some((message) => (
      message.type === "portus.terminal.settings.set"
      && isRecord(message.settings)
      && message.settings.enabled === false
    ))).toBe(true);

    const manualPath = screen.getByLabelText("Terminal Path");
    await user.type(manualPath, "C:\\Tools\\terminal.exe");
    await user.tab();

    expect(runtime().messages.some((message) => (
      message.type === "portus.terminal.settings.set"
      && isRecord(message.settings)
      && message.settings.manualTerminalPath === "C:\\Tools\\terminal.exe"
    ))).toBe(true);
    expect(runtime().status.policyPreferences.sessionStepRetentionLimit).toBe(10);
  });

  test("exports settings through the profile catalog shape from the rendered button", async () => {
    const user = userEvent.setup();
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:portus-settings");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<SidePanelApp />);

    await user.click(await screen.findByRole("button", { name: "Export Settings" }));

    expect(runtime().messages).toContainEqual({ type: "portus.settings.export" });
    expect(runtime().lastExport?.kind).toBe("portus.settingsProfiles");
    expect(runtime().lastExport?.catalog.profiles.map((item) => item.name)).toContain("Profile_1");
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:portus-settings");
    expect(anchorClick).toHaveBeenCalledOnce();
  });
});

describe("popup profile controls", () => {
  test("renders the minimal profile selector without management controls", async () => {
    render(<PopupApp />);

    expect(await screen.findByRole("button", { name: "Open Panel" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Profile" })).toHaveTextContent("Profile_1");
    expect(screen.queryByText("Auto-save")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  test("selects and creates profiles from the popup dropdown", async () => {
    const user = userEvent.setup();
    runtime().setStatus(createStatus({
      profiles: [
        profile("profile_default", "Default_Profile", true),
        profile("profile_1", "Profile_1"),
        profile("profile_2", "Work_Profile")
      ]
    }));
    render(<PopupApp />);

    await selectProfile(user, "Work_Profile");
    expect(runtime().messages).toContainEqual({ type: "portus.settings-profile.select", profileId: "profile_2" });

    await selectProfile(user, "+");
    expect(runtime().messages).toContainEqual({ type: "portus.settings-profile.create" });
    expect(screen.getByRole("combobox", { name: "Profile" })).toHaveTextContent("Profile_2");
  });
});

async function selectProfile(user: ReturnType<typeof userEvent.setup>, optionName: string): Promise<void> {
  await user.click(await screen.findByRole("combobox", { name: "Profile" }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

function runtime(): GuiRuntimeController {
  if (!runtimeMock.controller) throw new Error("Missing GUI runtime test controller.");
  return runtimeMock.controller;
}

interface RuntimeSuccess {
  ok: true;
  result: {
    status?: PortusExtensionStatus;
    settings?: unknown;
    terminal?: unknown;
  };
}

interface ProfileMetadata {
  profileId: string;
  name: string;
  builtIn: boolean;
  readOnly: boolean;
}

interface RuntimePort {
  name: string;
  messages: unknown[];
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void; removeListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void; removeListener(listener: () => void): void };
}

class GuiRuntimeController {
  status: PortusExtensionStatus = createStatus();
  messages: Array<Record<string, unknown>> = [];
  lastExport: { kind: string; catalog: { profiles: ProfileMetadata[]; activeProfileByBrowserType: Record<string, string> } } | null = null;
  private readonly profileContents = new Map<string, SettingsProfileContent>();
  private readonly statusListeners = new Set<(message: unknown) => void>();

  constructor() {
    this.resetProfileContents();
  }

  setStatus(status: PortusExtensionStatus): void {
    this.status = clone(status);
    this.resetProfileContents();
  }

  async sendRuntimeMessage(message: Record<string, unknown>): Promise<RuntimeSuccess> {
    this.messages.push(clone(message));
    switch (message.type) {
      case "portus.status":
        return this.response();
      case "portus.settings-profile.select":
        this.selectProfile(String(message.profileId));
        return this.response();
      case "portus.settings-profile.create":
        this.createProfile();
        return this.response();
      case "portus.settings-profile.auto-save.set":
        this.updateSettingsContent({ autoSave: message.enabled === true }, true);
        this.status.settingsProfiles.autoSave = message.enabled === true;
        this.status.settingsProfiles.dirty = false;
        return this.response();
      case "portus.settings-profile.save":
        this.saveActiveProfile();
        return this.response();
      case "portus.settings-profile.rename":
        this.renameActiveProfile(String(message.name));
        return this.response();
      case "portus.settings-profile.delete":
        this.deleteActiveProfile();
        return this.response();
      case "portus.settings.reset":
        this.resetActiveSettingsProfile();
        return this.response();
      case "portus.policy.enabled.set":
        this.updatePolicy({ originPolicyEnabled: message.enabled === true });
        return this.response();
      case "portus.policy.mode.set":
        this.updatePolicy({ policyMode: message.mode === "allowlist" ? "allowlist" : "blocklist" });
        return this.response();
      case "portus.policy.allow.clear":
        this.updatePolicy({ allowedOrigins: [] });
        return this.response();
      case "portus.policy.block.clear":
        this.updatePolicy({ blockedOrigins: [] });
        return this.response();
      case "portus.policy.retention.set":
        this.updatePolicy({ sessionStepRetentionLimit: Number(message.limit) });
        return this.response();
      case "portus.command-policy.set":
        this.updatePolicy({
          commandPolicy: {
            ...this.status.policyPreferences.commandPolicy,
            [String(message.commandType) as CommandType]: message.enabled === true
          }
        });
        return this.response();
      case "portus.terminal.settings.set": {
        const terminal = { ...defaultTerminalSettings(), ...(isRecord(message.settings) ? message.settings : {}) };
        this.updateTerminal(terminal);
        return this.response({ terminal });
      }
      case "portus.terminal.settings.reset": {
        const terminal = defaultTerminalSettings();
        this.updateTerminal(terminal);
        return this.response({ terminal });
      }
      case "portus.settings.export":
        this.lastExport = {
          kind: "portus.settingsProfiles",
          catalog: {
            profiles: this.status.settingsProfiles.profiles,
            activeProfileByBrowserType: { Chrome: this.status.settingsProfiles.activeProfileId }
          }
        };
        return this.response({
          settings: this.lastExport
        });
      case "portus.bridge.connect":
        this.status.bridgeState = "connected";
        return this.response();
      case "portus.bridge.disconnect":
        this.status.bridgeState = "disconnected";
        return this.response();
      default:
        return this.response();
    }
  }

  connectRuntimePort(name: string): RuntimePort {
    const messageListeners = new Set<(message: unknown) => void>();
    const disconnectListeners = new Set<() => void>();
    const port: RuntimePort = {
      name,
      messages: [],
      postMessage: (message: unknown) => {
        port.messages.push(message);
        if (name !== "portus.terminal" || !isRecord(message) || message.type !== "terminal.profiles.list") return;
        queueMicrotask(() => {
          for (const listener of messageListeners) {
            listener({
              type: "terminal.profiles",
              requestId: message.requestId,
              payload: {
                profiles: [
                  { profileId: "powershell", label: "PowerShell", shell: "pwsh.exe" },
                  { profileId: "cmd", label: "Command Prompt", shell: "cmd.exe" }
                ]
              }
            });
          }
        });
      },
      disconnect: () => {
        for (const listener of disconnectListeners) listener();
      },
      onMessage: {
        addListener: (listener) => {
          messageListeners.add(listener);
          if (name === "portus.status") this.statusListeners.add(listener);
        },
        removeListener: (listener) => {
          messageListeners.delete(listener);
          this.statusListeners.delete(listener);
        }
      },
      onDisconnect: {
        addListener: (listener) => disconnectListeners.add(listener),
        removeListener: (listener) => disconnectListeners.delete(listener)
      }
    };
    return port;
  }

  readLocalStorageValue(): Promise<unknown> {
    return Promise.resolve(undefined);
  }

  openSidePanelFromPopupGesture(): Promise<void> {
    this.status.sidePanelOpen = true;
    return Promise.resolve();
  }

  closeSidePanelFromPopupGesture(): Promise<void> {
    this.status.sidePanelOpen = false;
    return Promise.resolve();
  }

  closeWindow(): void {}

  private response(extra: Record<string, unknown> = {}): RuntimeSuccess {
    const status = clone(this.status);
    return { ok: true, result: { ...extra, status } };
  }

  private resetProfileContents(): void {
    this.profileContents.clear();
    for (const metadata of this.status.settingsProfiles.profiles) {
      const content = metadata.profileId === this.status.settingsProfiles.activeProfileId
        ? this.status.settingsProfiles.content
        : defaultSettingsContent();
      this.profileContents.set(metadata.profileId, clone(content));
    }
  }

  private selectProfile(profileId: string): void {
    const metadata = this.status.settingsProfiles.profiles.find((item) => item.profileId === profileId);
    if (!metadata) return;
    const content = this.profileContents.get(profileId) ?? defaultSettingsContent();
    this.applyActiveProfile(metadata, content, false);
  }

  private createProfile(): void {
    const name = nextProfileName(this.status.settingsProfiles.profiles);
    const profileId = nextProfileId(this.status.settingsProfiles.profiles);
    const metadata = profile(profileId, name);
    this.status.settingsProfiles.profiles = [...this.status.settingsProfiles.profiles, metadata];
    const content = defaultSettingsContent();
    this.profileContents.set(profileId, content);
    this.applyActiveProfile(metadata, content, false);
    this.refreshCanCreateProfile();
  }

  private renameActiveProfile(name: string): void {
    if (this.status.settingsProfiles.activeProfileReadOnly) return;
    this.status.settingsProfiles.profiles = this.status.settingsProfiles.profiles.map((item) => (
      item.profileId === this.status.settingsProfiles.activeProfileId ? { ...item, name } : item
    ));
    this.status.settingsProfiles.activeProfileName = name;
  }

  private deleteActiveProfile(): void {
    if (this.status.settingsProfiles.activeProfileReadOnly) return;
    const remainingCustom = this.status.settingsProfiles.profiles.filter((item) => !item.readOnly && item.profileId !== this.status.settingsProfiles.activeProfileId);
    if (remainingCustom.length === 0) return;
    const deletedProfileId = this.status.settingsProfiles.activeProfileId;
    this.status.settingsProfiles.profiles = this.status.settingsProfiles.profiles.filter((item) => item.profileId !== deletedProfileId);
    this.profileContents.delete(deletedProfileId);
    this.selectProfile(remainingCustom[0]?.profileId ?? "profile_1");
    this.refreshCanCreateProfile();
  }

  private saveActiveProfile(): void {
    this.profileContents.set(this.status.settingsProfiles.activeProfileId, clone(this.status.settingsProfiles.content));
    this.status.settingsProfiles.dirty = false;
  }

  private resetActiveSettingsProfile(): void {
    if (this.status.settingsProfiles.activeProfileReadOnly) return;
    const content = defaultSettingsContent();
    this.status.settingsProfiles.content = content;
    this.status.settingsProfiles.autoSave = content.autoSave;
    this.status.settingsProfiles.dirty = false;
    this.profileContents.set(this.status.settingsProfiles.activeProfileId, clone(content));
    this.syncTopLevelFromContent(content);
  }

  private updatePolicy(patch: Partial<SettingsProfileContent["policyPreferences"]>): void {
    this.prepareEditableProfile();
    this.updateSettingsContent({
      policyPreferences: {
        ...this.status.policyPreferences,
        ...patch
      }
    });
  }

  private updateTerminal(terminalPreferences: SettingsProfileContent["terminalPreferences"]): void {
    this.prepareEditableProfile();
    this.updateSettingsContent({ terminalPreferences });
  }

  private updateSettingsContent(patch: Partial<SettingsProfileContent>, forceSaved = false): void {
    const content = {
      ...this.status.settingsProfiles.content,
      ...patch,
      policyPreferences: patch.policyPreferences ?? this.status.settingsProfiles.content.policyPreferences,
      uxPreferences: patch.uxPreferences ?? this.status.settingsProfiles.content.uxPreferences,
      terminalPreferences: patch.terminalPreferences ?? this.status.settingsProfiles.content.terminalPreferences
    };
    this.status.settingsProfiles.content = clone(content);
    this.status.settingsProfiles.autoSave = content.autoSave;
    this.syncTopLevelFromContent(content);
    if (content.autoSave || forceSaved) {
      this.status.settingsProfiles.dirty = false;
      this.profileContents.set(this.status.settingsProfiles.activeProfileId, clone(content));
    } else {
      this.status.settingsProfiles.dirty = true;
    }
    this.refreshCanCreateProfile();
  }

  private prepareEditableProfile(): void {
    if (!this.status.settingsProfiles.activeProfileReadOnly) return;
    this.createProfile();
  }

  private applyActiveProfile(metadata: ProfileMetadata, content: SettingsProfileContent, dirty: boolean): void {
    this.status.settingsProfiles.activeProfileId = metadata.profileId;
    this.status.settingsProfiles.activeProfileName = metadata.name;
    this.status.settingsProfiles.activeProfileReadOnly = metadata.readOnly;
    this.status.settingsProfiles.content = clone(content);
    this.status.settingsProfiles.autoSave = content.autoSave;
    this.status.settingsProfiles.dirty = dirty;
    this.syncTopLevelFromContent(content);
    this.refreshCanCreateProfile();
  }

  private syncTopLevelFromContent(content: SettingsProfileContent): void {
    this.status.policyPreferences = clone(content.policyPreferences);
    this.status.uxPreferences = clone(content.uxPreferences);
    this.status.terminalPreferences = clone(content.terminalPreferences);
  }

  private refreshCanCreateProfile(): void {
    const customCount = this.status.settingsProfiles.profiles.filter((item) => !item.readOnly).length;
    this.status.settingsProfiles.canCreateProfile = customCount < this.status.settingsProfiles.maxCustomProfiles;
  }
}

interface SettingsProfileContent {
  policyPreferences: PortusExtensionStatus["policyPreferences"];
  uxPreferences: PortusExtensionStatus["uxPreferences"];
  terminalPreferences: PortusExtensionStatus["terminalPreferences"];
  autoSave: boolean;
}

function createStatus({
  activeProfileId = "profile_1",
  activeProfileName,
  bridgeState = "connected",
  dirty = false,
  maxCustomProfiles = 10,
  policyPreferences = {},
  profiles,
  terminalPreferences = {},
  uxPreferences = {}
}: {
  activeProfileId?: string;
  activeProfileName?: string;
  bridgeState?: PortusExtensionStatus["bridgeState"];
  dirty?: boolean;
  maxCustomProfiles?: number;
  policyPreferences?: Partial<PortusExtensionStatus["policyPreferences"]>;
  profiles?: ProfileMetadata[];
  terminalPreferences?: Partial<PortusExtensionStatus["terminalPreferences"]>;
  uxPreferences?: Partial<PortusExtensionStatus["uxPreferences"]>;
} = {}): PortusExtensionStatus {
  const profileList = profiles ?? [
    profile("profile_default", "Default_Profile", true),
    profile("profile_1", "Profile_1")
  ];
  const activeMetadata = profileList.find((item) => item.profileId === activeProfileId) ?? profileList[1] ?? profileList[0];
  const policy = { ...defaultPolicyPreferences(), ...policyPreferences };
  const ux = { ...defaultUxPreferences(), ...uxPreferences };
  const terminal = { ...defaultTerminalSettings(), ...terminalPreferences };
  const content = {
    policyPreferences: policy,
    uxPreferences: ux,
    terminalPreferences: terminal,
    autoSave: true
  };
  const customCount = profileList.filter((item) => !item.readOnly).length;

  return {
    activeTabOrigin: "https://example.com",
    activeTabUrl: "https://example.com/page",
    allowlist: [],
    bridgeState,
    brokerState: bridgeState === "connected" ? "connected" : "disconnected",
    browserId: bridgeState === "connected" ? "br_test" : null,
    nativeHostName: "com.portus.browser",
    nativeHostState: bridgeState === "connected" ? "connected" : "disconnected",
    permissionState: "granted",
    policyPreferences: policy,
    settingsProfiles: {
      activeProfileId: activeMetadata.profileId,
      activeProfileName: activeProfileName ?? activeMetadata.name,
      activeProfileReadOnly: activeMetadata.readOnly,
      autoSave: content.autoSave,
      canCreateProfile: customCount < maxCustomProfiles,
      content,
      dirty,
      maxCustomProfiles,
      profiles: profileList
    },
    sidePanelOpen: false,
    terminalNativeHostName: "com.portus.browser.terminal",
    terminalNativeHostState: "disconnected",
    terminalPreferences: terminal,
    uxPreferences: ux
  };
}

function profile(profileId: string, name: string, readOnly = false): ProfileMetadata {
  return {
    builtIn: readOnly,
    name,
    profileId,
    readOnly
  };
}

function defaultSettingsContent(): SettingsProfileContent {
  return {
    autoSave: true,
    policyPreferences: defaultPolicyPreferences(),
    terminalPreferences: defaultTerminalSettings(),
    uxPreferences: defaultUxPreferences()
  };
}

function defaultPolicyPreferences(): PortusExtensionStatus["policyPreferences"] {
  return {
    advancedBackendEnabled: false,
    allowedOrigins: [],
    blockedOrigins: [],
    commandPolicy: { ...DEFAULT_COMMAND_POLICY },
    originPolicyEnabled: true,
    policyMode: "blocklist",
    sessionStepRetentionLimit: 10
  };
}

function defaultUxPreferences(): PortusExtensionStatus["uxPreferences"] {
  return {
    defaultPanelView: "settings",
    iconClickBehavior: "popup"
  };
}

function defaultTerminalSettings(): PortusExtensionStatus["terminalPreferences"] {
  return {
    defaultProfileId: "powershell",
    defaultWorkingDirectory: "Downloads/portus-session",
    enabled: true,
    fontSize: 16,
    idleTimeoutMs: 1800000,
    manualTerminalPath: null,
    maxSessions: 5,
    startupCommand: null
  };
}

function nextProfileName(profiles: ProfileMetadata[]): string {
  const names = new Set(profiles.map((item) => item.name));
  for (let index = 1; index <= 100; index += 1) {
    const candidate = `Profile_${index}`;
    if (!names.has(candidate)) return candidate;
  }
  return "Profile_100";
}

function nextProfileId(profiles: ProfileMetadata[]): string {
  const ids = new Set(profiles.map((item) => item.profileId));
  for (let index = 1; index <= 100; index += 1) {
    const candidate = `profile_${index}`;
    if (!ids.has(candidate)) return candidate;
  }
  return "profile_100";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
