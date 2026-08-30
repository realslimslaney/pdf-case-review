// Reads and writes sidecar files through `workspace.fs` (web host safe); parsing and
// serialization are the pure functions in src/core/sidecar/.

import { FileSystemError, type Uri, workspace } from "vscode";

import { migrateSidecar } from "../../core/sidecar/migrate";
import { serializeSidecar } from "../../core/sidecar/serialize";
import type { Sidecar } from "../../core/sidecar/types";
import { SidecarError, validateSidecar } from "../../core/sidecar/validate";
import { writeAtomic } from "../util/atomicWrite";

export type SidecarLoad =
  | { kind: "missing" }
  | { kind: "loaded"; model: Sidecar; snapshot: string; migrated: boolean }
  | { kind: "invalid"; error: SidecarError };

function isFileNotFound(error: unknown): boolean {
  return error instanceof FileSystemError && error.code === "FileNotFound";
}

/**
 * Loads a sidecar. `snapshot` is the canonical serialization of what was loaded, so dirtiness is
 * measured against the model rather than the on-disk bytes (a hand-edited file is not dirty
 * until the user changes something).
 */
export async function readSidecar(uri: Uri): Promise<SidecarLoad> {
  let bytes: Uint8Array;
  try {
    bytes = await workspace.fs.readFile(uri);
  } catch (error) {
    if (isFileNotFound(error)) {
      return { kind: "missing" };
    }
    throw error;
  }
  try {
    const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const migration = migrateSidecar(raw);
    const model = validateSidecar(migration.value);
    return { kind: "loaded", model, snapshot: serializeSidecar(model), migrated: migration.migrated };
  } catch (error) {
    if (error instanceof SidecarError) {
      return { kind: "invalid", error };
    }
    if (error instanceof SyntaxError) {
      return { kind: "invalid", error: new SidecarError("", `invalid JSON: ${error.message}`) };
    }
    throw error;
  }
}

/** Writes the sidecar atomically and returns the text written (the new saved snapshot). */
export async function writeSidecar(uri: Uri, model: Sidecar): Promise<string> {
  const text = serializeSidecar(model);
  await writeAtomic(uri, new TextEncoder().encode(text));
  return text;
}
