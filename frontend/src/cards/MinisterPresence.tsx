import { t, useLocale } from "../i18n";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInternalNode, useReactFlow, useStore, useViewport } from '@xyflow/react';
import { ViewportPortal } from '../canvas/FlowPortal';
import { apiErrorMessage, worldApi } from '../api/client';
import { useNodeSurfaceStore } from '../state/nodeSurfaces';
import type { WorldCard } from '../types/world';
import type { MinisterChat } from '../types/minister';
import { MinisterConversation } from './MinisterConversation';
import { MinisterReviews } from './MinisterPermissions';
import { openMinisterSettings } from '../state/ministerRole';

// Presence is transient; the conversation API remains the history authority.
export function MinisterPresence({ card, active, setActive }: {
  card: WorldCard; active: boolean; setActive: (value: boolean) => void;
}) {
  useLocale();
  const node = useInternalNode(card.id);
  const origin = node?.internals.positionAbsolute ?? card.position;
  const flowRoot = useStore(state => state.domNode);
  const { screenToFlowPosition } = useReactFlow();
  const viewport = useViewport();
  const [left, setLeft] = useState<number>();
  const [reviewTop, setReviewTop] = useState<number>();
  const [chat, setChat] = useState<MinisterChat>();
  const [error, setError] = useState<string>();
  const [greeting, setGreeting] = useState(false);
  const greeted = useRef(false);
  const region = useRef<HTMLDivElement>(null);
  const draft = useNodeSurfaceStore(s => s.drafts[`minister:${card.id}`] ?? '');
  const [attempt, setAttempt] = useState(0);
  const [pendingReview, setPendingReview] = useState(false);
  const visible = active || pendingReview;
  useLayoutEffect(() => {
    if (!visible || !flowRoot || !region.current) return;
    const owner = Array.from(flowRoot.querySelectorAll<HTMLElement>(`.world-card[data-card-id="${CSS.escape(card.id)}"]`))
      .find(element => element.closest('.react-flow') === flowRoot);
    if (!owner) return;
    const controls = Array.from(owner.querySelectorAll<HTMLElement>('.equipment-toggle'));
    const place = () => {
      const bounds = owner.getBoundingClientRect();
      const visibleControls = controls.map(control => control.getBoundingClientRect()).filter(rect => rect.width && rect.height);
      const rightEdge = Math.max(bounds.right, ...visibleControls.map(rect => rect.right));
      const leftEdge = Math.min(bounds.left, ...visibleControls.map(rect => rect.left));
      const width = region.current!.getBoundingClientRect().width;
      const canvas = flowRoot.getBoundingClientRect();
      const gap = 16 * viewport.zoom;
      const right = rightEdge + gap, alternative = leftEdge - gap - width;
      const x = right + width > canvas.right - gap && alternative >= canvas.left + gap ? alternative : right;
      setLeft(screenToFlowPosition({ x, y: bounds.top }, { snapToGrid: false }).x);
      if (pendingReview) {
        const height = region.current!.getBoundingClientRect().height;
        const y = Math.max(canvas.top + gap, Math.min(bounds.top + 70 * viewport.zoom, canvas.bottom - gap - height));
        setReviewTop(screenToFlowPosition({ x, y }, { snapToGrid: false }).y);
      }
    };
    place();
    const observer = new ResizeObserver(place);
    [owner, ...controls, region.current, flowRoot].forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [visible, pendingReview, card.id, origin.x, origin.y, node?.measured.width, node?.measured.height,
    flowRoot, viewport.x, viewport.y, viewport.zoom, screenToFlowPosition]);
  useEffect(() => {
    if (!active || greeted.current) return;
    greeted.current = true;
    setGreeting(true);
    const timer = window.setTimeout(() => setGreeting(false), 9000);
    return () => window.clearTimeout(timer);
  }, [active]);
  useEffect(() => {
    if (!active || chat) return;
    let current = true;
    // Opening the durable session does not send a message or invoke a model.
    void worldApi.openMinisterChat(card.id).then(value => { if (current) { setChat(value); setError(undefined); } })
      .catch(reason => { if (current) setError(apiErrorMessage(reason)); });
    return () => { current = false; };
  }, [active, card.id, chat, attempt]);
  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    const move = (event: PointerEvent) => {
      const avatar = document.querySelector(`[data-minister-for="${CSS.escape(card.id)}"]`);
      const compactNode = document.querySelector(`.world-card.is-node[data-card-id="${CSS.escape(card.id)}"]`);
      const near = [avatar, compactNode, region.current].some(element => {
        const box = element?.getBoundingClientRect();
        return box && event.clientX >= box.left - 28 && event.clientX <= box.right + 28
          && event.clientY >= box.top - 28 && event.clientY <= box.bottom + 28;
      });
      window.clearTimeout(timer);
      if (!near) timer = window.setTimeout(() => {
        if (!draft && !region.current?.contains(document.activeElement) && card.status !== 'running' && card.status !== 'waiting') {
          setActive(false); setGreeting(false);
        }
      }, 1800);
    };
    window.addEventListener('pointermove', move);
    return () => { window.clearTimeout(timer); window.removeEventListener('pointermove', move); };
  }, [active, card.id, card.status, draft, setActive]);
  return <ViewportPortal><div ref={region} data-tutorial-card-id={card.id} className="minister-presence nodrag nopan nowheel"
    hidden={!visible} style={{ left: left ?? origin.x + (node?.measured.width ?? card.size.width) + 16, top: pendingReview ? reviewTop ?? origin.y + 70 : origin.y + 70 }}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { (document.activeElement as HTMLElement)?.blur(); setActive(false); setGreeting(false); } }}>
    <MinisterReviews card={card} presence onPendingChange={setPendingReview} />
    <div hidden={!active}>
    {greeting && <div className="minister-greeting">{t("Hi! Need a hand with this part of your canvas?")}</div>}
    {chat ? <MinisterConversation card={card} chat={chat} presence /> : <div className="minister-presence-loading" role="status">
      {error ?? t("Getting ready…")}{error && <button onClick={() => setAttempt(value => value + 1)}>{t("Retry")}</button>}
    </div>}
    <button className="minister-presence-history" onClick={() => { setActive(false); openMinisterSettings(card.id); }}>{t('Minister settings')}</button>
    </div>
  </div></ViewportPortal>;
}
