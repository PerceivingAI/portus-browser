import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  defaultRecipeLibraryDirectory,
  deleteRecipeFromLibrary,
  exportRecipeFromLibrary,
  getRecipeFromLibrary,
  importRecipeToLibrary,
  listRecipeLibrary,
  loadRecipeRecordFromFile,
  MinimalRecipeRecordSchema,
  parseRecipeRecord,
  PreferredRecipeSchema,
  recipeFileName,
  RecipeOutputSchema,
  RecipeRecordSchema,
  saveRecipeRecordToDirectory,
  serializeRecipeRecord,
  updateRecipeInLibrary,
  validateRecipeForManagement,
  wrapLooseRecipe
} from "../dist/index.js";

const now = "2026-04-28T00:00:00.000Z";

test("minimal recipe records validate with string content", () => {
  const recipe = MinimalRecipeRecordSchema.parse({
    id: "morning-setup",
    name: "Morning Setup",
    content: "Open mail, calendar, and the active project dashboard."
  });

  assert.equal(recipe.id, "morning-setup");
  assert.equal(RecipeRecordSchema.safeParse(recipe).success, true);
  assert.equal(parseRecipeRecord(JSON.stringify(recipe)).name, "Morning Setup");
});

test("preferred structured recipe validates with output expectations", () => {
  const output = RecipeOutputSchema.parse({
    mode: "file",
    format: "md",
    destination: "downloads",
    filenamePattern: "expedia-reviews-{timestamp}.md",
    fields: ["reviewer", "rating", "date", "text"],
    notes: "Include a short summary before the review table."
  });

  const recipe = PreferredRecipeSchema.parse({
    id: "expedia-latest-10",
    name: "Expedia Latest 10",
    kind: "retrieval-workflow",
    intent: "Get the latest 10 Expedia reviews for the saved restaurant.",
    description: "Use Expedia, open the saved restaurant page, sort reviews by most recent, and collect the latest 10.",
    savedContext: {
      restaurantUrl: "https://www.expedia.com/example-restaurant"
    },
    desiredState: {
      reviewSort: "most recent",
      count: 10
    },
    constraints: ["Do not change the listing.", "Report if the review section is unavailable."],
    output,
    notes: "Agent chooses the CLI/browser commands needed at runtime.",
    examples: ["use the expedia workflow for the latest 10"],
    createdAt: now,
    updatedAt: now
  });

  assert.equal(recipe.output.format, "md");
  assert.equal(RecipeRecordSchema.safeParse(recipe).success, true);
  assert.equal(validateRecipeForManagement(recipe).richSchemaOk, true);
});

test("loose recipes can be wrapped into management-valid records", () => {
  const recipe = wrapLooseRecipe({
    id: "news-setup",
    name: "News Setup",
    content: {
      goal: "Restore the saved news tabs.",
      tabs: [
        { url: "https://news.ycombinator.com", active: true },
        { url: "https://www.reuters.com", active: false }
      ]
    },
    kind: "browser-setup",
    source: "agent"
  });

  const validation = validateRecipeForManagement(recipe);
  assert.equal(validation.ok, true);
  assert.equal(validation.richSchemaOk, false);
  assert.equal(validation.issues[0].severity, "warning");
});

test("management validation rejects invalid ids and missing names", () => {
  assert.equal(validateRecipeForManagement({
    id: "Bad",
    name: "Bad",
    content: "Do the thing."
  }).ok, false);
  assert.equal(validateRecipeForManagement({
    id: "missing-name",
    content: "Do the thing."
  }).ok, false);
});

test("recipe library lists valid records and reports malformed records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-recipe-library-"));
  await saveRecipeRecordToDirectory({
    id: "z-workspace",
    name: "Workspace",
    content: "Open the workspace tabs."
  }, directory);
  await saveRecipeRecordToDirectory({
    id: "a-news",
    name: "News",
    content: {
      goal: "Restore saved news tabs."
    }
  }, directory);
  await writeFile(join(directory, "broken.json"), "{", "utf8");
  await writeFile(join(directory, "notes.txt"), "ignored", "utf8");

  const library = await listRecipeLibrary({ directory });
  assert.deepEqual(library.recipes.map((entry) => entry.recipe.id), ["a-news", "z-workspace"]);
  assert.equal(library.recipes.every((entry) => entry.issues[0].severity === "warning"), true);
  assert.equal(library.diagnostics.some((diagnostic) => diagnostic.filePath.endsWith("broken.json")), true);
});

test("recipe library gets saves updates and deletes inspectable recipe files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-recipe-library-"));
  const original = {
    id: "morning-setup",
    name: "Morning Setup",
    content: "Open mail and calendar."
  };

  const savedPath = await saveRecipeRecordToDirectory(original, directory);
  assert.equal(savedPath, join(directory, recipeFileName("morning-setup")));
  assert.equal(await readFile(savedPath, "utf8"), serializeRecipeRecord(original));
  assert.equal((await loadRecipeRecordFromFile(savedPath)).recipe.name, "Morning Setup");
  assert.equal((await getRecipeFromLibrary("morning-setup", { directory })).recipe.id, "morning-setup");

  await assert.rejects(() => saveRecipeRecordToDirectory(original, directory), { code: "RECIPE_INVALID" });

  await updateRecipeInLibrary("morning-setup", {
    ...original,
    content: "Open mail, calendar, and project dashboard."
  }, { directory });
  assert.equal((await getRecipeFromLibrary("morning-setup", { directory })).recipe.content, "Open mail, calendar, and project dashboard.");
  await assert.rejects(() => updateRecipeInLibrary("morning-setup", {
    ...original,
    id: "other"
  }, { directory }), { code: "RECIPE_INVALID" });

  await deleteRecipeFromLibrary("morning-setup", { directory });
  await assert.rejects(() => getRecipeFromLibrary("morning-setup", { directory }), { code: "RECIPE_INVALID" });
});

