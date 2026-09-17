import { useEffect, useRef, useState } from 'react';
import type { TerrainChunkGeometry } from './terrain';
import type { TerrainRequest, TerrainResponse } from './terrain.worker';

/** Geometry generation never runs inside React render or the pointer event loop. */
export function useTerrainChunks(keys: string[], resolution: number, seed: number | null) {
  const worker = useRef<Worker>();
  const requestId = useRef(0);
  const retained = useRef(new Map<string, TerrainChunkGeometry>());
  const retainedSeed = useRef(seed);
  const [snapshot, setSnapshot] = useState<{ seed: number | null; chunks: TerrainChunkGeometry[] }>({ seed, chunks: [] });

  useEffect(() => {
    const instance = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
    worker.current = instance;
    return () => { instance.terminate(); worker.current = undefined; };
  }, []);

  useEffect(() => {
    const instance = worker.current;
    if (!instance) return;
    const id = ++requestId.current;
    if (retainedSeed.current !== seed) {
      retained.current.clear();
      retainedSeed.current = seed;
    }
    const wanted = new Set(keys);
    for (const key of retained.current.keys()) {
      if (!wanted.has(key)) retained.current.delete(key);
    }
    const publish = () => setSnapshot({ seed, chunks: keys.flatMap(key => {
      const chunk = retained.current.get(key);
      return chunk ? [chunk] : [];
    }) });
    publish();
    let frame: number | undefined;
    instance.onmessage = (event: MessageEvent<TerrainResponse>) => {
      if (event.data.id !== requestId.current) return;
      const { chunk } = event.data;
      retained.current.set(`${chunk.chunkX}:${chunk.chunkY}`, chunk);
      if (frame === undefined) frame = requestAnimationFrame(() => { frame = undefined; publish(); });
    };
    // Keep the previous LOD visible until each replacement is ready. The worker
    // owns the bounded LRU cache, while the UI retains only its current coverage.
    instance.postMessage({ id, seed: seed ?? 0, resolution,
      keys: seed === null ? [] : keys.filter(key => retained.current.get(key)?.resolution !== resolution),
    } satisfies TerrainRequest);
    return () => {
      instance.onmessage = null;
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [keys, resolution, seed]);

  return snapshot.seed === seed ? snapshot.chunks : [];
}
