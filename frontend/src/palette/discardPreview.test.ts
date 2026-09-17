// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createDiscardPreview, discardProximity } from './discardPreview';

afterEach(() => vi.unstubAllGlobals());

it('increases toward the bin and stays zero outside the approach radius', () => {
  const box = new DOMRect(100, 100, 34, 34);
  expect(discardProximity(0, 117, box)).toBe(0);
  expect(discardProximity(50, 117, box)).toBe(.5);
  expect(discardProximity(90, 117, box)).toBeGreaterThan(.9);
  expect(discardProximity(117, 117, box)).toBe(1);
});

it('restores the intact card after moving away, reusing the same fragments', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const preview = document.createElement('div'), card = document.createElement('div');
  preview.append(card);
  const update = createDiscardPreview(preview, card);
  update(.5);
  const fragments = [...preview.querySelectorAll<HTMLElement>('.palette-shred-piece')];
  expect(fragments.some(piece => piece.style.display !== 'none')).toBe(true);
  update(1);
  expect(card.style.clipPath).toBe('inset(0 0 100% 0)');
  expect(fragments.every(piece => Number(piece.style.opacity) === .5)).toBe(true);
  update(0);
  expect(card.style.clipPath).toBe('');
  expect(fragments.every(piece => piece.style.display === 'none')).toBe(true);
  update(.5);
  expect(preview.querySelectorAll('.palette-shred-piece')).toHaveLength(fragments.length);
});

it('uses reversible fading without fragments for reduced motion', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const preview = document.createElement('div'), card = document.createElement('div');
  preview.append(card);
  const update = createDiscardPreview(preview, card);
  update(1);
  expect(Number(card.style.opacity)).toBe(.5);
  expect(preview.children).toHaveLength(1);
  update(0);
  expect(card.style.opacity).toBe('1');
});
