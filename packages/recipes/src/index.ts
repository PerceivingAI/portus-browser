import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, posix, win32 } from "node:path";
import { z } from "zod";
import {
  IsoDateTimeSchema,
  createPortusError,
  type PortusError
} from "@portus/protocol";

export const RecipeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

export const RecipeContentSchema = z.union([
  z.string().min(1),
  z.record(z.string(), z.unknown())
]);

export const RecipeOutputModeSchema = z.enum(["conversation", "file", "both"]);

export const RecipeOutputSchema = z.object({
  mode: RecipeOutputModeSchema.optional(),
  format: z.string().min(1).optional(),
  destination: z.string().min(1).nullable().optional(),
  filenamePattern: z.string().min(1).nullable().optional(),
  fields: z.array(z.string().min(1)).optional(),
  notes: z.string().min(1).optional()
}).strict();

export const MinimalRecipeRecordSchema = z.object({
  id: RecipeIdSchema,
  name: z.string().min(1),
  content: RecipeContentSchema,
  kind: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  createdAt: IsoDateTimeSchema.optional(),
  updatedAt: IsoDateTimeSchema.optional()
}).strict();

export const PreferredRecipeSchema = z.object({
  id: RecipeIdSchema,
  name: z.string().min(1),
  kind: z.string().min(1),
  intent: z.string().min(1),
  description: z.string().min(1).optional(),
  savedContext: z.record(z.string(), z.unknown()).optional(),
  desiredState: z.record(z.string(), z.unknown()).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  output: z.union([RecipeOutputSchema, z.string().min(1)]).optional(),
  notes: z.string().min(1).optional(),
  examples: z.array(z.string().min(1)).optional(),
  createdAt: IsoDateTimeSchema.optional(),
  updatedAt: IsoDateTimeSchema.optional()
}).strict();

export const RecipeRecordSchema = z.union([
  PreferredRecipeSchema,
  MinimalRecipeRecordSchema
]);

export const RecipeManagementIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  path: z.string(),
  message: z.string()
}).strict();

export const RecipeManagementValidationSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    richSchemaOk: z.boolean(),
    recipe: RecipeRecordSchema,
    issues: z.array(RecipeManagementIssueSchema)
  }).strict(),
  z.object({
    ok: z.literal(false),
    richSchemaOk: z.literal(false),
    issues: z.array(RecipeManagementIssueSchema)
  }).strict()
]);

export type RecipeId = z.infer<typeof RecipeIdSchema>;
export type RecipeContent = z.infer<typeof RecipeContentSchema>;
export type RecipeOutput = z.infer<typeof RecipeOutputSchema>;
export type MinimalRecipeRecord = z.infer<typeof MinimalRecipeRecordSchema>;
export type PreferredRecipe = z.infer<typeof PreferredRecipeSchema>;
export type RecipeRecord = z.infer<typeof RecipeRecordSchema>;
export type RecipeManagementIssue = z.infer<typeof RecipeManagementIssueSchema>;
export type RecipeManagementValidation = z.infer<typeof RecipeManagementValidationSchema>;

export interface SaveRecipeOptions {
  overwrite?: boolean;
}

export interface RecipeLibraryOptions {
  directory?: string;
}

export interface SaveRecipeRecordOptions {
  overwrite?: boolean;
}

export interface ImportRecipeOptions extends RecipeLibraryOptions, SaveRecipeRecordOptions {
  id?: string;
  name?: string;
}

export interface RecipeLibraryDiagnostic {
  filePath: string;
  recipeId?: string;
  severity: "error" | "warning";
  message: string;
  issues?: RecipeManagementIssue[];
}

export interface RecipeLibraryEntry {
  recipe: RecipeRecord;
  filePath: string;
  richSchemaOk: boolean;
  issues: RecipeManagementIssue[];
}

export interface RecipeLibraryListResult {
  directory: string;
  recipes: RecipeLibraryEntry[];
  diagnostics: RecipeLibraryDiagnostic[];
}

export interface WrapLooseRecipeOptions {
  id: string;
  name: string;
  content: RecipeContent;
  kind?: string;
  description?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function wrapLooseRecipe(input: WrapLooseRecipeOptions): MinimalRecipeRecord {
  const record = {
    id: input.id,
    name: input.name,
    content: input.content,
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt })
  };

  return MinimalRecipeRecordSchema.parse(record);
}

export function validateRecipeForManagement(input: unknown): RecipeManagementValidation {
  const parsedInput = parseRecipeRecordInput(input);
  if (!parsedInput.ok) return RecipeManagementValidationSchema.parse(parsedInput);

  const preferred = PreferredRecipeSchema.safeParse(parsedInput.value);
  if (preferred.success) {
    return RecipeManagementValidationSchema.parse({
      ok: true,
      richSchemaOk: true,
      recipe: preferred.data,
      issues: []
    });
  }

  const minimal = MinimalRecipeRecordSchema.safeParse(parsedInput.value);
  if (minimal.success) {
    return RecipeManagementValidationSchema.parse({
      ok: true,
      richSchemaOk: false,
      recipe: minimal.data,
      issues: [{
        severity: "warning",
        path: "",
        message: "Recipe is management-valid but does not match the preferred structured workflow schema."
      }]
    });
  }

  return RecipeManagementValidationSchema.parse({
    ok: false,
    richSchemaOk: false,
    issues: formatZodIssues(minimal.error)
  });
}

