import { shallow } from 'zustand/shallow';
import type { CanvasNode } from '../cards/types';

/** Retain React Flow's per-node identity when a world update changes its peers. */
export function stableNode(previous: CanvasNode | undefined, next: CanvasNode): CanvasNode {
  if (!previous) return next;
  const node = {
    ...next,
    position: shallow(previous.position, next.position) ? previous.position : next.position,
    style: shallow(previous.style, next.style) ? previous.style : next.style,
    data: shallow(previous.data, next.data) ? previous.data : next.data,
  };
  return shallow(previous, node) ? previous : node;
}

export function stableNodeList(previous: CanvasNode[], next: CanvasNode[]): CanvasNode[] {
  return previous.length === next.length && next.every((node, index) => node === previous[index]) ? previous : next;
}
