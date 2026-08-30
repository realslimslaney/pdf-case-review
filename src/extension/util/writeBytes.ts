import { Uri, workspace } from "vscode";

/**
 * Writes `bytes` to `uri`, creating the parent folder first. Deliberately not temp-and-rename:
 * VS Code treats an in-app rename over an open resource as a delete and closes its editor (the
 * custom editor showing the PDF, or a text editor on the sidecar). The save pipeline compensates
 * by writing the sidecar before the PDF, so an interrupted PDF write loses no notes.
 */
export async function writeBytes(uri: Uri, bytes: Uint8Array): Promise<void> {
  await workspace.fs.createDirectory(Uri.joinPath(uri, ".."));
  await workspace.fs.writeFile(uri, bytes);
}
