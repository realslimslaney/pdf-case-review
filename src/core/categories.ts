// Highlight categories and their mapping onto PDF.js highlight colors.
// Pure module: no `vscode`, no Node APIs.

export interface Category {
  id: string;
  name: string;
  /** `#RRGGBB` (any case on input; normalized to uppercase by `normalizeCategories`). */
  color: string;
  description?: string;
}

export const DEFAULT_CATEGORIES: readonly Category[] = [
  { id: "fact", name: "Fact", color: "#FFFF98" },
  { id: "financial", name: "Financial", color: "#53FFBC" },
  { id: "strategic", name: "Strategic implication", color: "#80EBFF" },
  { id: "concern", name: "Concern", color: "#FF4F5F" },
  { id: "question", name: "Question", color: "#FFCBE6" },
];

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const CATEGORY_ID = /^[a-z][a-z0-9-]*$/;

export interface CategoryValidationError {
  index: number;
  message: string;
}

export function validateCategories(categories: readonly Category[]): CategoryValidationError[] {
  const errors: CategoryValidationError[] = [];
  const seenIds = new Set<string>();
  const seenColors = new Set<string>();
  categories.forEach((category, index) => {
    if (!CATEGORY_ID.test(category.id)) {
      errors.push({ index, message: `id "${category.id}" must be lowercase letters, digits or dashes` });
    }
    if (seenIds.has(category.id)) {
      errors.push({ index, message: `duplicate id "${category.id}"` });
    }
    seenIds.add(category.id);
    if (!HEX_COLOR.test(category.color)) {
      errors.push({ index, message: `color "${category.color}" must be #RRGGBB` });
    }
    const color = category.color.toUpperCase();
    if (seenColors.has(color)) {
      errors.push({ index, message: `duplicate color ${color}: colors identify categories in the viewer` });
    }
    seenColors.add(color);
    if (category.name.trim() === "") {
      errors.push({ index, message: "name must not be empty" });
    }
  });
  return errors;
}

export function normalizeCategories(categories: readonly Category[]): Category[] {
  return categories.map((category) => ({ ...category, color: category.color.toUpperCase() }));
}

/** PDF.js `highlightEditorColors` option: `name=#HEX` pairs; the name doubles as the color's id. */
export function toHighlightEditorColors(categories: readonly Category[]): string {
  return normalizeCategories(categories)
    .map((category) => `${category.id}=${category.color}`)
    .join(",");
}

export function rgbToHex(rgb: readonly [number, number, number]): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function categoryForColor(categories: readonly Category[], color: string): Category | undefined {
  const wanted = color.toUpperCase();
  return categories.find((category) => category.color.toUpperCase() === wanted);
}

/** Color for highlights whose category is unknown, in the viewer and the PDF. */
export const UNCATEGORIZED_COLOR = "#CCCCCC";

/** `#RRGGBB` to 0-255 components (what PDF.js editors take). */
export function hexToRgb(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Built-in palettes; `pdfCaseReview.categoryPresets` can add more. */
export const CATEGORY_PRESETS: Readonly<Record<string, readonly Category[]>> = {
  "Business case": DEFAULT_CATEGORIES,
  "Academic paper": [
    { id: "claim", name: "Claim", color: "#FFFF98" },
    { id: "evidence", name: "Evidence", color: "#53FFBC" },
    { id: "method", name: "Method", color: "#80EBFF" },
    { id: "limitation", name: "Limitation", color: "#FF4F5F" },
    { id: "question", name: "Question", color: "#FFCBE6" },
  ],
  Contract: [
    { id: "obligation", name: "Obligation", color: "#FFFF98" },
    { id: "risk", name: "Risk", color: "#FF4F5F" },
    { id: "deadline", name: "Deadline", color: "#80EBFF" },
    { id: "defined-term", name: "Defined term", color: "#53FFBC" },
    { id: "question", name: "Question", color: "#FFCBE6" },
  ],
};

export interface PresetValidationError {
  preset: string;
  message: string;
}

/** Validates a `{ name: Category[] }` map; a preset with any error is reported and left out. */
export function validatePresets(presets: unknown): {
  presets: Record<string, Category[]>;
  errors: PresetValidationError[];
} {
  const valid: Record<string, Category[]> = {};
  const errors: PresetValidationError[] = [];
  if (typeof presets !== "object" || presets === null || Array.isArray(presets)) {
    return {
      presets: valid,
      errors: [{ preset: "", message: "expected an object of preset name to categories" }],
    };
  }
  for (const [name, categories] of Object.entries(presets as Record<string, unknown>)) {
    if (name.trim() === "") {
      errors.push({ preset: name, message: "preset name must not be empty" });
      continue;
    }
    if (!Array.isArray(categories) || categories.length === 0) {
      errors.push({ preset: name, message: "expected a non-empty list of categories" });
      continue;
    }
    const shaped = categories.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Category).id === "string" &&
        typeof (entry as Category).name === "string" &&
        typeof (entry as Category).color === "string",
    );
    if (!shaped) {
      errors.push({ preset: name, message: "every category needs id, name and color" });
      continue;
    }
    const categoryErrors = validateCategories(categories as Category[]);
    if (categoryErrors.length > 0) {
      errors.push({
        preset: name,
        message: categoryErrors.map((error) => `#${error.index + 1}: ${error.message}`).join("; "),
      });
      continue;
    }
    valid[name] = normalizeCategories(categories as Category[]);
  }
  return { presets: valid, errors };
}

/** The category bound to `Ctrl+Alt+<index>` (1-based, in palette order), if there is one. */
export function categoryAt(categories: readonly Category[], index: number): Category | undefined {
  return Number.isInteger(index) && index >= 1 ? categories[index - 1] : undefined;
}
