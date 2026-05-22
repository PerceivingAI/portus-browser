import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getRecipeFromLibrary,
  listRecipeLibrary
} from "@portus/recipes";
import { deserializeTransportFrame, getWindowsNamedPipePath, serializeTransportFrame } from "@portus/transport";
import { NamedPipeBrokerClient, runPortusBrowserCli } from "../dist/index.js";

const browsers = [
  browser("br_000001", "Chrome", "Main", "2026-04-28T00:00:00.000Z"),
  browser("br_000002", "Edge", "Work", "2026-04-28T00:01:00.000Z")
];

const tabs = [
  tab("br_000001", 22, 10, 1, false, "Second", "https://example.com/b"),
  tab("br_000001", 11, 10, 0, true, "First", "https://example.com/a")
];

test("browsers renders bridge-connected browsers as table", async () => {
  const broker = createMockBroker({
    "browser.list": { browsers }
  });

  const result = await runPortusBrowserCli(["browsers"], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /INDEX\s+BROWSER_ID\s+BROWSER/);
  assert.match(result.stdout, /1\s+br_000001\s+Chrome\s+Main\s+connected/);
  assert.deepEqual(broker.requests.map((request) => request.type), ["browser.list"]);
});

test("browsers renders stable json output", async () => {
  const broker = createMockBroker({
    "browser.list": { browsers: [] }
  });

  const result = await runPortusBrowserCli(["browsers", "--json"], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, browsers: [] });
});

test("uses configured command timeout by default and lets --timeout override it", async () => {
  const defaultBroker = createMockBroker({
    "browser.list": { browsers: [] }
  });
  const overrideBroker = createMockBroker({
    "browser.list": { browsers: [] }
  });

  await runPortusBrowserCli(["browsers"], {
    brokerClient: defaultBroker,
    config: { commands: { timeoutMs: 42 } }
  });
  await runPortusBrowserCli(["browsers", "--timeout", "7"], {
    brokerClient: overrideBroker,
    config: { commands: { timeoutMs: 42 } }
  });

  assert.equal(defaultBroker.requests[0].timeoutMs, 42);
  assert.equal(overrideBroker.requests[0].timeoutMs, 7);
});

