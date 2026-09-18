import { useCallback, useEffect, useRef, useState } from 'react';
import { t, useLocale, type PluginViewProps } from '@oaw/plugin-api';
import './tasks.css';

type Status = 'pending' | 'running' | 'blocked' | 'done';
type Task = { id: string; title: string; description: string; depends_on: string[]; status: Status; result: string; outputs: string[] };
type Plan = { id: string; title: string; goal: string; session_id: string; tasks: Task[] };
type Snapshot = { value: { plans: Plan[] }; revision: number };
const columns: { id: Status; label: string }[] = [
  { id: 'pending', label: 'To do' }, { id: 'running', label: 'In progress' },
  { id: 'blocked', label: 'Blocked' }, { id: 'done', label: 'Done' },
];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function useBoard(host: PluginViewProps['host']) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  const alive = useRef(false);
  const accept = useCallback((next: Snapshot) => {
    if (alive.current) setSnapshot(previous => !previous || next.revision >= previous.revision ? next : previous);
  }, []);
  const refresh = useCallback(async () => {
    const next = await host.readDocument() as Snapshot;
    accept(next);
    return next;
  }, [host, accept]);
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); if (!stopped) setError(''); }
      catch (reason) { if (!stopped) setError(message(reason)); }
      if (!stopped) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => { stopped = true; alive.current = false; clearTimeout(timer); };
  }, [refresh]);
  return { snapshot, error, refresh, accept };
}

