// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { worldApi } from '../api/client';
import { useWorldStore } from '../state/worldStore';
import { useNodeSurfaceStore } from '../state/nodeSurfaces';
import type { WorldCard } from '../types/world';
import { MinisterConversation } from './MinisterConversation';

const card: WorldCard = { id: 'minister', type: 'agent', name: 'Minister', position: { x: 0, y: 0 },
  size: { width: 96, height: 96 }, expanded: false, status: 'idle', config: {} };
const chat = { conversation_id: 'chat', session_id: 'session' };
const page = { items: [], has_before: false, has_after: false, active_agent_ids: [] };
beforeEach(() => {
  vi.restoreAllMocks();
  useWorldStore.setState({ events: [], socketState: 'live' });
  useNodeSurfaceStore.setState({ drafts: {} });
  vi.spyOn(worldApi, 'getConversationTimeline').mockResolvedValue(page);
});
afterEach(cleanup);

it('shows feedback before the send resolves and preserves the draft on failure', async () => {
  let reject!: (reason: Error) => void;
  vi.spyOn(worldApi, 'postConversationMessage').mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  render(<MinisterConversation card={card} chat={chat} presence />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send to Minister' }));
  expect(screen.getByRole('status').textContent).toBe('Sending...');
  expect((screen.getByRole('button', { name: 'Send to Minister' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(new Error('Send failed')));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Send failed');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Hello');
});

it('uses start and terminal events while history is stalled, scoped to this session', async () => {
  render(<MinisterConversation card={card} chat={chat} presence />);
  await waitFor(() => expect(worldApi.getConversationTimeline).toHaveBeenCalledOnce());
  await act(async () => {});
  vi.mocked(worldApi.getConversationTimeline).mockReturnValue(new Promise(() => {}));
  const start = { ...chat, id: 'start', type: 'agent_started', agent_id: card.id, timestamp: new Date().toISOString(), payload: {} };
  act(() => useWorldStore.setState({ events: [{ ...start, session_id: 'other' }] }));
  expect(screen.queryByRole('status')).toBeNull();
  act(() => useWorldStore.setState({ events: [start] }));
  expect(screen.getByRole('status').textContent).toBe('Minister is working…');
  expect(screen.getByRole('button', { name: 'Stop Minister' })).toBeTruthy();
  act(() => useWorldStore.setState({ events: [{ ...start, id: 'stop', type: 'run_succeeded' }, start] }));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: 'Send to Minister' })).toBeTruthy();
});