test("tabs resolves browser display index before requesting tabs", async () => {
  const broker = createMockBroker({
    "browser.list": { browsers },
    "tab.list": { tabs }
  });

  const result = await runPortusBrowserCli(["tabs", "--browser", "1", "--json"], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(broker.requests.map((request) => request.type), ["browser.list", "tab.list"]);
  assert.equal(broker.requests[1].payload.browserId, "br_000001");
  const output = JSON.parse(result.stdout);
  assert.equal(output.browserId, "br_000001");
  assert.deepEqual(output.tabs.map((item) => item.tabId), [11, 22]);
});

test("tabs accepts browser ids directly", async () => {
  const broker = createMockBroker({
    "tab.list": { tabs: [] }
  });

  const result = await runPortusBrowserCli(["tabs", "--browser", "br_000002"], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(broker.requests.map((request) => request.type), ["tab.list"]);
  assert.equal(broker.requests[0].payload.browserId, "br_000002");
});

test("tab gets by tab id and resolves tab display index", async () => {
  const broker = createMockBroker({
    "browser.list": { browsers },
    "tab.list": { tabs },
    "tab.get": { tab: tab("br_000001", 22, 10, 1, false, "Second", "https://example.com/b") }
  });

  const byId = await runPortusBrowserCli(["tab", "--browser", "br_000001", "--tab-id", "22", "--json"], { brokerClient: broker });
  const byIndex = await runPortusBrowserCli(["tab", "--browser", "1", "--index", "2", "--json"], { brokerClient: broker });

  assert.equal(byId.exitCode, 0);
  assert.equal(byIndex.exitCode, 0);
  assert.deepEqual(broker.requests.map((request) => request.type), ["tab.get", "browser.list", "tab.list", "tab.get"]);
  assert.equal(broker.requests[3].payload.tabId, 22);
  assert.equal(JSON.parse(byIndex.stdout).tab.tabId, 22);
});

test("open normalizes url and lets broker select default browser", async () => {
  const broker = createMockBroker({
    "tab.open": { tab: tab("br_000001", 33, 10, 2, true, "Example", "https://example.com/") }
  });

  const result = await runPortusBrowserCli(["open", "example.com", "--json"], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(broker.requests.map((request) => request.type), ["tab.open"]);
  assert.equal(broker.requests[0].payload.url, "https://example.com/");
  assert.equal(broker.requests[0].payload.active, true);
  assert.equal("browserId" in broker.requests[0].payload, false);
  assert.equal(JSON.parse(result.stdout).tab.tabId, 33);
});

test("open resolves browser index and supports background tabs", async () => {
  const broker = createMockBroker({
    "browser.list": { browsers },
    "tab.open": { tab: tab("br_000002", 44, 12, 0, false, "Docs", "https://docs.example.com/") }
  });

  const result = await runPortusBrowserCli(["open", "https://docs.example.com", "--browser", "2", "--background", "--json"], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(broker.requests.map((request) => request.type), ["browser.list", "tab.open"]);
  assert.equal(broker.requests[1].payload.browserId, "br_000002");
  assert.equal(broker.requests[1].payload.active, false);
});

test("navigate resolves browser index and sends existing-tab URL update", async () => {
  const broker = createMockBroker({
    "browser.list": { browsers },
    "tab.navigate": { tab: tab("br_000002", 44, 12, 0, true, "Docs", "https://docs.example.com/") }
  });

  const result = await runPortusBrowserCli(["navigate", "docs.example.com", "--browser", "2", "--tab-id", "44", "--json"], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(broker.requests.map((request) => request.type), ["browser.list", "tab.navigate"]);
  assert.equal(broker.requests[1].payload.browserId, "br_000002");
  assert.equal(broker.requests[1].payload.tabId, 44);
  assert.equal(broker.requests[1].payload.url, "https://docs.example.com/");
  assert.equal(JSON.parse(result.stdout).tab.tabId, 44);
});

test("back and forward send existing-tab history commands", async () => {
  const broker = createMockBroker({
    "tab.history.back": { tab: tab("br_000001", 44, 12, 0, true, "Previous", "https://example.com/previous") },
    "tab.history.forward": { tab: tab("br_000001", 44, 12, 0, true, "Next", "https://example.com/next") }
  });

  const back = await runPortusBrowserCli(["back", "--browser", "br_000001", "--tab-id", "44", "--json"], { brokerClient: broker });
  const forward = await runPortusBrowserCli(["forward", "--browser", "br_000001", "--tab-id", "44", "--json"], { brokerClient: broker });

  assert.equal(back.exitCode, 0);
  assert.equal(forward.exitCode, 0);
  assert.deepEqual(broker.requests.map((request) => request.type), ["tab.history.back", "tab.history.forward"]);
  assert.equal(broker.requests[0].payload.tabId, 44);
  assert.equal(broker.requests[1].payload.tabId, 44);
  assert.equal(JSON.parse(forward.stdout).tab.url, "https://example.com/next");
});

test("activate-tab and close-tab send tab commands", async () => {
  const broker = createMockBroker({
    "tab.activate": { tab: tab("br_000001", 22, 10, 1, true, "Second", "https://example.com/b") },
    "tab.close": { closed: true, tabId: 22 }
  });

  const activate = await runPortusBrowserCli(["activate-tab", "--browser", "br_000001", "--tab-id", "22", "--json"], { brokerClient: broker });
  const close = await runPortusBrowserCli(["close-tab", "--browser", "br_000001", "--tab-id", "22", "--yes", "--json"], { brokerClient: broker });

  assert.equal(activate.exitCode, 0);
  assert.equal(close.exitCode, 0);
  assert.deepEqual(broker.requests.map((request) => request.type), ["tab.activate", "tab.close"]);
  assert.equal(JSON.parse(close.stdout).closed, true);
});

test("screenshot resolves browser and tab targets", async () => {
  const broker = createMockBroker({
    "browser.list": { browsers },
    "screenshot.capture": { screenshot: screenshot("br_000001", 11, true) }
  });

  const result = await runPortusBrowserCli(["screenshot", "--browser", "1", "--tab-id", "11", "--json"], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(broker.requests.map((request) => request.type), ["browser.list", "screenshot.capture"]);
  assert.equal(broker.requests[1].payload.browserId, "br_000001");
  assert.equal(broker.requests[1].payload.tabId, 11);
  assert.equal(JSON.parse(result.stdout).screenshot.activatedTabBeforeCapture, true);
});

test("snapshot validates and renders snapshot output", async () => {
  const broker = createMockBroker({
    "snapshot.capture": { snapshot: snapshot("br_000001", 11) }
  });

  const result = await runPortusBrowserCli(["snapshot", "--browser", "br_000001", "--tab-id", "11"], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /SNAPSHOT_ID\s+BROWSER_ID\s+TAB_ID/);
  assert.equal(broker.requests[0].type, "snapshot.capture");
});

test("snapshot sends optional filters", async () => {
  const filtered = {
    ...snapshot("br_000001", 11),
    filtered: true,
    filter: {
      query: "reviews",
      role: "link",
      interactiveOnly: true,
      maxElements: 5
    }
  };
  const broker = createMockBroker({
    "snapshot.capture": { snapshot: filtered }
  });

  const result = await runPortusBrowserCli([
    "snapshot",
    "--browser",
    "br_000001",
    "--tab-id",
    "11",
    "--query",
    "reviews",
    "--role",
    "link",
    "--interactive-only",
    "--max-elements",
    "5",
    "--json"
  ], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(broker.requests[0].payload.filter, {
    query: "reviews",
    role: "link",
    interactiveOnly: true,
    maxElements: 5
  });
  const output = JSON.parse(result.stdout);
  assert.equal(output.snapshot.filtered, true);
  assert.equal(output.snapshot.snapshotId, "snap_000001");
  assert.equal(output.snapshot.elements[0].elementId, "el_000001");
});

test("click, hover, drag, fill-form, and type send DOM action payloads", async () => {
  const broker = createMockBroker({
    "action.click": { action: actionResult("click") },
    "action.hover": { action: actionResult("hover") },
    "action.drag": { action: actionResult("drag") },
    "action.fillForm": { fillForm: fillFormResult() },
    "action.type": { action: actionResult("type") }
  });

  const click = await runPortusBrowserCli([
    "click",
    "--browser",
    "br_000001",
    "--tab-id",
    "11",
    "--snapshot",
    "snap_000001",
    "--element",
    "el_000001",
    "--json"
  ], { brokerClient: broker });
  const type = await runPortusBrowserCli([
    "type",
    "--browser",
    "br_000001",
    "--tab-id",
    "11",
    "--snapshot",
    "snap_000001",
    "--element",
    "el_000001",
    "Ada",
    "--json"
  ], { brokerClient: broker });
  const hover = await runPortusBrowserCli([
    "hover",
    "--browser",
    "br_000001",
    "--tab-id",
    "11",
    "--snapshot",
    "snap_000001",
    "--element",
    "el_000001",
    "--json"
  ], { brokerClient: broker });
  const drag = await runPortusBrowserCli([
    "drag",
    "--browser",
    "br_000001",
    "--tab-id",
    "11",
    "--snapshot",
    "snap_000001",
    "--from",
    "el_000001",
    "--to",
    "el_000002",
    "--json"
  ], { brokerClient: broker });
  const fill = await runPortusBrowserCli([
    "fill-form",
    "--browser",
    "br_000001",
    "--tab-id",
    "11",
    "--snapshot",
    "snap_000001",
    "--field",
    "el_000001=Ada",
    "--field",
    "el_000002=Lovelace",
    "--json"
  ], { brokerClient: broker });

  assert.equal(click.exitCode, 0);
  assert.equal(type.exitCode, 0);
  assert.equal(hover.exitCode, 0);
  assert.equal(drag.exitCode, 0);
  assert.equal(fill.exitCode, 0);
  assert.equal(broker.requests[0].payload.elementId, "el_000001");
  assert.equal(broker.requests[1].payload.text, "Ada");
  assert.equal(broker.requests[2].type, "action.hover");
  assert.equal(broker.requests[3].type, "action.drag");
  assert.equal(broker.requests[3].payload.sourceElementId, "el_000001");
  assert.equal(broker.requests[4].type, "action.fillForm");
  assert.equal(broker.requests[4].payload.fields.length, 2);
});

test("wait routes tab and page conditions to broker commands", async () => {
  const broker = createMockBroker({
    "tab.wait": { wait: waitResult("current-tab") },
    "page.wait": { wait: waitResult("page-script") }
  });

  const tabWait = await runPortusBrowserCli(["wait", "--browser", "br_000001", "--tab-id", "11", "--state", "complete", "--url-contains", "example", "--json"], { brokerClient: broker });
  const pageWait = await runPortusBrowserCli(["wait", "--browser", "br_000001", "--tab-id", "11", "--text", "Reviews", "--json"], { brokerClient: broker });

  assert.equal(tabWait.exitCode, 0);
  assert.equal(pageWait.exitCode, 0);
  assert.equal(broker.requests[0].type, "tab.wait");
  assert.equal(broker.requests[0].payload.urlContains, "example");
  assert.equal(broker.requests[1].type, "page.wait");
  assert.equal(broker.requests[1].payload.text, "Reviews");
  assert.equal(JSON.parse(pageWait.stdout).wait.source, "page-script");
});

test("press and scroll send action payloads", async () => {
  const broker = createMockBroker({
    "action.press": { action: actionResult("press") },
    "action.scroll": { action: actionResult("scroll") }
  });

  const press = await runPortusBrowserCli(["press", "--browser", "br_000001", "--tab-id", "11", "Enter"], { brokerClient: broker });
  const scroll = await runPortusBrowserCli(["scroll", "--browser", "br_000001", "--tab-id", "11", "--x", "4", "--y", "200", "--json"], { brokerClient: broker });

  assert.equal(press.exitCode, 0);
  assert.equal(scroll.exitCode, 0);
  assert.equal(broker.requests[0].payload.key, "Enter");
  assert.equal(broker.requests[1].payload.deltaX, 4);
  assert.equal(broker.requests[1].payload.deltaY, 200);
});

test("dismiss sends popup cleanup payloads and renders result", async () => {
  const broker = createMockBroker({
    "browser.list": { browsers },
    "page.dismiss": { dismiss: dismissResult() }
  });

  const result = await runPortusBrowserCli([
    "dismiss",
    "--browser",
    "1",
    "--tab-id",
    "11",
    "--kind",
    "cookie",
    "--strategy",
    "conservative",
    "--dry-run"
  ], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /DISMISSED\s+DRY_RUN\s+KIND/);
  assert.deepEqual(broker.requests.map((request) => request.type), ["browser.list", "page.dismiss"]);
  assert.deepEqual(broker.requests[1].payload, {
    browserId: "br_000001",
    tabId: 11,
    kind: "cookie",
    strategy: "conservative",
    dryRun: true
  });
});

test("permissions list renders extension allowlist and request/revoke are GUI-first", async () => {
  const broker = createMockBroker({
    "browser.list": { browsers },
    "permission.list": {
      permissions: [{
        origin: "https://example.com",
        granted: true,
        source: "extension",
        scope: "origin",
        requestedAt: "2026-04-28T00:00:00.000Z",
        grantedAt: "2026-04-28T00:00:00.000Z",
        reason: "manual test"
      }]
    }
  });

  const listed = await runPortusBrowserCli(["permissions", "list", "--browser", "1", "--json"], { brokerClient: broker });
  const request = await runPortusBrowserCli(["permissions", "request", "https://example.com", "--browser", "1", "--json"], { brokerClient: broker });

  assert.equal(listed.exitCode, 0);
  assert.deepEqual(broker.requests.map((item) => item.type), ["browser.list", "permission.list"]);
  assert.equal(broker.requests[1].payload.browserId, "br_000001");
  assert.equal(JSON.parse(listed.stdout).permissions[0].origin, "https://example.com");
  assert.equal(request.exitCode, 2);
  assert.match(JSON.parse(request.stderr).error.message, /GUI-first/);
});

test("policy commands route visible-browser allow, block, and retention updates", async () => {
  const broker = createMockBroker({
    "browser.list": { browsers },
    "policy.get": {
      policy: policy({
        allowedOrigins: [policyEntry("https://allowed.example", "extension")],
        blockedOrigins: [policyEntry("https://blocked.example", "extension")],
        sessionStepRetentionLimit: 10
      })
    },
    "policy.allow.add": {
      policy: policy({
        allowedOrigins: [policyEntry("https://example.com", "cli")],
        blockedOrigins: [],
        sessionStepRetentionLimit: 10
      })
    },
    "policy.block.add": {
      policy: policy({
        allowedOrigins: [],
        blockedOrigins: [policyEntry("*.tripadvisor.com", "cli")],
        sessionStepRetentionLimit: 10
      })
    },
    "policy.block.remove": {
      policy: policy({
        allowedOrigins: [],
        blockedOrigins: [],
        sessionStepRetentionLimit: 10
      })
    },
    "policy.retention.set": {
      policy: policy({
        allowedOrigins: [],
        blockedOrigins: [],
        sessionStepRetentionLimit: 25
      })
    }
  });

  const allowList = await runPortusBrowserCli(["policy", "allow", "list", "--browser", "1", "--json"], { brokerClient: broker });
  const allowAdd = await runPortusBrowserCli(["policy", "allow", "add", "example.com", "--browser", "1", "--reason", "manual", "--json"], { brokerClient: broker });
  const blockAddWildcard = await runPortusBrowserCli(["policy", "block", "add", "*.tripadvisor.com", "--browser", "br_000001", "--reason", "manual", "--json"], { brokerClient: broker });
  const blockRemove = await runPortusBrowserCli(["policy", "block", "remove", "https://blocked.example", "--browser", "br_000001", "--json"], { brokerClient: broker });
  const retentionSet = await runPortusBrowserCli(["policy", "retention", "set", "25", "--browser", "br_000001", "--json"], { brokerClient: broker });

  assert.equal(allowList.exitCode, 0);
  assert.equal(allowAdd.exitCode, 0);
  assert.equal(blockAddWildcard.exitCode, 0);
  assert.equal(blockRemove.exitCode, 0);
  assert.equal(retentionSet.exitCode, 0);
  assert.deepEqual(broker.requests.map((item) => item.type), [
    "browser.list",
    "policy.get",
    "browser.list",
    "policy.allow.add",
    "policy.block.add",
    "policy.block.remove",
    "policy.retention.set"
  ]);
  assert.equal(broker.requests[3].payload.origin, "https://example.com");
  assert.equal(broker.requests[3].payload.reason, "manual");
  assert.equal(broker.requests[4].payload.origin, "*.tripadvisor.com");
  assert.equal(JSON.parse(allowList.stdout).entries[0].origin, "https://allowed.example");
  assert.equal(JSON.parse(retentionSet.stdout).retention, 25);
});

test("recipes manages local recipe records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-cli-recipes-"));
  const broker = createMockBroker({});

  const created = await runPortusBrowserCli([
    "recipes", "create", "morning", "Morning", "--content", "Open mail and calendar.", "--directory", directory, "--json"
  ], { brokerClient: broker });
  assert.equal(created.exitCode, 0);
  assert.equal(JSON.parse(created.stdout).recipe.id, "morning");

  const listed = await runPortusBrowserCli(["recipes", "--directory", directory], { brokerClient: broker });
  assert.equal(listed.exitCode, 0);
  assert.match(listed.stdout, /RECIPE_ID\s+NAME\s+KIND\s+RICH_SCHEMA\s+ISSUES/);
  assert.match(listed.stdout, /morning\s+Morning/);

  const searched = await runPortusBrowserCli(["recipes", "search", "mail", "--directory", directory, "--json"], { brokerClient: broker });
  assert.equal(JSON.parse(searched.stdout).recipes[0].id, "morning");

  const shown = await runPortusBrowserCli(["recipes", "show", "morning", "--directory", directory, "--json"], { brokerClient: broker });
  assert.equal(JSON.parse(shown.stdout).recipe.content, "Open mail and calendar.");

  const used = await runPortusBrowserCli(["recipes", "use", "mail and calendar", "--directory", directory, "--json"], { brokerClient: broker });
  assert.equal(JSON.parse(used.stdout).recipe.id, "morning");
  assert.equal(JSON.parse(used.stdout).readOnly, true);

  const updated = await runPortusBrowserCli([
    "recipes", "update", "morning", "--content", "Open mail, calendar, and dashboard.", "--directory", directory, "--json"
  ], { brokerClient: broker });
  assert.equal(JSON.parse(updated.stdout).recipe.content, "Open mail, calendar, and dashboard.");

  const renamed = await runPortusBrowserCli(["recipes", "rename", "morning", "Morning Setup", "--directory", directory, "--json"], { brokerClient: broker });
  assert.equal(JSON.parse(renamed.stdout).recipe.name, "Morning Setup");

  const validation = await runPortusBrowserCli(["recipes", "validate", "morning", "--directory", directory, "--json"], { brokerClient: broker });
  assert.equal(JSON.parse(validation.stdout).ok, true);

  const duplicated = await runPortusBrowserCli(["recipes", "duplicate", "morning", "morning-copy", "--directory", directory, "--json"], { brokerClient: broker });
  assert.equal(JSON.parse(duplicated.stdout).recipe.id, "morning-copy");

  const deletedWithoutConfirmation = await runPortusBrowserCli(["recipes", "delete", "morning-copy", "--directory", directory, "--json"], { brokerClient: broker });
  assert.equal(deletedWithoutConfirmation.exitCode, 2);

  const deleted = await runPortusBrowserCli(["recipes", "delete", "morning-copy", "--directory", directory, "--yes", "--json"], { brokerClient: broker });
  assert.equal(JSON.parse(deleted.stdout).deleted, true);
  assert.deepEqual(broker.requests.map((request) => request.type), ["recipe.list", "recipe.search", "recipe.get", "recipe.resolve"]);
});

test("recipes imports exports and protects overwrites", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-cli-recipes-"));
  const sourceDirectory = await mkdtemp(join(tmpdir(), "portus-cli-recipe-source-"));
  const exportPath = join(await mkdtemp(join(tmpdir(), "portus-cli-recipe-export-")), "news-export.json");
  const sourcePath = join(sourceDirectory, "news.json");
  await writeFile(sourcePath, `${JSON.stringify({
    id: "news",
    name: "News",
    content: "Restore news tabs."
  }, null, 2)}\n`, "utf8");

  const imported = await runPortusBrowserCli(["recipes", "import", sourcePath, "--directory", directory, "--json"], { brokerClient: createMockBroker({}) });
  assert.equal(imported.exitCode, 0);
  const duplicateImport = await runPortusBrowserCli(["recipes", "import", sourcePath, "--directory", directory, "--json"], { brokerClient: createMockBroker({}) });
  assert.notEqual(duplicateImport.exitCode, 0);

  const exported = await runPortusBrowserCli(["recipes", "export", "news", "--output", exportPath, "--directory", directory, "--json"], { brokerClient: createMockBroker({}) });
  assert.equal(exported.exitCode, 0);
  assert.equal(JSON.parse(await readFile(exportPath, "utf8")).id, "news");
  const duplicateExport = await runPortusBrowserCli(["recipes", "export", "news", "--output", exportPath, "--directory", directory, "--json"], { brokerClient: createMockBroker({}) });
  assert.notEqual(duplicateExport.exitCode, 0);
});

test("recipes import wraps plain text files and rename keeps stable ids", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-cli-recipes-"));
  const sourceDirectory = await mkdtemp(join(tmpdir(), "portus-cli-recipe-source-"));
  const sourcePath = join(sourceDirectory, "daily briefing.txt");
  await writeFile(sourcePath, "Open the saved news tabs and summarize headlines.", "utf8");
  const broker = createMockBroker({});

  const imported = await runPortusBrowserCli([
    "recipes", "import", sourcePath, "--directory", directory, "--id", "daily-briefing", "--name", "Daily Briefing", "--json"
  ], { brokerClient: broker });
  assert.equal(imported.exitCode, 0);
  const importedOutput = JSON.parse(imported.stdout);
  assert.equal(importedOutput.recipe.id, "daily-briefing");
  assert.equal(importedOutput.recipe.name, "Daily Briefing");
  assert.equal(importedOutput.recipe.content, "Open the saved news tabs and summarize headlines.");
  assert.equal(importedOutput.filePath.endsWith("daily-briefing.json"), true);

  const renamed = await runPortusBrowserCli([
    "recipes", "rename", "daily-briefing", "Morning Briefing", "--directory", directory, "--json"
  ], { brokerClient: broker });
  const renamedOutput = JSON.parse(renamed.stdout);
  assert.equal(renamedOutput.recipe.id, "daily-briefing");
  assert.equal(renamedOutput.recipe.name, "Morning Briefing");
  assert.equal(renamedOutput.filePath.endsWith("daily-briefing.json"), true);
  assert.deepEqual(broker.requests, []);
});

test("recipes round-trips preferred structured records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-cli-recipes-"));
  const recipe = {
    id: "cancun-hotels",
    name: "Cancun Hotels",
    kind: "retrieval-workflow",
    intent: "Find popular Cancun hotels and collect the latest reviews.",
    savedContext: {
      site: "Tripadvisor",
      location: "Cancun"
    },
    desiredState: {
      sort: "most popular",
      hotelCount: 5,
      reviewsPerHotel: 3
    },
    output: {
      mode: "file",
      format: "csv",
      destination: "downloads",
      filenamePattern: "cancun-hotels-{timestamp}.csv"
    },
    examples: ["use the cancun-hotels workflow"]
  };
  const broker = createMockBroker({});

  const created = await runPortusBrowserCli([
    "recipes", "create", "cancun-hotels", "--json-input", JSON.stringify(recipe), "--directory", directory, "--json"
  ], { brokerClient: broker });
  assert.equal(created.exitCode, 0);
  assert.equal(JSON.parse(created.stdout).recipe.output.format, "csv");

  const shown = await runPortusBrowserCli(["recipes", "show", "cancun-hotels", "--directory", directory, "--json"], { brokerClient: broker });
  assert.equal(JSON.parse(shown.stdout).richSchemaOk, true);
  assert.deepEqual(JSON.parse(shown.stdout).issues, []);

  const used = await runPortusBrowserCli(["recipes", "use", "Cancun hotels", "--directory", directory, "--json"], { brokerClient: broker });
  const useOutput = JSON.parse(used.stdout);
  assert.equal(useOutput.readOnly, true);
  assert.equal(useOutput.recipe.id, "cancun-hotels");
  assert.equal(useOutput.recipe.intent, recipe.intent);

  const duplicated = await runPortusBrowserCli([
    "recipes", "duplicate", "cancun-hotels", "cancun-hotels-copy", "--directory", directory, "--json"
  ], { brokerClient: broker });
  assert.equal(JSON.parse(duplicated.stdout).recipe.id, "cancun-hotels-copy");
  assert.equal(JSON.parse(duplicated.stdout).recipe.output.filenamePattern, "cancun-hotels-{timestamp}.csv");
  assert.deepEqual(broker.requests.map((request) => request.type), ["recipe.get", "recipe.resolve"]);
});

