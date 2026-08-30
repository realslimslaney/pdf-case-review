import { Uri, workspace } from "vscode";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Writes `bytes` to a temp sibling and renames it over `uri`, so a crash mid-write never leaves a
 * truncated file. Uses `workspace.fs` only (web host safe). File systems that refuse the rename
 * fall back to a direct write.
 */
export async function writeAtomic(uri: Uri, bytes: Uint8Array): Promise<void> {
  const parent = Uri.joinPath(uri, "..");
  const name = uri.path.slice(uri.path.lastIndexOf("/") + 1);
  const temp = Uri.joinPath(parent, `.${name}.${randomSuffix()}.tmp`);
  await workspace.fs.createDirectory(parent);
  await workspace.fs.writeFile(temp, bytes);
  try {
    await workspace.fs.rename(temp, uri, { overwrite: true });
  } catch (renameError) {
    try {
      await workspace.fs.delete(temp);
    } catch {
      // The temp file is all that is left behind; the direct write below is what matters.
    }
    try {
      await workspace.fs.writeFile(uri, bytes);
    } catch {
      throw renameError;
    }
  }
}
