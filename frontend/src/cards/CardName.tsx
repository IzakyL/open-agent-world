import { useState } from "react";
import { Pencil } from "lucide-react";
import { IconButton } from "../components/IconButton";
import { t, useLocale } from "../i18n";
import { useWorldStore } from "../state/worldStore";
import type { WorldCard } from "../types/world";

export function CardName({ card, label, workspace = false, editable = true }: { card: WorldCard; label: string; workspace?: boolean; editable?: boolean }) {
  useLocale();
  const updateCard = useWorldStore(state => state.updateCard);
  const [editing, setEditing] = useState(false);
  const Heading = workspace ? "strong" : "h2";
  return <div className="card-name">
    {editing ? <input className={`${workspace ? "workspace" : "card"}-name-input nodrag nopan`}
      aria-label={t("{v0} name", { v0: label })} defaultValue={card.name} autoFocus
      onFocus={event => event.currentTarget.select()}
      onBlur={event => {
        const name = event.currentTarget.value.trim();
        setEditing(false);
        if (name && name !== card.name) void updateCard(card.id, { name });
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") { event.currentTarget.value = card.name; event.currentTarget.blur(); }
      }} /> : <>
      <Heading title={card.name}>{card.name}</Heading>
      {editable && <IconButton className="card-name-edit" icon={Pencil} size="xs" quiet label={t("Rename")}
        onClick={() => setEditing(true)} />}
    </>}
  </div>;
}

