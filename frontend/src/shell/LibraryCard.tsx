import type { CSSProperties, ReactNode } from "react";

export function LibraryCard({ selected, included, color, children }: { selected: boolean; included: boolean; color: string; children: ReactNode }) {
  return <article className={`library-card ${selected ? "is-selected" : ""} ${included ? "is-in-deck" : ""}`} style={{ "--collection-color": color } as CSSProperties}>
    {children}
  </article>;
}
