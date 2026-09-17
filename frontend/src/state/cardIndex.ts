import type { WorldCard } from '../types/world';

const indexes = new WeakMap<readonly WorldCard[], Map<string, WorldCard>>();

/** World card arrays are immutable snapshots. Share their ID lookup across consumers. */
export function cardIndex(cards: readonly WorldCard[]): ReadonlyMap<string, WorldCard> {
  let index = indexes.get(cards);
  if (!index) {
    index = new Map(cards.map(card => [card.id, card]));
    indexes.set(cards, index);
  }
  return index;
}
