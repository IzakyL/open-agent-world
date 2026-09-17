/** A binary split tree fills every pixel; card IDs are references, never copies. */
export type WorkspaceLeaf = { kind: 'pane'; card_id: string } | { kind: 'tabs'; card_ids: string[]; active_card_id: string };
export type WorkspaceNode = WorkspaceLeaf | {
  kind: 'split'; axis: 'horizontal' | 'vertical'; ratio: number;
  first: WorkspaceNode; second: WorkspaceNode;
};
export interface WorkspaceLayout { version: 1; root: WorkspaceNode | null }
export type DockSide = 'left' | 'right' | 'top' | 'bottom';

export function readWorkspaceLayout(value: unknown): WorkspaceLayout {
  const empty: WorkspaceLayout = { version: 1, root: null };
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('root' in value)) return empty;
  const seen = new Set<string>();
  function valid(node: unknown, depth: number): node is WorkspaceNode {
    if (!node || typeof node !== 'object' || depth > 16 || !('kind' in node)) return false;
    if (node.kind === 'pane') {
      if (!('card_id' in node) || typeof node.card_id !== 'string' || !node.card_id || seen.has(node.card_id)) return false;
      seen.add(node.card_id);
      return seen.size <= 100;
    }
    if (node.kind === 'tabs') {
      if (!('card_ids' in node) || !Array.isArray(node.card_ids) || !node.card_ids.length
        || !('active_card_id' in node) || !node.card_ids.includes(node.active_card_id)) return false;
      for (const id of node.card_ids) {
        if (typeof id !== 'string' || !id || id.length > 200 || seen.has(id)) return false;
        seen.add(id);
      }
      return seen.size <= 100;
    }
    return node.kind === 'split' && 'axis' in node && ['horizontal', 'vertical'].includes(String(node.axis))
      && 'ratio' in node && typeof node.ratio === 'number' && Number.isFinite(node.ratio) && node.ratio >= .15 && node.ratio <= .85
      && 'first' in node && 'second' in node && valid(node.first, depth + 1) && valid(node.second, depth + 1);
  }
  function canonical(node: WorkspaceNode): WorkspaceNode {
    return node.kind === 'pane' ? { kind: 'pane', card_id: node.card_id }
      : node.kind === 'tabs' ? { kind: 'tabs', card_ids: [...node.card_ids], active_card_id: node.active_card_id }
      : { kind: 'split', axis: node.axis, ratio: node.ratio, first: canonical(node.first), second: canonical(node.second) };
  }
  return value.root === null ? empty : valid(value.root, 1) ? { version: 1, root: canonical(value.root) } : empty;
}

export function paneIds(node: WorkspaceNode | null): string[] {
  return !node ? [] : node.kind === 'pane' ? [node.card_id] : node.kind === 'tabs' ? node.card_ids : [...paneIds(node.first), ...paneIds(node.second)];
}

export function activePaneId(node: WorkspaceLeaf): string {
  return node.kind === 'pane' ? node.card_id : node.active_card_id;
}

function makeLeaf(ids: string[], active: string): WorkspaceLeaf | null {
  return !ids.length ? null : ids.length === 1 ? { kind: 'pane', card_id: ids[0] }
    : { kind: 'tabs', card_ids: ids, active_card_id: ids.includes(active) ? active : ids[0] };
}

function leafForCard(node: WorkspaceNode | null, id: string): WorkspaceLeaf | null {
  if (!node) return null;
  return node.kind === 'split' ? leafForCard(node.first, id) ?? leafForCard(node.second, id)
    : paneIds(node).includes(id) ? node : null;
}

function mapLeaves(node: WorkspaceNode, update: (leaf: WorkspaceLeaf) => WorkspaceNode): WorkspaceNode {
  return node.kind === 'split' ? { ...node, first: mapLeaves(node.first, update), second: mapLeaves(node.second, update) } : update(node);
}

