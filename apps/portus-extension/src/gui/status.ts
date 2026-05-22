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

export function labelForPermissionState(state: string): string {
  switch (state) {
    case "granted":
      return "Granted";
    case "missing":
      return "Missing";
    case "requested":
      return "Requested";
    case "denied":
      return "Denied";
    case "error":
      return "Error";
    default:
      return "Unknown";
  }
}

export function badgeToneForState(state: string): "secondary" | "success" | "warning" | "destructive" {
  if (state === "connected" || state === "granted") return "success";
  if (state === "connecting" || state === "disconnecting" || state === "missing" || state === "denied" || state === "unavailable" || state === "disabled") return "warning";
  if (state === "error") return "destructive";
  return "secondary";
}

export function describeOriginPolicy(status: PortusExtensionStatus): string {
  const origin = status.activeTabOrigin;
  if (!origin) return "unsupported";
  if (status.policyPreferences.originPolicyEnabled === false) return "disabled";
  if (status.policyPreferences.policyMode === "blocklist") {
    return status.policyPreferences.blockedOrigins.some((entry) => policyOriginMatches(entry.origin, origin)) ? "blocked" : "neutral";
  }
  return status.policyPreferences.allowedOrigins.some((entry) => policyOriginMatches(entry.origin, origin)) ? "allowed" : "not allowed";
}

export function policyOriginMatches(pattern: string, origin: string): boolean {
  if (pattern === origin) return true;
  const wildcard = pattern.toLowerCase().match(/^(?:(https?):\/\/)?\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/);
  if (!wildcard) return false;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (wildcard[1] && parsed.protocol !== `${wildcard[1]}:`) return false;
  const suffix = wildcard[2];
  if (!suffix) return false;
  const host = parsed.hostname.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function policyInputForOrigin(origin: string, includeSubdomains: boolean): string {
  if (!includeSubdomains) return origin;
  return wildcardPolicyPatternForOrigin(origin) ?? origin;
}

export function wildcardPolicyPatternForOrigin(origin: string): string | null {
  const trimmed = origin.trim();
  if (/^(?:(https?):\/\/)?\*\./i.test(trimmed)) return trimmed.toLowerCase();

  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const domain = registrableDomainFromHost(parsed.hostname);
  return domain ? `*.${domain}` : null;
}

function registrableDomainFromHost(hostname: string): string | null {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const knownSecondLevelSuffixes = new Set([
    "co.uk",
    "org.uk",
    "ac.uk",
    "com.au",
    "net.au",
    "org.au",
    "com.br",
    "com.co",
    "co.jp",
    "com.mx",
    "com.ar"
  ]);
  const lastTwo = parts.slice(-2).join(".");
  if (parts.length >= 3 && knownSecondLevelSuffixes.has(lastTwo)) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}
