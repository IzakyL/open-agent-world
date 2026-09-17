import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, GripVertical, LayoutTemplate, Pencil, Plus, Save, X } from 'lucide-react';
import { apiErrorMessage } from '../api/client';
import { CardContent } from '../cards/CardFrame';
import { WorkspaceContent } from '../cards/NodeWorkspace';
import { CatalogIcon } from '../components/CatalogIcon';
import { t, useLocale } from '../i18n';
import { nodeSurfaceSupport } from '../state/nodeSurfaces';
import { useLegionWorkspace } from '../state/legionWorkspace';
import { useWorldStore } from '../state/worldStore';
import type { WorldCard } from '../types/world';
import { activateTab, activePaneId, dockPane, dropSide, layoutMinimum, paneIds, readWorkspaceLayout, removePane, resizeSplit, retainPanes, stackPane,
  type DockSide, type WorkspaceLayout, type WorkspaceLeaf, type WorkspaceNode } from './workspaceLayout';
import './legionWorkspace.css';

const CARD_MIME = 'application/x-oaw-workspace-card';
const sides: DockSide[] = ['left', 'right', 'top', 'bottom'];
const sideLabels: Record<DockSide, string> = { left: 'Dock left', right: 'Dock right', top: 'Dock above', bottom: 'Dock below' };

export function LegionWorkspace() {
  const activeId = useLegionWorkspace(s => s.activeId);
  const card = useWorldStore(s => s.cards.find(item => item.id === activeId && item.type === 'legion'));
  return card ? <WorkspaceWindow key={card.id} card={card} /> : null;
}

