import type { WorldCard } from '../types/world';
import { useWorldStore } from '../state/worldStore';
import { t, useLocale } from '../i18n';
import { useMinisterRole } from '../state/ministerRole';
import { useNodeSurfaceStore } from '../state/nodeSurfaces';
import { Crown, ShieldOff, History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MinisterReviews, MinisterNearby } from './MinisterPermissions';
import './minister.css';

/** The normal catalog card supplies its crown, title, frame and drag behavior. */
export function MinisterRoleCardPreview() {
  useLocale();
  return <div className="minister-role-card-copy">
    <span>{t('Role card')}</span>
    <strong>{t('Drag onto an Agent')}</strong>
    <p>{t('The card is absorbed. Your Agent becomes a Minister and keeps its own model and tools.')}</p>
  </div>;
}

export function MinisterRoleSettings({ card, onOpenHistory }: { card: WorldCard; onOpenHistory?: () => void }) {
  useLocale();
  const updateCard = useWorldStore(s => s.updateCard);
  const [radius, setRadius] = useState(card.minister?.control_radius ?? 1200);
  const [removing, setRemoving] = useState(false);
  useEffect(() => setRadius(card.minister?.control_radius ?? 1200), [card.minister?.control_radius]);
  if (card.ephemeral || !card.minister) return null;
  const saveRadius = () => {
    const next = Number.isFinite(radius) ? Math.max(200, Math.min(3000, Math.round(radius / 50) * 50)) : card.minister!.control_radius;
    setRadius(next);
    if (next !== card.minister!.control_radius) void updateCard(card.id, { minister: { ...card.minister!, control_radius: next } });
  };
  return <section className="agent-minister-role" aria-label={t('Minister permissions')}>
    <div className="minister-role-heading"><Crown size={20} /><div><strong>{t('Minister permissions')}</strong>
      <p>{t('Manage nearby cards with this Agent’s existing model and tools.')}</p></div></div>
    <label className="field-label"><span>{t('Control radius')}</span><input type="number" aria-label={t('Control radius')} min={200} max={3000} step={50} value={radius}
      onChange={event => setRadius(Number(event.target.value))} onBlur={saveRadius} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
    <label className="minister-permission-switch"><input type="checkbox" checked={card.minister.allow_canvas_edits}
      onChange={event => void updateCard(card.id, { minister: { ...card.minister!, allow_canvas_edits: event.target.checked } })} />
      <span><strong>{t('Allow canvas edits')}</strong><small>{t('When off, this Agent can only inspect nearby cards.')}</small></span></label>
    <p>{t('Sensitive or destructive changes still need your confirmation.')}</p>
    <MinisterReviews card={card} />
    <details className="minister-nearby-details"><summary>{t('Nearby cards')}</summary><MinisterNearby card={card} /></details>
    <button type="button" className="secondary-button" onClick={() => {
      useMinisterRole.setState({ settingsCardId: undefined }); useNodeSurfaceStore.getState().openWorkspace(card.id);
      onOpenHistory?.();
    }}><History size={16} />{t('Open Agent history')}</button>
    <div className="minister-remove-section">
      <p>{t('Keep this Agent, its model, tools and history. Only Minister permissions are removed.')}</p>
      <button type="button" className="minister-remove-button" disabled={removing} onClick={async () => {
        setRemoving(true);
        try {
          await updateCard(card.id, { minister: null });
          if (!useWorldStore.getState().cards.find(item => item.id === card.id)?.minister) useMinisterRole.setState({ settingsCardId: undefined });
        } finally { setRemoving(false); }
      }}><ShieldOff size={18} />{t('Remove Minister role')}</button>
    </div>
  </section>;
}
