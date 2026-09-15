import { t, useLocale } from '../i18n';
import { useReactFlow } from '@xyflow/react';
import { Crown } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ViewportPortal } from '../canvas/FlowPortal';
import { useWorldStore } from '../state/worldStore';
import { useMinisterRole } from '../state/ministerRole';
import { useNodeSurfaceStore } from '../state/nodeSurfaces';
import { reportInteraction } from '../state/interactions';
import type { WorldCard } from '../types/world';
import { MinisterPresence } from './MinisterPresence';
export { MinisterReviews, MinisterNearby } from './MinisterPermissions';
export { ministerToolSummary } from './ministerActivity';
import './minister.css';

const clampRadius = (value: number) => Math.max(200, Math.min(3000, Math.round(value / 50) * 50));

/** Additive canvas controls: the Agent keeps its normal card, ports and surfaces. */
export function MinisterAgent({ card, nodeHovered = false }: { card: WorldCard; nodeHovered?: boolean }) {
  useLocale();
  const level = useNodeSurfaceStore(s => s.surfaceLevels[card.id] ?? 'preview');
  const open = useMinisterRole(s => s.settingsCardId === card.id) && (level === 'inspector' || level === 'workspace');
  const update = useWorldStore(s => s.updateCard);
  const savedRadius = card.minister!.control_radius;
  const [radius, setRadius] = useState(savedRadius);
  const [attention, setAttention] = useState(false);
  const [hovered, setHovered] = useState(false);
  const resizing = useRef(false);
  const { screenToFlowPosition } = useReactFlow();
  const showConversation = () => {
    setAttention(true);
    // A fresh hover/click is meaningful even if the bubble is already visible.
    reportInteraction({ type: 'minister-opened', cardId: card.id });
  };
  useEffect(() => { if (open) setAttention(false); }, [open]);
  useEffect(() => { if (nodeHovered) showConversation(); }, [nodeHovered]);
  useEffect(() => { if (!resizing.current) setRadius(savedRadius); }, [savedRadius]);
  const save = (value: number) => {
    value = Number.isFinite(value) ? clampRadius(value) : savedRadius;
    setRadius(value);
    if (value !== savedRadius) void update(card.id, { minister: { ...card.minister!, control_radius: value } });
  };
  return <>
    <div className="minister-avatar-zone nodrag nopan" data-minister-for={card.id} data-compact={level === 'node' || undefined}
      onPointerEnter={() => { setHovered(true); showConversation(); }} onPointerLeave={() => setHovered(false)}>
      <button type="button" className="minister-badge" aria-label={t('Open Minister {v0}', { v0: card.name })}
        aria-expanded={attention} onClick={showConversation} onFocus={() => { setHovered(true); showConversation(); }} onBlur={() => setHovered(false)}>
        <Crown size={17} strokeWidth={1.6} />{level !== 'node' && <span>{t('Minister')}</span>}
      </button>
    </div>
    <MinisterPresence card={card} active={attention} setActive={setAttention} />
    <ViewportPortal>
      <div className={`minister-scope ${hovered || nodeHovered || open ? 'is-visible' : ''} ${card.minister!.allow_canvas_edits ? 'can-edit' : ''}`}
        data-minister-scope={card.id} style={{ left: card.position.x, top: card.position.y,
          '--minister-radius': `${radius}px`, '--minister-cx': `${card.size.width / 2}px`, '--minister-cy': `${card.size.height / 2}px`,
        } as CSSProperties}>
        <div className="minister-radius" aria-hidden="true" />
        {open && <button type="button" className="minister-radius-handle nodrag nopan" aria-label={t('Resize {v0} control radius', { v0: card.name })}
          title={t('Drag to change control radius')}
          onPointerDown={event => { event.stopPropagation(); resizing.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => {
            if (!resizing.current) return;
            const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
            setRadius(clampRadius(Math.hypot(point.x - card.position.x - card.size.width / 2, point.y - card.position.y - card.size.height / 2)));
          }} onPointerUp={event => { if (!resizing.current) return; resizing.current = false; event.currentTarget.releasePointerCapture(event.pointerId); save(radius); }}
          onPointerCancel={() => { resizing.current = false; setRadius(savedRadius); }} onKeyDown={event => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault(); save(radius + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -50 : 50));
            }
          }}><span>{radius}</span></button>}
      </div>
    </ViewportPortal>
  </>;
}