function WorkspaceWindow({ card }: { card: WorldCard }) {
  useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const cards = useWorldStore(s => s.cards);
  const catalog = useWorldStore(s => s.catalog);
  const updateCard = useWorldStore(s => s.updateCard);
  const close = useLegionWorkspace(s => s.close);
  const members = useMemo(() => cards.filter(item => item.parent_id === card.id
    && !catalog.node_types.find(type => type.id === item.type)?.container), [cards, card.id, catalog]);
  const memberIds = useMemo(() => new Set(members.map(item => item.id)), [members]);
  const sourceKey = JSON.stringify(card.config.workspace_layout ?? null);
  const [baseKey, setBaseKey] = useState(sourceKey);
  const [baseline, setBaseline] = useState(() => readWorkspaceLayout(card.config.workspace_layout));
  const [draft, setDraft] = useState(baseline);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savingRef = useRef(false);
  const [editing, setEditing] = useState(!baseline.root);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const mountedIds = useRef(new Set<string>());
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const root = useMemo(() => retainPanes(draft.root, memberIds), [draft, memberIds]);
  const assigned = new Set(paneIds(root));
  const unplaced = members.filter(member => !assigned.has(member.id));
  const drawerCard = unplaced.find(member => member.id === drawerId);
  assigned.forEach(id => mountedIds.current.add(id));
  if (drawerCard) mountedIds.current.add(drawerCard.id);
  // Stable hosts keep text drafts, terminals and plugin state mounted while a
  // card moves between branches or the user switches between edit and preview.
  const surfaceHosts = useRef(new Map<string, HTMLDivElement>());
  for (const member of members) {
    if (!surfaceHosts.current.has(member.id)) {
      const host = document.createElement('div');
      host.className = `legion-pane-content ${nodeSurfaceSupport(member.type, catalog).workspace ? 'has-workspace' : 'has-inspector'}`;
      surfaceHosts.current.set(member.id, host);
    }
  }
  const minimum = layoutMinimum(root);
  const conflict = sourceKey !== baseKey && dirty && !busy;

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    if (drawerId && !unplaced.some(member => member.id === drawerId)) setDrawerId(null);
    for (const id of surfaceHosts.current.keys()) {
      if (!memberIds.has(id)) { surfaceHosts.current.delete(id); mountedIds.current.delete(id); }
    }
  }, [drawerId, root, memberIds]);
  useEffect(() => {
    if (busy || dirty || sourceKey === baseKey) return;
    const layout = readWorkspaceLayout(card.config.workspace_layout);
    setBaseline(layout); setDraft(layout); setBaseKey(sourceKey);
  }, [sourceKey, baseKey, busy, dirty, card.config.workspace_layout]);

  const reset = () => {
    const layout = readWorkspaceLayout(card.config.workspace_layout);
    setBaseline(layout); setDraft(layout); setBaseKey(sourceKey);
    setError(''); setSelected(null); setClosing(false); setSaved(false);
  };
  const changeRoot = (next: WorkspaceNode | null) => {
    draftRef.current = { version: 1, root: next };
    setDraft(draftRef.current); setSaved(false); setError('');
  };
  const requestClose = () => { if (busy) return; if (dirty) setClosing(true); else close(); };
  const save = async () => {
    if (conflict || savingRef.current) return;
    savingRef.current = true;
    setBusy(true); setError('');
    try {
      const layout: WorkspaceLayout = { version: 1, root: retainPanes(draftRef.current.root, memberIds) };
      await updateCard(card.id, { config: { workspace_layout: layout } }, card.revision === undefined ? undefined : { expectedRevision: card.revision });
      const current = useWorldStore.getState().cards.find(item => item.id === card.id);
      if (!current || JSON.stringify(readWorkspaceLayout(current.config.workspace_layout)) !== JSON.stringify(layout)) {
        throw new Error(t('Layout could not be saved. Your draft is still here.'));
      }
      setBaseline(layout); setDraft(layout); setBaseKey(JSON.stringify(current.config.workspace_layout));
      setEditing(false); setSelected(null); setSaved(true); setClosing(false);
    } catch (reason) { setError(apiErrorMessage(reason)); }
    finally { savingRef.current = false; setBusy(false); }
  };
  const finishEditing = () => {
    if (dirty) void save();
    else { setEditing(false); setSelected(null); }
  };
  const finishResize = () => {
    if (!editing && JSON.stringify(draftRef.current) !== JSON.stringify(baseline)) void save();
  };
  const place = (id: string, target: string | null, side: DockSide) => {
    if (!memberIds.has(id) || busy) return;
    const next = dockPane(root, id, target, side);
    if (next === root && id !== target) { setError(t('This split is too deep. Choose another region.')); return; }
    changeRoot(next); setSelected(null); setDragging(false);
  };
  const stack = (id: string, target: string, before?: string) => {
    if (!editing || busy || !memberIds.has(id)) return;
    changeRoot(stackPane(root, id, target, before)); setSelected(null); setDragging(false);
  };
  const activate = (id: string) => {
    if (!root || busy || savingRef.current || conflict) return;
    const next = activateTab(root, id);
    if (JSON.stringify(next) === JSON.stringify(root)) return;
    changeRoot(next);
    if (!editing) void save();
  };
  const startDrag = (event: DragEvent, id: string) => {
    event.dataTransfer.setData(CARD_MIME, id); event.dataTransfer.effectAllowed = 'move';
    setSelected(id); setDragging(true);
  };

  return <dialog ref={dialog} className="legion-workspace" aria-label={t('{v0} workspace mode', { v0: card.name })}
    onCancel={event => { event.preventDefault(); if (drawerCard) setDrawerId(null); else requestClose(); }} onKeyDown={event => event.stopPropagation()}
    onDragEnd={() => setDragging(false)}>
    <header className="legion-window-titlebar">
      <span className="legion-window-mark"><LayoutTemplate size={16} /></span>
      <div className="legion-window-title"><strong>{card.name}</strong></div>
      <span className="legion-window-status" role="status">{busy ? t('Saving...') : dirty ? t('Unsaved layout') : saved ? t('Layout saved') : ''}</span>
      <button className="secondary-button" disabled={busy || (editing && conflict)} onClick={() => { if (editing) finishEditing(); else { setEditing(true); setSelected(null); } }}>
        {editing ? <Check size={13} /> : <Pencil size={13} />}{editing ? t('Done editing') : t('Edit layout')}
      </button>
      {editing && dirty && <button className="secondary-button" disabled={busy} onClick={reset}>{t('Cancel layout changes')}</button>}
      {editing && <button className="primary-button" disabled={busy || !dirty || conflict} onClick={() => void save()}><Save size={13} />{busy ? t('Saving...') : t('Save layout')}</button>}
      <button className="secondary-button" disabled={busy} onClick={requestClose}><ArrowLeft size={14} />{t('Back to canvas')}</button>
    </header>
    {(error || conflict) && <div className="legion-window-error" role="alert">{error || t('This layout changed elsewhere. Reload it before saving.')}
      {conflict ? <button onClick={reset}>{t('Reload layout')}</button> : !editing && <>
        <button disabled={busy} onClick={() => void save()}>{t('Retry')}</button>
        <button disabled={busy} onClick={reset}>{t('Cancel layout changes')}</button>
      </>}
    </div>}
    {closing && <div className="legion-window-close-prompt" role="alert">
      <span>{t('Save your layout or discard the changes before returning to the canvas.')}</span>
      <button className="secondary-button" onClick={() => setClosing(false)}>{t('Keep editing')}</button>
      <button className="secondary-button" onClick={close}>{t('Discard layout and close')}</button>
    </div>}
    <div className={`legion-window-main ${editing ? 'is-editing' : ''}`}>
      {editing && <aside className="legion-layout-palette" aria-label={t('Workspace cards')}>
        <header><strong>{t('Workspace cards')}</strong><span>{assigned.size} / {members.length}</span></header>
        <p>{t('Drop on a title bar to add a tab, or on a region edge to split. You can also select a card and use the docking buttons.')}</p>
        <div className="legion-layout-card-list">
          {members.map(member => {
            const definition = catalog.node_types.find(item => item.id === member.type);
            return <button key={member.id} className="legion-layout-card" data-workspace-source={member.id}
              draggable={!busy} disabled={busy} aria-pressed={selected === member.id} onClick={() => setSelected(selected === member.id ? null : member.id)}
              onDragStart={event => startDrag(event, member.id)}>
              <CatalogIcon definition={definition} size={18} />
              <span><strong>{member.name}</strong><small>{definition?.label ?? member.type}</small></span>
              {assigned.has(member.id) ? <Check size={14} aria-label={t('Placed in workspace')} /> : <GripVertical size={14} />}
            </button>;
          })}
          {!members.length && <p>{t('Add cards to this Legion on the canvas first.')}</p>}
        </div>
        <footer>{t('Unplaced cards are available in the bottom bar. All members keep their connections and continue working.')}</footer>
      </aside>}
      <main className="legion-layout-stage" aria-label={t('Workspace layout')}>
        <div className="legion-layout-root" style={{ minWidth: minimum.width, minHeight: minimum.height }}>
          {root ? <LayoutRegion node={root} path="" members={members} hosts={surfaceHosts.current} editing={editing && !busy} resizable={!busy && !conflict} finishResize={finishResize} selected={selected} dragging={dragging}
            stack={stack} activate={activate} selectable={!busy && !conflict}
            place={place} startDrag={startDrag} remove={id => changeRoot(removePane(root, id))}
            resize={(path, ratio) => changeRoot(resizeSplit(root, path, ratio))} />
            : <div className="legion-layout-empty" onDragOver={event => { if (editing && dragging) event.preventDefault(); }}
              onDrop={event => { event.preventDefault(); if (editing) place(event.dataTransfer.getData(CARD_MIME), null, 'right'); }}>
              <LayoutTemplate size={44} /><h2>{t('Build your workspace')}</h2>
              <p>{editing ? t('Drop the first card here, then split regions to arrange the rest.') : t('Choose Edit layout to add cards to this window.')}</p>
              {editing && selected && <button className="primary-button" onClick={() => place(selected, null, 'right')}><Plus size={14} />{t('Place selected card')}</button>}
              {!editing && <button className="primary-button" onClick={() => setEditing(true)}><Pencil size={14} />{t('Edit layout')}</button>}
            </div>}
        </div>
      </main>
      <section id="legion-card-drawer" className="legion-card-drawer" hidden={!drawerCard} aria-label={t('Unplaced card details')}>
        <header className="legion-drawer-titlebar">
          {drawerCard && <><CatalogIcon definition={catalog.node_types.find(item => item.id === drawerCard.type)} size={14} /><strong>{drawerCard.name}</strong></>}
          <button className="legion-tab-close" aria-label={t('Collapse card details')} onClick={() => {
            const id = drawerId; setDrawerId(null);
            if (id) document.getElementById(`legion-tray-${id}`)?.focus();
          }}><X size={14} /></button>
        </header>
        {unplaced.filter(member => mountedIds.current.has(member.id)).map(member =>
          <PaneMount key={member.id} id={member.id} host={surfaceHosts.current.get(member.id)!} hidden={member.id !== drawerCard?.id} label={member.name} />)}
      </section>
    </div>
    <footer className="legion-window-footer"><span><i />{editing ? t('Layout editor') : t('Live workspace')}</span>
    {!!unplaced.length && <nav className="legion-unplaced-bar" aria-label={t('Unplaced workspace cards')}>
      {unplaced.map(member => <button key={member.id} id={`legion-tray-${member.id}`} className="legion-unplaced-card"
        aria-label={member.name} title={`${member.name} · ${catalog.node_types.find(item => item.id === member.type)?.label ?? member.type}`}
        aria-expanded={drawerCard?.id === member.id} aria-controls="legion-card-drawer"
        draggable={editing && !busy} onDragStart={event => startDrag(event, member.id)}
        onClick={() => setDrawerId(drawerCard?.id === member.id ? null : member.id)}>
        <CatalogIcon definition={catalog.node_types.find(item => item.id === member.type)} size={17} />
      </button>)}
    </nav>}
      <span className="legion-footer-hint">{editing ? t('Drag dividers to resize. Removing a pane keeps its card in the Legion.') : t('Drag dividers to resize; sizes save automatically. Use Edit layout to move cards.')}</span>
    </footer>
    {members.filter(member => mountedIds.current.has(member.id)).map(member => createPortal(
      nodeSurfaceSupport(member.type, catalog).workspace ? <WorkspaceContent card={member} /> : <CardContent card={member} level="inspector" />,
      surfaceHosts.current.get(member.id)!, member.id,
    ))}
  </dialog>;
}

