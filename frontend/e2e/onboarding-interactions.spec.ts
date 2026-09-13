import { resetTutorialProfile } from './tutorial-profile';
import { expect, test } from '@playwright/test';

for (const [name, dx, dy] of [['right', 500, 0], ['left', -500, 0], ['below', 0, 340], ['above', 0, -340]] as const) {
  test(`tutorial connects actual ${name} boundaries and waits for confirmation`, async ({ page, request }) => {
    test.setTimeout(35_000);
    const prefix = `guide-${name}-${Date.now()}`, agent = `${prefix}-agent`, conversation = `${prefix}-room`;
    const originals = (await (await request.get('/api/nodes')).json()).map((card: { id: string }) => card.id);
    for (const [id, type, x, y] of [[agent, 'agent', 600, 450], [conversation, 'conversation', 600 + dx, 450 + dy]] as const) {
      expect((await request.post('/api/nodes', { data: { id, type, name: id, position: { x, y } } })).ok()).toBe(true);
    }
    try {
      await resetTutorialProfile(request, { id: 'geometry-test', step: 'connect-demo', initialIds: originals, demos: [], refs: { agent, conversation } });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto('/');
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await page.getByRole('button', { name: 'Show the connection', exact: true }).click();
      const trace = page.locator('.tutorial-connection-trace path');
      await expect(trace).toHaveAttribute('d', /^M /);
      const endpoints = await trace.evaluate((element) => {
        const path = element as SVGPathElement, matrix = path.getScreenCTM()!;
        const start = path.getPointAtLength(0).matrixTransform(matrix), end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
        return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
      });
      const a = (await page.locator(`.react-flow__node[data-id="${agent}"]`).boundingBox())!;
      const b = (await page.locator(`.react-flow__node[data-id="${conversation}"]`).boundingBox())!;
      if (dx) {
        expect(endpoints.start.x).toBeCloseTo(a.x + (dx > 0 ? a.width : 0), 0);
        expect(endpoints.end.x).toBeCloseTo(b.x + (dx > 0 ? 0 : b.width), 0);
      } else {
        expect(endpoints.start.y).toBeCloseTo(a.y + (dy > 0 ? a.height : 0), 0);
        expect(endpoints.end.y).toBeCloseTo(b.y + (dy > 0 ? 0 : b.height), 0);
      }
      for (const role of ['agent', 'conversation']) await expect(page.locator(`mask rect[data-spotlight-target="${role}"]`)).toHaveAttribute('opacity', '1');
      await expect(page.locator('mask path[data-spotlight-route]')).toHaveAttribute('opacity', '1');
      await page.screenshot({ path: `test-results/tutorial-connect-${name}.png` });
      const bubble = page.locator('.tutorial-bubble');
      await expect(bubble).toHaveAttribute('data-reviewing', 'true');
      await expect(page.locator('.tutorial-next')).toBeEnabled();
      // The real saved edge uses exactly the same endpoints as the demonstration.
      const actual = page.locator(`.semantic-edge-endpoint--source[data-source-id="${agent}"]`);
      const point = (await actual.boundingBox())!;
      expect(point.x + point.width / 2).toBeCloseTo(endpoints.start.x, 0);
      expect(point.y + point.height / 2).toBeCloseTo(endpoints.start.y, 0);
      await page.waitForTimeout(1000);
      await expect(bubble).toHaveAttribute('data-step', 'connect-demo');
      if (name === 'left') {
        await page.reload();
        await page.getByRole('button', { name: 'Resume', exact: true }).click();
        await expect(bubble).toHaveAttribute('data-reviewing', 'true');
        await expect(trace).toHaveCount(0);
      }
      await page.locator('.tutorial-next').click();
      await expect(bubble).toHaveAttribute('data-step', 'conversation-open');
      // The former source fades out; the destination stays illuminated.
      await expect.poll(async () => page.evaluate(() => Number(document.querySelector('mask rect[data-spotlight-target="agent"]')?.getAttribute('opacity') ?? 0))).toBeLessThan(1);
      await expect(page.locator('mask rect[data-spotlight-target="conversation"]')).toHaveAttribute('opacity', '1');
    } finally {
      await request.delete(`/api/nodes/${agent}`); await request.delete(`/api/nodes/${conversation}`);
    }
  });
}
