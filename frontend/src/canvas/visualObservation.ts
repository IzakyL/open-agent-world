import { toCanvas } from 'html-to-image';

export interface ObservationRequest {
  request_id: string;
  scope: { center: { x: number; y: number }; radius: number };
  cards: { id: string; type: string; position: { x: number; y: number }; size: { width: number; height: number } }[];
  content_ids: string[];
  versions: { cards: Record<string, { revision: number }> };
  edges: { id: string; source: string; target: string }[];
}

// Capture only host-owned card headers and explicitly readable built-in
// previews. A plugin adding a new body cannot silently expand visual access.
export function visibleInObservation(element: HTMLElement, root: HTMLElement, readContent: boolean): boolean {
  if (element === root) return true;
  if (element.matches('input, textarea, select, iframe, video, [contenteditable="true"]')) return false;
  if (element.closest('[data-observation-private]')) return false;
  if (element.closest('.card-header') && root.contains(element.closest('.card-header'))) return true;
  if (readContent && element.closest('.node-preview-content') && root.contains(element.closest('.node-preview-content'))) return true;
  return false;
}

export async function captureObservation(request: ObservationRequest) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1600;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable');
  const { radius, center } = request.scope;
  const scale = canvas.width / (2 * radius);
  context.fillStyle = getComputedStyle(document.body).backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.beginPath();
  context.arc(800, 800, 800, 0, Math.PI * 2);
  context.clip();
  // Read the displayed SVG paths, preserving the canvas's current routing.
  context.save();
  context.scale(scale, scale);
  context.translate(radius - center.x, radius - center.y);
  for (const edge of request.edges) {
    const path = document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(edge.id)}"] .react-flow__edge-path`);
    if (!path?.getAttribute('d')) continue;
    const style = getComputedStyle(path);
    context.strokeStyle = style.stroke;
    context.lineWidth = parseFloat(style.strokeWidth) || 1;
    context.stroke(new Path2D(path.getAttribute('d')!));
  }
  context.restore();
  const captured: string[] = [];
  const readable = new Set(request.content_ids);
  for (const card of request.cards) {
    const root = document.querySelector<HTMLElement>(`.world-card[data-card-id="${CSS.escape(card.id)}"]`);
    // React Flow virtualizes offscreen cards. Report them as missing, never
    // substitute a made-up image or pan the human's viewport to capture them.
    if (!root || root.getAttribute('data-surface-level') === 'workspace' || !root.querySelector('.card-header')) continue;
    const revision = String(request.versions.cards[card.id]?.revision);
    if (root.dataset.cardRevision !== revision) continue;
    const width = root.offsetWidth, height = root.offsetHeight;
    if (!width || !height || width > 4096 || height > 4096) continue;
    const readContent = readable.has(card.id) && ['image', 'text'].includes(card.type);
    const image = await toCanvas(root, {
      width, height, pixelRatio: 1, skipFonts: true,
      filter: node => !(node instanceof Element) || visibleInObservation(node as HTMLElement, root, readContent),
      style: { transform: 'none', animation: 'none', transition: 'none' },
    });
    if (!root.isConnected || root.dataset.cardRevision !== revision) continue;
    const x = (card.position.x - center.x + radius) * scale;
    const y = (card.position.y - center.y + radius) * scale;
    // Clip expanded/hover surfaces to the backend-authorized saved rectangle.
    context.save();
    context.beginPath();
    context.rect(x, y, card.size.width * scale, card.size.height * scale);
    context.clip();
    context.drawImage(image, x, y, width * scale, height * scale);
    context.restore();
    captured.push(card.id);
  }
  context.restore();
  return { request_id: request.request_id, data_base64: canvas.toDataURL('image/png').split(',')[1], captured_ids: captured };
}
