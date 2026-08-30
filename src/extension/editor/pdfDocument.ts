/*
 * Copyright 2021 Mathematic Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified by Brennen Slaney for PDF Case Review, 2026. Changes: renamed class
 * and file; watcher created with a RelativePattern so it also works on remote and
 * virtual file systems; otherwise as in mathematic-inc/vscode-pdf.
 */

import { type CustomDocument, EventEmitter, RelativePattern, Uri, workspace } from "vscode";

import { Disposable } from "../util/disposable";

function areUriEqual(left: Uri, right: Uri) {
  return `${left}` === `${right}`;
}

export function parentUri(uri: Uri): Uri {
  return Uri.joinPath(uri, "..");
}

export function baseName(uri: Uri): string {
  return uri.path.slice(uri.path.lastIndexOf("/") + 1);
}

/** SHA-256 of the file's bytes as lowercase hex. Web-safe: `crypto.subtle` exists in both hosts. */
export async function contentHash(uri: Uri): Promise<string> {
  const bytes = Uint8Array.from(await workspace.fs.readFile(uri));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The custom document behind a PDF Case Review editor: the PDF on disk plus change events. */
export class PdfDocument extends Disposable implements CustomDocument {
  private readonly _uri: Uri;
  /** Hash of the bytes the viewer last loaded; watcher events that don't change it are ignored. */
  contentHash: string | undefined;

  constructor(uri: Uri) {
    super();
    this._uri = uri;

    const watcher = this._register(
      workspace.createFileSystemWatcher(new RelativePattern(parentUri(uri), baseName(uri))),
    );

    const onChangeHandler = (changed: Uri) => {
      if (areUriEqual(changed, uri)) {
        this._onDidChange.fire(changed);
      }
    };

    this._register(watcher.onDidChange(onChangeHandler));
    this._register(watcher.onDidCreate(onChangeHandler));
  }

  get uri() {
    return this._uri;
  }

  private readonly _onDidDelete = this._register(new EventEmitter<Uri>());
  /** Fired when the document is deleted (no editors reference it any more). */
  readonly onDidDelete = this._onDidDelete.event;

  private readonly _onDidChange = this._register(new EventEmitter<Uri>());
  /** Fired to notify webviews that the PDF changed on disk. */
  readonly onDidChange = this._onDidChange.event;

  override dispose(): void {
    this._onDidDelete.fire(this.uri);
    super.dispose();
  }
}
