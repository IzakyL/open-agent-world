import { CardFace, CardStock } from "../components/CardFace";
import { t, useLocale } from "../i18n";
import { AlertTriangle, Layers3, LibraryBig, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DECK_ICONS, DeckIcon } from "../components/DeckIcon";
import { DeckHand } from "./DeckHand";
import type { PaletteDragPayload } from "./dragPayload";
import { useWorldStore } from "../state/worldStore";
import { displayDeckName } from "../shell/libraryCatalog";
import { useCardLibrary } from "../state/cardLibrary";
import { CatalogIcon } from "../components/CatalogIcon";
import { useEquipmentDrag } from "../state/equipment";
import { buildCardDraft } from "../state/helpers";
import { startPalettePointerDrag, usePaletteDropTarget } from "./pointerDrag";

// Compatibility helpers have no role in ongoing deck population.
export { defaultDecks, normalizeDecks } from "./legacyDecks";

export function ComponentPalette() {
  useLocale();
  const library = useCardLibrary();
  const [editingDeck, setEditingDeck] = useState(false);
  const [showLegions, setShowLegions] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [deckIcon, setDeckIcon] = useState("folder");
  const catalog = useWorldStore(state => state.catalog);
  const legions = useWorldStore(state => state.legions);
  const legionError = useWorldStore(state => state.legionError);
  const createCard = useWorldStore(state => state.createCard);
  const instantiateLegion = useWorldStore(state => state.instantiateLegion);
  const deleteLegion = useWorldStore(state => state.deleteLegion);
  const [removing, setRemoving] = useState(false);
  const [trashActive, setTrashActive] = useState(false);
  const [dropDeck, setDropDeck] = useState<string>();
  const root = useRef<HTMLElement>(null);
  const cancelPointer = useRef<() => void>();
  const suppressClick = useRef(false);
  const dragged = useRef<{ kind: "node" | "legion"; id: string; sourceDeckId?: string }>();
  const endDrag = () => { dragged.current = undefined; setTrashActive(false); setDropDeck(undefined); useEquipmentDrag.getState().set(); };
  useEffect(() => { void library.refresh(); }, [library.refresh]);
  const snapshot = library.snapshot;
  const deck = showLegions ? { id: "legion-library", name: t("Legions"), icon: "layers",
    entries: legions.map(item => ({ kind: "legion" as const, id: item.id })) }
    : snapshot?.decks.find(item => item.id === snapshot.active_deck_id);
  useEffect(() => () => cancelPointer.current?.(), [deck?.id]);
  const moveToDeck = async (id: string) => {
    const entry = dragged.current;
    endDrag();
    if (!entry || entry.sourceDeckId === id || library.busy || removing) return;
    const saved = await library.edit({ action: "move_entry", id, source_deck_id: entry.sourceDeckId,
      entry: { kind: entry.kind, id: entry.id } });
    if (saved) { setEditingDeck(false); setShowLegions(false); }
  };
  const discard = async () => {
    const entry = dragged.current;
    endDrag();
    if (!entry || !deck || removing || library.busy || !deck.entries.some(item => item.kind === entry.kind && item.id === entry.id)) return;
    const label = legions.find(item => item.id === entry.id)?.name ?? entry.id;
    if (showLegions && !window.confirm(t("Delete saved Legion \"{v0}\"? Existing formations in the world will remain.", { v0: String(label) }))) return;
    setRemoving(true);
    try {
      if (showLegions) await deleteLegion(entry.id);
      else await library.edit({ action: "update_deck", id: deck.id,
        entries: deck.entries.filter(item => item.kind !== entry.kind || item.id !== entry.id) });
    } finally { setRemoving(false); }
  };
  usePaletteDropTarget(root, {
    accepts: (item, point) => {
      const id = point.target.closest<HTMLElement>("[data-deck-destination]")?.dataset.deckDestination;
      return !library.busy && !removing && Boolean(point.target.closest(".deck-trash") || (id && id !== item.entry.sourceDeckId));
    },
    over: (_item, point) => {
      setTrashActive(Boolean(point.target.closest(".deck-trash")));
      setDropDeck(point.target.closest<HTMLElement>("[data-deck-destination]")?.dataset.deckDestination);
    },
    leave: () => { setTrashActive(false); setDropDeck(undefined); },
    drop: (_item, point) => {
      const id = point.target.closest<HTMLElement>("[data-deck-destination]")?.dataset.deckDestination;
      if (id) void moveToDeck(id);
      else if (point.target.closest(".deck-trash")) void discard();
    },
  });
  return <aside ref={root} className="component-palette" aria-label={t("Active card deck")} data-tutorial="deck"
    style={{ "--deck-tab-count": (snapshot?.decks.length ?? 0) + 1, "--deck-hand-count": deck?.entries.length ?? 0 } as CSSProperties}>
    <div className="deck-tabs">
      <div className="deck-tab-scroll" role="tablist" aria-label={t("Card decks")}>
        {snapshot?.decks.map(item => <button type="button" role="tab" key={item.id} data-deck-destination={item.id} aria-selected={item.id === deck?.id}
          aria-controls="active-card-deck" className={`${item.id === deck?.id ? "is-active" : ""} ${dropDeck === item.id ? "is-drop-target" : ""}`} disabled={library.busy}
          onClick={() => { setEditingDeck(false); setShowLegions(false); void library.edit({ action: "activate_deck", id: item.id }); }}>
          <span className="deck-tab-summary"><DeckIcon icon={item.icon} /><small>{item.entries.length}</small></span>
          <span className="deck-tab-label">{displayDeckName(item)}</span>
        </button>)}
        <button type="button" role="tab" aria-selected={showLegions} aria-controls="active-card-deck"
          className={showLegions ? "is-active" : ""} onClick={() => { setEditingDeck(false); setShowLegions(true); }}>
          <span className="deck-tab-summary"><Layers3 size={16} /><small>{legions.length}</small></span>
          <span className="deck-tab-label">{t("Legions")}</span>
        </button>
      </div>
      <button type="button" className={`deck-add-button ${editingDeck ? "is-active" : ""}`} onClick={() => setEditingDeck(true)} aria-label={t("Create a new card deck")} aria-expanded={editingDeck} title={t("Create a new deck")}><Plus size={16} /></button>
    </div>
    <div className={`deck-stage ${editingDeck ? "is-editor" : ""}`} id="active-card-deck" role="tabpanel">
      {editingDeck ? <form className="deck-editor" onSubmit={async event => {
        event.preventDefault();
        if (!deckName.trim()) return;
        const saved = await library.edit({ action: "create_deck", name: deckName.trim(), icon: deckIcon });
        if (saved) { setEditingDeck(false); setShowLegions(false); setDeckName(""); setDeckIcon("folder"); }
      }}>
        <div className="deck-editor-heading"><div><strong>{t("New deck")}</strong><small>{t("Choose a name and icon.")}</small></div><button type="button" aria-label={t("Cancel creating deck")} onClick={() => setEditingDeck(false)}><X size={15} /></button></div>
        <label className="deck-name-field"><span>{t("Deck name")}</span><input autoFocus aria-label={t("Deck name")} maxLength={120} value={deckName} onChange={event => setDeckName(event.target.value)} required /></label>
        <div className="deck-quick-create"><label><DeckIcon icon={deckIcon} /><select aria-label={t("Deck icon")} value={deckIcon} onChange={event => setDeckIcon(event.target.value)}>{Object.keys(DECK_ICONS).map(icon => <option key={icon}>{icon}</option>)}</select></label>
          <button className="deck-create-button" disabled={library.busy || !deckName.trim()}><Plus size={14} /> {t("Create deck")}</button></div>
        {library.error ? <small role="alert">{library.error}</small> : null}
      </form> : <>
      <div className="deck-caption"><span><DeckIcon icon={deck?.icon} size={13} /> {deck ? displayDeckName(deck) : t("Your deck")}</span><small>{t("Drag into the world")}</small>
        <div className={`deck-trash ${trashActive ? "is-active" : ""}`} role="region" aria-label={t("Discard card")}
          title={showLegions ? t("Drop to delete saved Legion") : t("Drop to remove from this deck")} aria-busy={removing}><Trash2 size={20} /></div>
      </div>
      {library.error ? <button className="deck-library-error" onClick={library.show}><AlertTriangle size={13} /> {t("Library needs attention")}</button> : null}
      {showLegions && legionError ? <small role="alert">{legionError}</small> : null}
      {deck?.entries.length ? <DeckHand key={deck.id} className={`palette-items ${deck.entries.length > 2 ? "has-many" : ""}`}
        style={{ "--deck-card-count": deck.entries.length } as CSSProperties}>
        {deck.entries.map(entry => {
          const definition = entry.kind === "node" ? snapshot?.card_definitions[entry.id] : undefined;
          const legion = entry.kind === "legion" ? legions.find(item => item.id === entry.id) : undefined;
          const available = entry.kind === "node" ? snapshot?.available_card_ids.includes(entry.id) : legion?.compatible;
          const label = definition ? t(definition.label) : legion?.name ?? entry.id;
          const payload: PaletteDragPayload = entry.kind === "node" ? { version: 1, kind: "node", type: entry.id }
            : { version: 1, kind: "legion", id: entry.id, revision: legion?.revision ?? 0 };
          return <button type="button" key={`${entry.kind}:${entry.id}`} className="deck-hover-button" data-palette-card={entry.id} aria-disabled={!available}
            draggable={false} onPointerDown={event => {
              if (removing || library.busy || event.button !== 0 || !event.isPrimary) return;
              suppressClick.current = false;
              const draggedEntry = { ...entry, sourceDeckId: showLegions ? undefined : deck.id };
              cancelPointer.current = startPalettePointerDrag(event.nativeEvent, event.currentTarget,
                { entry: draggedEntry, payload: available ? payload : undefined }, {
                  start: () => {
                    suppressClick.current = true;
                    dragged.current = draggedEntry;
                    if (available && payload.kind === "node") useEquipmentDrag.getState().set({
                      ...buildCardDraft(payload.type, { x: 0, y: 0 }, catalog.node_types.find(item => item.id === payload.type)), id: "",
                    });
                  },
                  end: endDrag,
                });
            }}
            onClick={event => {
              if (dragged.current) { event.preventDefault(); return; }
              if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.preventDefault(); return; }
              if (available) entry.kind === "node" ? void createCard(entry.id) : void instantiateLegion(entry.id);
            }}
            aria-label={available ? t("Place {v0}", { v0: String(label) }) : t("{v0} unavailable", { v0: String(label) })} title={available ? (definition ? t(definition.description) : undefined) ?? t("Deploy saved formation") : t("Content unavailable. Inspect it in the Library.")}>
            <CardStock style={{ "--collection-color": definition?.color ?? "#78967b" } as CSSProperties} className={`palette-item palette-item--${entry.kind === "node" ? entry.id : "legion"}`} data-deck-visual>
              <CardFace icon={available ? definition ? <CatalogIcon definition={definition} /> : <Layers3 /> : <AlertTriangle />} label={label}
                description={available ? (definition ? t(definition.description) : undefined) ?? t("Saved formation") : t("Unavailable")} />
            </CardStock>
          </button>;
        })}
      </DeckHand> : showLegions ? <div className="deck-empty"><Layers3 size={22} /><strong>{t("No saved Legions")}</strong>
        <small>{t("Form a Legion in the world, then save it to your library.")}</small></div>
      : <div className="deck-empty"><LibraryBig size={22} /><strong>{snapshot ? t("Build your deck") : t("Loading your deck")}</strong>
        <small>{t("Open packs, collect cards, then choose what belongs here.")}</small><button className="secondary-button" onClick={library.show}>{t("Open Library")}</button></div>}
      </>}
    </div>
  </aside>;
}
