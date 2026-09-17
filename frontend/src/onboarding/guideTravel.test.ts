import { describe, expect, it } from 'vitest';
import { GuideTravel, PORTAL_DURATION } from './guideTravel';

describe('guide travel', () => {
  it('walks nearby without showing a portal and settles', () => {
    const trip = new GuideTravel({ x: 0, y: 0 });
    expect(trip.update({ x: 100, y: 0 }, 16).phase).toBe('walking');
    for (let i = 0; i < 150; i++) trip.update({ x: 100, y: 0 }, 16);
    expect(trip.update({ x: 100, y: 0 }, 16)).toMatchObject({ phase: 'idle', moving: false, position: { x: 100, y: 0 } });
  });
  it.each([1000, 4000, 10000])('bounds a %i pixel trip to the same duration', x => {
    const trip = new GuideTravel({ x: 0, y: 0 }), target = { x, y: 500 };
    expect(trip.update(target, 100)).toMatchObject({ phase: 'departing', moving: true, position: { x: 0, y: 0 } });
    expect(trip.update(target, PORTAL_DURATION / 2)).toMatchObject({ phase: 'arriving', moving: true, position: target });
    expect(trip.update(target, PORTAL_DURATION)).toMatchObject({ phase: 'idle', moving: false, position: target });
  });
  it('retargets during transit without restarting or revealing the bubble early', () => {
    const trip = new GuideTravel({ x: 0, y: 0 });
    trip.update({ x: 1500, y: 0 }, 200);
    expect(trip.update({ x: 800, y: 200 }, 200)).toMatchObject({ phase: 'arriving', moving: true });
    expect(trip.update({ x: 600, y: 300 }, 320)).toMatchObject({ phase: 'idle', position: { x: 600, y: 300 } });
  });
  it('cancels animation immediately for reduced motion or pause', () => {
    const trip = new GuideTravel({ x: 0, y: 0 });
    trip.update({ x: 4000, y: 0 }, 100);
    expect(trip.update({ x: 200, y: 100 }, 0, true)).toMatchObject({ phase: 'idle', moving: false, position: { x: 200, y: 100 } });
    expect(trip.update({ x: 200, y: 100 }, 16).phase).toBe('idle');
  });
});