export function parseRecipeRecord(input: unknown): RecipeRecord {
  const validation = validateRecipeForManagement(input);
  if (!validation.ok) {
    throw recipeInvalid("Recipe does not match the minimal Portus recipe record schema.", {
      issues: validation.issues
    });
  }

  return validation.recipe;
}

export function serializeRecipeRecord(input: unknown): string {
  const recipe = parseRecipeRecord(input);
  return `${JSON.stringify(recipe, null, 2)}\n`;
}

export async function loadRecipeRecordFromFile(filePath: string): Promise<RecipeLibraryEntry> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    throw recipeInvalid("Recipe record file could not be loaded.", {
      path: filePath,
      reason: error instanceof Error ? error.message : "load failed"
    });
  }

  const validation = validateRecipeForManagement(text);
  if (!validation.ok) {
    throw recipeInvalid("Recipe record file is not management-valid.", {
      path: filePath,
      issues: validation.issues
    });
  }

  return {
    recipe: validation.recipe,
    filePath,
    richSchemaOk: validation.richSchemaOk,
    issues: validation.issues
  };
}

export async function listRecipeLibrary(
  options: RecipeLibraryOptions = {}
): Promise<RecipeLibraryListResult> {
  const directory = options.directory ?? defaultRecipeLibraryDirectory();
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    return {
      directory,
      recipes: [],
      diagnostics: [{
        filePath: directory,
        severity: "warning",
        message: error instanceof Error ? error.message : "Recipe library directory could not be read."
      }]
    };
  }

  const recipes: RecipeLibraryEntry[] = [];
  const diagnostics: RecipeLibraryDiagnostic[] = [];
  for (const entry of entries.filter((value) => value.endsWith(".json")).sort()) {
    const filePath = join(directory, entry);
    const result = await inspectRecipeRecordFile(filePath);
    if (result.ok) {
      recipes.push(result.entry);
      for (const issue of result.entry.issues) {
        diagnostics.push({
          filePath,
          recipeId: result.entry.recipe.id,
          severity: issue.severity,
          message: issue.message,
          issues: [issue]
        });
      }
    } else {
      diagnostics.push(result.diagnostic);
    }
  }

  return {
    directory,
    recipes: recipes.sort(compareRecipeLibraryEntries),
    diagnostics
  };
}

export async function getRecipeFromLibrary(
  recipeId: string,
  options: RecipeLibraryOptions = {}
): Promise<RecipeLibraryEntry> {
  const id = RecipeIdSchema.parse(recipeId);
  const directory = options.directory ?? defaultRecipeLibraryDirectory();
  return loadRecipeRecordFromFile(join(directory, recipeFileName(id)));
}

export async function saveRecipeRecordToDirectory(
  input: unknown,
  directory: string,
  options: SaveRecipeRecordOptions = {}
): Promise<string> {
  const recipe = parseRecipeRecord(input);
  const filePath = join(directory, recipeFileName(recipe.id));
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, serializeRecipeRecord(recipe), {
      encoding: "utf8",
      flag: options.overwrite === true ? "w" : "wx"
    });
    return filePath;
  } catch (error) {
    throw recipeInvalid("Recipe record file could not be saved.", {
      path: filePath,
      reason: error instanceof Error ? error.message : "save failed"
    });
  }
}

export async function updateRecipeInLibrary(
  recipeId: string,
  input: unknown,
  options: RecipeLibraryOptions = {}
): Promise<string> {
  const id = RecipeIdSchema.parse(recipeId);
  const recipe = parseRecipeRecord(input);
  if (recipe.id !== id) {
    throw recipeInvalid("Updated recipe id must match the target recipe id.", {
      recipeId: id,
      inputRecipeId: recipe.id
    });
  }

  return saveRecipeRecordToDirectory(recipe, options.directory ?? defaultRecipeLibraryDirectory(), {
    overwrite: true
  });
}

export async function deleteRecipeFromLibrary(
  recipeId: string,
  options: RecipeLibraryOptions = {}
): Promise<string> {
  const id = RecipeIdSchema.parse(recipeId);
  const directory = options.directory ?? defaultRecipeLibraryDirectory();
  const filePath = join(directory, recipeFileName(id));
  try {
    await rm(filePath);
    return filePath;
  } catch (error) {
    throw recipeInvalid("Recipe record file could not be deleted.", {
      path: filePath,
      reason: error instanceof Error ? error.message : "delete failed"
    });
  }
}