export function TaskPreview({ host }: PluginViewProps) {
  useLocale();
  const { snapshot, error } = useBoard(host);
  const tasks = snapshot?.value.plans.flatMap(plan => plan.tasks) ?? [];
  return <div className="mc-task-preview"><small>{t('Research task board')}</small>
    <strong>{tasks.filter(task => task.status === 'done').length} / {tasks.length} {t('Done')}</strong>
    <p>{snapshot?.value.plans.at(-1)?.title ?? t('Plan, execute, verify and learn.')}</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function TaskBoard({ host }: PluginViewProps) {
  useLocale();
  const { snapshot, error: readError, refresh, accept } = useBoard(host);
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [session, setSession] = useState('');
  const [editor, setEditor] = useState<{ task: Task; planId: string; revision: number; fresh: boolean }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const plans = snapshot?.value.plans ?? [];
  const plan = plans.find(item => item.id === selected) ?? plans.at(-1);
  const done = plan?.tasks.filter(task => task.status === 'done').length ?? 0;

  async function mutate(action: string, arguments_: Record<string, unknown>, revision = snapshot?.revision) {
    if (running.current || revision === undefined) return false;
    running.current = true; setBusy(true); setError('');
    try {
      const next = await host.documentAction(action, arguments_, revision) as Snapshot;
      accept(next);
      if (action === 'create_plan') setSelected(next.value.plans.at(-1)!.id);
      return true;
    } catch (reason) { setError(message(reason)); return false; }
    finally { running.current = false; setBusy(false); }
  }

  function edit(task?: Task) {
    if (!plan || !snapshot) return;
    setError(''); setCreating(false);
    setEditor({ planId: plan.id, revision: snapshot.revision, fresh: !task, task: task ?? {
      id: crypto.randomUUID(), title: '', description: '', depends_on: [], status: 'pending', result: '', outputs: [],
    } });
  }
  const patch = (value: Partial<Task>) => setEditor(current => current && ({ ...current, task: { ...current.task, ...value } }));
  const stale = editor && snapshot && editor.revision !== snapshot.revision;
  return <section className="mc-task-board nodrag nowheel" aria-label={t('Research task board')}>
    <header className="mc-task-toolbar">
      <label><span>{t('Research plans')}</span><select aria-label={t('Research plans')} value={plan?.id ?? ''} disabled={busy || !!editor}
        onChange={event => { setSelected(event.target.value); setCreating(false); setError(''); }}>
        {!plans.length && <option value="">{t('No research plans yet')}</option>}
        {plans.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
      </select></label>
      <button disabled={!snapshot || busy || !!editor} onClick={() => { setCreating(true); setError(''); }}>{t('New plan')}</button>
      <button disabled={!snapshot || busy} onClick={() => void refresh().catch(reason => setError(message(reason)))}>{t('Refresh')}</button>
    </header>
    {(error || readError) && <p className="mc-task-error" role="alert">{error || readError}</p>}
    {!snapshot && !readError && <p role="status">{t('Loading research tasks…')}</p>}
    {creating && <form className="mc-task-editor" onSubmit={async event => {
      event.preventDefault();
      if (await mutate('create_plan', { title: title.trim(), goal, session_id: session, tasks: [] })) {
        setCreating(false); setTitle(''); setGoal(''); setSession('');
      }
    }}>
      <h3>{t('New research plan')}</h3>
      <label>{t('Plan title')}<input autoFocus aria-label={t('Plan title')} required maxLength={180} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>{t('Research goal')}<textarea aria-label={t('Research goal')} maxLength={8000} value={goal} onChange={event => setGoal(event.target.value)} /></label>
      <label>{t('Session reference (optional)')}<input maxLength={200} value={session} onChange={event => setSession(event.target.value)} /></label>
      <div className="mc-task-actions"><button disabled={busy || !title.trim()}>{t('Create plan')}</button><button type="button" disabled={busy} onClick={() => setCreating(false)}>{t('Cancel')}</button></div>
    </form>}
    {plan && !creating && <>
      <div className="mc-task-goal"><div><h3>{plan.title}</h3>{plan.goal && <p>{plan.goal}</p>}
        {plan.session_id && <small>{t('Session')}: {plan.session_id}</small>}</div>
        <span>{done}/{plan.tasks.length} {t('Done')}</span>
      </div>
      <progress aria-label={t('Research progress')} value={done} max={plan.tasks.length || 1} />
      {!editor && <button className="mc-task-add" disabled={busy} onClick={() => edit()}>{t('Add task')}</button>}
      {editor ? <form className="mc-task-editor" onSubmit={async event => {
        event.preventDefault();
        const { id, ...fields } = editor.task;
        const args = editor.fresh ? { plan_id: editor.planId, task: editor.task } : { plan_id: editor.planId, task_id: id, ...fields };
        if (await mutate(editor.fresh ? 'add_task' : 'update_task', args, editor.revision)) setEditor(undefined);
      }}>
        <h3>{t(editor.fresh ? 'Add task' : 'Edit task')}</h3>
        {stale && <div className="mc-task-conflict" role="status"><p>{t('The board changed while you were editing. Your draft is retained.')}</p>
          <button type="button" disabled={busy} onClick={() => {
            const current = plan.tasks.find(task => task.id === editor.task.id);
            if (current) setEditor({ ...editor, task: current, revision: snapshot!.revision });
            else if (editor.fresh) setEditor({ ...editor, revision: snapshot!.revision });
            else setError(t('This task was removed. Copy your draft before closing.'));
            if (current || editor.fresh) setError('');
          }}>{t(editor.fresh ? 'Use latest board revision' : 'Reload latest task')}</button></div>}
        <label>{t('Task title')}<input autoFocus aria-label={t('Task title')} required maxLength={180} value={editor.task.title} onChange={event => patch({ title: event.target.value })} /></label>
        <label>{t('Task details')}<textarea aria-label={t('Task details')} maxLength={8000} value={editor.task.description} onChange={event => patch({ description: event.target.value })} /></label>
        <label>{t('Task status')}<select aria-label={t('Task status')} value={editor.task.status} onChange={event => patch({ status: event.target.value as Status })}>
          {columns.map(column => <option key={column.id} value={column.id}>{t(column.label)}</option>)}
        </select></label>
        {plan.tasks.some(task => task.id !== editor.task.id) && <fieldset><legend>{t('Prerequisite tasks')}</legend>
          {plan.tasks.filter(task => task.id !== editor.task.id).map(task => <label className="mc-task-dependency" key={task.id}>
            <input type="checkbox" checked={editor.task.depends_on.includes(task.id)} onChange={event => patch({ depends_on: event.target.checked
              ? [...editor.task.depends_on, task.id] : editor.task.depends_on.filter(id => id !== task.id) })} />{task.title}</label>)}
        </fieldset>}
        <label>{t('Result or blocker')}<textarea aria-label={t('Result or blocker')} required={editor.task.status === 'done'} maxLength={12000} value={editor.task.result} onChange={event => patch({ result: event.target.value })} /></label>
        <label>{t('Output paths (one per line)')}<textarea aria-label={t('Output paths (one per line)')} value={editor.task.outputs.join('\n')} onChange={event => patch({ outputs: event.target.value.split('\n') })} onBlur={() => patch({ outputs: editor.task.outputs.map(path => path.trim()).filter(Boolean) })} /></label>
        <div className="mc-task-actions"><button disabled={busy || !!stale || !editor.task.title.trim()}>{t('Save task')}</button>
          <button type="button" disabled={busy} onClick={() => { setEditor(undefined); setError(''); }}>{t('Cancel')}</button>
          {!editor.fresh && <button type="button" disabled={busy || !!stale} onClick={async () => {
            if (await mutate('remove_task', { plan_id: editor.planId, task_id: editor.task.id }, editor.revision)) setEditor(undefined);
          }}>{t('Remove task')}</button>}
        </div>
      </form> : <div className="mc-task-columns">
        {columns.map(column => <section className={`mc-task-column is-${column.id}`} aria-label={t(column.label)} key={column.id}>
          <h4><span className="mc-task-dot" />{t(column.label)}<span>{plan.tasks.filter(task => task.status === column.id).length}</span></h4>
          {plan.tasks.filter(task => task.status === column.id).map(task => <button className="mc-task-item" key={task.id} onClick={() => edit(task)}>
            <strong>{task.title}</strong>{task.description && <p>{task.description}</p>}
            {!!task.depends_on.length && <small>{t('After')}: {task.depends_on.map(id => plan.tasks.find(item => item.id === id)?.title ?? id).join(', ')}</small>}
            {task.result && <p className="mc-task-result">{task.result}</p>}
            {!!task.outputs.length && <small>{task.outputs.join(' · ')}</small>}
          </button>)}
          {!plan.tasks.some(task => task.status === column.id) && <p className="mc-task-empty-column">{t('No tasks')}</p>}
        </section>)}
      </div>}
    </>}
    {snapshot && !plan && !creating && <div className="mc-task-empty"><span>01 → 02 → 03</span><h3>{t('Plan, execute, verify and learn.')}</h3>
      <p>{t('Describe a materials research goal in the conversation, or create a plan here. Tasks keep dependencies, progress and results together.')}</p>
      <button onClick={() => setCreating(true)}>{t('New plan')}</button></div>}
    <footer>{t('Task status records progress. Use the conversation or Sandbox controls to stop execution.')}</footer>
  </section>;
}
