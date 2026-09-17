import { expect, test } from '@playwright/test';

test('composited grid preserves dot phase, size and viewport coverage', async ({ page }) => {
  await page.goto('/');
  const grid = page.locator('#oaw-world-map > .world-grid');
  await expect(grid).toBeVisible();
  const check = async () => {
    const state = await grid.evaluate(el => {
      const root = el.parentElement!;
      const viewport = root.querySelector('.react-flow__viewport')!;
      const transform = new DOMMatrix(getComputedStyle(viewport).transform);
      const translated = new DOMMatrix(getComputedStyle(el).transform);
      const pattern = el.querySelector('pattern')!;
      const gap = Number(pattern.getAttribute('width'));
      const bounds = el.getBoundingClientRect(), canvas = root.getBoundingClientRect();
      return { gap, zoom: transform.a, x: translated.e, y: translated.f,
        expectedX: transform.e % gap, expectedY: transform.f % gap,
        radius: el.querySelector('circle')!.getAttribute('r'),
        covers: bounds.left <= canvas.left && bounds.top <= canvas.top && bounds.right >= canvas.right && bounds.bottom >= canvas.bottom,
      };
    });
    expect(state.covers).toBe(true);
    expect(state.radius).toBe('1');
    expect(state.x).toBeCloseTo(state.expectedX, 3);
    expect(state.y).toBeCloseTo(state.expectedY, 3);
    expect(state.gap).toBeCloseTo(24 * state.zoom * 2 ** Math.max(0, Math.ceil(Math.log2(18 / (24 * state.zoom)))), 3);
  };
  await check();
  for (const end of [{ x: 320, y: 230 }, { x: 1140, y: 560 }]) {
    await page.mouse.move(800, 400);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 20 });
    await page.mouse.up();
    await check();
  }
  for (const selector of ['.react-flow__controls-zoomout', '.react-flow__controls-zoomin']) {
    for (let i = 0; i < 5; i++) await page.locator(`.world-controls ${selector}`).click();
    await page.waitForTimeout(250);
    await check();
  }
  await page.setViewportSize({ width: 1700, height: 1000 });
  await check();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.screenshot({ path: `../.outputs/viewport-grid-${theme}.png` });
    await check();
  }
});
