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
