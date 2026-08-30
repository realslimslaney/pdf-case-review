import { Uri, workspace } from "vscode";

import { sidecarFileName, sidecarFolderPath } from "../../core/sidecar/location";
import { baseName, parentUri } from "../editor/pdfDocument";
import type { SidecarLocation } from "../settings";

/** The sidecar Uri for a PDF. PDFs outside any workspace folder always get a sidecar beside them. */
export function sidecarUriFor(pdfUri: Uri, location: SidecarLocation): Uri {
  if (location === "folder") {
    const folder = workspace.getWorkspaceFolder(pdfUri);
    if (folder) {
      const relative = workspace.asRelativePath(pdfUri, false);
      return Uri.joinPath(folder.uri, ...sidecarFolderPath(relative).split("/"));
    }
  }
  return Uri.joinPath(parentUri(pdfUri), sidecarFileName(baseName(pdfUri)));
}
