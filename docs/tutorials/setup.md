# Set up your computer

This tutorial is for someone who has never used VS Code. In about twenty minutes you will install it,
learn the five parts of its window, install the PDF Case Review extension, and see where the optional
command-line AI assistant fits. Nothing here needs programming experience.

## 1. Install VS Code

Visual Studio Code (VS Code) is a free editor from Microsoft. Programmers use it to write code, but at
heart it is a fast, extensible program for working with files in a folder. PDF Case Review is an
add-on that turns it into a PDF reader with categorized highlights, notes and printable reports.

1. Download it from <https://code.visualstudio.com/download>. On Windows pick the **User Installer**;
   on a Mac pick the build for your chip (Apple silicon or Intel; **Universal** works on both).
2. Run the installer. On Windows keep the defaults; on a Mac drag the app into **Applications**.
3. Open it once. You can skip or close the welcome page.

Microsoft's own [documentation](https://code.visualstudio.com/docs) starts with the first launch, and
its [User interface](https://code.visualstudio.com/docs/editing/getting-started/userinterface) page
names every part of the window in more detail than the next section.

## 2. The window, in five parts

- **Activity bar**: the narrow strip of icons down the left edge. Each icon opens a different side bar.
  The top one, **Explorer**, is your folder's file list. PDF Case Review adds a pen icon here.
- **Side bar**: the panel next to the activity bar that shows whatever icon you clicked. You can drag
  its edge to resize it or click the active icon again to hide it.
- **Editor area**: the big middle space where files open in tabs. A PDF opens here in the viewer.
  The small icons at the top right of a tab are that file's buttons.
- **Panel**: the strip along the bottom, usually hidden, that holds the **Terminal** (a place to type
  commands) and messages. **View > Terminal** opens it.
- **Status bar**: the thin bar along the very bottom with counts and notices.

Two keys are worth learning on day one. `Ctrl+Shift+P` (`Cmd+Shift+P` on a Mac) opens the **Command
Palette**, a search box for every command VS Code and its extensions know; type a few letters of what
you want and press Enter. `Ctrl+,` opens **Settings**, also searchable.

## 3. What extensions are, and installing this one

An extension is a plug-in that adds features to VS Code. They come from the Extensions Marketplace,
which is built into the editor.

1. Click the **Extensions** icon in the activity bar (four small squares), or press `Ctrl+Shift+X`.
2. Type `PDF Case Review` in the search box at the top of the side bar.
3. Click **Install** on the result. Installed extensions stay in the list under **Installed**, where
   you can disable or uninstall them later.

Until the extension is on the Marketplace, install it from its `.vsix` file instead: in the Extensions
side bar click the **...** menu at the top right, choose **Install from VSIX...**, and pick the file
you downloaded from the [project's GitHub page](https://github.com/realslimslaney/pdf-case-review).

Microsoft's
[Extension Marketplace](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace)
page covers searching, updating and disabling extensions.

## 4. Open a folder, not a file

VS Code works best on a folder. Put your case PDFs in one (`Cases`, say) and open it with
**File > Open Folder...**. The Explorer then lists the PDFs, the notes file and the reports the
extension writes beside each PDF appear there as they are created, and the terminal starts in that
folder. The first time, VS Code asks whether you trust the folder's authors; say yes for your own
folders. AI features only run in trusted folders.

Click a PDF in the Explorer and it opens in the viewer. You are ready for
[Your first case, start to finish](first-case.md).

## 5. Optional: a command-line AI assistant

The extension's AI features (an executive summary of your highlights, and letting an assistant read
your notes) are optional; everything else works without them. They need Claude Code or Codex
installed on your computer. When you want them, follow
[Install a command-line AI assistant](../how-to/install-an-ai-cli.md) and come back here.

## What to read next

- [Your first case, start to finish](first-case.md): open a PDF, highlight, take notes, print a report.
- What the extension does with an assistant, and how the consent dialog works:
  [Use Claude Code or Codex as your reviewer](../how-to/ai-reviewer.md).
- If your school gives you a Claude account and you also have a personal one:
  [Use personal and school Claude accounts](../how-to/two-claude-accounts.md).
