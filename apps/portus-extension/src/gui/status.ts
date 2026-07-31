import { navigationPolicyAllowsUrl } from "@portus/protocol";
import type { PortusExtensionStatus } from "../index.js";

export function labelForBridgeState(state: string): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting...";
    case "disconnecting":
      return "Disconnecting";
    case "error":
      return "Error";
    default:
      return "Disconnected";
  }
}


export function badgeToneForState(state: string): "secondary" | "success" | "warning" | "destructive" {
  if (state === "connected" || state === "allowed") return "success";
  if (state === "connecting" || state === "disconnecting" || state === "blocked" || state === "unavailable" || state === "disabled") return "warning";
  if (state === "error") return "destructive";
  return "secondary";
}

export function describeNavigationPolicy(status: PortusExtensionStatus): string {
  const url = status.activeTabUrl;
  if (!url) return "unsupported";
  if (status.policyPreferences.navigationPolicyEnabled === false) return "disabled";
  return navigationPolicyAllowsUrl(url, status.policyPreferences) ? "allowed" : "blocked";
}