interface RegionProps {
  stack: (id: string, target: string, before?: string) => void;
  activate: (id: string) => void; selectable: boolean;
  resizable: boolean; finishResize: () => void;
  hosts: Map<string, HTMLDivElement>;
  node: WorkspaceNode; path: string; members: WorldCard[]; editing: boolean; selected: string | null; dragging: boolean;
  place: (id: string, target: string, side: DockSide) => void;
  startDrag: (event: DragEvent, id: string) => void;
  remove: (id: string) => void; resize: (path: string, ratio: number) => void;
}

function LayoutRegion(props: RegionProps) {
  const { node, path, resizable, resize, finishResize } = props;
  const splitRef = useRef<HTMLDivElement>(null);
  const resizeStart = useRef<{ bounds: DOMRect; ratio: number }>();
  if (node.kind !== 'split') return <WorkspacePane {...props} leaf={node} />;
  const horizontal = node.axis === 'horizontal';
  const template = `${node.ratio}fr 5px ${1 - node.ratio}fr`;
  return <div ref={splitRef} className="legion-layout-split" data-split-axis={node.axis}
    style={horizontal ? { gridTemplateColumns: template } : { gridTemplateRows: template }}>
    <LayoutRegion {...props} node={node.first} path={`${path}0`} />
    <div className={`legion-layout-divider ${resizable ? 'is-editable' : ''}`} role="separator"
      tabIndex={resizable ? 0 : -1} aria-disabled={!resizable} aria-label={t('Resize workspace regions')} aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(node.ratio * 100)}
      onPointerDown={event => {
        if (!resizable || event.button !== 0) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        resizeStart.current = { bounds: splitRef.current!.getBoundingClientRect(), ratio: node.ratio };
      }} onPointerMove={event => {
        const start = resizeStart.current;
        if (!start) return;
        const ratio = horizontal ? (event.clientX - start.bounds.left - 2.5) / (start.bounds.width - 5)
          : (event.clientY - start.bounds.top - 2.5) / (start.bounds.height - 5);
        resize(path, ratio);
      }} onPointerUp={event => {
        const started = resizeStart.current;
        resizeStart.current = undefined;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (started) finishResize();
      }}
      onPointerCancel={() => { if (resizeStart.current) resize(path, resizeStart.current.ratio); resizeStart.current = undefined; }}
      onLostPointerCapture={() => { const started = resizeStart.current; resizeStart.current = undefined; if (started) finishResize(); }}
      onKeyDown={event => {
        if (!resizable) return;
        const delta = (horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']).indexOf(event.key);
        if (delta >= 0) { event.preventDefault(); resize(path, node.ratio + (delta === 0 ? -.025 : .025)); }
        if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); resize(path, event.key === 'Home' ? .15 : .85); }
      }} onKeyUp={event => { if (resizable && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) finishResize(); }} />
    <LayoutRegion {...props} node={node.second} path={`${path}1`} />
  </div>;
}

