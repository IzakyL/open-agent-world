import { create } from 'zustand';
import { t } from '../i18n';
import type { PluginCatalog, WorldCard } from '../types/world';
import { profileStorage } from './profileStorage';
import { reportInteraction } from './interactions';
import { useWorldStore } from './worldStore';
import { apiErrorMessage, worldApi } from '../api/client';
import { useNodeSurfaceStore } from './nodeSurfaces';

export const MINISTER_ROLE_CARD = 'core.minister-role';
export const PROMOTION_DURATION = 1400;
export const canAppointMinister = (card: WorldCard, catalog: PluginCatalog) => !card.ephemeral && !card.minister
  && catalog.node_types.some(type => type.id === card.type && type.traits.includes('core.agent'));

// Only interaction state lives here. Saved role authority belongs to WorldCard.
export const useMinisterRole = create<{
  pending: Record<string, boolean>;
  promotions: Record<string, number>; settingsCardId?: string;
}>(() => ({ pending: {}, promotions: {} }));

export function openMinisterSettings(cardId: string) {
  useMinisterRole.setState({ settingsCardId: cardId });
  if (useNodeSurfaceStore.getState().surfaceLevels[cardId] !== 'workspace') useNodeSurfaceStore.getState().openInspector(cardId);
  reportInteraction({ type: 'minister-settings-opened', cardId });
}

export async function appointMinister(cardId: string, source?: WorldCard) {
  const world = useWorldStore.getState(), card = world.cards.find(item => item.id === cardId);
  if (!card || !canAppointMinister(card, world.catalog) || useMinisterRole.getState().pending[cardId]) return;
  useMinisterRole.setState(s => ({ pending: { ...s.pending, [cardId]: true } }));
  try {
    const updated = await worldApi.appointMinister(cardId, card.revision ?? 0, source);
    world.acceptImportedCard(updated);
    // This is the successful promotion gesture, not a rule applied on reload.
    // The drag is finishing, so commit the requested base surface directly.
    useNodeSurfaceStore.setState(s => ({ surfaceLevels: { ...s.surfaceLevels, [cardId]: 'node' },
      baseLevels: { ...s.baseLevels, [cardId]: 'node' } }));
    const started = Date.now();
    useMinisterRole.setState(s => ({ promotions: { ...s.promotions, [cardId]: started } }));
    window.setTimeout(() => useMinisterRole.setState(s => {
      const promotions = { ...s.promotions };
      if (promotions[cardId] === started) delete promotions[cardId];
      return { promotions };
    }), PROMOTION_DURATION);
    reportInteraction({ type: 'minister-appointed', cardId });
    // Also reconcile a consumed role card when the socket is reconnecting.
    void world.refreshWorld();
    if (!profileStorage.getItem('oaw-minister-role-learned')) {
      profileStorage.setItem('oaw-minister-role-learned', 'true');
      world.pushToast({ tone: 'success', title: t('Minister role appointed'),
        detail: t('Use the crown to chat. Open the Agent’s Minister tab for permissions and confirmations; its workspace keeps the history.') });
    }
  } catch (error) {
    world.pushToast({ tone: 'error', title: t('The role card was not applied'), detail: apiErrorMessage(error) });
    await world.refreshWorld();
  } finally {
    useMinisterRole.setState(s => ({ pending: { ...s.pending, [cardId]: false } }));
  }
}