test("recipes use reports ambiguous matches through broker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-cli-recipes-"));
  const broker = createMockBroker({});

  await runPortusBrowserCli([
    "recipes", "create", "news-work", "News Work", "--content", "Open work news tabs.", "--directory", directory, "--json"
  ], { brokerClient: broker });
  await runPortusBrowserCli([
    "recipes", "create", "news-personal", "News Personal", "--content", "Open personal news tabs.", "--directory", directory, "--json"
  ], { brokerClient: broker });

  const result = await runPortusBrowserCli(["recipes", "use", "news", "--directory", directory, "--json"], { brokerClient: broker });
  assert.equal(result.exitCode, 1);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, "RECIPE_INVALID");
  assert.equal(error.details.matches.length, 2);
  assert.deepEqual(broker.requests.map((request) => request.type), ["recipe.resolve"]);
});

test("recipes create reports invalid JSON input as recipe diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-cli-recipes-"));
  const result = await runPortusBrowserCli([
    "recipes", "create", "broken", "--json-input", "{", "--directory", directory, "--json"
  ], { brokerClient: createMockBroker({}) });

  assert.equal(result.exitCode, 1);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, "RECIPE_INVALID");
  assert.equal(error.details.source, "--json-input");
});

test("invalid usage returns code 2", async () => {
  const result = await runPortusBrowserCli(["tabs", "--json"], { brokerClient: createMockBroker({}) });

  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).error.code, "INVALID_MESSAGE");
});

