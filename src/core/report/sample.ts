// A synthetic report input (invented company, invented numbers) used by tests and by the
// "render a sample report" debug command so the layout can be eyeballed without a real case.

import type { ReportInput } from "./model";

export const SAMPLE_REPORT_INPUT: ReportInput = {
  title: "Acme Widgets (A): The Pricing Decision",
  sourceFileName: "sample-case.pdf",
  pageCount: 3,
  author: "Reader",
  generatedAt: "2026-09-01",
  categories: [
    { id: "fact", name: "Fact", color: "#FFFF98" },
    { id: "financial", name: "Financial", color: "#53FFBC" },
    { id: "strategic", name: "Strategic implication", color: "#80EBFF" },
    { id: "concern", name: "Concern", color: "#FF4F5F" },
    { id: "question", name: "Question", color: "#FFCBE6" },
  ],
  highlights: [
    {
      id: "h2",
      categoryId: "financial",
      page: 2,
      top: 700,
      text: "Gross margin: 2023 41.0 percent; 2024 37.2 percent; 2025 33.1 percent.",
      createdAt: "2026-08-30T10:10:00Z",
      note: "Eight points in two years — **pricing**, not volume.",
    },
    {
      id: "h1",
      categoryId: "fact",
      page: 1,
      pageLabel: "i",
      top: 650,
      text: "Distributors now accounted for 58 percent of revenue but only 31\n percent of contribution.",
      createdAt: "2026-08-30T10:00:00Z",
      note: "",
    },
    {
      id: "h3",
      categoryId: "concern",
      page: 1,
      top: 600,
      text: "Kim was worried that a blanket increase would hand share to Beta Fas-\ntenerS.",
      note: "- capacity = 25% of market\n- came online in January",
      createdAt: "2026-08-30T10:05:00Z",
    },
    { id: "h4", categoryId: "ghost", page: 3, text: "Orphaned highlight", note: "" },
  ],
  pageNotes: [{ page: 3, note: "The real question is cost to serve.", createdAt: "2026-08-30T10:15:00Z" }],
  documentNotes: [
    {
      title: "Thesis",
      note: "Exit the distributor channel *only* if cost-to-serve data confirms it.",
      createdAt: "2026-08-30T09:55:00Z",
    },
  ],
};
