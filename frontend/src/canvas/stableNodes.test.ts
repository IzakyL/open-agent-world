import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../cards/types';
import { stableNode, stableNodeList } from './stableNodes';

const card = { id: 'a', position: { x: 0, y: 0 } } as CanvasNode['data']['card'];
const node: CanvasNode = { id: 'a', type: 'worldCard', position: { x: 0, y: 0 },
  style: { width: 224, height: 300 }, data: { card, surfaceLevel: 'preview', displaced: false }, selected: true };

describe('canvas node identity', () => {
  it('retains unchanged nodes and lists when another card is instantiated', () => {
    const next = stableNode(node, { ...node, position: { ...node.position }, style: { ...node.style }, data: { ...node.data } });
    expect(next).toBe(node);
    const previous = [node];
    expect(stableNodeList(previous, [next])).toBe(previous);
  });
  it('moves the wrapper without invalidating card contents', () => {
    const next = stableNode(node, { ...node, position: { x: 45, y: 20 }, data: { ...node.data } });
    expect(next).not.toBe(node);
    expect(next.data).toBe(node.data);
    expect(next.position).toEqual({ x: 45, y: 20 });
    expect(next.selected).toBe(true);
  });
  it('does not retain stale content, geometry or structural flags', () => {
    const next = stableNode(node, { ...node, data: { ...node.data, card: { ...card, name: 'New' } },
      style: { width: 438, height: 570 }, hidden: false, parentId: 'container', selected: false });
    expect(next.data).not.toBe(node.data);
    expect(next.style).not.toBe(node.style);
    expect(next.parentId).toBe('container');
    expect(next.selected).toBe(false);
  });
});
