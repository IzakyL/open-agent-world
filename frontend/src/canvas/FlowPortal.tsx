import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@xyflow/react';

const portals = new WeakMap<HTMLElement, Map<string, HTMLElement>>();

/** React Flow's first-descendant lookup can select a nested graph's portal. */
export function ownedFlowPortal(root: HTMLElement | null, className: string) {
  if (!root) return null;
  const cached = portals.get(root)?.get(className);
  if (cached?.closest('.react-flow') === root) return cached;
  const target = Array.from(root.querySelectorAll<HTMLElement>(`.${className}`))
    .find(element => element.closest('.react-flow') === root) ?? null;
  if (target) {
    let owned = portals.get(root);
    if (!owned) { owned = new Map(); portals.set(root, owned); }
    owned.set(className, target);
  }
  return target;
}

export function ViewportPortal({ children }: { children: ReactNode }) {
  const target = useStore(state => ownedFlowPortal(state.domNode, 'react-flow__viewport-portal'));
  return target ? createPortal(children, target) : null;
}

export function EdgeLabelRenderer({ children }: { children: ReactNode }) {
  const target = useStore(state => ownedFlowPortal(state.domNode, 'react-flow__edgelabel-renderer'));
  return target ? createPortal(children, target) : null;
}