test("settings profile rename and delete are not CLI commands", async () => {
  const broker = createMockBroker({});
  const rename = await runPortusBrowserCli(["profiles", "rename", "Profile_1", "Work_Profile", "--json"], { brokerClient: broker });
  const deleted = await runPortusBrowserCli(["profiles", "delete", "Profile_1", "--json"], { brokerClient: broker });

  assert.equal(rename.exitCode, 2);
  assert.equal(deleted.exitCode, 2);
  assert.match(JSON.parse(rename.stderr).error.message, /Unknown command: profiles/);
  assert.match(JSON.parse(deleted.stderr).error.message, /Unknown command: profiles/);
  assert.deepEqual(broker.requests, []);
});

test("broker errors map to documented exit codes", async () => {
  const broker = createMockBroker({}, {
    "browser.list": {
      code: "BROKER_UNAVAILABLE",
      message: "Portus Broker is unavailable.",
      retryable: true
    },
    "screenshot.capture": {
      code: "ORIGIN_BLOCKED",
      message: "Portus policy blocks browser control for https://blocked.example."
    },
    "policy.allow.add": {
      code: "COMMAND_DISABLED_BY_POLICY",
      message: "Portus policy disables command policy.allow.add."
    }
  });

  const result = await runPortusBrowserCli(["browsers", "--json"], { brokerClient: broker });
  const blocked = await runPortusBrowserCli(["screenshot", "--browser", "br_000001", "--json"], { brokerClient: broker });
  const disabled = await runPortusBrowserCli(["policy", "allow", "add", "https://example.com", "--browser", "br_000001", "--json"], { brokerClient: broker });

  assert.equal(result.exitCode, 4);
  assert.equal(JSON.parse(result.stderr).error.code, "BROKER_UNAVAILABLE");
  assert.equal(blocked.exitCode, 5);
  assert.equal(JSON.parse(blocked.stderr).error.code, "ORIGIN_BLOCKED");
  assert.equal(disabled.exitCode, 5);
  assert.equal(JSON.parse(disabled.stderr).error.code, "COMMAND_DISABLED_BY_POLICY");
});

