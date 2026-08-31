// The Highlights view: a TreeView over the active document's sidecar, grouped by category or page.

import {
  EventEmitter,
  ThemeIcon,
  type TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
} from "vscode";

import { buildTree, type GroupBy, type GroupNode, type LeafNode } from "../../core/tree";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import { Disposable } from "../util/disposable";

export type TreeNode = GroupNode | LeafNode;

function isGroup(node: TreeNode): node is GroupNode {
  return "children" in node;
}

export interface TreeSnapshot {
  groupBy: GroupBy;
  groups: {
    label: string;
    description: string;
    children: { id: string; label: string; description: string }[];
  }[];
}

const icons = new Map<string, Uri>();

/** A filled circle in the category color, as an inline SVG icon (works in every theme). */
export function circleIcon(color: string): Uri {
  let icon = icons.get(color);
  if (!icon) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${color}" stroke="rgba(128,128,128,0.6)"/></svg>`;
    icon = Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
    icons.set(color, icon);
  }
  return icon;
}

export class HighlightsTreeProvider extends Disposable implements TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = this._register(new EventEmitter<TreeNode | undefined>());
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private groups: GroupNode[] = [];
  private readonly parents = new Map<string, GroupNode>();

  constructor(
    private readonly tracker: ActiveDocumentTracker,
    private readonly getGroupBy: () => GroupBy,
  ) {
    super();
    this._register(tracker.onDidChange(() => this.refresh()));
    this.refresh();
  }

  refresh(): void {
    const document = this.tracker.active;
    this.groups = document ? buildTree(document.model, this.getGroupBy()) : [];
    this.parents.clear();
    for (const group of this.groups) {
      for (const child of group.children) {
        this.parents.set(`${child.kind}:${child.id}`, group);
      }
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.groups;
    }
    return isGroup(element) ? element.children : [];
  }

  getParent(element: TreeNode): TreeNode | undefined {
    return isGroup(element) ? undefined : this.parents.get(`${element.kind}:${element.id}`);
  }

  getTreeItem(node: TreeNode): TreeItem {
    if (isGroup(node)) {
      const item = new TreeItem(node.label, TreeItemCollapsibleState.Expanded);
      item.id = `${node.kind}:${node.id}`;
      item.description = node.description;
      item.iconPath = node.color
        ? circleIcon(node.color)
        : new ThemeIcon(node.kind === "documentNotes" ? "notebook" : "book");
      item.contextValue = node.kind;
      return item;
    }
    const item = new TreeItem(node.label, TreeItemCollapsibleState.None);
    item.id = `${node.kind}:${node.id}`;
    item.description = node.description;
    item.tooltip = node.tooltip;
    item.iconPath = node.kind === "highlight" ? circleIcon(node.color) : new ThemeIcon("note");
    item.contextValue = node.kind;
    item.command =
      node.kind === "highlight"
        ? { command: "pdfCaseReview.goToHighlight", title: "Go to highlight", arguments: [node] }
        : { command: "pdfCaseReview.editNote", title: "Edit note", arguments: [node] };
    return item;
  }

  /** What the view shows, for the integration tests. */
  snapshot(): TreeSnapshot {
    return {
      groupBy: this.getGroupBy(),
      groups: this.groups.map((group) => ({
        label: group.label,
        description: group.description,
        children: group.children.map(({ id, label, description }) => ({ id, label, description })),
      })),
    };
  }
}
