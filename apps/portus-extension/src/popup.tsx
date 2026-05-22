import * as React from "react";
import { createRoot } from "react-dom/client";
import { SETTINGS_PROFILE_CREATE_OPTION } from "@portus/protocol";
import { Button } from "./components/ui/button.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip.js";
import { cn } from "./lib/utils.js";
import { Section, Diagnostics, SelectField, StatusBadge, StatusGrid } from "./gui/components.js";
import { closeSidePanelFromPopupGesture, closeWindow, connectRuntimePort, openSidePanelFromPopupGesture, readStatus, readStatusMessage, sendRuntimeMessage } from "./gui/chromeApi.js";
import { describeOriginPolicy, labelForBridgeState } from "./gui/status.js";
import type { PortusExtensionStatus } from "./index.js";

export function PopupApp(): React.JSX.Element {
  const [status, setStatus] = React.useState<PortusExtensionStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [diagnostic, setDiagnostic] = React.useState("Checking Bridge state.");
  const [isError, setIsError] = React.useState(false);

  const applyError = React.useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : "Extension popup failed.";
    setDiagnostic(message);
    setIsError(true);
  }, []);

  const refreshStatus = React.useCallback(async () => {
    setBusy(true);
    setDiagnostic("Checking Bridge state.");
    setIsError(false);
    try {
      const response = await sendRuntimeMessage({ type: "portus.status" });
      setStatus(readStatus(response));
      setDiagnostic("");
    } catch (error) {
      applyError(error);
    } finally {
      setBusy(false);
    }
  }, [applyError]);

  React.useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  React.useEffect(() => {
    const port = connectRuntimePort("portus.status");
    port.onMessage.addListener((message) => {
      const nextStatus = readStatusMessage(message);
      if (nextStatus) setStatus(nextStatus);
    });
    return () => port.disconnect();
  }, []);

  async function mutateStatus(message: Record<string, unknown>, successMessage: string): Promise<void> {
    setBusy(true);
    setDiagnostic("Saving.");
    setIsError(false);
    try {
      const response = await sendRuntimeMessage(message);
      setStatus(readStatus(response));
      setDiagnostic(successMessage);
    } catch (error) {
      applyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function openPanel(): Promise<void> {
    setBusy(true);
    setDiagnostic("Opening panel.");
    setIsError(false);
    try {
      await openSidePanelFromPopupGesture();
      setDiagnostic("Panel opened.");
      closeWindow();
    } catch (error) {
      applyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function closePanel(): Promise<void> {
    setBusy(true);
    setDiagnostic("Closing panel.");
    setIsError(false);
    try {
      await closeSidePanelFromPopupGesture();
      setStatus((current) => current ? { ...current, sidePanelOpen: false } : current);
      setDiagnostic("Panel closed.");
    } catch (error) {
      applyError(error);
    } finally {
      setBusy(false);
    }
  }

  const bridgeState = status?.bridgeState ?? "unknown";
  const bridgeActionType = status?.bridgeState === "connected" ? "portus.bridge.disconnect" : "portus.bridge.connect";
  const sidePanelOpen = status?.sidePanelOpen === true;
  const settingsProfiles = status?.settingsProfiles;
  const profileControlsDisabled = busy || !settingsProfiles || status?.bridgeState !== "connected";

  function profileOptionLabel(profileId: string, name: string): string {
    if (settingsProfiles?.activeProfileId === profileId && settingsProfiles.dirty) return `${name}*`;
    return name;
  }

  async function changeSettingsProfile(value: string): Promise<void> {
    if (value === SETTINGS_PROFILE_CREATE_OPTION) {
      await mutateStatus({ type: "portus.settings-profile.create" }, "Profile created.");
      return;
    }
    await mutateStatus({ type: "portus.settings-profile.select", profileId: value }, "Profile selected.");
  }

  return (
    <TooltipProvider delayDuration={250}>
      <main className="portus-popup-root grid gap-0 p-4 pt-6 pb-0">
        <div className="grid gap-[var(--portus-section-gap)]">
          <header className="flex items-center justify-between gap-[var(--portus-section-gap)]">
            <h1 className="text-base font-bold leading-none"><span className="text-brand">Portus</span>Browser</h1>
            <StatusBadge label={labelForBridgeState(bridgeState)} state={bridgeState} />
          </header>

          <StatusGrid
            rows={[
              { label: "Native Host", value: status?.nativeHostState ?? "unknown" },
              { label: "Broker", value: status?.brokerState ?? "unknown" },
              { label: "Browser ID", value: status?.browserId ?? "none" }
            ]}
          />

          <div className="grid gap-[var(--portus-subsection-gap)]">
            <Button
              disabled={busy}
              onClick={() => {
                void mutateStatus({ type: bridgeActionType }, bridgeActionType === "portus.bridge.connect" ? "Bridge connected." : "Bridge disconnected.");
              }}
              type="button"
            >
              {status?.bridgeState === "connected" ? "Disconnect" : "Connect"}
            </Button>
            <Button disabled={busy} onClick={() => void (sidePanelOpen ? closePanel() : openPanel())} type="button" variant="secondary">
              {sidePanelOpen ? "Close Panel" : "Open Panel"}
            </Button>
          </div>

          <Section className="pt-[var(--portus-section-gap)]" showDivider={false} title="Settings">
            <div className="grid gap-[var(--portus-subsection-gap)]">
              <p className="text-xs font-semibold text-muted-foreground">Profile</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <SelectField
                      aria-label="Profile"
                      disabled={profileControlsDisabled}
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
            </div>
          </Section>

          <Section
            className="pt-[var(--portus-section-gap)]"
            action={<p className={cn("max-w-44 break-words text-right text-xs leading-5", status?.activeTabOrigin ? "text-brand" : "text-muted-foreground")}>{status?.activeTabOrigin ?? "none"}</p>}
            showDivider={false}
            title="Current Origin"
          >
            <StatusGrid
              rows={[
                { label: "Permission", value: status?.permissionState ?? "unknown" },
                { label: "Portus Policy", value: status ? describeOriginPolicy(status) : "neutral" }
              ]}
            />
          </Section>
        </div>
        <div className="flex h-8 items-center overflow-hidden text-xs leading-none">
          <Diagnostics error={isError} message={diagnostic} />
        </div>
      </main>
    </TooltipProvider>
  );
}

export function mountPopup(rootElement: HTMLElement | null = document.getElementById("root")): void {
  if (!rootElement) throw new Error("Missing popup root element.");
  createRoot(rootElement).render(<PopupApp />);
}

const rootElement = typeof document === "undefined" ? null : document.getElementById("root");
if (rootElement) mountPopup(rootElement);
