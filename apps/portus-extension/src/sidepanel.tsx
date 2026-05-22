import * as React from "react";
import { createRoot } from "react-dom/client";
import { ChevronDownIcon, InfoIcon, PencilIcon, PlusIcon, RefreshCwIcon, SettingsIcon, SquareTerminalIcon, Trash2Icon, XIcon } from "lucide-react";
import { DEFAULT_COMMAND_POLICY, ExtensionUxPreferencesSchema, SETTINGS_PROFILE_CREATE_OPTION, type CommandType, type ExtensionUxPreferences, type PolicyPreferences } from "@portus/protocol";
import {
  TerminalSettingsSchema,
  type TerminalClientMessage,
  type TerminalProfile,
  type TerminalServerMessage,
  type TerminalSessionMetadata,
  type TerminalSettings
} from "@portus/terminal";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import "./sidepanel.css";
import { Accordion, AccordionItem } from "./components/ui/accordion.js";
import { cn } from "./lib/utils.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Checkbox } from "./components/ui/checkbox.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog.js";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./components/ui/field.js";
import { Input } from "./components/ui/input.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import { Textarea } from "./components/ui/textarea.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip.js";
import { commandGroups } from "./gui/commandGroups.js";
import { Diagnostics, NativeRadioGroupField, Section, SelectField, StatusBadge, StatusGrid } from "./gui/components.js";
import { connectRuntimePort, isRecord, readLocalStorageValue, readStatus, readStatusMessage, sendRuntimeMessage, type RuntimePort } from "./gui/chromeApi.js";
import {
  describeOriginPolicy,
  labelForBridgeState,
  labelForPermissionState,
  policyInputForOrigin
} from "./gui/status.js";
import type { PortusExtensionStatus } from "./index.js";

type ViewName = ExtensionUxPreferences["defaultPanelView"];
type PolicyUrlListKind = "allow" | "block";
const TERMINAL_PREFERENCES_STORAGE_KEY = "portus.terminalPreferences";

