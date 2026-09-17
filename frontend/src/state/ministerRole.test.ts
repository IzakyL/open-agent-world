// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { worldApi } from '../api/client';
import { TEST_CATALOG } from './catalog.fixture';
import { buildCardDraft } from './helpers';
import { appointMinister, canAppointMinister, PROMOTION_DURATION, useMinisterRole } from './ministerRole';
import { useWorldStore } from './worldStore';
import { profileStorage } from './profileStorage';
import { useNodeSurfaceStore } from './nodeSurfaces';

const agent = () => ({ id: 'worker', revision: 1, ...buildCardDraft('agent', { x: 100, y: 100 }) });
beforeEach(() => {
  vi.restoreAllMocks(); vi.useFakeTimers();
  profileStorage.removeItem('oaw-minister-role-learned');
  useMinisterRole.setState({ promotions: {}, pending: {}, settingsCardId: undefined });
  useWorldStore.setState({ cards: [agent()], catalog: TEST_CATALOG, undoStack: [], redoStack: [], historyBusy: false,
    cardTombstones: {}, syncState: 'online', toasts: [] });
  vi.spyOn(useWorldStore.getState(), 'refreshWorld').mockResolvedValue();
  useNodeSurfaceStore.setState({ surfaceLevels: {}, baseLevels: {}, dragging: false });
});
afterEach(() => { vi.useRealTimers(); });

it('animates a saved role-card promotion without replaying after reload', async () => {
  const before = agent(), minister = { control_radius: 1200, allow_canvas_edits: true };
  const source = { ...before, id: 'role', type: 'core.minister-role' };
  const save = vi.spyOn(worldApi, 'appointMinister').mockResolvedValue({ ...before, revision: 2, minister });
  useNodeSurfaceStore.setState({ dragging: true });
  await appointMinister(before.id, source);
  expect(useNodeSurfaceStore.getState().surfaceLevels[before.id]).toBe('node');
  expect(useNodeSurfaceStore.getState().baseLevels[before.id]).toBe('node');
  expect(save).toHaveBeenCalledWith(before.id, before.revision, source);
  expect(useWorldStore.getState().cards[0]).toMatchObject({ type: before.type, config: before.config, minister });
  expect(useMinisterRole.getState().promotions[before.id]).toBeDefined();
  vi.advanceTimersByTime(PROMOTION_DURATION);
  expect(useMinisterRole.getState().promotions).toEqual({});
  // Loading the same saved world never enqueues a promotion.
  useWorldStore.setState({ cards: [{ ...before, minister }] });
  expect(useMinisterRole.getState().promotions).toEqual({});
});

it('retains the normal Agent and does not celebrate a rejected save', async () => {
  vi.spyOn(worldApi, 'appointMinister').mockRejectedValue(new Error('offline'));
  await appointMinister('worker');
  expect(useWorldStore.getState().cards[0].minister).toBeUndefined();
  expect(useMinisterRole.getState().promotions).toEqual({});
  expect(profileStorage.getItem('oaw-minister-role-learned')).toBeNull();
});

it('uses the normal Agent trait for plugin eligibility', () => {
  const builtin = TEST_CATALOG.node_types.find(type => type.id === 'agent')!;
  const catalog = { ...TEST_CATALOG, node_types: [...TEST_CATALOG.node_types, { ...builtin, id: 'future.worker' }] };
  expect(canAppointMinister({ ...agent(), type: 'future.worker' }, catalog)).toBe(true);
  expect(canAppointMinister({ ...agent(), type: 'text' }, catalog)).toBe(false);
  expect(canAppointMinister({ ...agent(), ephemeral: true }, catalog)).toBe(false);
});
