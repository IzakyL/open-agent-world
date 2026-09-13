import { Layers3, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { DeckIcon } from '../components/DeckIcon';
import { useCardLibrary, type DeckEntry } from '../state/cardLibrary';
import { displayDeckName, type LibraryCard } from './libraryCatalog';

export function LibraryDeckRail({ selectedId, onSelect, dragged, adding, onAdded, onCancel, cards }: {
  selectedId?: string; onSelect: (id: string) => void; dragged: DeckEntry | null;
  adding: LibraryCard | null; onAdded: () => void; onCancel: () => void; cards: LibraryCard[];
}) {
  const library = useCardLibrary();
  const root = useRef<HTMLElement>(null);
  useEffect(() => { root.current?.querySelector<HTMLElement>('.library-deck-destination.is-selected > button')?.scrollIntoView?.({ block: 'nearest' }); }, [selectedId]);
  const [over, setOver] = useState<string>();
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { if (!dragged) setOver(undefined); }, [dragged]);
  const add = async (id: string, entry: DeckEntry) => {
    const state = useCardLibrary.getState();
    const deck = state.snapshot?.decks.find(deck => deck.id === id);
    const card = cards.find(card => card.kind === entry.kind && card.id === entry.id);
    if (!deck || state.busy || !card?.available || card.internal) return;
    const included = deck.entries.some(item => item.kind === entry.kind && item.id === entry.id);
    if (!included && !await state.edit({ action: 'update_deck', id, entries: [...deck.entries, { kind: entry.kind, id: entry.id }] })) return;
    onSelect(id); onAdded();
    setNotice(t('Added {card} to {deck}', { card: card.label, deck: displayDeckName(deck) }));
  };
  return <aside ref={root} className={`library-deck-rail ${dragged || adding ? 'is-choosing' : ''}`} aria-label={t('Deck destinations')} data-tutorial="library-decks">
    <header><Layers3 size={19} /><h3>{t('Your decks')}</h3></header>
    <p>{adding ? t('Choose a deck for {card}', { card: adding.label }) : t('Drag a card here to add it to a deck.')}</p>
    {adding && <button className="library-text-button" onClick={onCancel}>{t('Cancel')}</button>}
    <div className="library-deck-destinations">
      {library.snapshot?.decks.map(deck => <section key={deck.id} data-deck-id={deck.id}
        className={`library-deck-destination ${selectedId === deck.id ? 'is-selected' : ''} ${over === deck.id ? 'is-over' : ''}`}
        onDragOver={event => { if (!dragged || library.busy) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setOver(deck.id); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(undefined); }}
        onDrop={event => { event.preventDefault(); event.stopPropagation(); setOver(undefined); if (dragged) void add(deck.id, dragged); }}>
        <button type="button" className="library-deck-destination-select" aria-pressed={selectedId === deck.id} disabled={library.busy}
          onClick={() => adding ? void add(deck.id, adding) : onSelect(deck.id)}>
          <DeckIcon icon={deck.icon} /><span><strong>{displayDeckName(deck)}</strong><small>{t('{count} cards', { count: deck.entries.length })}{deck.id === library.snapshot?.active_deck_id ? ` · ${t('Active deck')}` : ''}</small></span>
          {(adding || dragged) && <Plus size={16} />}
        </button>
        {selectedId === deck.id && <ul>{deck.entries.map(entry => <li key={`${entry.kind}:${entry.id}`}>
          <span>{cards.find(card => card.id === entry.id && card.kind === entry.kind)?.label ?? entry.id}</span>
          <button type="button" disabled={library.busy} aria-label={t('Remove {card} from {deck}', { card: cards.find(card => card.id === entry.id && card.kind === entry.kind)?.label ?? entry.id, deck: displayDeckName(deck) })}
            onClick={() => void library.edit({ action: 'update_deck', id: deck.id, entries: deck.entries.filter(item => item.kind !== entry.kind || item.id !== entry.id) })}><X size={12} /></button>
        </li>)}</ul>}
      </section>)}
    </div>
    <form onSubmit={async event => {
      event.preventDefault();
      if (!name.trim()) return;
      const before = new Set(library.snapshot?.decks.map(deck => deck.id));
      const saved = await library.edit({ action: 'create_deck', name: name.trim(), icon: 'layers' });
      const created = saved?.decks.find(deck => !before.has(deck.id));
      if (created) { onSelect(created.id); setName(''); if (adding) await add(created.id, adding); }
    }}>
      <input aria-label={t('New deck name')} placeholder={t('Name a new deck')} value={name} maxLength={120} onChange={event => setName(event.target.value)} />
      <button className="secondary-button" disabled={library.busy || !name.trim()} aria-label={t('Create deck')}><Plus size={16} /></button>
    </form>
    <small role="status">{notice}</small>
  </aside>;
}
