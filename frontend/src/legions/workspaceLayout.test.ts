import { describe, expect, it } from 'vitest';
import { activateTab, dockPane, dropSide, layoutMinimum, paneIds, readWorkspaceLayout, removePane, resizeSplit, retainPanes, stackPane, type WorkspaceNode } from './workspaceLayout';

const pane = (card_id: string): WorkspaceNode => ({ kind: 'pane', card_id });

describe('Legion window layout', () => {
  it('stacks cards, reorders tabs and moves them across regions without duplication', () => {
    let root = stackPane(pane('a'), 'b', 'a');
    root = stackPane(root, 'c', 'a', 'b');
    expect(root).toEqual({ kind: 'tabs', card_ids: ['a', 'c', 'b'], active_card_id: 'c' });
    root = stackPane(root, 'b', 'c', 'a');
    expect(paneIds(root)).toEqual(['b', 'a', 'c']);
    root = dockPane(root, 'b', 'b', 'right');
    expect(root).toMatchObject({ first: { kind: 'tabs', card_ids: ['a', 'c'] }, second: pane('b') });
    root = stackPane(root, 'c', 'b');
    expect(root).toMatchObject({ first: pane('a'), second: { kind: 'tabs', card_ids: ['b', 'c'], active_card_id: 'c' } });
    expect(activateTab(root!, 'b')).toMatchObject({ second: { active_card_id: 'b' } });
    expect(stackPane(root, 'a', 'missing')).toBe(root);
    expect(stackPane(root, 'c', 'c', 'c')).toBe(root);
  });
  it('recovers the active tab after removing or detaching members', () => {
    const root = { kind: 'tabs', card_ids: ['a', 'b', 'c'], active_card_id: 'b' } as const;
    const tree: WorkspaceNode = { ...root, card_ids: [...root.card_ids] };
    expect(removePane(tree, 'b')).toEqual({ kind: 'tabs', card_ids: ['a', 'c'], active_card_id: 'a' });
    expect(retainPanes(tree, new Set(['c']))).toEqual(pane('c'));
    expect(retainPanes(tree, new Set())).toBeNull();
  });
  it('validates tab membership and uniqueness across the whole tree', () => {
    for (const root of [
      { kind: 'tabs', card_ids: [], active_card_id: 'a' },
      { kind: 'tabs', card_ids: ['a', 'a'], active_card_id: 'a' },
      { kind: 'tabs', card_ids: ['a', 'b'], active_card_id: 'missing' },
      { kind: 'split', axis: 'horizontal', ratio: .5, first: pane('a'), second: { kind: 'tabs', card_ids: ['a', 'b'], active_card_id: 'a' } },
    ]) expect(readWorkspaceLayout({ version: 1, root }).root).toBeNull();
  });
  it('docks around a region, then moves an existing card without duplicating it', () => {
    let root = dockPane(null, 'editor', null, 'right');
    root = dockPane(root, 'files', 'editor', 'left');
    root = dockPane(root, 'terminal', 'editor', 'bottom');
    expect(paneIds(root)).toEqual(['files', 'editor', 'terminal']);
    root = dockPane(root, 'files', 'terminal', 'right');
    expect(paneIds(root)).toEqual(['editor', 'terminal', 'files']);
    expect(root).toMatchObject({ kind: 'split', axis: 'vertical', first: pane('editor'), second: { axis: 'horizontal' } });
  });
  it('does not drop a card on itself or lose a card on a stale target', () => {
    const root = dockPane(pane('a'), 'b', 'a', 'right');
    expect(dockPane(root, 'a', 'a', 'left')).toBe(root);
    expect(dockPane(root, 'a', 'deleted', 'left')).toBe(root);
  });
  it('collapses removed and detached panes so remaining cards fill the window', () => {
    const root = dockPane(dockPane(pane('a'), 'b', 'a', 'right'), 'c', 'b', 'bottom');
    expect(retainPanes(root, new Set(['a', 'c']))).toMatchObject({ first: pane('a'), second: pane('c') });
    expect(retainPanes(root, new Set(['c']))).toEqual(pane('c'));
    expect(removePane(pane('a'), 'a')).toBeNull();
  });
  it('resizes only the addressed split and computes minima for uneven panes', () => {
    const root = dockPane(dockPane(pane('a'), 'b', 'a', 'right'), 'c', 'b', 'bottom')!;
    const resized = resizeSplit(root, '1', .2);
    expect(resized).toMatchObject({ ratio: .5, second: { ratio: .2 } });
    expect(layoutMinimum(resized)).toEqual({ width: 485, height: 1005 });
    expect(resizeSplit(root, '', 1)).toMatchObject({ ratio: .85 });
    expect(dropSide(490, 100, 500, 300)).toBe('right');
  });
  it('rejects unsupported, malformed and duplicate persisted layouts', () => {
    for (const value of [{ version: 2 }, { version: 1, root: {} }, { version: 1, root: { kind: 'split', axis: 'horizontal', ratio: NaN, first: pane('a'), second: pane('b') } },
      { version: 1, root: { kind: 'split', axis: 'horizontal', ratio: .5, first: pane('a'), second: pane('a') } }]) {
      expect(readWorkspaceLayout(value).root).toBeNull();
    }
  });
  it('canonicalizes JSON object order for saved draft comparisons', () => {
    expect(JSON.stringify(readWorkspaceLayout({ root: { card_id: 'a', kind: 'pane' }, version: 1 })))
      .toBe(JSON.stringify({ version: 1, root: pane('a') }));
  });
});
