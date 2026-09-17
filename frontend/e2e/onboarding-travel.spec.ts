import { expect, test } from '@playwright/test';
import { resetTutorialProfile } from './tutorial-profile';

for (const theme of ['light', 'dark']) test(`long-distance guide portals hide the bubble (${theme})`, async ({ page, request }) => {
  await resetTutorialProfile(request);
  await page.setViewportSize({ width: 3440, height: 1440 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  if (theme === 'dark') await page.getByRole('button', { name: 'Use dark theme' }).click();
  await page.getByRole('button', { name: /^Start Tutorial/ }).click();
  await expect(page.locator('.tutorial-guide')).toHaveAttribute('data-moving', 'false');
  await page.evaluate(() => {
    const samples: { time: number; phase?: string; moving?: string; visibility?: string }[] = [];
    Object.assign(window, { travelSamples: samples });
    const start = performance.now();
    const sample = () => {
      const guide = document.querySelector<HTMLElement>('.tutorial-guide');
      const bubble = document.querySelector<HTMLElement>('.tutorial-bubble');
      samples.push({ time: performance.now(), phase: guide?.dataset.travelPhase, moving: guide?.dataset.moving, visibility: bubble && getComputedStyle(bubble).visibility });
      if (performance.now() - start < 3000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.locator('.tutorial-next').click();
  await expect(page.locator('.tutorial-guide')).toHaveAttribute('data-travel-phase', 'departing');
  await expect(page.locator('.tutorial-bubble')).not.toBeVisible();
  await page.screenshot({ path: `test-results/tutorial-portal-${theme}.png` });
  await expect(page.locator('.tutorial-guide')).toHaveAttribute('data-moving', 'false');
  await expect(page.locator('.tutorial-bubble')).toBeVisible();
  const samples = await page.evaluate(() => (window as unknown as { travelSamples: { time: number; phase: string; moving: string; visibility: string }[] }).travelSamples);
  const transit = samples.filter(s => ['departing', 'arriving'].includes(s.phase));
  expect(transit.some(s => s.phase === 'arriving')).toBe(true);
  expect(transit.at(-1)!.time - transit[0].time).toBeLessThan(1100);
  expect(samples.filter(s => s.moving === 'true').every(s => s.visibility === 'hidden')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
});
