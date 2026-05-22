import {
  ScreenshotResultSchema,
  SnapshotElementSchema,
  SnapshotFilterSchema,
  SnapshotSchema,
  type ScreenshotResult,
  type Snapshot,
  type SnapshotElement,
  type SnapshotFilter
} from "@portus/protocol";

export {
  BoundsSchema,
  ScreenshotResultSchema,
  SnapshotElementSchema,
  SnapshotFilterSchema,
  SnapshotSchema,
  ViewportSchema,
  type ScreenshotResult,
  type Snapshot,
  type SnapshotElement,
  type SnapshotFilter
} from "@portus/protocol";

export interface SnapshotElementCandidate {
  role: string;
  label?: string;
  text?: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  state?: Record<string, unknown>;
  selectorHint?: string;
  tagName?: string;
  disabled?: boolean;
  editable?: boolean;
  href?: string;
  inputType?: string;
  name?: string;
  placeholder?: string;
}

export interface BuildSnapshotInput {
  snapshotId?: string;
  browserId: string;
  tabId: number;
  url: string;
  title: string;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  screenshot: ScreenshotResult;
  visibleText: string;
  elements: SnapshotElementCandidate[];
  capturedAt: string;
  cleanedDom?: string;
}

export function createSnapshotId(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("snapshot sequence must be a positive integer");
  }
  return `snap_${String(sequence).padStart(6, "0")}`;
}

export function createElementId(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("element sequence must be a positive integer");
  }
  return `el_${String(sequence).padStart(6, "0")}`;
}

export function buildSnapshot(input: BuildSnapshotInput): Snapshot {
  const snapshotId = input.snapshotId ?? createSnapshotId(1);
  const elements = input.elements.map((element, index) => normalizeSnapshotElement(element, index + 1));
  const snapshotInput: Record<string, unknown> = {
    snapshotId,
    browserId: input.browserId,
    tabId: input.tabId,
    url: input.url,
    title: input.title,
    viewport: input.viewport,
    screenshot: ScreenshotResultSchema.parse(input.screenshot),
    visibleText: input.visibleText,
    elements,
    capturedAt: input.capturedAt
  };
  if (input.cleanedDom !== undefined) snapshotInput.cleanedDom = input.cleanedDom;
  return SnapshotSchema.parse(snapshotInput);
}

export function filterSnapshot(snapshot: Snapshot, filterInput: SnapshotFilter | undefined): Snapshot {
  const filter = normalizeSnapshotFilter(filterInput);
  if (!filter) return SnapshotSchema.parse({ ...snapshot, filtered: false, filter: null });

  let elements = snapshot.elements;
  if (filter.query !== undefined) {
    const query = normalizeSearchText(filter.query);
    elements = elements.filter((element) => snapshotElementMatchesQuery(element, query));
  }
  if (filter.role !== undefined) {
    const role = filter.role.toLowerCase();
    elements = elements.filter((element) => element.role.toLowerCase() === role);
  }
  if (filter.interactiveOnly === true) {
    elements = elements.filter(isLikelyInteractiveElement);
  }
  if (filter.maxElements !== undefined) {
    elements = elements.slice(0, filter.maxElements);
  }

  return SnapshotSchema.parse({
    ...snapshot,
    elements,
    filtered: true,
    filter
  });
}

export function normalizeSnapshotElement(input: SnapshotElementCandidate, sequence: number): SnapshotElement {
  const elementInput: Record<string, unknown> = {
    elementId: createElementId(sequence),
    role: input.role,
    label: input.label ?? "",
    text: input.text ?? "",
    bounds: input.bounds,
    state: input.state ?? {}
  };
  if (input.selectorHint !== undefined) elementInput.selectorHint = input.selectorHint;
  if (input.tagName !== undefined) elementInput.tagName = input.tagName;
  if (input.disabled !== undefined) elementInput.disabled = input.disabled;
  if (input.editable !== undefined) elementInput.editable = input.editable;
  if (input.href !== undefined) elementInput.href = input.href;
  if (input.inputType !== undefined) elementInput.inputType = input.inputType;
  if (input.name !== undefined) elementInput.name = input.name;
  if (input.placeholder !== undefined) elementInput.placeholder = input.placeholder;
  return SnapshotElementSchema.parse(elementInput);
}

export function findSnapshotElement(snapshot: Snapshot, elementId: string): SnapshotElement | null {
  return snapshot.elements.find((element) => element.elementId === elementId) ?? null;
}

export function isSnapshotForTarget(snapshot: Snapshot, browserId: string, tabId: number): boolean {
  return snapshot.browserId === browserId && snapshot.tabId === tabId;
}

function normalizeSnapshotFilter(filterInput: SnapshotFilter | undefined): SnapshotFilter | null {
  if (filterInput === undefined) return null;
  const parsed = SnapshotFilterSchema.parse(filterInput);
  const normalized: SnapshotFilter = {};
  const query = parsed.query?.trim();
  const role = parsed.role?.trim().toLowerCase();
  if (query) normalized.query = query;
  if (role) normalized.role = role;
  if (parsed.interactiveOnly === true) normalized.interactiveOnly = true;
  if (parsed.maxElements !== undefined) normalized.maxElements = parsed.maxElements;
  return Object.keys(normalized).length === 0 ? null : normalized;
}

function snapshotElementMatchesQuery(element: SnapshotElement, query: string): boolean {
  const extended = element as SnapshotElement & Record<string, unknown>;
  const haystack = [
    element.label,
    element.text,
    element.role,
    typeof extended.href === "string" ? extended.href : "",
    typeof extended.inputType === "string" ? extended.inputType : "",
    typeof extended.name === "string" ? extended.name : "",
    typeof extended.placeholder === "string" ? extended.placeholder : "",
    typeof element.selectorHint === "string" ? element.selectorHint : "",
    typeof element.tagName === "string" ? element.tagName : ""
  ].map(normalizeSearchText).join(" ");
  return haystack.includes(query);
}

function isLikelyInteractiveElement(element: SnapshotElement): boolean {
  if (element.disabled === true) return false;
  if (element.editable === true) return true;
  const role = element.role.toLowerCase();
  if ([
    "button",
    "link",
    "textbox",
    "searchbox",
    "combobox",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "option",
    "slider",
    "spinbutton"
  ].includes(role)) return true;
  const tagName = element.tagName?.toLowerCase();
  return tagName === "a"
    || tagName === "button"
    || tagName === "input"
    || tagName === "textarea"
    || tagName === "select";
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
