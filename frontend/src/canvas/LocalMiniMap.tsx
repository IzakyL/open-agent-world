import { t, useLocale } from "../i18n";
import { Panel, useReactFlow, useStore, useStoreApi } from '@xyflow/react';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { shallow } from 'zustand/shallow';
import type { CanvasNodeData } from '../cards/types';
import { getNodeType } from '../state/catalog';
import { useWorldStore } from '../state/worldStore';

const LocalNode = memo(function LocalNode({ id }: { id: string }) {
  useLocale();
  const catalog = useWorldStore(state => state.catalog);
  const rect = useStore(state => {
    const node = state.nodeLookup.get(id);
    if (!node || node.hidden) return null;
    return {
      ...node.internals.positionAbsolute,
      width: node.measured.width ?? node.width ?? 0,
      height: node.measured.height ?? node.height ?? 0,
      type: (node.data as CanvasNodeData).card.type,
    };
  }, shallow);
  return rect && <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height}
    rx={5} fill={getNodeType(catalog, rect.type)?.color ?? 'var(--ink-soft)'} />;
});

/** A local lens: bounds depend only on the live viewport, never on node extents. */
export const LocalMiniMap = memo(function LocalMiniMap() {
  useLocale();
  const { setViewport, getViewport } = useReactFlow();
  const store = useStoreApi();
  const { width, height } = useStore(state => ({
    width: state.width, height: state.height,
  }), shallow);
  const nodes = useStore(state => state.nodes);
  const ids = useMemo(() => nodes.map(node => node.id), [nodes]);
  const svg = useRef<SVGSVGElement>(null);
  const mask = useRef<SVGPathElement>(null);
  const outline = useRef<SVGRectElement>(null);
  const drag = useRef<{ clientX: number; clientY: number; x: number; y: number; zoom: number; scale: number }>();
  useLayoutEffect(() => {
    const update = () => {
      const { transform: [x, y, zoom], width, height } = store.getState();
      const view = { x: -x / zoom, y: -y / zoom, width: width / zoom, height: height / zoom };
      const bounds = { x: view.x - view.width * .15, y: view.y - view.height * .15,
        width: view.width * 1.3, height: view.height * 1.3 };
      svg.current?.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
      mask.current?.setAttribute('d', `M${bounds.x},${bounds.y}h${bounds.width}v${bounds.height}h${-bounds.width}z M${view.x},${view.y}h${view.width}v${view.height}h${-view.width}z`);
      for (const [key, value] of Object.entries(view)) outline.current?.setAttribute(key, String(value));
    };
    update();
    // Pan updates only SVG geometry; the card list and controls do not render.
    return store.subscribe((state, previous) => {
      if (state.transform !== previous.transform || state.width !== previous.width || state.height !== previous.height) update();
    });
  }, [store, width, height]);
  if (!width || !height) return null;
  const scale = Math.min(132 / width, 96 / height);
  const mapWidth = width * scale;
  const mapHeight = height * scale;
  return <Panel position="bottom-right" className="world-minimap react-flow__minimap"
    style={{ width: mapWidth, height: mapHeight, background: 'var(--canvas)' }}>
    <svg ref={svg} className="react-flow__minimap-svg" width={mapWidth} height={mapHeight}
      role="img"
      aria-label={t("Nearby canvas — current view with 15% surroundings; drag to pan")}
      onWheel={event => event.stopPropagation()}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const viewport = getViewport();
        drag.current = { clientX: event.clientX, clientY: event.clientY, ...viewport, scale: width / viewport.zoom * 1.3 / mapWidth };
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start) return;
        void setViewport({ x: start.x - (event.clientX - start.clientX) * start.scale * start.zoom,
          y: start.y - (event.clientY - start.clientY) * start.scale * start.zoom, zoom: start.zoom });
      }}
      onPointerUp={event => {
        drag.current = undefined;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = undefined; }}
      onLostPointerCapture={() => { drag.current = undefined; }}>
      <title>{t("Nearby canvas · drag to pan")}</title>
      {ids.map(id => <LocalNode key={id} id={id} />)}
      <path ref={mask} className="local-minimap-mask" fill="var(--minimap-mask)" fillRule="evenodd" pointerEvents="none" />
      <rect ref={outline} className="local-minimap-viewport" fill="none" stroke="var(--accent)"
        strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
    </svg>
  </Panel>;
});