test("events recent and session steps render retained history", async () => {
  const broker = createMockBroker({
    "browser.list": { browsers },
    "events.recent": { events: [event("evt_000001", "tab.created", "br_000001")] },
    "session.steps": { steps: [sessionStep("step_000001", "action.type", "completed")] }
  });

  const eventsResult = await runPortusBrowserCli(["events", "recent", "--browser", "1", "--type", "tab.created", "--limit", "5"], { brokerClient: broker });
  const stepsResult = await runPortusBrowserCli(["session", "steps", "--browser", "1", "--limit", "5"], { brokerClient: broker });

  assert.equal(eventsResult.exitCode, 0);
  assert.match(eventsResult.stdout, /evt_000001\s+tab.created/);
  assert.equal(stepsResult.exitCode, 0);
  assert.match(stepsResult.stdout, /step_000001\s+action.type\s+completed/);
  assert.deepEqual(broker.requests.map((request) => request.type), ["browser.list", "events.recent", "browser.list", "session.steps"]);
});

test("bridge disconnect routes through broker with required browser target", async () => {
  const broker = createMockBroker({
    "browser.list": { browsers },
    "bridge.disconnect": { disconnected: true }
  });

  const result = await runPortusBrowserCli(["bridge", "disconnect", "--browser", "1"], { brokerClient: broker });

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /DISCONNECTED/);
  assert.equal(broker.requests.at(-1).type, "bridge.disconnect");
  assert.deepEqual(broker.requests.at(-1).payload, { browserId: "br_000001", reason: "cli-requested" });
});

