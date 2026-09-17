import { useOnViewportChange, useStore, type Viewport } from "@xyflow/react";
import { ViewportPortal } from "./FlowPortal";
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { CHUNK_SIZE, getViewportChunkKeys } from "../state/chunks";
import { useWorldStore } from "../state/worldStore";
import type { FlowViewportState } from "../types/world";
import { terrainResolutionForZoom } from "./terrain";
import { useTerrainChunks } from './useTerrainChunks';

interface TerrainView {
  keys: string[];
  resolution: number;
  signature: string;
}

function terrainViewFor(viewport: FlowViewportState): TerrainView {
  const visible = new Set(getViewportChunkKeys(viewport, 0));
  const keys = getViewportChunkKeys(viewport).sort((a, b) => Number(visible.has(b)) - Number(visible.has(a)));
  const resolution = terrainResolutionForZoom(viewport.zoom);
  return { keys, resolution, signature: `${resolution}|${keys.join(",")}` };
}

export const ContourLayer = memo(function ContourLayer() {
  // React Flow scales an HTML ancestor. SVG vector-effect does not compensate
  // that outer CSS transform, so convert screen pixels back to world units.
  const zoom = useStore(state => state.transform[2]);
  const storedViewport = useWorldStore((state) => state.viewport);
  const terrainSeed = useWorldStore((state) => state.terrainSeed);
  const [terrainView, setTerrainView] = useState(() => terrainViewFor(storedViewport));
  const signature = useRef(terrainView.signature);
  const acceptViewport = useCallback((viewport: FlowViewportState) => {
    const next = terrainViewFor(viewport);
    if (next.signature === signature.current) return;
    signature.current = next.signature;
    setTerrainView(next);
  }, []);
  const onViewportChange = useCallback((viewport: Viewport) => {
    const { width, height } = useWorldStore.getState().viewport;
    acceptViewport({ ...viewport, width, height });
  }, [acceptViewport]);

  useOnViewportChange({ onChange: onViewportChange, onEnd: onViewportChange });
  useEffect(() => acceptViewport(storedViewport), [acceptViewport, storedViewport]);

  const chunks = useTerrainChunks(terrainView.keys, terrainView.resolution, terrainSeed);

  return (
    <ViewportPortal>
      {chunks.map((chunk) => (
        <svg
          key={chunk.key}
          className="contour-chunk"
          data-chunk={`${chunk.chunkX}:${chunk.chunkY}`}
          data-resolution={chunk.resolution}
          viewBox={`0 0 ${CHUNK_SIZE} ${CHUNK_SIZE}`}
          style={{
            '--contour-stroke-scale': 1 / zoom,
            left: chunk.chunkX * CHUNK_SIZE,
            top: chunk.chunkY * CHUNK_SIZE,
          } as CSSProperties}
          role="presentation"
        >
          {chunk.fillPaths.map((path, index) => path && (
            <path key={index} className="contour-fill" fillRule="evenodd" d={path} />
          ))}
          {chunk.minorPath && <path className="contour contour-minor" d={chunk.minorPath} />}
          {chunk.majorPath && <path className="contour contour-major" d={chunk.majorPath} />}
        </svg>
      ))}
    </ViewportPortal>
  );
});