export function SidePanelApp(): React.JSX.Element {
  const [status, setStatus] = React.useState<PortusExtensionStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [diagnostic, setDiagnostic] = React.useState("Checking Bridge state.");
  const [isError, setIsError] = React.useState(false);
  const [view, setView] = React.useState<ViewName | null>(null);
  const [originInput, setOriginInput] = React.useState("");
  const [includeSubdomains, setIncludeSubdomains] = React.useState(true);
  const [retentionValue, setRetentionValue] = React.useState("10");
  const [terminalPreferencesOverride, setTerminalPreferencesOverride] = React.useState<TerminalSettings | null>(null);

  const applyError = React.useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : "Extension side panel failed.";
    setDiagnostic(message);
    setIsError(true);
  }, []);

  const applyStatus = React.useCallback((nextStatus: PortusExtensionStatus) => {
    setStatus(nextStatus);
    setRetentionValue(String(nextStatus.policyPreferences.sessionStepRetentionLimit));
    setView((current) => current ?? nextStatus.uxPreferences.defaultPanelView);
  }, []);

  const refreshStatus = React.useCallback(async () => {
    setBusy(true);
    setDiagnostic("Checking Bridge state.");
    setIsError(false);
    try {
      const response = await sendRuntimeMessage({ type: "portus.status" });
      applyStatus(readStatus(response));
      setDiagnostic("");
    } catch (error) {
      applyError(error);
    } finally {
      setBusy(false);
    }
  }, [applyError, applyStatus]);

  React.useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  React.useEffect(() => {
    const port = connectRuntimePort("portus.status");
    port.onMessage.addListener((message) => {
      const nextStatus = readStatusMessage(message);
      if (nextStatus) applyStatus(nextStatus);
    });
    return () => port.disconnect();
  }, [applyStatus]);

  React.useEffect(() => {
    if (!diagnostic) return;
    const timeout = globalThis.setTimeout(() => {
      setDiagnostic("");
      setIsError(false);
    }, 3500);
    return () => globalThis.clearTimeout(timeout);
  }, [diagnostic, isError]);

  async function mutateStatus(message: Record<string, unknown>, successMessage: string): Promise<void> {
    setBusy(true);
    setDiagnostic("Saving.");
    setIsError(false);
    try {
      const response = await sendRuntimeMessage(message);
      applyStatus(readStatus(response));
      setDiagnostic(successMessage);
    } catch (error) {
      applyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function mutatePolicy(message: Record<string, unknown>, successMessage: string): Promise<void> {
    await mutateStatus(message, successMessage);
  }

  async function mutateCommandPolicy(commandType: CommandType, enabled: boolean): Promise<void> {
    const previousStatus = status;
    setIsError(false);
    setStatus((current) => {
      if (!current) return current;
      return {
        ...current,
        policyPreferences: {
          ...current.policyPreferences,
          commandPolicy: {
            ...current.policyPreferences.commandPolicy,
            [commandType]: enabled
          }
        }
      };
    });
    try {
      const response = await sendRuntimeMessage({ type: "portus.command-policy.set", commandType, enabled });
      applyStatus(readStatus(response));
    } catch (error) {
      setStatus(previousStatus);
      applyError(error);
    }
  }

  async function mutateUx(message: Record<string, unknown>): Promise<void> {
    setIsError(false);
    try {
      const response = await sendRuntimeMessage(message);
      const uxPreferences = ExtensionUxPreferencesSchema.parse(response.result.ux);
      setStatus((current) => current ? { ...current, uxPreferences } : current);
    } catch (error) {
      applyError(error);
    }
  }

  async function mutateSettings(message: Record<string, unknown>, successMessage: string): Promise<void> {
    await mutateStatus(message, successMessage);
  }

  async function mutateManualOrigins(type: "portus.policy.allow.add" | "portus.policy.block.add", listName: "allowlist" | "blocklist"): Promise<void> {
    const parsed = parseOriginInput(originInput, includeSubdomains);
    if (parsed.origins.length === 0) {
      applyError(new Error("Enter at least one origin first."));
      return;
    }
    setBusy(true);
    setDiagnostic("Saving origins.");
    setIsError(false);
    try {
      let latest: PortusExtensionStatus | null = status;
      for (const origin of parsed.origins) {
        const response = await sendRuntimeMessage({ type, origin, reason: "Portus Browser user policy" });
        latest = readStatus(response);
      }
      if (latest) applyStatus(latest);
      if (parsed.invalid.length === 0) {
        setOriginInput("");
        setDiagnostic(`${parsed.origins.length} ${parsed.origins.length === 1 ? "origin" : "origins"} added to ${listName}.`);
      } else {
        setDiagnostic(`${parsed.origins.length} added to ${listName}. Invalid: ${parsed.invalid.join(", ")}.`);
      }
    } catch (error) {
      applyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefaultCommandPolicy(): Promise<void> {
    setBusy(true);
    setDiagnostic("Saving command defaults.");
    setIsError(false);
    try {
      let latest: PortusExtensionStatus | null = status;
      for (const group of commandGroups) {
        for (const command of group.commands) {
          const enabled = DEFAULT_COMMAND_POLICY[command.type] !== false;
          const response = await sendRuntimeMessage({
            type: "portus.command-policy.set",
            commandType: command.type,
            enabled
          });
          latest = readStatus(response);
        }
      }
      if (latest) applyStatus(latest);
      setDiagnostic("Command defaults restored.");
    } catch (error) {
      applyError(error);
    } finally {
      setBusy(false);
    }
  }

  const bridgeState = status?.bridgeState ?? "unknown";
  const permissionState = status?.permissionState ?? "unknown";
  const bridgeActionType = status?.bridgeState === "connected" ? "portus.bridge.disconnect" : "portus.bridge.connect";
  const activeView = view ?? "terminal";
  const viewToggleLabel = activeView === "terminal" ? "Open Settings" : "Open Terminal";

  return (
    <TooltipProvider delayDuration={250}>
      <main className="portus-panel-root grid h-screen grid-rows-[auto_minmax(0,1fr)_var(--portus-panel-footer-height)] gap-[var(--portus-panel-gap)] p-[var(--portus-panel-padding)]">
        <header className="grid gap-[var(--portus-section-gap)] pb-[var(--portus-section-gap)]">
          <div className="flex items-center justify-between gap-[var(--portus-section-gap)]">
            <div className="flex min-w-0 items-center">
              <StatusBadge label={labelForBridgeState(bridgeState)} state={bridgeState} />
            </div>
            <div className="flex items-center gap-[var(--portus-subsection-gap)]">
              <Button
                disabled={busy}
                onClick={() => {
                  void mutateStatus({ type: bridgeActionType }, bridgeActionType === "portus.bridge.connect" ? "Bridge connected." : "Bridge disconnected.");
                }}
                size="sm"
                type="button"
              >
                {status?.bridgeState === "connected" ? "Disconnect" : "Connect"}
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={viewToggleLabel}
                    onClick={() => setView(activeView === "terminal" ? "settings" : "terminal")}
                    size="icon"
                    type="button"
                    variant="secondary"
                  >
                    {activeView === "terminal" ? <SettingsIcon aria-hidden="true" /> : <SquareTerminalIcon aria-hidden="true" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{viewToggleLabel}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </header>

        <div className={activeView === "terminal" ? "min-h-0 h-full" : "hidden"}>
          <TerminalPanel
            disabled={busy}
            onDiagnostic={(message) => {
              setDiagnostic(message);
              setIsError(false);
            }}
            onError={applyError}
            terminalPreferences={terminalPreferencesOverride}
          />
        </div>
        <div className={activeView === "settings" ? "min-h-0 h-full mx-[calc(var(--portus-panel-padding)*-1)] px-[var(--portus-settings-area-padding-x)]" : "hidden"}>
          <ScrollArea className="h-full min-h-0">
          <SettingsPanel
              busy={busy}
              includeSubdomains={includeSubdomains}
              onIncludeSubdomainsChange={setIncludeSubdomains}
              onOriginInputChange={setOriginInput}
              onRefresh={() => void refreshStatus()}
              onRestoreDefaultCommandPolicy={() => void restoreDefaultCommandPolicy()}
              onTerminalDiagnostic={(message) => {
                setDiagnostic(message);
                setIsError(false);
              }}
              active={activeView === "settings"}
              onTerminalPreferencesChange={(terminalPreferences) => {
                setTerminalPreferencesOverride(terminalPreferences);
                setStatus((current) => current ? { ...current, terminalPreferences } : current);
              }}
              onError={applyError}
              originInput={originInput}
              retentionValue={retentionValue}
              setRetentionValue={setRetentionValue}
              status={status}
              mutateManualOrigins={mutateManualOrigins}
              mutateCommandPolicy={mutateCommandPolicy}
              mutatePolicy={mutatePolicy}
              mutateSettings={mutateSettings}
              mutateUx={mutateUx}
            />
          </ScrollArea>
        </div>

        <Diagnostics error={isError} message={diagnostic} />
      </main>
    </TooltipProvider>
  );
}

function SettingsPanel({
  active,
  busy,
  includeSubdomains,
  mutateManualOrigins,
  mutateCommandPolicy,
  mutatePolicy,
  mutateSettings,
  mutateUx,
  onError,
  onIncludeSubdomainsChange,
  onOriginInputChange,
  onRefresh,
  onRestoreDefaultCommandPolicy,
  onTerminalDiagnostic,
  onTerminalPreferencesChange,
  originInput,
  retentionValue,
  setRetentionValue,
  status
}: {
  active: boolean;
  busy: boolean;
  includeSubdomains: boolean;
  mutateManualOrigins(type: "portus.policy.allow.add" | "portus.policy.block.add", listName: "allowlist" | "blocklist"): Promise<void>;
  mutateCommandPolicy(commandType: CommandType, enabled: boolean): Promise<void>;
  mutatePolicy(message: Record<string, unknown>, successMessage: string): Promise<void>;
  mutateSettings(message: Record<string, unknown>, successMessage: string): Promise<void>;
  mutateUx(message: Record<string, unknown>): Promise<void>;
  onError(error: unknown): void;
  onIncludeSubdomainsChange(value: boolean): void;
  onOriginInputChange(value: string): void;
  onRefresh(): void;
  onRestoreDefaultCommandPolicy(): void;
  onTerminalDiagnostic(message: string): void;
  onTerminalPreferencesChange(terminalPreferences: TerminalSettings): void;
  originInput: string;
  retentionValue: string;
  setRetentionValue(value: string): void;
  status: PortusExtensionStatus | null;
}): React.JSX.Element {
  const policy = status?.policyPreferences;
  const ux = status?.uxPreferences;
  const terminal = status?.terminalPreferences;
  const settingsProfiles = status?.settingsProfiles;
  const profileControlsDisabled = busy || !settingsProfiles || status?.bridgeState !== "connected";
  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const [clearUrlsTarget, setClearUrlsTarget] = React.useState<PolicyUrlListKind | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = React.useState(false);
  const [renameProfileName, setRenameProfileName] = React.useState("");
  const [deleteProfileRequested, setDeleteProfileRequested] = React.useState(false);
  const customProfileCount = settingsProfiles?.profiles.filter((profile) => !profile.readOnly).length ?? 0;
  const profileRenameDisabled = profileControlsDisabled || settingsProfiles?.activeProfileReadOnly === true;
  const profileDeleteDisabled = profileRenameDisabled || customProfileCount <= 1;
  const activeProfileName = settingsProfiles?.activeProfileName ?? "Profile";
  const profileRenameTooltip = settingsProfiles?.activeProfileReadOnly === true
    ? "Default_Profile is read-only."
    : "Rename active profile";
  const profileDeleteTooltip = settingsProfiles?.activeProfileReadOnly === true
    ? "Default_Profile is read-only."
    : customProfileCount <= 1
      ? "At least one custom profile is required."
      : "Delete active profile";
  const selectedPolicyListKind: PolicyUrlListKind = policy?.policyMode === "allowlist" ? "allow" : "block";
  const selectedPolicyListLabel = selectedPolicyListKind === "allow" ? "allowlist" : "blocklist";
  const selectedPolicyListCount = selectedPolicyListKind === "allow"
    ? policy?.allowedOrigins.length ?? 0
    : policy?.blockedOrigins.length ?? 0;
  const clearUrlsTargetLabel = clearUrlsTarget === "allow" ? "allowlist" : "blocklist";
  const clearUrlsTargetCount = clearUrlsTarget === "allow"
    ? policy?.allowedOrigins.length ?? 0
    : clearUrlsTarget === "block"
      ? policy?.blockedOrigins.length ?? 0
      : 0;

  function importSettingsFromJson(rawJson: string): void {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (!isRecord(parsed)) {
      throw new Error("Imported JSON must be an object.");
    }
    const looksLikeProfileExport = Object.prototype.hasOwnProperty.call(parsed, "catalog")
      || parsed.kind === "portus.settingsProfiles";
    void mutateSettings(
      looksLikeProfileExport ? { type: "portus.settings.import", settings: parsed } : { type: "portus.settings.import", ...parsed },
      "Settings imported."
    );
  }

  async function exportSettingsToFile(): Promise<void> {
    try {
      const response = await sendRuntimeMessage({ type: "portus.settings.export" });
      const settings = response.result.settings;
      if (!settings) throw new Error("Settings export did not return profile data.");
      const blob = new Blob([JSON.stringify(settings, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "portus-browser-settings.json";
      anchor.click();
      URL.revokeObjectURL(url);
      onTerminalDiagnostic("Settings exported.");
    } catch (error) {
      onError(error);
    }
  }

  function profileOptionLabel(profileId: string, name: string): string {
    if (settingsProfiles?.activeProfileId === profileId && settingsProfiles.dirty) return `${name}*`;
    return name;
  }

  async function changeSettingsProfile(value: string): Promise<void> {
    if (value === SETTINGS_PROFILE_CREATE_OPTION) {
      await mutateSettings({ type: "portus.settings-profile.create" }, "Profile created.");
      return;
    }
    await mutateSettings({ type: "portus.settings-profile.select", profileId: value }, "Profile selected.");
  }

  function openRenameProfileDialog(): void {
    setRenameProfileName(activeProfileName);
    setRenameDialogOpen(true);
  }

  async function renameSettingsProfile(): Promise<void> {
    const nextName = renameProfileName.trim();
    if (!nextName) {
      onError(new Error("Profile name is required."));
      return;
    }
    const activeProfileId = settingsProfiles?.activeProfileId;
    const duplicate = settingsProfiles?.profiles.some((profile) => (
      profile.profileId !== activeProfileId && profile.name === nextName
    ));
    if (duplicate) {
      onError(new Error("Profile name already exists."));
      return;
    }
    setRenameDialogOpen(false);
    await mutateSettings({ type: "portus.settings-profile.rename", name: nextName }, `Profile renamed to ${nextName}.`);
  }

  async function deleteSettingsProfile(): Promise<void> {
    const deletedProfileName = activeProfileName;
    setDeleteProfileRequested(false);
    await mutateSettings({ type: "portus.settings-profile.delete" }, `${deletedProfileName} deleted.`);
  }

  async function toggleAutoSave(enabled: boolean): Promise<void> {
    await mutateSettings({ type: "portus.settings-profile.auto-save.set", enabled }, enabled ? "Auto-save enabled." : "Auto-save disabled.");
  }

  async function toggleOriginPolicies(enabled: boolean): Promise<void> {
    await mutatePolicy({ type: "portus.policy.enabled.set", enabled }, enabled ? "Origin policies enabled." : "Origin policies disabled.");
  }

  async function confirmClearPolicyUrls(): Promise<void> {
    if (!clearUrlsTarget) return;
    const target = clearUrlsTarget;
    setClearUrlsTarget(null);
    await mutatePolicy(
      { type: target === "allow" ? "portus.policy.allow.clear" : "portus.policy.block.clear" },
      `${target === "allow" ? "Allowlist" : "Blocklist"} URLs cleared.`
    );
  }

  async function saveSettingsProfile(): Promise<void> {
    await mutateSettings({ type: "portus.settings-profile.save" }, "Profile saved.");
  }

  async function resetSettingsProfile(): Promise<void> {
    const profileName = settingsProfiles?.activeProfileName ?? "Profile";
    const message = settingsProfiles?.activeProfileReadOnly
      ? `${profileName} has the default values.`
      : `${profileName} reset to default values.`;
    await mutateSettings({ type: "portus.settings.reset" }, message);
  }

  return (
    <div className="grid gap-[var(--portus-panel-gap)] px-[var(--portus-section-gap)]">
      <Section
        className="gap-[var(--portus-subsection-gap)]"
        action={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-label="Refresh" disabled={busy} onClick={onRefresh} size="icon" type="button" variant="secondary">
                <RefreshCwIcon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
        }
        showDivider={false}
        title="Bridge"
      >
        <StatusGrid
          rows={[
            { label: "Native Host", value: status?.nativeHostState ?? "unknown" },
            { label: "Broker", value: status?.brokerState ?? "unknown" },
            { label: "Browser ID", value: status?.browserId ?? "none" }
          ]}
        />
      </Section>

      <Section className="pt-[var(--portus-section-gap-large)]" showDivider={false} title="Settings">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="settings-profile-select">Profiles</FieldLabel>
            <div className="grid grid-cols-2 items-center gap-[var(--portus-subsection-gap)]">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <SelectField
                      aria-label="Profile"
                      disabled={profileControlsDisabled}
                      id="settings-profile-select"
                      onChange={(value) => void changeSettingsProfile(value)}
                      options={[
                        ...(settingsProfiles?.profiles ?? []).map((profile) => ({
                          value: profile.profileId,
                          label: profileOptionLabel(profile.profileId, profile.name)
                        })),
                        {
                          value: SETTINGS_PROFILE_CREATE_OPTION,
                          label: "+",
                          disabled: !settingsProfiles?.canCreateProfile
                        }
                      ]}
                      value={settingsProfiles?.activeProfileId ?? ""}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {settingsProfiles?.canCreateProfile === false
                    ? `Maximum of ${settingsProfiles.maxCustomProfiles} profiles reached`
                    : "Create Profile"}
                </TooltipContent>
              </Tooltip>
              <div className="flex items-center justify-between gap-[var(--portus-subsection-gap)]">
                <label className="flex items-center gap-[var(--portus-subsection-gap)] text-sm">
                  <Checkbox
                    checked={settingsProfiles?.autoSave ?? true}
                    disabled={profileControlsDisabled || settingsProfiles?.activeProfileReadOnly === true}
                    onCheckedChange={(value) => void toggleAutoSave(value === true)}
                  />
                  <span>Auto-save</span>
                </label>
                <Button
                  disabled={profileControlsDisabled || settingsProfiles?.activeProfileReadOnly === true}
                  onClick={() => void saveSettingsProfile()}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Save
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 items-center gap-[var(--portus-subsection-gap)]">
              <div className="grid grid-cols-2 gap-[var(--portus-subsection-gap)] w-full">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex w-full">
                      <Button
                        className="w-full"
                        disabled={profileRenameDisabled}
                        onClick={openRenameProfileDialog}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        <PencilIcon aria-hidden="true" />
                        Rename
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{profileRenameTooltip}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex w-full">
                      <Button
                        className="w-full"
                        disabled={profileDeleteDisabled}
                        onClick={() => setDeleteProfileRequested(true)}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        <Trash2Icon aria-hidden="true" />
                        Delete
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{profileDeleteTooltip}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </Field>
        </FieldGroup>
      </Section>

      <Section className="pt-[var(--portus-section-gap-large)]" showDivider={false} title="Panel">
        <FieldGroup>
          <NativeRadioGroupField
            disabled={!ux}
            label="Default View"
            name="default-panel-view"
            onChange={(value) => void mutateUx({ type: "portus.ux.default-panel-view.set", view: value })}
            options={[
              { value: "terminal", label: "Terminal" },
              { value: "settings", label: "Settings" }
            ]}
            columns={2}
            value={ux?.defaultPanelView ?? "terminal"}
          />
          <NativeRadioGroupField
            disabled={!ux}
            label="Extension Icon"
            name="icon-click-behavior"
            onChange={(value) => void mutateUx({ type: "portus.ux.icon-click-behavior.set", behavior: value })}
            options={[
              { value: "popup", label: "Open Popup" },
              { value: "side-panel", label: "Open Side Panel" }
            ]}
            columns={2}
            value={ux?.iconClickBehavior ?? "popup"}
          />
        </FieldGroup>
      </Section>

      <TerminalSettingsSection
        active={active}
        busy={busy}
        onDiagnostic={onTerminalDiagnostic}
        onError={onError}
        onPreferencesChange={onTerminalPreferencesChange}
        status={status}
      />

      <Section
        className="pt-[var(--portus-section-gap-large)]"
        showDivider={false}
        action={
          <div className="flex w-1/2 items-center justify-between gap-[var(--portus-subsection-gap)]">
            <label className="flex items-center gap-[var(--portus-subsection-gap)] text-sm">
              <Checkbox
                checked={policy?.originPolicyEnabled ?? true}
                disabled={busy || !policy}
                onCheckedChange={(value) => void toggleOriginPolicies(value === true)}
              />
              <span>Enable Policies</span>
            </label>
            <Button
              disabled={busy || !policy || selectedPolicyListCount === 0}
              onClick={() => setClearUrlsTarget(selectedPolicyListKind)}
              size="sm"
              type="button"
              variant="secondary"
            >
              Clear URLs
            </Button>
          </div>
        }
        title="Origin Policy"
      >
        <FieldGroup>
          <NativeRadioGroupField
            disabled={busy || !policy}
            label="Mode"
            onChange={(value) => void mutatePolicy({ type: "portus.policy.mode.set", mode: value }, "Policy mode saved.")}
            name="policy-mode"
            options={[
              { value: "blocklist", label: "Blocklist" },
              { value: "allowlist", label: "Allowlist" }
            ]}
            columns={2}
            value={policy?.policyMode ?? "blocklist"}
          />
          <Field>
            <FieldLabel htmlFor="origin-input">Origins</FieldLabel>
            <Textarea
              className="min-h-20 resize-y"
              disabled={busy}
              id="origin-input"
              onChange={(event) => onOriginInputChange(event.currentTarget.value)}
              placeholder="https://example.com, https://docs.example.com"
              rows={4}
              value={originInput}
            />
          </Field>
          <label className="flex items-center gap-[var(--portus-subsection-gap)] text-sm">
            <Checkbox checked={includeSubdomains} disabled={busy} onCheckedChange={(value) => onIncludeSubdomainsChange(value === true)} />
            <span>Include Subdomains</span>
          </label>
        </FieldGroup>
        <div className="grid grid-cols-2 gap-[var(--portus-subsection-gap)]">
          <Button disabled={busy} onClick={() => void mutateManualOrigins("portus.policy.allow.add", "allowlist")} type="button" variant="secondary">
            Add Allow
          </Button>
          <Button disabled={busy} onClick={() => void mutateManualOrigins("portus.policy.block.add", "blocklist")} type="button" variant="secondary">
            Add Block
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-[var(--portus-section-gap)]">
          <OriginChipList
            disabled={busy}
            origins={policy?.allowedOrigins.map((entry) => entry.origin) ?? []}
            onRemove={(origin) => void mutatePolicy({ type: "portus.policy.allow.remove", origin }, "Origin removed from allowlist.")}
            title="Allowed"
          />
          <OriginChipList
            disabled={busy}
            origins={policy?.blockedOrigins.map((entry) => entry.origin) ?? []}
            onRemove={(origin) => void mutatePolicy({ type: "portus.policy.block.remove", origin }, "Origin removed from blocklist.")}
            title="Blocked"
          />
        </div>
        <div className="grid gap-[var(--portus-subsection-gap)] pt-[var(--portus-section-gap-large)]">
          <Field className="grid grid-cols-2 gap-[var(--portus-subsection-gap)]">
            <div className="col-span-2 grid gap-1.5">
              <FieldLabel htmlFor="retention-input">Retained Steps</FieldLabel>
              <Input
                className="text-right"
                disabled={busy}
                id="retention-input"
                max={1000}
                min={0}
                onBlur={() => {
                  const limit = Number.parseInt(retentionValue, 10);
                  if (!Number.isInteger(limit) || limit < 0 || limit > 1000) {
                    onError(new Error("Retention must be an integer from 0 to 1000."));
                    return;
                  }
                  if (limit === policy?.sessionStepRetentionLimit) return;
                  void mutatePolicy({ type: "portus.policy.retention.set", limit }, "Retention setting saved.");
                }}
                onChange={(event) => setRetentionValue(event.currentTarget.value)}
                step={1}
                type="number"
                value={retentionValue}
              />
            </div>
          </Field>
          <FieldDescription className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-[var(--portus-subsection-gap)] mb-[var(--portus-panel-gap)]">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span className="leading-none">The number of browser steps available for review. They are cleared automatically upon disconnecting the bridge or closing the browser.</span>
          </FieldDescription>
        </div>
      </Section>

      <Section
        className="pt-[var(--portus-section-gap-large)]"
        showDivider={false}
        action={<p className={cn("max-w-44 break-words text-right text-xs leading-5", status?.activeTabOrigin ? "text-brand" : "text-muted-foreground")}>{status?.activeTabOrigin ?? "none"}</p>}
        title="Current Origin"
      >
        <StatusGrid
          rows={[
            { label: "Permission", value: status?.permissionState ?? "unknown" },
            { label: "Portus Policy", value: status ? describeOriginPolicy(status) : "neutral" }
          ]}
        />
      </Section>

      <Section
        className="pt-[var(--portus-section-gap-large)]"
        showDivider={false}
        action={
          <Button disabled={busy} onClick={onRestoreDefaultCommandPolicy} size="sm" type="button" variant="secondary">
            Defaults
          </Button>
        }
        title="CLI Commands"
      >
        <div className="grid gap-[var(--portus-subsection-gap)]">
          <FieldDescription className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-[var(--portus-subsection-gap)] mb-[var(--portus-panel-gap)]">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span className="leading-none">The following permissions allow for specific commands to be available through the CLI.</span>
          </FieldDescription>
          <Accordion className="gap-[var(--portus-subsection-gap)]">
            {commandGroups.map((group) => (
              <AccordionItem key={group.title} title={group.title}>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {group.commands.map((command) => (
                    <label className="grid min-h-7 grid-cols-[auto_minmax(0,1fr)] items-center gap-[var(--portus-subsection-gap)] text-xs" key={command.type}>
                      <Checkbox
                        checked={policy ? policy.commandPolicy[command.type] !== false : true}
                        disabled={!policy}
                        onCheckedChange={(value) => void mutateCommandPolicy(command.type, value === true)}
                      />
                      <span className="break-words">{command.label}</span>
                    </label>
                  ))}
                </div>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </Section>

      <Section className="pt-[var(--portus-section-gap-large)]" showDivider={false} title="Advanced Debugger Backend">
        <div className="grid gap-[var(--portus-subsection-gap)]">
          <label className="flex items-center gap-[var(--portus-subsection-gap)] text-sm">
            <Checkbox
              checked={policy?.advancedBackendEnabled === true}
              disabled={busy || !policy}
              onCheckedChange={(value) => void mutatePolicy({ type: "portus.advanced-backend.set", enabled: value === true }, `Advanced debugger backend ${value === true ? "enabled" : "disabled"}.`)}
            />
            <span>Enable Debugger/CDP Backend</span>
          </label>
          <FieldDescription className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-[var(--portus-subsection-gap)] mb-[var(--portus-section-gap-large)]">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span className="leading-none">Required for native browser dialogs and CDP-backed input. Chrome may show debugger-style warnings while it is used.</span>
          </FieldDescription>
        </div>
      </Section>

      <div aria-label="Import / Export" className="grid gap-[var(--portus-subsection-gap)]">
        <input
          accept="application/json,.json"
          className="hidden"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            void file.text().then(importSettingsFromJson).catch(onError);
          }}
          ref={importInputRef}
          type="file"
        />
        <div className="grid grid-cols-2 gap-[var(--portus-subsection-gap)]">
          <Button
            disabled={busy || status?.bridgeState !== "connected" || !policy || !ux || !terminal}
            onClick={exportSettingsToFile}
            type="button"
            variant="secondary"
          >
            Export Settings
          </Button>
          <Button
            disabled={busy || status?.bridgeState !== "connected"}
            onClick={() => importInputRef.current?.click()}
            type="button"
            variant="secondary"
          >
            Import Settings
          </Button>
        </div>
        <Button disabled={busy || status?.bridgeState !== "connected"} onClick={() => void resetSettingsProfile()} type="button" variant="destructive">
          Restore Defaults
        </Button>
      </div>
      {clearUrlsTarget ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Clear URLs"
          description={`This removes all URLs from the active ${clearUrlsTargetLabel}. The ${clearUrlsTarget === "allow" ? "blocklist" : "allowlist"} is not changed.`}
          onCancel={() => setClearUrlsTarget(null)}
          onConfirm={() => void confirmClearPolicyUrls()}
          title={`Clear ${clearUrlsTargetCount} ${clearUrlsTargetLabel} ${clearUrlsTargetCount === 1 ? "URL" : "URLs"}?`}
        />
      ) : null}
      {renameDialogOpen ? (
        <RenameProfileDialog
          busy={busy}
          name={renameProfileName}
          onCancel={() => setRenameDialogOpen(false)}
          onChange={setRenameProfileName}
          onConfirm={() => void renameSettingsProfile()}
        />
      ) : null}
      {deleteProfileRequested ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Delete Profile"
          description={`This removes ${activeProfileName}. Restore Defaults only changes settings values and is not used for deleting profiles.`}
          onCancel={() => setDeleteProfileRequested(false)}
          onConfirm={() => void deleteSettingsProfile()}
          title={`Delete ${activeProfileName}?`}
        />
      ) : null}
    </div>
  );
}

function RenameProfileDialog({
  busy,
  name,
  onCancel,
  onChange,
  onConfirm
}: {
  busy: boolean;
  name: string;
  onCancel(): void;
  onChange(value: string): void;
  onConfirm(): void;
}): React.JSX.Element {
  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent asChild>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename Profile</DialogTitle>
            <DialogDescription>Rename the active profile without changing its settings.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="rename-profile-name">Profile Name</FieldLabel>
            <Input
              autoFocus
              disabled={busy}
              id="rename-profile-name"
              maxLength={80}
              onChange={(event) => onChange(event.currentTarget.value)}
              value={name}
            />
          </Field>
          <DialogFooter>
            <Button disabled={busy} onClick={onCancel} size="sm" type="button" variant="secondary">
              Cancel
            </Button>
            <Button disabled={busy} size="sm" type="submit">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  busy,
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  title
}: {
  busy: boolean;
  confirmLabel: string;
  description: string;
  onCancel(): void;
  onConfirm(): void;
  title: string;
}): React.JSX.Element {
  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={busy} onClick={onCancel} size="sm" type="button" variant="secondary">
            Cancel
          </Button>
          <Button disabled={busy} onClick={onConfirm} size="sm" type="button" variant="destructive">
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OriginChipList({
  title,
  origins,
  disabled,
  onRemove
}: {
  title: string;
  origins: string[];
  disabled: boolean;
  onRemove(origin: string): void;
}): React.JSX.Element {
  const entries = origins.length === 0 ? ["none"] : origins.slice().sort((a, b) => a.localeCompare(b));
  return (
    <div className="grid gap-[var(--portus-subsection-gap)]">
      <h3 className="text-xs font-bold text-muted-foreground">{title}</h3>
      <ul className="flex flex-wrap gap-1.5">
        {entries.map((origin) => (
          <li className="min-w-0 max-w-full" key={origin}>
            {origin === "none" ? (
              <span className="inline-flex min-h-7 items-center rounded-[var(--portus-chip-radius)] bg-muted px-2.5 py-1 text-xs text-muted-foreground">none</span>
            ) : (
              <span className="inline-flex max-w-full items-center gap-1 rounded-[var(--portus-chip-radius)] bg-muted py-1 pl-2.5 pr-1 text-xs text-foreground">
                <span className="min-w-0 truncate">{origin}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={`Remove ${origin} from ${title}`}
                      className="size-5 shrink-0"
                      disabled={disabled}
                      onClick={() => onRemove(origin)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <XIcon aria-hidden="true" className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{`Remove ${origin} from ${title}`}</TooltipContent>
                </Tooltip>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function parseOriginInput(input: string, includeSubdomains: boolean): { origins: string[]; invalid: string[] } {
  const origins: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const rawToken of input.split(/[,\s]+/)) {
    const token = rawToken.trim();
    if (!token) continue;
    const normalized = normalizeOriginInputToken(token);
    if (!normalized) {
      invalid.push(token);
      continue;
    }
    const policyOrigin = policyInputForOrigin(normalized, includeSubdomains);
    if (seen.has(policyOrigin)) continue;
    seen.add(policyOrigin);
    origins.push(policyOrigin);
  }
  return { origins, invalid };
}

function normalizeOriginInputToken(input: string): string | null {
  const token = input.trim();
  if (!token) return null;
  if (/^(?:(https?):\/\/)?\*\./i.test(token)) return token.toLowerCase();
  try {
    const parsed = new URL(token.includes("://") ? token : `https://${token}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function TerminalSettingsSection({
  active,
  busy,
  onDiagnostic,
  onError,
  onPreferencesChange,
  status
}: {
  active: boolean;
  busy: boolean;
  onDiagnostic(message: string): void;
  onError(error: unknown): void;
  onPreferencesChange(terminalPreferences: TerminalSettings): void;
  status: PortusExtensionStatus | null;
}): React.JSX.Element {
  const [form, setForm] = React.useState<TerminalSettings>(() => TerminalSettingsSchema.parse({}));
  const [fontSizeValue, setFontSizeValue] = React.useState("16");
  const [profiles, setProfiles] = React.useState<TerminalProfile[]>([]);
  const profilesLoadedRef = React.useRef(false);

  React.useEffect(() => {
    if (status?.terminalPreferences) {
      const next = TerminalSettingsSchema.parse(status.terminalPreferences);
      setForm(next);
      setFontSizeValue(String(next.fontSize));
    }
  }, [status?.terminalPreferences]);

  React.useEffect(() => {
    if (!active || profilesLoadedRef.current) return;
    profilesLoadedRef.current = true;
    void loadProfilesForSettings().then(setProfiles).catch((error) => {
      profilesLoadedRef.current = false;
      onError(error);
    });
  }, [active, onError]);

  async function saveSettings(settings: TerminalSettings, message = "Terminal settings saved."): Promise<void> {
    try {
      const response = await sendRuntimeMessage({ type: "portus.terminal.settings.set", settings });
      const next = TerminalSettingsSchema.parse(response.result.terminal ?? settings);
      setForm(next);
      setFontSizeValue(String(next.fontSize));
      onPreferencesChange(next);
      onDiagnostic(message);
    } catch (error) {
      onError(error);
    }
  }

  async function setTerminalEnabled(enabled: boolean): Promise<void> {
    const next = TerminalSettingsSchema.parse({ ...form, enabled });
    setForm(next);
    onPreferencesChange(next);
    try {
      const response = await sendRuntimeMessage({ type: "portus.terminal.settings.set", settings: next });
      const saved = TerminalSettingsSchema.parse(response.result.terminal ?? next);
      setForm(saved);
      setFontSizeValue(String(saved.fontSize));
      onPreferencesChange(saved);
      onDiagnostic(enabled ? "Terminal enabled." : "Terminal disabled.");
    } catch (error) {
      setForm(form);
      setFontSizeValue(String(form.fontSize));
      onPreferencesChange(form);
      onError(error);
    }
  }

  function saveField(patch: Partial<TerminalSettings>, message = "Terminal settings saved."): void {
    try {
      const next = TerminalSettingsSchema.parse({ ...form, ...patch });
      setForm(next);
      onPreferencesChange(next);
      void saveSettings(next, message);
    } catch (error) {
      onError(error);
    }
  }

  async function resetSettings(): Promise<void> {
    try {
      const response = await sendRuntimeMessage({ type: "portus.terminal.settings.reset" });
      const next = TerminalSettingsSchema.parse(response.result.terminal);
      setForm(next);
      setFontSizeValue(String(next.fontSize));
      onPreferencesChange(next);
      onDiagnostic("Terminal defaults restored.");
    } catch (error) {
      onError(error);
    }
  }

  const patchForm = (patch: Partial<TerminalSettings>) => setForm((current) => TerminalSettingsSchema.parse({ ...current, ...patch }));

  return (
    <Section
      className="pt-[var(--portus-section-gap-large)]"
      showDivider={false}
      action={
        <div className="flex w-1/2 items-center justify-between gap-[var(--portus-subsection-gap)]">
          <label className="flex items-center gap-[var(--portus-subsection-gap)] text-sm">
            <Checkbox
              checked={form.enabled}
              disabled={busy}
              onCheckedChange={(value) => {
                void setTerminalEnabled(value === true);
              }}
            />
            <span>Enable Terminal</span>
          </label>
          <Button disabled={busy} onClick={() => void resetSettings()} size="sm" type="button" variant="secondary">
            Defaults
          </Button>
        </div>
      }
      title="Terminal"
    >
      <FieldGroup>
        <div className="grid grid-cols-2 gap-[var(--portus-section-gap)]">
          <SelectField
            disabled={busy}
            id="terminal-default-profile"
            label="Default Terminal"
            onChange={(value) => saveField({ defaultProfileId: value })}
            options={
              profiles.length === 0
                ? [{ value: form.defaultProfileId, label: form.defaultProfileId === "auto" ? "Auto" : form.defaultProfileId }]
                : [
                    { value: "auto", label: "Auto" },
                    ...profiles.map((profile) => ({ value: profile.profileId, label: profile.label }))
                  ]
            }
            value={form.defaultProfileId}
          />
          <Field>
            <FieldLabel htmlFor="terminal-manual-path">Terminal Path</FieldLabel>
            <Input disabled={busy} id="terminal-manual-path" onBlur={(event) => saveField({ manualTerminalPath: event.currentTarget.value.trim() || null })} onChange={(event) => patchForm({ manualTerminalPath: event.currentTarget.value.trim() || null })} placeholder="Optional Absolute Path" type="text" value={form.manualTerminalPath ?? ""} />
          </Field>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-[var(--portus-section-gap)]">
          <Field>
            <FieldLabel htmlFor="terminal-working-directory">Default Folder</FieldLabel>
            <Input disabled={busy} id="terminal-working-directory" onBlur={(event) => saveField({ defaultWorkingDirectory: event.currentTarget.value })} onChange={(event) => setForm((current) => ({ ...current, defaultWorkingDirectory: event.currentTarget.value }))} placeholder="Downloads/portus-session" type="text" value={form.defaultWorkingDirectory} />
          </Field>
          <Field>
            <FieldLabel htmlFor="terminal-font-size">Font Size</FieldLabel>
            <Input className="text-right" disabled={busy} id="terminal-font-size" max={24} min={10} onBlur={(event) => {
              const fontSize = Number.parseInt(event.currentTarget.value, 10);
              if (!Number.isInteger(fontSize) || fontSize < 10 || fontSize > 24) {
                setFontSizeValue(String(form.fontSize));
                onError(new Error("Font size must be an integer from 10 to 24."));
                return;
              }
              saveField({ fontSize }, "Terminal font size saved.");
            }} onChange={(event) => setFontSizeValue(event.currentTarget.value)} step={1} type="number" value={fontSizeValue} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="terminal-startup-command">Startup Command (Optional)</FieldLabel>
          <Input disabled={busy} id="terminal-startup-command" onBlur={(event) => saveField({ startupCommand: event.currentTarget.value.trim() || null })} onChange={(event) => patchForm({ startupCommand: event.currentTarget.value.trim() || null })} placeholder="e.g. codex" type="text" value={form.startupCommand ?? ""} />
        </Field>
      </FieldGroup>
    </Section>
  );
}

function loadProfilesForSettings(): Promise<TerminalProfile[]> {
  return new Promise((resolve, reject) => {
    const requestId = "treq_settings_profiles_" + Date.now().toString(36);
    const port = connectRuntimePort("portus.terminal");
    let settled = false;
    const finish = (profiles: TerminalProfile[]) => {
      if (settled) return;
      settled = true;
      port.disconnect();
      resolve(profiles);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      port.disconnect();
      reject(error);
    };

    port.onMessage.addListener((input: unknown) => {
      if (!isRecord(input) || input.requestId !== requestId || typeof input.type !== "string") return;
      const message = input as TerminalServerMessage;
      if (message.type === "terminal.profiles") finish(message.payload.profiles);
      if (message.type === "terminal.session.error") fail(new Error(message.payload.message));
    });
    port.onDisconnect.addListener(() => {
      if (!settled) fail(new Error("Terminal profile list disconnected."));
    });
    port.postMessage({ type: "terminal.profiles.list", requestId, payload: {} } satisfies TerminalClientMessage);
  });
}

function terminalSettingsKey(settings: TerminalSettings): string {
  return JSON.stringify(settings);
}

function TerminalPanel({
  disabled,
  onDiagnostic,
  onError,
  terminalPreferences
}: {
  disabled: boolean;
  onDiagnostic(message: string): void;
  onError(error: unknown): void;
  terminalPreferences: TerminalSettings | null;
}): React.JSX.Element {
  const [settings, setSettings] = React.useState<TerminalSettings>(() => TerminalSettingsSchema.parse({}));
  const [profiles, setProfiles] = React.useState<TerminalProfile[]>([]);
  const [sessions, setSessions] = React.useState<TerminalSessionMetadata[]>([]);
  const [activeTerminalId, setActiveTerminalId] = React.useState<string | null>(null);
  const [placeholder, setPlaceholder] = React.useState("Terminal is starting.");
  const [terminalState, setTerminalState] = React.useState("Checking");
  const [optionsOpen, setOptionsOpen] = React.useState(false);
  const portRef = React.useRef<RuntimePort | null>(null);
  const pendingRef = React.useRef(new Map<string, { resolve: (message: TerminalServerMessage) => void; reject: (error: Error) => void }>());
  const requestCounterRef = React.useRef(0);
  const termsRef = React.useRef(new Map<string, { term: XTerm; fit: FitAddon; element: HTMLDivElement }>());
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  const syncedSettingsKeyRef = React.useRef<string | null>(null);
  const appliedSettingsKeyRef = React.useRef<string | null>(null);
  const profilesCacheKeyRef = React.useRef<string | null>(null);
  const bootstrappedRef = React.useRef(false);

  React.useEffect(() => {
    void bootstrapTerminalFromStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!terminalPreferences) return;
    const next = TerminalSettingsSchema.parse(terminalPreferences);
    const settingsKey = terminalSettingsKey(next);
    if (appliedSettingsKeyRef.current === settingsKey) return;
    appliedSettingsKeyRef.current = settingsKey;
    bootstrappedRef.current = true;
    setSettings(next);
    if (!next.enabled) {
      disconnectPort();
      showPlaceholder("Terminal is disabled. Enable it in Settings to use it here.", "Disabled");
      return;
    }
    void syncTerminal(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalPreferences]);

  React.useEffect(() => {
    const onResize = () => fitActive();
    globalThis.addEventListener("resize", onResize);
    return () => {
      globalThis.removeEventListener("resize", onResize);
      disconnectPort();
      for (const entry of termsRef.current.values()) entry.term.dispose();
      termsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!settings.enabled) return;
    activateSession(activeTerminalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTerminalId, settings.enabled]);

  React.useEffect(() => {
    for (const entry of termsRef.current.values()) {
      entry.term.options.fontSize = settings.fontSize;
      entry.fit.fit();
    }
    resizeActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.fontSize]);

  async function bootstrapTerminalFromStorage(): Promise<void> {
    try {
      const stored = await readLocalStorageValue(TERMINAL_PREFERENCES_STORAGE_KEY);
      if (bootstrappedRef.current) return;
      const next = TerminalSettingsSchema.parse(stored ?? {});
      appliedSettingsKeyRef.current = terminalSettingsKey(next);
      bootstrappedRef.current = true;
      setSettings(next);
      if (!next.enabled) {
        showPlaceholder("Terminal is disabled. Enable it in Settings to use it here.", "Disabled");
        return;
      }
      void syncTerminal(next);
    } catch (error) {
      if (bootstrappedRef.current) return;
      bootstrappedRef.current = true;
      onError(error);
    }
  }

  async function syncTerminal(nextSettings: TerminalSettings): Promise<void> {
    try {
      showPlaceholder("Terminal is starting.", "Checking");
      await ensurePort();
      await syncSettingsIfNeeded(nextSettings);
      const nextSessions = await refreshSessions();
      void loadProfiles(nextSettings);
      onDiagnostic("");
      if (nextSessions.length === 0) await createSession({ enabled: nextSettings.enabled, reuseExisting: true });
      else activateSession(activeTerminalId ?? nextSessions[0]?.terminalId ?? null);
    } catch (error) {
      showPlaceholder(error instanceof Error ? error.message : "Terminal backend is unavailable.", "Unavailable");
    }
  }

  async function syncSettingsIfNeeded(nextSettings: TerminalSettings): Promise<void> {
    const settingsKey = terminalSettingsKey(nextSettings);
    if (syncedSettingsKeyRef.current === settingsKey) return;
    await sendTerminal({ type: "terminal.settings.set", requestId: nextRequestId(), payload: { settings: nextSettings } });
    syncedSettingsKeyRef.current = settingsKey;
  }

  async function ensurePort(): Promise<void> {
    if (portRef.current) return;
    const port = connectRuntimePort("portus.terminal");
    portRef.current = port;
    port.onMessage.addListener(handleServerMessage);
    port.onDisconnect.addListener(() => {
      portRef.current = null;
      for (const pending of pendingRef.current.values()) pending.reject(new Error("Terminal channel disconnected."));
      pendingRef.current.clear();
      showPlaceholder("Terminal backend disconnected.", "Disconnected");
    });
  }

  function disconnectPort(): void {
    if (portRef.current) portRef.current.disconnect();
    portRef.current = null;
    syncedSettingsKeyRef.current = null;
    setSessions([]);
    setActiveTerminalId(null);
  }

  async function loadProfiles(nextSettings = settings): Promise<void> {
    const cacheKey = nextSettings.manualTerminalPath ?? "";
    if (profilesCacheKeyRef.current === cacheKey && profiles.length > 0) return;
    const message = await sendTerminal({ type: "terminal.profiles.list", requestId: nextRequestId(), payload: {} });
    if (message.type === "terminal.profiles") {
      setProfiles(message.payload.profiles);
      profilesCacheKeyRef.current = cacheKey;
    }
  }

  async function refreshSessions(): Promise<TerminalSessionMetadata[]> {
    const message = await sendTerminal({ type: "terminal.sessions.list", requestId: nextRequestId(), payload: {} });
    if (message.type === "terminal.sessions") {
      applySessions(message.payload.sessions, message.payload.activeTerminalId ?? null);
      onDiagnostic("");
      return message.payload.sessions;
    }
    return [];
  }

  async function createSession({
    profileId,
    enabled = settings.enabled,
    reuseExisting = false
  }: {
    profileId?: string;
    enabled?: boolean;
    reuseExisting?: boolean;
  } = {}): Promise<void> {
    if (!enabled) return;
    await ensurePort();
    const size = measureSize();
    const created = await sendTerminal({
      type: "terminal.session.create",
      requestId: nextRequestId(),
      payload: {
        cols: size.cols,
        rows: size.rows,
        reuseExisting,
        ...(profileId === undefined ? {} : { profileId })
      }
    });
    if (created.type === "terminal.session.created") {
      setSessions((current) => [...current.filter((session) => session.terminalId !== created.terminalId), created.payload.session]);
      setActiveTerminalId(created.terminalId);
      setPlaceholder("");
      setTerminalState("Ready");
      onDiagnostic("");
    }
  }

  async function replaceActiveSessionProfile(profileId: string): Promise<void> {
    const next = TerminalSettingsSchema.parse({ ...settings, defaultProfileId: profileId });
    setSettings(next);
    setOptionsOpen(false);
    await sendRuntimeMessage({ type: "portus.terminal.settings.set", settings: next });
    if (!activeTerminalId) {
      onDiagnostic("Terminal settings saved.");
      return;
    }
    const oldTerminalId = activeTerminalId;
    setTerminalState("Switching");
    const size = measureSize();
    const created = await sendTerminal({ type: "terminal.session.create", requestId: nextRequestId(), payload: { profileId, cols: size.cols, rows: size.rows } });
    if (created.type === "terminal.session.created") {
      setSessions((current) => [
        ...current.filter((session) => session.terminalId !== oldTerminalId && session.terminalId !== created.terminalId),
        created.payload.session
      ]);
      setActiveTerminalId(created.terminalId);
      setPlaceholder("");
      setTerminalState("Ready");
      onDiagnostic("");
      void sendTerminal({ type: "terminal.session.close", requestId: nextRequestId(), terminalId: oldTerminalId, payload: {} })
        .then(() => {
          termsRef.current.get(oldTerminalId)?.term.dispose();
          termsRef.current.delete(oldTerminalId);
        })
        .catch(onError);
    }
  }

  function activateSession(terminalId: string | null): void {
    if (!surfaceRef.current) return;
    surfaceRef.current.textContent = "";
    if (!terminalId) {
      showPlaceholder(settings.enabled ? "No terminal tabs are open. Use + to open a new tab." : "Terminal is disabled. Enable it in Settings to use it here.", settings.enabled ? "Ready" : "Disabled");
      return;
    }
    setPlaceholder("");
    const entry = ensureTerm(terminalId);
    surfaceRef.current.append(entry.element);
    entry.fit.fit();
    resizeActive();
  }

  function ensureTerm(terminalId: string): { term: XTerm; fit: FitAddon; element: HTMLDivElement } {
    const existing = termsRef.current.get(terminalId);
    if (existing) return existing;
    const element = document.createElement("div");
    element.className = "h-full";
    const term = new XTerm({ cursorBlink: true, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace', fontSize: settings.fontSize });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.onData((data) => {
      if (!portRef.current) return;
      portRef.current.postMessage({ type: "terminal.session.input", terminalId, payload: { data } } satisfies TerminalClientMessage);
    });
    term.open(element);
    const entry = { term, fit, element };
    termsRef.current.set(terminalId, entry);
    return entry;
  }

  function handleServerMessage(input: unknown): void {
    if (!isRecord(input) || typeof input.type !== "string") return;
    const message = input as TerminalServerMessage;
    if (message.requestId) {
      const pending = pendingRef.current.get(message.requestId);
      if (pending) {
        pendingRef.current.delete(message.requestId);
        if (message.type === "terminal.session.error") pending.reject(new Error(message.payload.message));
        else pending.resolve(message);
        if (message.type === "terminal.session.error") return;
      }
    }
    if (message.type === "terminal.session.output" && message.terminalId) ensureTerm(message.terminalId).term.write(message.payload.data);
    if (message.type === "terminal.session.exit" && message.terminalId) {
      setSessions((current) => current.map((session) => session.terminalId === message.terminalId ? { ...session, status: "exited", exitCode: message.payload.exitCode } : session));
    }
    if (message.type === "terminal.sessions") applySessions(message.payload.sessions, message.payload.activeTerminalId ?? null);
    if (message.type === "terminal.session.error") showPlaceholder(message.payload.message, "Unavailable");
  }

  function sendTerminal(message: TerminalClientMessage): Promise<TerminalServerMessage> {
    return new Promise((resolve, reject) => {
      if (!portRef.current) return reject(new Error("Terminal channel is not connected."));
      if (!message.requestId) return reject(new Error("Terminal requestId is required."));
      pendingRef.current.set(message.requestId, { resolve, reject });
      portRef.current.postMessage(message);
    });
  }

  function applySessions(nextSessions: TerminalSessionMetadata[], nextActiveTerminalId: string | null): void {
    setSessions(nextSessions);
    setActiveTerminalId(nextActiveTerminalId);
    setTerminalState(portRef.current ? "Ready" : "Disconnected");
    if (nextSessions.length > 0) setPlaceholder("");
  }

  function showPlaceholder(text: string, nextState: string): void {
    setPlaceholder(text);
    setTerminalState(nextState);
  }

  function fitActive(): void {
    const active = activeTerminalId ? termsRef.current.get(activeTerminalId) : undefined;
    if (active) active.fit.fit();
  }

  function resizeActive(): void {
    const active = activeTerminalId ? termsRef.current.get(activeTerminalId) : undefined;
    if (!active || !portRef.current || !activeTerminalId) return;
    const size = measureSize();
    portRef.current.postMessage({ type: "terminal.session.resize", terminalId: activeTerminalId, payload: size } satisfies TerminalClientMessage);
  }

  function measureSize(): { cols: number; rows: number } {
    const active = activeTerminalId ? termsRef.current.get(activeTerminalId) : undefined;
    if (active) {
      try {
        active.fit.fit();
        return { cols: active.term.cols, rows: active.term.rows };
      } catch {
        return { cols: 100, rows: 30 };
      }
    }
    return { cols: 100, rows: 30 };
  }

  function nextRequestId(): string {
    requestCounterRef.current += 1;
    return "treq_sidepanel_" + requestCounterRef.current;
  }

  return (
    <Tabs value={activeTerminalId || ""} onValueChange={setActiveTerminalId} className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
        <TabsList className="h-auto min-w-0 w-full bg-transparent p-0 gap-1 overflow-hidden justify-start rounded-none" aria-label="Terminal Tabs">
        {sessions.map((session) => (
          <TabsTrigger
            key={session.terminalId}
            value={session.terminalId}
            className="h-[var(--portus-terminal-tab-height)] min-w-0 justify-between rounded-b-none rounded-t-[var(--radius-md)] pl-3 pr-1.5 data-[state=active]:bg-black data-[state=active]:shadow-none data-[state=inactive]:bg-secondary data-[state=inactive]:text-muted-foreground"
          >
            <span className="truncate text-xs">{session.title}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  aria-label={`Close ${session.title}`}
                  className="ml-1.5 inline-flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] hover:bg-background/50"
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeSessionById(session.terminalId).catch(onError);
                  }}
                  role="button"
                >
                  <XIcon aria-hidden="true" className="size-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{`Close ${session.title}`}</TooltipContent>
            </Tooltip>
          </TabsTrigger>
        ))}
        </TabsList>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-label="New Terminal Tab" disabled={disabled || !settings.enabled} onClick={() => void createSession().catch(onError)} size="icon" type="button" variant="ghost">
                <PlusIcon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Terminal Tab</TooltipContent>
          </Tooltip>
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-expanded={optionsOpen}
                  aria-haspopup="menu"
                  aria-label="Terminal Options"
                  disabled={disabled || !settings.enabled}
                  onClick={() => setOptionsOpen((current) => !current)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <ChevronDownIcon aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Terminal Options</TooltipContent>
            </Tooltip>
            {optionsOpen ? (
              <div className="absolute right-0 top-[var(--portus-terminal-tab-height)] z-50 grid min-w-52 gap-1 rounded-[var(--radius-md)] border bg-popover p-[var(--portus-menu-padding)] text-popover-foreground shadow-md" role="menu">
                <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">Detected Terminals</p>
                {(profiles.length === 0 ? [{ profileId: settings.defaultProfileId, label: settings.defaultProfileId }] : profiles).map((profile) => (
                  <button
                    className={`rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground ${profile.profileId === settings.defaultProfileId ? "bg-accent text-accent-foreground" : ""}`}
                    key={profile.profileId}
                    onClick={() => {
                      void replaceActiveSessionProfile(profile.profileId).catch(onError);
                      setOptionsOpen(false);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {profile.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 pb-[var(--portus-terminal-bottom-padding)]">
        <div
          aria-label="Terminal Session"
          className={placeholder ? "hidden" : "h-full min-h-0 min-w-0 overflow-hidden rounded-b-[var(--radius-md)] border border-t-0 border-black bg-black p-[var(--portus-terminal-padding)]"}
          style={{ "--portus-terminal-background": "oklch(0 0 0)" } as React.CSSProperties}
          ref={surfaceRef}
        />
        {placeholder ? (
          <div className="flex h-full min-h-0 items-center justify-center rounded-[var(--radius-md)] border border-dashed bg-muted p-[var(--portus-panel-padding)] text-center text-sm text-muted-foreground">
            {placeholder}
          </div>
        ) : null}
      </div>
      <div className="flex min-h-[var(--portus-terminal-footer-height)] items-center justify-between gap-[var(--portus-subsection-gap)] text-xs text-muted-foreground">
        <span>Terminal</span>
        {terminalState === "Ready" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className="bg-transparent px-0 font-bold text-brand shadow-none hover:bg-transparent">Ready</Badge>
            </TooltipTrigger>
            <TooltipContent>Terminal is ready for input</TooltipContent>
          </Tooltip>
        ) : (
          <StatusBadge label={terminalState} state={terminalState.toLowerCase()} />
        )}
      </div>
    </Tabs>
  );

  async function closeSessionById(terminalId: string): Promise<void> {
    await sendTerminal({ type: "terminal.session.close", requestId: nextRequestId(), terminalId, payload: {} });
    termsRef.current.get(terminalId)?.term.dispose();
    termsRef.current.delete(terminalId);
    const nextSessions = await refreshSessions();
    const next = nextSessions.find((session) => session.terminalId !== terminalId)?.terminalId ?? nextSessions[0]?.terminalId ?? null;
    setActiveTerminalId(next);
    onDiagnostic("");
  }
}

export function mountSidePanel(rootElement: HTMLElement | null = document.getElementById("root")): void {
  if (!rootElement) throw new Error("Missing side panel root element.");
  createRoot(rootElement).render(<SidePanelApp />);
}

const rootElement = typeof document === "undefined" ? null : document.getElementById("root");
if (rootElement) mountSidePanel(rootElement);
