import type { ReactNode } from "react";
import "./cardFace.css";

/** Shared printed face for collected cards and the active hand. */
export function CardFace({ icon, label, description }: { icon: ReactNode; label: string; description: string }) {
  return <span className="card-face">
    <span className="card-face-corner" aria-hidden="true">{icon}</span>
    <span className="card-face-art" aria-hidden="true">{icon}</span>
    <span className="card-face-copy"><strong>{label}</strong><small>{description}</small></span>
  </span>;
}
