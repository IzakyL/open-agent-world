/** A reversible visual effect. It never changes the card or deck membership. */
export function createDiscardPreview(preview: HTMLElement, card: HTMLElement) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pieces: { element: HTMLElement; column: number; row: number }[] = [];
  const columns = 6, rows = 4;
  let lastProgress = -1;
  return (progress: number) => {
    const p = Math.max(0, Math.min(1, progress));
    if (p === lastProgress) return;
    lastProgress = p;
    preview.dataset.discardProgress = p.toFixed(3);
    const opacity = String(1 - p * .5);
    if (reducedMotion) { card.style.opacity = opacity; return; }
    if (p > 0 && !pieces.length) {
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const element = document.createElement('div');
        element.className = 'palette-shred-piece';
        element.append(card.cloneNode(true));
        preview.append(element);
        pieces.push({ element, column, row });
      }
    }
    card.style.clipPath = p ? `inset(0 0 ${p * 100}% 0)` : '';
    const cut = 1 - p;
    for (const { element, column, row } of pieces) {
      const top = Math.max(row / rows, cut), bottom = (row + 1) / rows;
      const local = Math.max(0, Math.min(1, (p - (1 - bottom)) * 2));
      element.style.display = top >= bottom ? 'none' : '';
      const left = column / columns * 100, right = (column + 1) / columns * 100;
      // Slightly staggered edges look like torn paper, rather than a grid of tiles.
      element.style.clipPath = `polygon(${left}% ${top * 100}%, ${right}% ${top * 100}%, ${right - 1}% ${bottom * 100 - 2}%, ${left + 1}% ${bottom * 100}%)`;
      const spread = (column - (columns - 1) / 2) * (9 + row * 3) * local;
      const fall = (20 + row * 12 + column % 2 * 10) * local;
      element.style.transform = `translate(${spread}px, ${fall}px) rotate(${(column % 2 ? 1 : -1) * (8 + row * 5) * local}deg)`;
      element.style.opacity = opacity;
    }
  };
}

export function discardProximity(x: number, y: number, box: DOMRect): number {
  const distance = Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
  const progress = Math.max(0, 1 - distance / 100);
  return progress * progress * (3 - 2 * progress);
}
