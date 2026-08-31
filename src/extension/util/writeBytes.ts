import { FileSystemError, Uri, workspace } from "vscode";

/**
 * Writes `bytes` to `uri`, creating the parent folder first. Deliberately not temp-and-rename:
 * VS Code treats an in-app rename over an open resource as a delete and closes its editor (the
 * custom editor showing the PDF, or a text editor on the sidecar). The save pipeline compensates
 * by writing the sidecar before the PDF, so an interrupted PDF write loses no notes.
 *
 * A refusal from a read-only or unavailable file system (virtual workspaces) surfaces as a plain
 * sentence instead of a raw FileSystemError.
 */
export async function writeBytes(uri: Uri, bytes: Uint8Array): Promise<void> {
  try {
    await workspace.fs.createDirectory(Uri.joinPath(uri, ".."));
    await workspace.fs.writeFile(uri, bytes);
  } catch (error) {
    if (
      error instanceof FileSystemError &&
      (error.code === "NoPermissions" || error.code === "Unavailable")
    ) {
      throw new Error(`the "${uri.scheme}" file system is read-only or unavailable, nothing was written`);
    }
    throw error;
  }
}
