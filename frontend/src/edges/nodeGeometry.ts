import type { CanvasNode } from "../cards/types";
import { NODE_SURFACE_RADIUS } from "../state/nodeSurfaces";

/** Match the surface actually rendered, including compact equipment slots. */
export function nodeCornerRadius(node?: Pick<CanvasNode, "type" | "data">): number {
  if (node?.type === "equipment") return 8;
  if (node?.type === "equipmentPanel") return 12;
  if (node?.data.surfaceLevel) return NODE_SURFACE_RADIUS[node.data.surfaceLevel];
  return 24;
}
