// M3 phase 5: scanned PDFs. A document with no text layer still opens, sidecar highlights on it
// still load, the tree and the report tell an image region (free highlight) from a failed text
// capture, and a highlight with no geometry at all is reported instead of vanishing silently.

import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as vscode from "vscode";

import type { Sidecar } from "../../src/core/sidecar/types";
import { closeAll, copyFixture, fixtureUri, openWith, remove, waitFor, waitForLoaded } from "./helpers";

const FREE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const LOST_ID = "aaaaaaaa-0000-4000-8000-000000000002";
const NOW = "2026-09-01T12:00:00.000Z";

function sidecarFor(bytes: Uint8Array): Sidecar {
  return {
    version: 1,
    source: {
      fileName: "case.pdf",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.byteLength,
      pageCount: 2,
    },
    categories: [
      { id: "fact", name: "Fact", color: "#FFFF98", order: 0 },
      { id: "concern", name: "Concern", color: "#FF4F5F", order: 1 },
    ],
    highlights: [
      {
        id: FREE_ID,
        categoryId: "fact",
        page: 1,
        rect: [100, 500, 300, 600],
        quadPoints: [],
        kind: "free",
        text: "",
        note: "The chart in the middle of the page.",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: LOST_ID,
        categoryId: "concern",
        page: 2,
        rect: [72, 640, 400, 652],
        quadPoints: [72, 652, 400, 652, 72, 640, 400, 640],
        kind: "text",
        text: "",
        note: "",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
}

interface TreeChild {
  label: string;
  description: string;
}
interface TreeSnapshot {
  groups: { label: string; children: TreeChild[] }[];
}

suite("M3 phase 5: scanned PDFs and empty quotes", () => {
  const folder = fixtureUri("generated", "scanned-test");
  const pdf = fixtureUri("generated", "scanned-test", "case.pdf");

  suiteSetup(async () => {
    await remove(folder);
    await copyFixture(fixtureUri("generated", "scanned-case.pdf"), pdf);
    const bytes = await vscode.workspace.fs.readFile(pdf);
    await vscode.workspace.fs.writeFile(
      fixtureUri("generated", "scanned-test", "case.pdf.review.json"),
      new TextEncoder().encode(JSON.stringify(sidecarFor(bytes), null, 2)),
    );
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
    await remove(folder);
  });

  test("the tree labels an image region and a failed capture differently", async () => {
    const snapshot = await waitFor("both highlights in the tree", async () => {
      const current = await vscode.commands.executeCommand<TreeSnapshot>(
        "pdfCaseReview.debug.getTreeSnapshot",
      );
      return current && current.groups.reduce((sum, group) => sum + group.children.length, 0) === 2
        ? current
        : undefined;
    });
    const labels = snapshot.groups.flatMap((group) => group.children.map((child) => child.label));
    assert.deepEqual(labels.sort(), ["(no text captured)", "[image region]"]);
  });

  test("a free highlight without outlines is reported as undrawable, not dropped silently", async () => {
    const trace = await vscode.commands.executeCommand<string[]>("pdfCaseReview.debug.getTrace");
    assert.ok(
      trace?.some((line) => line.includes("undrawable")),
      `expected an undrawable trace entry, got:\n${trace?.join("\n")}`,
    );
  });

  test("the report tells an image region from a failed capture", async () => {
    await vscode.commands.executeCommand("pdfCaseReview.generateReportAs", "markdown");
    const report = await waitFor("the markdown report", async () => {
      try {
        return await vscode.workspace.fs.readFile(fixtureUri("generated", "scanned-test", "case.review.md"));
      } catch {
        return undefined;
      }
    });
    const markdown = new TextDecoder().decode(report);
    assert.ok(markdown.includes("[image region]"), "free highlight renders as an image region");
    assert.ok(markdown.includes("(no text captured)"), "failed capture renders as no text");
    assert.ok(markdown.includes("The chart in the middle of the page."), "its note still renders");
  });
});
