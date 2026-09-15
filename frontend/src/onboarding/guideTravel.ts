import { advanceGuide } from './placement';

type Point = { x: number; y: number };
export const PORTAL_DISTANCE = 480;
export const PORTAL_DURATION = 720;
export type TravelPhase = 'idle' | 'walking' | 'departing' | 'arriving';

/** Fixed-duration long trips; a moving target never restarts the portal clock. */
export class GuideTravel {
  position: Point;
  private portal?: { elapsed: number; source: Point };
  constructor(position: Point) { this.position = position; }
  update(target: Point, elapsed: number, immediate = false) {
    let phase: TravelPhase = 'idle', progress = 0;
    if (immediate) { this.portal = undefined; this.position = target; }
    else {
      if (!this.portal && Math.hypot(target.x - this.position.x, target.y - this.position.y) > PORTAL_DISTANCE) {
        this.portal = { elapsed: 0, source: this.position };
      }
      if (this.portal) {
        this.portal.elapsed += Math.max(0, elapsed);
        const portion = this.portal.elapsed / PORTAL_DURATION;
        if (portion >= 1) { this.position = target; this.portal = undefined; }
        else {
          phase = portion < .5 ? 'departing' : 'arriving';
          progress = (portion % .5) * 2;
          this.position = portion < .5 ? this.portal.source : target;
        }
      } else {
        this.position = advanceGuide(this.position, target, elapsed);
        phase = Math.hypot(this.position.x - target.x, this.position.y - target.y) < .5 ? 'idle' : 'walking';
      }
    }
    return { position: this.position, phase, progress, moving: phase !== 'idle' };
  }
}
