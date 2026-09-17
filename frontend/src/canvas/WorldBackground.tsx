import { memo, useId, useLayoutEffect, useRef } from "react";
import { useStoreApi } from '@xyflow/react';

// Larger than the largest dot spacing (24 * the canvas maxZoom of 2.2).
const PADDING = 64;

/** Keep dots visible in screen pixels; zooming out shows a coarser world grid. */
export const WorldBackground = memo(function WorldBackground() {
  const store = useStoreApi();
  const id = `oaw-world-grid-${useId().replaceAll(':', '')}`;
  const svg = useRef<SVGSVGElement>(null);
  const pattern = useRef<SVGPatternElement>(null);
  useLayoutEffect(() => {
    let previousZoom: number | undefined;
    const update = () => {
      const [x, y, zoom] = store.getState().transform;
      const stride = 2 ** Math.max(0, Math.ceil(Math.log2(18 / (24 * zoom))));
      const gap = 24 * stride * zoom;
      if (zoom !== previousZoom) {
        pattern.current!.setAttribute('width', String(gap));
        pattern.current!.setAttribute('height', String(gap));
        pattern.current!.setAttribute('patternTransform', `translate(${-gap / 2},${-gap / 2})`);
        previousZoom = zoom;
      }
      // Translate a cached screen-sized tile instead of repainting an SVG
      // pattern and rendering React on every pointer movement.
      svg.current!.style.transform = `translate(${x % gap}px, ${y % gap}px)`;
    };
    update();
    return store.subscribe((state, previous) => {
      if (state.transform !== previous.transform) update();
    });
  }, [store]);
  return <svg ref={svg} className="react-flow__background world-grid" data-testid="rf__background"
    aria-hidden="true" style={{ position: 'absolute', left: -PADDING, top: -PADDING,
      width: `calc(100% + ${PADDING * 2}px)`, height: `calc(100% + ${PADDING * 2}px)`, willChange: 'transform' }}>
    <pattern ref={pattern} id={id} x={PADDING} y={PADDING} patternUnits="userSpaceOnUse">
      <circle cx={1} cy={1} r={1} fill="var(--grid-dot)" />
    </pattern>
    <rect width="100%" height="100%" fill={`url(#${id})`} />
  </svg>;
});
