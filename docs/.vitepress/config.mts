import { defineConfig } from "vitepress";

// The four diataxis quadrants, one sidebar group each. Keep every page listed here: the sidebar
// is the site's table of contents.
export default defineConfig({
  title: "PDF Case Review",
  description:
    "Highlight PDFs by category, attach notes, and turn them into a printable Markdown, Word or PDF report.",
  base: "/pdf-case-review/",
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Tutorial", link: "/tutorials/setup" },
      { text: "How-to", link: "/how-to/categories" },
      { text: "Reference", link: "/reference/commands" },
      { text: "Explanation", link: "/explanation/decisions" },
    ],
    sidebar: [
      {
        text: "Tutorials",
        items: [
          { text: "Set up your computer", link: "/tutorials/setup" },
          { text: "Your first case", link: "/tutorials/first-case" },
        ],
      },
      {
        text: "How-to",
        items: [
          { text: "Set up categories", link: "/how-to/categories" },
          { text: "Work with scanned PDFs", link: "/how-to/scanned-pdfs" },
          { text: "Work with very large PDFs", link: "/how-to/large-pdfs" },
          { text: "Install a command-line AI assistant", link: "/how-to/install-an-ai-cli" },
          { text: "Claude Code or Codex as reviewer", link: "/how-to/ai-reviewer" },
          { text: "Personal and school Claude accounts", link: "/how-to/two-claude-accounts" },
        ],
      },
      {
        text: "For maintainers",
        items: [{ text: "Publish a release", link: "/how-to/release" }],
      },
      {
        text: "Reference",
        items: [
          { text: "Commands", link: "/reference/commands" },
          { text: "Keybindings", link: "/reference/keybindings" },
          { text: "Settings", link: "/reference/settings" },
          { text: "The sidecar file", link: "/reference/sidecar" },
        ],
      },
      {
        text: "Explanation",
        items: [
          { text: "Architecture decisions", link: "/explanation/decisions" },
          { text: "How Claude Code and Codex know who you are", link: "/explanation/claude-accounts" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/realslimslaney/pdf-case-review" }],
    search: { provider: "local" },
  },
});
