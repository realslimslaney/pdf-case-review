// Webview smoke: the riskiest seam (our adapter over PDF.js internals) driven in a real browser.
// Host-to-webview traffic rides window.postMessage exactly as in VS Code; webview-to-host posts
// are collected by the stub (see stub.js).

import { expect, type Page, test } from "@playwright/test";

import type { WebviewToHostMessage } from "../../src/shared/protocol";
import { SMOKE_MAX_CANVAS_PIXELS } from "./globalSetup";

declare global {
  interface Window {
    __hostMessages: WebviewToHostMessage[];
    PDFViewerApplicationOptions: { get(name: string): unknown };
    PDFViewerApplication: {
      pdfViewer: { currentPageNumber: number };
      eventBus: { dispatch(name: string, data: Record<string, unknown>): void };
    };
  }
}

function messages<T extends WebviewToHostMessage["type"]>(page: Page, type: T) {
  return page.evaluate(
    (wanted) => window.__hostMessages.filter((message) => message.type === wanted),
    type,
  ) as Promise<Extract<WebviewToHostMessage, { type: T }>[]>;
}

async function post(page: Page, message: Record<string, unknown>): Promise<void> {
  await page.evaluate((payload) => window.postMessage(payload, window.origin), message);
}

async function openViewer(page: Page, path = "/test/e2e/.out/index.html") {
  await page.goto(path);
  await expect
    .poll(async () => (await messages(page, "viewerLoaded")).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const [loaded] = await messages(page, "viewerLoaded");
  return loaded;
}

test("the viewer loads the fixture and reports pages, labels and palette", async ({ page }) => {
  const loaded = await openViewer(page);
  expect(loaded?.pagesCount).toBe(3);
  expect(loaded?.pageLabels?.[0]).toBe("i");
  expect(loaded?.highlightEditorColors).toContain("financial=#53FFBC");
});

test("the viewer config reaches PDF.js AppOptions", async ({ page }) => {
  await openViewer(page);
  const options = await page.evaluate(() => ({
    maxCanvasPixels: window.PDFViewerApplicationOptions.get("maxCanvasPixels"),
    forcePageColors: window.PDFViewerApplicationOptions.get("forcePageColors"),
    scripting: window.PDFViewerApplicationOptions.get("enableScripting"),
  }));
  expect(options.maxCanvasPixels).toBe(SMOKE_MAX_CANVAS_PIXELS);
  expect(options.forcePageColors).toBe(false);
  expect(options.scripting).toBe(false);
});

test("a high-contrast theme forces the page colors (ADR-0008)", async ({ page }) => {
  await openViewer(page, "/test/e2e/.out/high-contrast.html");
  const options = await page.evaluate(() => ({
    forcePageColors: window.PDFViewerApplicationOptions.get("forcePageColors"),
    background: window.PDFViewerApplicationOptions.get("pageColorsBackground"),
  }));
  expect(options.forcePageColors).toBe(true);
  expect(options.background).toBeTruthy();
});

test("spike.highlightText creates an editor and the snapshot reports it", async ({ page }) => {
  await openViewer(page);
  await post(page, { type: "spike.highlightText", page: 1, spanCount: 2, color: "#53FFBC", requestId: 1 });
  await expect
    .poll(async () => (await messages(page, "done")).some((done) => done.requestId === 1 && done.ok))
    .toBe(true);
  await expect
    .poll(async () => {
      const snapshots = await messages(page, "editorsChanged");
      const last = snapshots.at(-1);
      return last ? { editors: last.editors.length, rendered: last.rendered } : null;
    })
    .toEqual({ editors: 1, rendered: 1 });
  const snapshots = await messages(page, "editorsChanged");
  expect(snapshots.at(-1)?.editors[0]?.color).toBe("#53FFBC");
});

test("loadHighlights injects a sidecar-only highlight once its page renders", async ({ page }) => {
  await openViewer(page);
  await post(page, {
    type: "loadHighlights",
    highlights: [
      {
        sidecarId: "aaaaaaaa-0000-4000-8000-000000000042",
        pageIndex: 0,
        data: {
          annotationType: 9,
          color: [255, 79, 95],
          opacity: 1,
          rect: [72, 640, 400, 652],
          rotation: 0,
          quadPoints: [72, 652, 400, 652, 72, 640, 400, 640],
        },
      },
    ],
  });
  await expect
    .poll(async () => {
      const snapshots = await messages(page, "editorsChanged");
      return snapshots
        .at(-1)
        ?.editors.some((editor) => editor.sidecarId === "aaaaaaaa-0000-4000-8000-000000000042");
    })
    .toBe(true);
});

test("goTo scrolls to the page and reports the change", async ({ page }) => {
  await openViewer(page);
  await post(page, { type: "goTo", page: 3, requestId: 2 });
  await expect
    .poll(async () => (await messages(page, "done")).some((done) => done.requestId === 2 && done.ok))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.PDFViewerApplication.pdfViewer.currentPageNumber))
    .toBe(3);
});

test("the injected category dropdown lists the palette and follows picker changes", async ({ page }) => {
  await openViewer(page);
  const select = page.locator("#pdfCaseReviewCategorySelect");
  await expect(select).toBeVisible();
  await expect(select.locator("option")).toHaveText([
    "Fact",
    "Financial",
    "Strategic implication",
    "Concern",
    "Question",
  ]);
  await select.selectOption({ label: "Concern" });
  await expect(page.locator("#pdfCaseReviewCategorySwatch")).toHaveCSS(
    "background-color",
    "rgb(255, 79, 95)",
  );
  // A PDF.js color-picker pick reaches the dropdown through switchannotationeditorparams.
  await page.evaluate(() =>
    window.PDFViewerApplication.eventBus.dispatch("switchannotationeditorparams", {
      source: null,
      type: 31,
      value: "#FFCBE6",
    }),
  );
  await expect(select).toHaveValue("#FFCBE6");
});
