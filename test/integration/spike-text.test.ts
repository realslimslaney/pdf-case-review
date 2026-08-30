// Spike 2 (see docs/explanation/decisions.md): the text PDF.js captured for a highlight (its
// aria-label, from the selection) and the text recovered by intersecting the highlight's quads
// with the page's text content must agree, modulo whitespace, on at least 90% of samples.

import * as assert from "node:assert/strict";

import { normalizeCapturedText } from "../../src/core/text/normalize";
import {
  closeAll,
  copyFixture,
  fixtureUri,
  openWith,
  send,
  viewerState,
  waitFor,
  waitForLoaded,
} from "./helpers";

const SAMPLES: [page: number, spans: number][] = [
  [1, 2],
  [1, 6],
  [1, 12],
  [1, 20],
  [2, 2],
  [2, 6],
  [2, 12],
  [3, 2],
  [3, 6],
  [3, 12],
];

suite("Spike 2: quad-intersection text agrees with the captured selection", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "text-test", "case.pdf");

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("selection text and quad text match on at least 90% of samples", async () => {
    const mismatches: string[] = [];
    for (const [page, spans] of SAMPLES) {
      const known = new Set((await viewerState(pdf))?.editors.map((editor) => editor.id) ?? []);
      await send(pdf, { type: "spike.highlightText", page, spanCount: spans, color: "#FFFF98" });
      const created = await waitFor(
        `a new editor with text and quad text (page ${page}, ${spans} spans)`,
        async () => {
          const state = await viewerState(pdf);
          return state?.editors.find(
            (editor) => !known.has(editor.id) && editor.text && editor.quadText !== undefined,
          );
        },
      );
      const selected = normalizeCapturedText(created.text ?? "");
      const recovered = normalizeCapturedText(created.quadText ?? "");
      if (selected !== recovered) {
        mismatches.push(`page ${page}, ${spans} spans:\n  selection: ${selected}\n  quads:     ${recovered}`);
      }
    }
    const agreement = (SAMPLES.length - mismatches.length) / SAMPLES.length;
    assert.ok(
      agreement >= 0.9,
      `${Math.round(agreement * 100)}% agreement (${mismatches.length}/${SAMPLES.length} mismatches):\n${mismatches.join("\n")}`,
    );
  });
});
