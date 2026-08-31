// The note editor view: category dropdown, quote preview and a Markdown textarea autosaving on
// debounce and blur. State lives in the host's sidecar model; this script mirrors one target.

import type {
  HostToNoteEditorMessage,
  NoteEditorLoad,
  NoteEditorToHostMessage,
} from "../shared/noteEditorProtocol";

const vscode = acquireVsCodeApi();

function post(message: NoteEditorToHostMessage): void {
  vscode.postMessage(message);
}

const AUTOSAVE_DELAY_MS = 400;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Missing #${id}`);
  }
  return found as T;
}

const empty = element<HTMLDivElement>("empty");
const editor = element<HTMLFormElement>("editor");
const title = element<HTMLHeadingElement>("title");
const citation = element<HTMLSpanElement>("citation");
const quote = element<HTMLQuoteElement>("quote");
const category = element<HTMLSelectElement>("category");
const note = element<HTMLTextAreaElement>("note");
const revealButton = element<HTMLButtonElement>("reveal");
const deleteButton = element<HTMLButtonElement>("delete");
const saveState = element<HTMLDivElement>("saveState");

/** Announces through the polite live region; cleared first so a repeat save re-announces. */
function announce(text: string): void {
  saveState.textContent = "";
  requestAnimationFrame(() => {
    saveState.textContent = text;
  });
}

let current: NoteEditorLoad | null = null;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (current && dirty) {
    dirty = false;
    post({ type: "saveNote", documentUri: current.documentUri, target: current.target, note: note.value });
  }
}

function scheduleSave(): void {
  dirty = true;
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  timer = setTimeout(flush, AUTOSAVE_DELAY_MS);
}

function show(message: NoteEditorLoad): void {
  flush();
  current = message;
  dirty = false;
  empty.hidden = true;
  editor.hidden = false;
  title.textContent = message.title;
  citation.textContent = message.citation;
  citation.hidden = message.citation === "";
  quote.textContent = message.quote ?? "";
  quote.hidden = message.quote === null;
  category.replaceChildren(
    ...message.categories.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.name;
      return option;
    }),
  );
  category.hidden = message.categories.length === 0;
  if (message.categoryId !== null) {
    category.value = message.categoryId;
  }
  revealButton.hidden = message.target.kind === "document";
  note.value = message.note;
  saveState.textContent = "";
}

function clear(reason: "noDocument" | "noTarget"): void {
  flush();
  current = null;
  dirty = false;
  editor.hidden = true;
  empty.hidden = false;
  empty.textContent =
    reason === "noDocument"
      ? "Open a PDF to edit its notes."
      : "Select a highlight or note in the Highlights view.";
}

note.addEventListener("input", scheduleSave);
note.addEventListener("blur", flush);
category.addEventListener("change", () => {
  if (current) {
    post({
      type: "setCategory",
      documentUri: current.documentUri,
      target: current.target,
      categoryId: category.value,
    });
  }
});
revealButton.addEventListener("click", () => {
  if (current) {
    flush();
    post({ type: "revealTarget", documentUri: current.documentUri, target: current.target });
  }
});
deleteButton.addEventListener("click", () => {
  if (current) {
    dirty = false;
    post({ type: "deleteTarget", documentUri: current.documentUri, target: current.target });
  }
});
window.addEventListener("message", (event: MessageEvent) => {
  if (event.origin !== window.origin) {
    return;
  }
  const message = event.data as HostToNoteEditorMessage;
  if (message.type === "load") {
    show(message);
  } else if (message.type === "clear") {
    clear(message.reason);
  } else if (message.type === "saved") {
    announce("Note saved");
  }
});

editor.addEventListener("submit", (event) => event.preventDefault());

post({ type: "ready" });
