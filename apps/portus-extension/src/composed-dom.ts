import type { ShadowPathSegment } from "@portus/protocol";

export interface PortusComposedDomEntry {
  element: Element;
  root: Document | ShadowRoot;
  selectorHint: string;
  shadowPath?: ShadowPathSegment[];
}

export interface PortusComposedDomRuntime {
  collect(root?: Document | ShadowRoot): PortusComposedDomEntry[];
  selectorForElement(element: Element, root: Document | ShadowRoot): string;
  shadowRootForElement(element: Element): ShadowRoot | null;
  hostInstanceIdForElement(element: Element): string;
  closedShadowRootAccessAvailable(): boolean;
}

type PortusShadowHostIdentityState = {
  hostIds: WeakMap<Element, string>;
  nextHostId: number;
};

type PortusShadowIdentityGlobal = typeof globalThis & {
  __portusShadowHostIdentityState?: PortusShadowHostIdentityState;
};

type PortusChromeDomGlobal = typeof globalThis & {
  chrome?: {
    dom?: {
      openOrClosedShadowRoot?: (element: HTMLElement) => unknown;
    };
  };
};

export function collectPortusComposedDomElements(
  root: Document | ShadowRoot = document,
  environment: typeof globalThis = globalThis
): PortusComposedDomEntry[] {
  const entries: PortusComposedDomEntry[] = [];
  const seen = new Set<Element>();
  walkRoot(root, []);
  return entries;

  function walkRoot(currentRoot: Document | ShadowRoot, shadowPath: ShadowPathSegment[]): void {
    for (const child of Array.from(currentRoot.children)) {
      walkElement(child, currentRoot, shadowPath);
    }
  }

  function walkElement(
    element: Element,
    currentRoot: Document | ShadowRoot,
    shadowPath: ShadowPathSegment[]
  ): void {
    if (seen.has(element)) return;
    seen.add(element);

    entries.push({
      element,
      root: currentRoot,
      selectorHint: selectorForPortusComposedElement(element, currentRoot),
      ...(shadowPath.length === 0 ? {} : { shadowPath: shadowPath.map((segment) => ({ ...segment })) })
    });

    const accessibleShadowRoot = shadowRootForPortusElement(element, environment);
    if (accessibleShadowRoot) {
      const hostSegment: ShadowPathSegment = {
        hostSelectorHint: selectorForPortusComposedElement(element, currentRoot),
        rootType: accessibleShadowRoot.mode,
        hostInstanceId: hostInstanceIdForPortusElement(element, environment)
      };
      walkRoot(accessibleShadowRoot, [...shadowPath, hostSegment]);
    }

    for (const child of Array.from(element.children)) {
      walkElement(child, currentRoot, shadowPath);
    }
  }
}

export function selectorForPortusComposedElement(
  element: Element,
  root: Document | ShadowRoot
): string {
  if (!elementBelongsToRoot(element, root)) {
    throw new Error("Element does not belong to the requested composed-DOM root.");
  }

  if (element.id) {
    const idSelector = `#${escapeCssIdentifier(element.id)}`;
    try {
      if (root.querySelector(idSelector) === element) return idSelector;
    } catch {
      // Fall through to a structural selector if an id cannot be queried safely.
    }
  }

  const parts: string[] = [];
  let current: Element | null = element;
  while (current) {
    const tagName = current.tagName.toLowerCase();
    const currentTagName = current.tagName;
    const parent: Element | null = current.parentElement;
    const rootSiblings: Element[] = parent ? Array.from(parent.children) : Array.from(root.children);
    const siblings = rootSiblings.filter((candidate: Element) => candidate.tagName === currentTagName);
    const index = siblings.indexOf(current) + 1;
    parts.unshift(`${tagName}:nth-of-type(${Math.max(index, 1)})`);

    if (!parent || !elementBelongsToRoot(parent, root)) break;
    current = parent;
  }
  return parts.join(" > ");
}

export function hostInstanceIdForPortusElement(
  element: Element,
  environment: typeof globalThis = globalThis
): string {
  const identityGlobal = environment as PortusShadowIdentityGlobal;
  let state = identityGlobal.__portusShadowHostIdentityState;
  if (!state) {
    state = { hostIds: new WeakMap<Element, string>(), nextHostId: 1 };
    Object.defineProperty(identityGlobal, "__portusShadowHostIdentityState", {
      configurable: true,
      writable: true,
      value: state
    });
  }
  let id = state.hostIds.get(element);
  if (!id) {
    id = `sh_${String(state.nextHostId++).padStart(6, "0")}`;
    state.hostIds.set(element, id);
  }
  return id;
}

export function shadowRootForPortusElement(
  element: Element,
  environment: typeof globalThis = globalThis
): ShadowRoot | null {
  const openShadowRoot = element.shadowRoot;
  if (openShadowRoot) return openShadowRoot;

  const chromeDom = (environment as PortusChromeDomGlobal).chrome?.dom;
  const accessor = chromeDom?.openOrClosedShadowRoot;
  if (typeof accessor !== "function") return null;

  try {
    const candidate = accessor.call(chromeDom, element as HTMLElement);
    if (!candidate || typeof candidate !== "object") return null;
    const shadowRoot = candidate as Partial<ShadowRoot>;
    if ((shadowRoot.mode !== "open" && shadowRoot.mode !== "closed") || typeof shadowRoot.querySelector !== "function") return null;
    return candidate as ShadowRoot;
  } catch {
    return null;
  }
}

export function createPortusComposedDomRuntime(
  environment: typeof globalThis = globalThis
): PortusComposedDomRuntime {
  return {
    collect: (root = document) => collectPortusComposedDomElements(root, environment),
    selectorForElement: selectorForPortusComposedElement,
    shadowRootForElement: (element) => shadowRootForPortusElement(element, environment),
    hostInstanceIdForElement: (element) => hostInstanceIdForPortusElement(element, environment),
    closedShadowRootAccessAvailable: () => {
      const chromeDom = (environment as PortusChromeDomGlobal).chrome?.dom;
      const accessor = chromeDom?.openOrClosedShadowRoot;
      if (typeof accessor !== "function") return false;
      const probe = (environment as typeof globalThis & { document?: Document }).document?.documentElement;
      if (!probe) return true;
      try {
        accessor.call(chromeDom, probe);
        return true;
      } catch {
        return false;
      }
    }
  };
}

export function installPortusComposedDomRuntime(
  target: typeof globalThis = globalThis
): PortusComposedDomRuntime {
  const runtime = createPortusComposedDomRuntime(target);
  (target as typeof globalThis & { __portusComposedDom?: PortusComposedDomRuntime }).__portusComposedDom = runtime;
  return runtime;
}

function elementBelongsToRoot(element: Element, root: Document | ShadowRoot): boolean {
  return element.getRootNode() === root;
}

function escapeCssIdentifier(value: string): string {
  const cssApi = globalThis.CSS;
  if (cssApi && typeof cssApi.escape === "function") return cssApi.escape(value);
  return value.replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (match, leadingDigit: string | undefined) => {
    if (leadingDigit) return `\\3${leadingDigit} `;
    const codePoint = match.codePointAt(0);
    return codePoint === undefined ? "" : `\\${codePoint.toString(16)} `;
  });
}