test("recipe library imports and exports without silent overwrite", async () => {
  const sourceDirectory = await mkdtemp(join(tmpdir(), "portus-recipe-source-"));
  const libraryDirectory = await mkdtemp(join(tmpdir(), "portus-recipe-library-"));
  const exportDirectory = await mkdtemp(join(tmpdir(), "portus-recipe-export-"));
  const sourcePath = join(sourceDirectory, "tripadvisor-cancun.json");
  const recipe = {
    id: "tripadvisor-cancun",
    name: "Tripadvisor Cancun",
    content: "Find Cancun hotels, sort by popularity, and return the latest reviews for the top results."
  };
  await writeFile(sourcePath, serializeRecipeRecord(recipe), "utf8");

  const importedPath = await importRecipeToLibrary(sourcePath, { directory: libraryDirectory });
  assert.equal(importedPath, join(libraryDirectory, recipeFileName("tripadvisor-cancun")));
  await assert.rejects(() => importRecipeToLibrary(sourcePath, { directory: libraryDirectory }), { code: "RECIPE_INVALID" });

  const exportedPath = await exportRecipeFromLibrary("tripadvisor-cancun", exportDirectory, {
    directory: libraryDirectory
  });
  assert.equal(exportedPath, join(exportDirectory, recipeFileName("tripadvisor-cancun")));
  assert.equal(await readFile(exportedPath, "utf8"), serializeRecipeRecord(recipe));
  await assert.rejects(() => exportRecipeFromLibrary("tripadvisor-cancun", exportDirectory, {
    directory: libraryDirectory
  }), { code: "RECIPE_INVALID" });
});

test("plain text imports are wrapped into json recipe records", async () => {
  const sourceDirectory = await mkdtemp(join(tmpdir(), "portus-recipe-source-"));
  const libraryDirectory = await mkdtemp(join(tmpdir(), "portus-recipe-library-"));
  const sourcePath = join(sourceDirectory, "morning notes.txt");
  await writeFile(sourcePath, "Open mail and calendar.\nThen open the project dashboard.\n", "utf8");

  const importedPath = await importRecipeToLibrary(sourcePath, { directory: libraryDirectory });
  assert.equal(importedPath, join(libraryDirectory, recipeFileName("morning-notes")));

  const entry = await getRecipeFromLibrary("morning-notes", { directory: libraryDirectory });
  assert.equal(entry.recipe.name, "morning notes");
  assert.equal(entry.recipe.content, "Open mail and calendar.\nThen open the project dashboard.");
  assert.equal(entry.recipe.source, "import:morning notes.txt");
  assert.equal(entry.filePath.endsWith(".json"), true);

  const overridePath = join(sourceDirectory, "loose.md");
  await writeFile(overridePath, "Search for the latest car industry news.", "utf8");
  await importRecipeToLibrary(overridePath, {
    directory: libraryDirectory,
    id: "car-news",
    name: "Car News"
  });
  assert.equal((await getRecipeFromLibrary("car-news", { directory: libraryDirectory })).recipe.name, "Car News");
});

test("representative recipe records round-trip as agent-readable fixtures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portus-recipe-library-"));
  const newsSetup = {
    id: "news-setup",
    name: "News Setup",
    kind: "browser-setup",
    intent: "Restore the saved news reading tabs and make the first tab active.",
    savedContext: {
      tabs: [
        { url: "https://news.ycombinator.com", active: true, index: 0 },
        { url: "https://www.reuters.com", active: false, index: 1 }
      ]
    },
    desiredState: {
      activeUrl: "https://news.ycombinator.com"
    },
    output: {
      mode: "conversation"
    },
    examples: ["save this as my news setup", "use the news setup"]
  };
  const cancunHotels = {
    id: "cancun-hotels",
    name: "Cancun Hotels",
    kind: "retrieval-workflow",
    intent: "Find popular Cancun hotels and collect recent review information.",
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

  await saveRecipeRecordToDirectory(newsSetup, directory);
  await saveRecipeRecordToDirectory(cancunHotels, directory);

  const library = await listRecipeLibrary({ directory });
  assert.deepEqual(library.recipes.map((entry) => entry.recipe.id), ["cancun-hotels", "news-setup"]);
  assert.equal(library.recipes.every((entry) => entry.richSchemaOk), true);
  assert.equal(library.recipes.every((entry) => entry.issues.length === 0), true);
  assert.deepEqual((await getRecipeFromLibrary("news-setup", { directory })).recipe.savedContext.tabs.map((tab) => tab.url), [
    "https://news.ycombinator.com",
    "https://www.reuters.com"
  ]);
  assert.equal((await getRecipeFromLibrary("cancun-hotels", { directory })).recipe.output.filenamePattern, "cancun-hotels-{timestamp}.csv");
});

test("default recipe library directory is user data storage, not app config", () => {
  assert.equal(
    defaultRecipeLibraryDirectory({ APPDATA: "C:\\Users\\Ada\\AppData\\Roaming" }, "win32"),
    "C:\\Users\\Ada\\AppData\\Roaming\\Portus Browser\\recipes"
  );
  assert.equal(
    defaultRecipeLibraryDirectory({ XDG_DATA_HOME: "/home/ada/.local/share" }, "linux"),
    "/home/ada/.local/share/portus-browser/recipes"
  );
});