export function activateTab(root: WorkspaceNode, id: string): WorkspaceNode {
  return mapLeaves(root, leaf => leaf.kind === 'tabs' && leaf.card_ids.includes(id) ? { ...leaf, active_card_id: id } : leaf);
}

/** Move a card into a region, optionally before an existing tab (also reorders). */
export function stackPane(root: WorkspaceNode | null, id: string, target: string, before?: string): WorkspaceNode | null {
  const leaf = leafForCard(root, target);
  if (!leaf || before === id) return root;
  const targetIds = paneIds(leaf).filter(item => item !== id);
  if (!targetIds.length) return root;
  const remaining = removePane(root, id)!;
  const index = before ? targetIds.indexOf(before) : -1;
  targetIds.splice(index < 0 ? targetIds.length : index, 0, id);
  const result = mapLeaves(remaining, item => paneIds(item).includes(targetIds.find(key => key !== id)!)
    ? makeLeaf(targetIds, id)! : item);
  return readWorkspaceLayout({ version: 1, root: result }).root ? result : root;
}

export function retainPanes(node: WorkspaceNode | null, ids: ReadonlySet<string>): WorkspaceNode | null {
  if (!node) return null;
  if (node.kind === 'pane') return ids.has(node.card_id) ? node : null;
  if (node.kind === 'tabs') return makeLeaf(node.card_ids.filter(id => ids.has(id)), node.active_card_id);
  const first = retainPanes(node.first, ids), second = retainPanes(node.second, ids);
  return first && second ? { ...node, first, second } : first ?? second;
}

export function removePane(node: WorkspaceNode | null, id: string) {
  return retainPanes(node, new Set(paneIds(node).filter(item => item !== id)));
}

export function dockPane(root: WorkspaceNode | null, id: string, target: string | null, side: DockSide): WorkspaceNode | null {
  if (root && !paneIds(root).includes(target ?? '')) return root;
  if (id === target) {
    target = paneIds(leafForCard(root, id)).find(key => key !== id) ?? null;
    if (!target) return root;
  }
  const pane: WorkspaceNode = { kind: 'pane', card_id: id };
  const remaining = removePane(root, id);
  if (!remaining) return pane;
  const before = side === 'left' || side === 'top';
  function insert(node: WorkspaceNode): WorkspaceNode {
    if (node.kind !== 'split') return paneIds(node).includes(target!) ? {
      kind: 'split', axis: side === 'left' || side === 'right' ? 'horizontal' : 'vertical', ratio: .5,
      first: before ? pane : node, second: before ? node : pane,
    } : node;
    return { ...node, first: insert(node.first), second: insert(node.second) };
  }
  const result = insert(remaining);
  // Keep UI and backend depth/count limits identical; an invalid drop is a no-op.
  return readWorkspaceLayout({ version: 1, root: result }).root ? result : root;
}

export function resizeSplit(node: WorkspaceNode, path: string, ratio: number): WorkspaceNode {
  if (node.kind !== 'split') return node;
  if (!path) return { ...node, ratio: Math.min(.85, Math.max(.15, ratio)) };
  return path[0] === '0' ? { ...node, first: resizeSplit(node.first, path.slice(1), ratio) }
    : { ...node, second: resizeSplit(node.second, path.slice(1), ratio) };
}

export function layoutMinimum(node: WorkspaceNode | null): { width: number; height: number } {
  if (!node || node.kind !== 'split') return { width: 240, height: 200 };
  const a = layoutMinimum(node.first), b = layoutMinimum(node.second);
  return node.axis === 'horizontal'
    ? { width: Math.ceil(Math.max(a.width / node.ratio, b.width / (1 - node.ratio))) + 5, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: Math.ceil(Math.max(a.height / node.ratio, b.height / (1 - node.ratio))) + 5 };
}

export function dropSide(x: number, y: number, width: number, height: number): DockSide {
  const distances: [DockSide, number][] = [['left', x / width], ['right', 1 - x / width], ['top', y / height], ['bottom', 1 - y / height]];
  return distances.sort((a, b) => a[1] - b[1])[0][0];
}
