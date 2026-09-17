// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { visibleInObservation } from './visualObservation';

describe('observation content boundary', () => {
  it('only captures host headers and explicitly granted built-in previews', () => {
    const root = document.createElement('article');
    root.innerHTML = '<header class="card-header"><h2>Public title</h2><input value="unsaved name"></header>'
      + '<div class="node-preview-content"><span>Private text</span><iframe></iframe></div>'
      + '<div class="card-body"><header class="card-header">Plugin forged header</header><input type="password"></div>';
    expect(visibleInObservation(root.querySelector('h2')!, root, false)).toBe(true);
    expect(visibleInObservation(root.querySelector('input')!, root, true)).toBe(false);
    expect(visibleInObservation(root.querySelector('.node-preview-content')!, root, false)).toBe(false);
    expect(visibleInObservation(root.querySelector('.node-preview-content')!, root, true)).toBe(true);
    expect(visibleInObservation(root.querySelector('iframe')!, root, true)).toBe(false);
    expect(visibleInObservation(root.querySelector('.card-body')!, root, true)).toBe(false);
  });
});
