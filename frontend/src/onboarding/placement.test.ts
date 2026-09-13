import { describe, expect, it } from 'vitest';
import { placeGuide, vacantPosition, type GuideRect } from './placement';

const intersects = (a: GuideRect, b: GuideRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe('guide placement', () => {
  it('places the zoom mascot above its controls without covering nearby tools or the minimap', () => {
    const subject = { x: 1100, y: 700, width: 34, height: 99 };
    const obstacles = [subject, { x: 860, y: 755, width: 76, height: 44 }, { x: 950, y: 720, width: 136, height: 79 }];
    const bubble = { width: 256, height: 140 };
    const offset = bubble.width - 92;
    const point = placeGuide({ x: 907, y: 592 }, subject, bubble, { width: 1160, height: 820 }, obstacles, offset);
    const mascot = { x: point.x + offset, y: point.y, width: 92, height: 92 };
    expect(mascot.y + mascot.height).toBeLessThan(subject.y);
    expect(Math.abs(mascot.x + 46 - (subject.x + subject.width / 2))).toBeLessThan(32);
    for (const obstacle of obstacles) {
      expect(intersects(mascot, obstacle)).toBe(false);
      expect(intersects({ x: point.x, y: point.y - bubble.height - 9, ...bubble }, obstacle)).toBe(false);
    }
  });

  it('prioritizes the highlighted control in a crowded settings dialog', () => {
    const subject = { x: 248, y: 645, width: 492, height: 49 };
    const bubble = { width: 256, height: 130 };
    const fields = [390, 454, 559].map(y => ({ x: 248, y, width: 492, height: 34 }));
    const point = placeGuide({ x: 248, y: 565 }, subject, bubble, { width: 800, height: 800 }, fields);
    expect(intersects({ x: point.x, y: point.y - bubble.height - 9, ...bubble }, subject)).toBe(false);
  });

  it('keeps the bubble inside a narrow screen and off an open workspace', () => {
    const workspace = { x: 300, y: 80, width: 450, height: 440 };
    const bubble = { width: 256, height: 180 };
    const point = placeGuide({ x: 320, y: 220 }, workspace, bubble, { width: 768, height: 640 }, [workspace]);
    const rect = { x: point.x, y: point.y - bubble.height - 17, ...bubble };
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(768);
    expect(rect.y + rect.height).toBeLessThanOrEqual(640);
    expect(intersects(rect, workspace)).toBe(false);
  });

  it('reserves space for a Minister composer among existing cards without moving them', () => {
    const obstacles = [{ x: 200, y: 150, width: 286, height: 156 }, { x: 520, y: 280, width: 286, height: 156 }, { x: 120, y: 410, width: 600, height: 156 }];
    const before = structuredClone(obstacles);
    const desired = { x: 300, y: 200, width: 480, height: 360 };
    const point = vacantPosition(desired, obstacles);
    expect(obstacles).toEqual(before);
    expect(obstacles.every(rect => !intersects({ ...desired, ...point }, { x: rect.x - 32, y: rect.y - 32, width: rect.width + 64, height: rect.height + 64 }))).toBe(true);
    expect(vacantPosition({ ...desired, x: -1000 }, obstacles)).toEqual({ x: -1000, y: 200 });
  });
});