export async function importRecipeToLibrary(
  filePath: string,
  options: ImportRecipeOptions = {}
): Promise<string> {
  const recipe = extname(filePath).toLocaleLowerCase() === ".json"
    ? (await loadRecipeRecordFromFile(filePath)).recipe
    : await wrapPlainTextRecipeFile(filePath, options);

  return saveRecipeRecordToDirectory(recipe, options.directory ?? defaultRecipeLibraryDirectory(), {
    ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite })
  });
}

export async function exportRecipeFromLibrary(
  recipeId: string,
  destinationDirectory: string,
  options: RecipeLibraryOptions & SaveRecipeRecordOptions = {}
): Promise<string> {
  const entry = await getRecipeFromLibrary(recipeId, options);
  const destinationPath = join(destinationDirectory, basename(entry.filePath));
  try {
    await mkdir(destinationDirectory, { recursive: true });
    await copyFile(entry.filePath, destinationPath, options.overwrite === true ? 0 : 1);
    return destinationPath;
  } catch (error) {
    throw recipeInvalid("Recipe record file could not be exported.", {
      path: destinationPath,
      reason: error instanceof Error ? error.message : "export failed"
    });
  }
}

export function recipeFileName(recipeId: string): string {
  return `${RecipeIdSchema.parse(recipeId)}.json`;
}

export function defaultRecipeLibraryDirectory(
  environment: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === "win32") {
    return win32.join(environment.APPDATA ?? homedir(), "Portus Browser", "recipes");
  }

  if (platform === "darwin") {
    return posix.join(homedir(), "Library", "Application Support", "Portus Browser", "recipes");
  }

  return posix.join(environment.XDG_DATA_HOME ?? posix.join(homedir(), ".local", "share"), "portus-browser", "recipes");
}

export function recipeInvalid(message: string, details?: Record<string, unknown>): PortusError {
  return createPortusError({
    code: "RECIPE_INVALID",
    message,
    ...(details === undefined ? {} : { details })
  });
}

type ParsedRecipeRecordInput =
  | { ok: true; value: unknown }
  | { ok: false; richSchemaOk: false; issues: RecipeManagementIssue[] };

function parseRecipeRecordInput(input: unknown): ParsedRecipeRecordInput {
  if (typeof input !== "string") return { ok: true, value: input };

  try {
    return { ok: true, value: JSON.parse(input) as unknown };
  } catch (error) {
    return {
      ok: false,
      richSchemaOk: false,
      issues: [{
        severity: "error",
        path: "",
        message: error instanceof Error
          ? `Recipe record JSON could not be parsed: ${error.message}`
          : "Recipe record JSON could not be parsed."
      }]
    };
  }
}

function formatZodIssues(error: z.ZodError): RecipeManagementIssue[] {
  return error.issues.map((issue) => ({
    severity: "error",
    path: issue.path.join("."),
    message: issue.message
  }));
}

async function wrapPlainTextRecipeFile(filePath: string, options: ImportRecipeOptions): Promise<MinimalRecipeRecord> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    throw recipeInvalid("Plain text recipe file could not be loaded.", {
      path: filePath,
      reason: error instanceof Error ? error.message : "load failed"
    });
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw recipeInvalid("Plain text recipe file is empty.", { path: filePath });
  }

  const baseName = basename(filePath, extname(filePath));
  return wrapLooseRecipe({
    id: options.id ?? slugifyRecipeId(baseName),
    name: options.name ?? titleFromFileName(baseName),
    content: trimmed,
    source: `import:${basename(filePath)}`
  });
}

function slugifyRecipeId(value: string): string {
  const slug = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return RecipeIdSchema.parse(slug);
}

function titleFromFileName(value: string): string {
  const title = value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title.length > 0 ? title : value;
}

type RecipeRecordFileInspection =
  | { ok: true; entry: RecipeLibraryEntry }
  | { ok: false; diagnostic: RecipeLibraryDiagnostic };

async function inspectRecipeRecordFile(filePath: string): Promise<RecipeRecordFileInspection> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    return {
      ok: false,
      diagnostic: {
        filePath,
        severity: "error",
        message: error instanceof Error ? error.message : "Recipe file could not be read."
      }
    };
  }

  const validation = validateRecipeForManagement(text);
  if (!validation.ok) {
    return {
      ok: false,
      diagnostic: {
        filePath,
        severity: "error",
        message: "Recipe file is not management-valid.",
        issues: validation.issues
      }
    };
  }

  return {
    ok: true,
    entry: {
      recipe: validation.recipe,
      filePath,
      richSchemaOk: validation.richSchemaOk,
      issues: validation.issues
    }
  };
}

function compareRecipeLibraryEntries(left: RecipeLibraryEntry, right: RecipeLibraryEntry): number {
  const idCompare = left.recipe.id.localeCompare(right.recipe.id);
  if (idCompare !== 0) return idCompare;
  return left.recipe.name.localeCompare(right.recipe.name);
}