test("broker status and stop route through broker management requests", async () => {
  const broker = createMockBroker({
    "broker.status": {
      running: true,
      pipePath: "\\\\.\\pipe\\portus-browser-broker",
      pipeName: "portus-browser-broker",
      startedAt: "2026-04-28T00:00:00.000Z",
      protocolVersion: "1",
      processId: 123
    },
    "broker.stop": {
      stopping: true,
      pipePath: "\\\\.\\pipe\\portus-browser-broker",
      pipeName: "portus-browser-broker"
    }
  });

  const status = await runPortusBrowserCli(["broker", "status", "--json"], { brokerClient: broker });
  const stop = await runPortusBrowserCli(["broker", "stop", "--json"], { brokerClient: broker });

  assert.equal(status.exitCode, 0);
  assert.equal(stop.exitCode, 0);
  assert.deepEqual(broker.requests.map((request) => request.type), ["broker.status", "broker.stop"]);
  assert.equal(JSON.parse(status.stdout).broker.running, true);
  assert.equal(JSON.parse(stop.stdout).broker.stopping, true);
});

test("watch subscribes to live events and renders ndjson for --json", async () => {
  const broker = createMockBroker({ "browser.list": { browsers } }, {}, [event("evt_000001", "tab.created", "br_000001")]);
  const chunks = [];

  const result = await runPortusBrowserCli(["watch", "--browser", "1", "--json"], {
    brokerClient: broker,
    stdout: (chunk) => chunks.push(chunk)
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.match(chunks.join(""), /"eventId":"evt_000001"/);
  assert.deepEqual(broker.subscriptions[0].payload, { browserId: "br_000001" });
});

test("dialog, console, and network diagnostics route to broker commands", async () => {
  const broker = createMockBroker({
    "dialog.dismiss": { dialog: dialogResult("dismiss") },
    "console.list": { console: consoleResult() },
    "network.list": { network: networkListResult() },
    "network.get": { network: networkGetResult() }
  });

  const dialog = await runPortusBrowserCli(["dialog", "dismiss", "--browser", "br_000001", "--tab-id", "11", "--json"], { brokerClient: broker });
  const consoleList = await runPortusBrowserCli(["console", "list", "--browser", "br_000001", "--tab-id", "11", "--limit", "5", "--json"], { brokerClient: broker });
  const networkList = await runPortusBrowserCli(["network", "list", "--browser", "br_000001", "--tab-id", "11", "--json"], { brokerClient: broker });
  const networkGet = await runPortusBrowserCli(["network", "get", "req_net_1", "--browser", "br_000001", "--tab-id", "11", "--json"], { brokerClient: broker });

  assert.equal(dialog.exitCode, 0);
  assert.equal(consoleList.exitCode, 0);
  assert.equal(networkList.exitCode, 0);
  assert.equal(networkGet.exitCode, 0);
  assert.equal(broker.requests[0].type, "dialog.dismiss");
  assert.equal(broker.requests[1].type, "console.list");
  assert.equal(broker.requests[1].payload.limit, 5);
  assert.equal(broker.requests[2].type, "network.list");
  assert.equal(broker.requests[3].payload.requestId, "req_net_1");
});

test("named pipe broker client sends validated transport frames", async () => {
  const pipeName = `portus-browser-cli-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const pipePath = getWindowsNamedPipePath(pipeName);
  const seen = [];
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) return;
      const frame = deserializeTransportFrame(buffer.slice(0, newlineIndex));
      seen.push(frame.message);
      socket.write(serializeTransportFrame({
        protocolVersion: "1",
        requestId: frame.message.requestId,
        kind: "response",
        ok: true,
        result: { browsers: [] }
      }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(pipePath, resolve);
  });

  const client = new NamedPipeBrokerClient(pipePath, "test-broker-token");
  try {
    const result = await client.request("browser.list", { includeUnavailable: false }, 1000);
    assert.deepEqual(result, { browsers: [] });
    assert.equal(seen[0].type, "browser.list");
    assert.equal(seen[0].auth.brokerToken, "test-broker-token");
    assert.equal(seen[0].client.name, "portus-browser-cli");
  } finally {
    await client.close();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

function createMockBroker(results, errors = {}, events = []) {
  return {
    requests: [],
    subscriptions: [],
    async request(type, payload, timeoutMs) {
      this.requests.push({ type, payload, timeoutMs });
      if (errors[type]) throw errors[type];
      if (!results[type] && type.startsWith("recipe.")) return handleMockRecipeRequest(type, payload);
      if (!results[type]) throw {
        code: "INTERNAL_ERROR",
        message: `Unexpected request: ${type}`
      };
      return results[type];
    },
    async subscribeEvents(payload, onEvent, timeoutMs) {
      this.subscriptions.push({ payload, timeoutMs });
      if (errors["event.subscribe"]) throw errors["event.subscribe"];
      for (const event of events) onEvent(event);
    }
  };
}

async function handleMockRecipeRequest(type, payload) {
  const options = payload.directory === undefined ? {} : { directory: payload.directory };
  if (type === "recipe.list") {
    const library = await listRecipeLibrary(options);
    return {
      directory: library.directory,
      recipes: library.recipes.map((entry) => summarizeMockRecipe(entry.recipe, entry.richSchemaOk, entry.issues)),
      diagnostics: library.diagnostics
    };
  }
  if (type === "recipe.get") {
    const entry = await getRecipeFromLibrary(payload.recipeId, options);
    return {
      recipe: entry.recipe,
      richSchemaOk: entry.richSchemaOk,
      issues: entry.issues,
      diagnostics: []
    };
  }
  if (type === "recipe.search") {
    const library = await listRecipeLibrary(options);
    const query = String(payload.query).toLocaleLowerCase();
    return {
      directory: library.directory,
      recipes: library.recipes
        .filter((entry) => mockRecipeMatches(entry.recipe, query))
        .map((entry) => summarizeMockRecipe(entry.recipe, entry.richSchemaOk, entry.issues)),
      diagnostics: library.diagnostics
    };
  }
  if (type === "recipe.resolve") {
    const library = await listRecipeLibrary(options);
    const query = String(payload.query).toLocaleLowerCase();
    const exact = library.recipes.find((entry) => entry.recipe.id.toLocaleLowerCase() === query);
    const matches = exact === undefined
      ? library.recipes.filter((entry) => mockRecipeMatches(entry.recipe, query))
      : [exact];
    if (matches.length !== 1) {
      throw {
        code: "RECIPE_INVALID",
        message: matches.length === 0 ? "No recipe matched the requested query." : "Recipe query is ambiguous.",
        details: {
          query: payload.query,
          matches: matches.map((entry) => summarizeMockRecipe(entry.recipe, entry.richSchemaOk, entry.issues))
        }
      };
    }
    const entry = matches[0];
    return {
      recipe: entry.recipe,
      richSchemaOk: entry.richSchemaOk,
      issues: entry.issues,
      diagnostics: library.diagnostics
    };
  }
  throw {
    code: "INTERNAL_ERROR",
    message: `Unexpected request: ${type}`
  };
}

function summarizeMockRecipe(recipe, richSchemaOk, issues) {
  return {
    id: recipe.id,
    name: recipe.name,
    ...("kind" in recipe && recipe.kind !== undefined ? { kind: recipe.kind } : {}),
    ...("description" in recipe && recipe.description !== undefined ? { description: recipe.description } : {}),
    richSchemaOk,
    issues
  };
}

function mockRecipeMatches(recipe, query) {
  const examples = "examples" in recipe && Array.isArray(recipe.examples) ? recipe.examples : [];
  const content = "content" in recipe
    ? typeof recipe.content === "string"
      ? recipe.content
      : JSON.stringify(recipe.content)
    : undefined;
  return [
    recipe.id,
    recipe.name,
    "kind" in recipe ? recipe.kind : undefined,
    "description" in recipe ? recipe.description : undefined,
    "intent" in recipe ? recipe.intent : undefined,
    "notes" in recipe ? recipe.notes : undefined,
    ...examples,
    content
  ].some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(query));
}

function browser(browserId, browserName, browserLabel, connectedAt) {
  return {
    browserId,
    browserName,
    extensionVersion: "0.1.0",
    connectedAt,
    lastHeartbeat: connectedAt,
    capabilities: ["tabs", "windows", "permissions", "events"],
    bridgeStatus: "connected",
    status: "available",
    browserLabel
  };
}

function tab(browserId, tabId, windowId, index, active, title, url) {
  return {
    browserId,
    tabId,
    windowId,
    index,
    active,
    pinned: false,
    discarded: false,
    title,
    url,
    status: "complete"
  };
}

function screenshot(browserId, tabId, activatedTabBeforeCapture) {
  const result = {
    browserId,
    tabId,
    capturedAt: "2026-04-28T00:00:00.000Z",
    mimeType: "image/png",
    data: "data:image/png;base64,abc",
    activatedTabBeforeCapture
  };
  if (activatedTabBeforeCapture) result.previousActiveTabId = 10;
  return result;
}

function snapshot(browserId, tabId) {
  const shot = screenshot(browserId, tabId, false);
  return {
    snapshotId: "snap_000001",
    browserId,
    tabId,
    url: "https://example.com/",
    title: "Example",
    viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
    screenshot: shot,
    visibleText: "Submit",
    capturedAt: "2026-04-28T00:00:00.000Z",
    elements: [
      {
        elementId: "el_000001",
        role: "button",
        label: "Submit",
        text: "Submit",
        bounds: { x: 1, y: 2, width: 100, height: 40 },
        state: {},
        selectorHint: "button:nth-of-type(1)",
        tagName: "button"
      }
    ]
  };
}

function actionResult(action) {
  return {
    backend: "content-script-dom",
    completedAt: "2026-04-28T00:00:00.000Z",
    snapshotInvalidated: true,
    details: { action }
  };
}

function fillFormResult() {
  return {
    backend: "content-script-dom",
    completedAt: "2026-04-28T00:00:00.000Z",
    snapshotInvalidated: true,
    fields: [
      { elementId: "el_000001", ok: true },
      { elementId: "el_000002", ok: true }
    ],
    details: { fieldCount: 2 }
  };
}

function dialogResult(action) {
  return {
    handled: false,
    action,
    completedAt: "2026-04-28T00:00:00.000Z",
    details: { reason: "advanced backend unavailable" }
  };
}

function consoleResult() {
  return {
    captureStartedAt: "2026-04-28T00:00:00.000Z",
    messages: [{
      level: "error",
      text: "Example error",
      createdAt: "2026-04-28T00:00:00.000Z",
      source: "page",
      url: "https://example.com/"
    }]
  };
}

function networkListResult() {
  return {
    captureStartedAt: "2026-04-28T00:00:00.000Z",
    requests: [networkRecord()]
  };
}

function networkGetResult() {
  return {
    request: networkRecord()
  };
}

function networkRecord() {
  return {
    requestId: "req_net_1",
    tabId: 11,
    url: "https://example.com/",
    method: "GET",
    resourceType: "main_frame",
    statusCode: 200,
    startedAt: "2026-04-28T00:00:00.000Z",
    completedAt: "2026-04-28T00:00:01.000Z",
    redacted: true
  };
}

function waitResult(source) {
  return {
    browserId: "br_000001",
    tabId: 11,
    matched: true,
    source,
    condition: source === "page-script" ? { text: "Reviews" } : { state: "complete", urlContains: "example" },
    completedAt: "2026-04-28T00:00:00.000Z",
    url: "https://example.com/",
    title: "Example"
  };
}

function dismissResult() {
  return {
    strategy: "conservative",
    kind: "cookie",
    dryRun: true,
    dismissed: false,
    snapshotId: "snap_000001",
    elementId: "el_000001",
    label: "Reject all cookies",
    role: "button",
    reason: "cookie-reject-control"
  };
}

function event(eventId, type, browserId, overrides = {}) {
  return {
    protocolVersion: "1",
    eventId,
    kind: "event",
    type,
    createdAt: "2026-04-28T00:00:00.000Z",
    browserId,
    payload: { browserId },
    ...overrides
  };
}

function sessionStep(stepId, commandType, status) {
  return {
    stepId,
    browserId: "br_000001",
    commandType,
    status,
    createdAt: "2026-04-28T00:00:00.000Z",
    args: {
      text: "[redacted-text]"
    }
  };
}

function policy(overrides = {}) {
  return {
    policyMode: overrides.policyMode ?? "blocklist",
    allowedOrigins: overrides.allowedOrigins ?? [],
    blockedOrigins: overrides.blockedOrigins ?? [],
    commandPolicy: overrides.commandPolicy ?? {},
    sessionStepRetentionLimit: overrides.sessionStepRetentionLimit ?? 10
  };
}

function policyEntry(origin, source) {
  return {
    origin,
    source,
    updatedAt: "2026-04-28T00:00:00.000Z"
  };
}
