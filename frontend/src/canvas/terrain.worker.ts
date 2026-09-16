import { getTerrainChunk, parseChunkKey, type TerrainChunkGeometry } from './terrain';

export interface TerrainRequest {
  id: number;
  keys: string[];
  resolution: number;
  seed: number;
}

export interface TerrainResponse {
  id: number;
  chunk: TerrainChunkGeometry;
}

let pending: TerrainRequest | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function pump() {
  timer = undefined;
  if (!pending) return;
  const key = pending.keys.shift();
  if (key === undefined) return;
  const coordinates = parseChunkKey(key);
  if (coordinates) {
    const chunk = getTerrainChunk(coordinates.x, coordinates.y, pending.resolution, pending.seed);
    postMessage({ id: pending.id, chunk } satisfies TerrainResponse);
  }
  // Yield between chunks so a newer viewport can replace obsolete queued work.
  if (pending.keys.length) timer = setTimeout(pump, 0);
}

self.onmessage = (event: MessageEvent<TerrainRequest>) => {
  pending = event.data;
  if (timer === undefined) timer = setTimeout(pump, 0);
};
