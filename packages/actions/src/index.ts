import {
  ActionRequestSchema,
  ActionResultSchema,
  SnapshotSchema,
  createPortusError,
  type ActionRequest,
  type ActionResult,
  type PortusError,
  type Snapshot,
  type SnapshotElement
} from "@portus/protocol";

export {
  ActionBackendSchema,
  ActionRequestSchema,
  ActionResultSchema,
  FillFormRequestSchema,
  FillFormResultSchema,
  type ActionRequest,
  type ActionResult,
  type FillFormRequest,
  type FillFormResult
} from "@portus/protocol";

export interface SnapshotStoreEntry {
  snapshot: Snapshot;
  stale: boolean;
}

export function createDomActionResult(completedAt: string, details: Record<string, unknown> = {}): ActionResult {
  return ActionResultSchema.parse({
    backend: "content-script-dom",
    completedAt,
    snapshotInvalidated: true,
    details
  });
}

export function validateActionRequest(input: unknown): ActionRequest {
  return ActionRequestSchema.parse(input);
}

export function resolveActionElement(
  request: ActionRequest,
  snapshots: ReadonlyMap<string, SnapshotStoreEntry>
): SnapshotElement | null {
  if (!request.elementId) return null;
  if (!request.snapshotId) throw staleSnapshotError("Action with elementId requires snapshotId.");

  const entry = snapshots.get(request.snapshotId);
  if (!entry || entry.stale) throw staleSnapshotError("Snapshot is stale or unavailable.");
  if (entry.snapshot.browserId !== request.browserId || entry.snapshot.tabId !== request.tabId) {
    throw staleSnapshotError("Snapshot does not belong to the target tab.");
  }

  const element = entry.snapshot.elements.find((candidate) => candidate.elementId === request.elementId);
  if (!element) throw staleSnapshotError("Element is unavailable in the snapshot.");
  return element;
}

export function markSnapshotsStaleForTab(
  snapshots: Map<string, SnapshotStoreEntry>,
  browserId: string,
  tabId: number
): string[] {
  const invalidated: string[] = [];
  for (const [snapshotId, entry] of snapshots) {
    if (entry.snapshot.browserId !== browserId || entry.snapshot.tabId !== tabId || entry.stale) continue;
    entry.stale = true;
    invalidated.push(snapshotId);
  }
  return invalidated;
}

export function unsupportedActionError(message: string): PortusError {
  return createPortusError({
    code: "ACTION_UNSUPPORTED",
    message
  });
}

export function failedActionError(message: string): PortusError {
  return createPortusError({
    code: "ACTION_FAILED",
    message
  });
}

export function staleSnapshotError(message: string): PortusError {
  return createPortusError({
    code: "SNAPSHOT_STALE",
    message
  });
}
