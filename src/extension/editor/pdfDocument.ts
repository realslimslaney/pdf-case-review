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
 * virtual file systems; carries the sidecar model, its saved snapshot, the PDF's hash and
 * the per-load reconcile session so the provider can implement an editable custom editor;
 * otherwise as in mathematic-inc/vscode-pdf.
 */

import { type CustomDocument, EventEmitter, RelativePattern, Uri, workspace } from "vscode";

import { ReconcileSession } from "../../core/sidecar/reconcile";
import { serializeSidecar } from "../../core/sidecar/serialize";
import type { Sidecar, SidecarSource } from "../../core/sidecar/types";
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

/** SHA-256 of `bytes` as lowercase hex. Web-safe: `crypto.subtle` exists in both hosts. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function contentHash(uri: Uri): Promise<string> {
  return hashBytes(await workspace.fs.readFile(uri));
}

/** What the sidecar's `source` block records about the PDF; refreshed on load and at save time. */
export interface PdfInfo {
  sha256: string;
  byteLength: number;
  pageCount: number;
  title: string | null;
}

/** The `source` block for `uri` as the sidecar should record it now. */
export function sourceFor(uri: Uri, info: PdfInfo): SidecarSource {
  const source: SidecarSource = {
    fileName: baseName(uri),
    sha256: info.sha256,
    byteLength: info.byteLength,
    pageCount: info.pageCount,
  };
  if (info.title) {
    source.title = info.title;
  }
  return source;
}

/** The custom document behind a PDF Case Review editor: the PDF on disk plus its sidecar model. */
export class PdfDocument extends Disposable implements CustomDocument {
  private readonly _uri: Uri;
  /** Hash of the bytes the viewer last loaded; watcher events that don't change it are ignored. */
  contentHash: string | undefined;
  /** Canonical text of the model as last loaded or saved; dirty means the model no longer matches. */
  savedSnapshot: string;
  /** Viewer-id bookkeeping for the current viewer load (reset on every `viewerLoaded`). */
  readonly session = new ReconcileSession();
  /** Page labels reported by the viewer, by page index; null when the PDF defines none. */
  pageLabels: string[] | null = null;
  /** Set when the sidecar on disk could not be read; saving is refused until it is fixed. */
  readOnly = false;
  /** Encrypted or permission-restricted: the PDF is never written, highlights stay sidecar-only. */
  protected = false;
  /** The one-time "this PDF is protected" notice was shown for this document. */
  protectedNoticeShown = false;

  constructor(
    uri: Uri,
    readonly sidecarUri: Uri,
    public model: Sidecar,
    savedSnapshot: string,
    public info: PdfInfo,
  ) {
    super();
    this._uri = uri;
    this.savedSnapshot = savedSnapshot;
    this.contentHash = info.sha256;

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

  get isDirty(): boolean {
    return serializeSidecar(this.model) !== this.savedSnapshot;
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
