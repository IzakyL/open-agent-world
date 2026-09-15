import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { GuideRect } from './placement';

export interface SpotlightRegion extends GuideRect { id: string; glow?: boolean }
export interface SpotlightRoute { id: string; path: string; transform: string }
export interface SpotlightHandle { update: (regions: SpotlightRegion[], route?: SpotlightRoute, dim?: boolean) => void }

/** One mask with several openings: overlapping holes never darken each other.
 * Keep outgoing openings alive while the next subjects fade into view. */
export const Spotlight = forwardRef<SpotlightHandle>(function Spotlight(_, ref) {
  const id = useId();
  const holes = useRef<SVGGElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const shade = useRef<SVGRectElement>(null);
  const desired = useRef<{ regions: SpotlightRegion[]; route?: SpotlightRoute; dim?: boolean }>({ regions: [] });
  useImperativeHandle(ref, () => ({ update: (regions, route, dim = true) => { desired.current = { regions, route, dim }; } }), []);
  useLayoutEffect(() => {
    const entries = new Map<string, { hole: SVGElement; glow?: HTMLDivElement; opacity: number }>();
    let frame = 0, previous = performance.now(), darkness = 0;
    const tick = (now: number) => {
      const dt = Math.min(50, now - previous); previous = now;
      const amount = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : dt / 480;
      const { regions, route, dim } = desired.current;
      const wanted = new Set(regions.map(region => region.id));
      if (route) wanted.add(route.id);
      for (const region of regions) {
        let entry = entries.get(region.id);
        if (!entry) {
          const hole = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          hole.setAttribute('fill', 'black'); hole.setAttribute('rx', '18');
          hole.dataset.spotlightTarget = region.id;
          const light = document.createElement('div'); light.className = 'tutorial-spotlight';
          light.dataset.spotlightTarget = region.id;
          holes.current?.append(hole); glow.current?.append(light);
          entry = { hole, glow: light, opacity: 0 }; entries.set(region.id, entry);
        }
        const rect = { x: region.x - 10, y: region.y - 10, width: region.width + 20, height: region.height + 20 };
        for (const [key, value] of Object.entries(rect)) entry.hole.setAttribute(key, String(value));
        Object.assign(entry.glow!.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        // A foreground chooser owns the glow; card outlines must not bleed
        // through its contents, while the uncovered parts of both cards stay lit.
        entry.glow!.style.visibility = region.glow === false ? 'hidden' : 'visible';
      }
      if (route) {
        let entry = entries.get(route.id);
        if (!entry) {
          const hole = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          hole.setAttribute('fill', 'none'); hole.setAttribute('stroke', 'black');
          hole.setAttribute('stroke-width', '80'); hole.setAttribute('stroke-linecap', 'round');
          hole.setAttribute('vector-effect', 'non-scaling-stroke'); hole.dataset.spotlightRoute = route.id;
          holes.current?.append(hole); entry = { hole, opacity: 0 }; entries.set(route.id, entry);
        }
        entry.hole.setAttribute('d', route.path); entry.hole.setAttribute('transform', route.transform);
      }
      for (const [key, entry] of entries) {
        entry.opacity = Math.max(0, Math.min(1, entry.opacity + (wanted.has(key) ? amount : -amount)));
        entry.hole.setAttribute('opacity', String(entry.opacity));
        if (entry.glow) entry.glow.style.opacity = String(entry.opacity);
        if (!wanted.has(key) && entry.opacity === 0) { entry.hole.remove(); entry.glow?.remove(); entries.delete(key); }
      }
      darkness = Math.max(0, Math.min(1, darkness + (wanted.size && dim ? amount : -amount)));
      shade.current?.setAttribute('opacity', String(darkness));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); for (const entry of entries.values()) { entry.hole.remove(); entry.glow?.remove(); } };
  }, []);
  return <div className="tutorial-spotlight-layer" aria-hidden="true">
    <svg className="tutorial-spotlight-mask" width="100%" height="100%">
      <defs><mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" style={{ maskType: 'luminance' }}>
        <rect width="100%" height="100%" fill="white" /><g ref={holes} />
      </mask></defs>
      <rect ref={shade} width="100%" height="100%" fill="rgb(8 12 18 / 56%)" mask={`url(#${id})`} opacity="0" />
    </svg>
    <div ref={glow} />
  </div>;
});
