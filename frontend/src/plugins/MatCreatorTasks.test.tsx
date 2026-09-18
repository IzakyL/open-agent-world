// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PluginViewProps } from './sdk';
import { TaskBoard } from '../../../plugins/matcreator/frontend/TaskBoard';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const task = { id: 'build', title: 'Build copper', description: '', status: 'pending', depends_on: [], result: '', outputs: [] };
const board = (revision: number, title = task.title) => ({ revision, value: { plans: [
  { id: 'research', title: 'Copper study', goal: 'Verify a structure', session_id: '', tasks: [{ ...task, title }] },
] } });

it('retains an editor draft when the agent updates the board and reloads explicitly', async () => {
  const read = vi.fn().mockResolvedValue(board(1));
  const action = vi.fn();
  render(<TaskBoard {...{ host: { readDocument: read, documentAction: action } } as unknown as PluginViewProps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Build copper' }));
  fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'My unsaved edit' } });
  read.mockResolvedValue(board(2, 'Agent changed title'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('The board changed while you were editing. Your draft is retained.');
  expect((screen.getByLabelText('Task title') as HTMLInputElement).value).toBe('My unsaved edit');
  expect((screen.getByRole('button', { name: 'Save task' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest task' }));
  expect((screen.getByLabelText('Task title') as HTMLInputElement).value).toBe('Agent changed title');
  action.mockResolvedValue(board(3, 'Final title'));
  fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Final title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
  await screen.findByRole('button', { name: 'Final title' });
  expect(action).toHaveBeenCalledWith('update_task', expect.objectContaining({ plan_id: 'research', task_id: 'build', title: 'Final title' }), 2);
});

it('keeps the draft after a rejected dependency transition', async () => {
  const action = vi.fn().mockRejectedValue(new Error('Complete prerequisite tasks first'));
  render(<TaskBoard {...{ host: { readDocument: vi.fn().mockResolvedValue(board(1)), documentAction: action } } as unknown as PluginViewProps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Build copper' }));
  fireEvent.change(screen.getByLabelText('Task status'), { target: { value: 'running' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Complete prerequisite'));
  expect((screen.getByLabelText('Task status') as HTMLSelectElement).value).toBe('running');
});