function WorkspacePane({ leaf, members, hosts, editing, selected, dragging, place, stack, activate, selectable, startDrag, remove }: RegionProps & { leaf: WorkspaceLeaf }) {
  const id = activePaneId(leaf);
  const ids = paneIds(leaf);
  const card = members.find(member => member.id === id)!;
  const catalog = useWorldStore(s => s.catalog);
  const definition = catalog.node_types.find(item => item.id === card.type);
  const [hover, setHover] = useState<DockSide | null>(null);
  const [tabHover, setTabHover] = useState<string | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const canPlace = editing && selected && (selected !== id || ids.length > 1);
  const canStack = editing && selected && (selected !== id || ids.length > 1);
  useEffect(() => {
    tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [id]);
  return <section className="legion-workspace-pane" data-workspace-pane={id} aria-label={card.name}
    onDragOver={event => {
      if (!canPlace || !dragging) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move';
      const bounds = event.currentTarget.getBoundingClientRect();
      setHover(dropSide(event.clientX - bounds.left, event.clientY - bounds.top, bounds.width, bounds.height));
    }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHover(null); }}
    onDrop={event => {
      event.preventDefault();
      if (canPlace && hover) place(event.dataTransfer.getData(CARD_MIME), id, hover);
      setHover(null);
    }}>
    <header className={`legion-pane-titlebar ${dragging && tabHover !== null ? 'is-tab-drop' : ''}`}
      onDragOver={event => {
        event.stopPropagation();
        if (!canStack || !dragging) return;
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setHover(null);
        setTabHover((event.target as HTMLElement).closest<HTMLElement>('[data-workspace-tab]')?.dataset.workspaceTab ?? '');
      }} onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTabHover(null);
      }} onDrop={event => {
        event.preventDefault(); event.stopPropagation();
        if (canStack) stack(event.dataTransfer.getData(CARD_MIME), id,
          (event.target as HTMLElement).closest<HTMLElement>('[data-workspace-tab]')?.dataset.workspaceTab);
        setTabHover(null);
      }}>
      <div ref={tabs} className="legion-pane-tabs" role="tablist" aria-label={t('Region tabs')}>
        {ids.map(tabId => {
          const member = members.find(item => item.id === tabId)!;
          const tabDefinition = catalog.node_types.find(item => item.id === member.type);
          return <span key={tabId} className={`legion-tab-item ${tabId === id ? 'is-active' : ''} ${dragging && tabHover === tabId ? 'is-drop-before' : ''}`} role="presentation" data-workspace-tab={tabId}>
            <button className="legion-workspace-tab" role="tab" id={`legion-tab-${tabId}`} aria-controls={`legion-panel-${tabId}`}
              aria-selected={tabId === id} aria-disabled={!selectable} tabIndex={tabId === id ? 0 : -1}
              title={`${member.name} · ${tabDefinition?.label ?? member.type}`} draggable={editing}
              onDragStart={event => startDrag(event, tabId)} onClick={() => activate(tabId)}
              onKeyDown={event => {
                if (!selectable || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const index = ids.indexOf(tabId);
                const nextId = ids[event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + ids.length) % ids.length];
                const buttons = tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                buttons?.[ids.indexOf(nextId)]?.focus(); activate(nextId);
              }}>
              <CatalogIcon definition={tabDefinition} size={13} /><span>{member.name}</span>
            </button>
            {editing && <button className="legion-tab-close" aria-label={t('Remove {v0} from layout', { v0: member.name })} onClick={() => remove(tabId)}><X size={12} /></button>}
          </span>;
        })}
      </div>
      {canStack && <button className="legion-add-tab" onClick={() => stack(selected, id)} title={t('Add selected card as tab')} aria-label={t('Add selected card as tab')}><Plus size={12} />{t('Add tab')}</button>}
    </header>
    {editing && <div className="legion-pane-placeholder"><CatalogIcon definition={definition} size={32} /><strong>{card.name}</strong><span>{t('Finish editing to use this card')}</span></div>}
    {ids.map(tabId => <PaneMount key={tabId} id={tabId} host={hosts.get(tabId)!} hidden={editing || tabId !== id} />)}
    {canPlace && <div className="legion-dock-targets">{sides.map(side => <button key={side} data-dock-side={side}
      onClick={() => place(selected, id, side)} onMouseEnter={() => { if (!dragging) setHover(side); }} onMouseLeave={() => { if (!dragging) setHover(null); }}
      aria-label={t('{v0}: {v1}', { v0: t(sideLabels[side]), v1: card.name })}>{t(sideLabels[side])}</button>)}</div>}
    {canPlace && hover && <div className="legion-dock-preview" data-dock-preview={hover}><Plus size={20} /><strong>{members.find(item => item.id === selected)?.name}</strong><span>{t(sideLabels[hover])}</span></div>}
  </section>;
}

/** Each tab keeps its existing portal host and component state while hidden. */
function PaneMount({ id, host, hidden, label }: { id: string; host: HTMLDivElement; hidden: boolean; label?: string }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = mount.current!;
    target.appendChild(host);
    return () => { if (host.parentNode === target) target.removeChild(host); };
  }, [host]);
  return <div ref={mount} className="legion-pane-mount" role={label ? 'region' : 'tabpanel'} id={`legion-panel-${id}`} aria-label={label} aria-labelledby={label ? undefined : `legion-tab-${id}`} hidden={hidden} />;
}
