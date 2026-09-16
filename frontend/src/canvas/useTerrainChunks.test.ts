// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTerrainChunks } from './useTerrainChunks';
import type { TerrainRequest, TerrainResponse } from './terrain.worker';

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: MessageEvent<TerrainResponse>) => void) | null = null;
  requests: TerrainRequest[] = [];
  terminate = vi.fn();
  constructor() { FakeWorker.latest = this; }
  postMessage(request: TerrainRequest) { this.requests.push(request); }
  reply(request = this.requests.at(-1)!, x = 0) {
    this.onmessage?.(new MessageEvent<TerrainResponse>('message', { data: { id: request.id, chunk: {
      key: `${request.seed}:${x}:0:${request.resolution}`, chunkX: x, chunkY: 0,
      resolution: request.resolution, minorPath: 'M0 0L1 1', majorPath: '', fillPaths: [],
    } } }));
  }
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps old detail until replacement, rejects stale replies, and clears another seed', () => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FakeWorker);
  const keys = ['0:0'];
  const { result, rerender, unmount } = renderHook(
    ({ resolution, seed }) => useTerrainChunks(keys, resolution, seed),
    { initialProps: { resolution: 56, seed: 123 as number | null } },
  );
  const worker = FakeWorker.latest;
  const initial = worker.requests[0];
  expect(result.current).toEqual([]);
  act(() => { worker.reply(); vi.advanceTimersByTime(20); });
  expect(result.current[0].resolution).toBe(56);
  rerender({ resolution: 80, seed: 123 });
  expect(result.current[0].resolution).toBe(56);
  act(() => { worker.reply(initial, 99); vi.advanceTimersByTime(20); });
  expect(result.current).toHaveLength(1);
  act(() => { worker.reply(); vi.advanceTimersByTime(20); });
  expect(result.current[0].resolution).toBe(80);
  const previous = worker.requests.at(-1)!;
  rerender({ resolution: 80, seed: 456 });
  expect(result.current).toEqual([]);
  act(() => { worker.reply(previous); vi.advanceTimersByTime(20); });
  expect(result.current).toEqual([]);
  act(() => { worker.reply(); vi.advanceTimersByTime(20); });
  expect(result.current[0].key).toBe('456:0:0:80');
  rerender({ resolution: 80, seed: null });
  expect(result.current).toEqual([]);
  expect(worker.requests.at(-1)!.keys).toEqual([]);
  unmount();
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('drops offscreen chunks and cancels a queued paint on unmount', () => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FakeWorker);
  const { result, rerender, unmount } = renderHook(({ keys }) => useTerrainChunks(keys, 56, 123),
    { initialProps: { keys: ['0:0'] } });
  const worker = FakeWorker.latest;
  act(() => { worker.reply(); vi.advanceTimersByTime(20); });
  rerender({ keys: ['1:0'] });
  expect(result.current).toEqual([]);
  act(() => worker.reply(worker.requests.at(-1), 1));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
