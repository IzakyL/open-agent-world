import { expect, test } from '@playwright/test';

for (const [type, level] of [['text', 'inspector'], ['sandbox', 'workspace'], ['conversation', 'workspace']]) {
  test(`${type} title edits only through its adjacent button and remains draggable`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1800, height: 1200 });
    const response = await request.post('/api/nodes', { data: { type, name: 'Short title', position: { x: 550, y: 340 } } });
    expect(response.ok()).toBe(true);
    const { id } = await response.json();
    try {
      const profile = await (await request.get('/api/application')).json();
      expect((await request.patch('/api/application/preferences', { data: {
        profile_id: profile.profile_id, generation: profile.generation, changes: {
          'oaw-canvas-viewport-v1': null,
          'oaw-node-surfaces-v1': JSON.stringify({ state: { surfaceLevels: { [id]: level } }, version: 3 }),
        },
      } })).ok()).toBe(true);
      await page.goto('/');
      const card = page.locator(`.world-card[data-card-id="${id}"]`);
      await expect(card).toHaveAttribute('data-surface-level', level);
      const title = card.locator('.card-name');
      const heading = title.locator('h2, strong');
      const button = title.getByRole('button', { name: 'Rename', exact: true });
      await page.mouse.move(5, 5);
      await expect(button).toHaveCSS('opacity', '0');
      await expect(async () => {
        await heading.hover();
        await expect(button).toHaveCSS('opacity', '1', { timeout: 500 });
      }).toPass();
      const h = (await heading.boundingBox())!, b = (await button.boundingBox())!;
      expect(b.x - h.x - h.width).toBeGreaterThanOrEqual(0);
      expect(b.x - h.x - h.width).toBeLessThan(7);
      await heading.dblclick();
      await expect(title.locator('input')).toHaveCount(0);
      await page.waitForTimeout(500);
      const before = (await card.boundingBox())!, text = (await heading.boundingBox())!;
      await page.mouse.move(text.x + 10, text.y + text.height / 2);
      await page.mouse.down();
      await page.mouse.move(text.x + 100, text.y + text.height / 2 + 40, { steps: 12 });
      await page.mouse.up();
      await expect.poll(async () => (await card.boundingBox())!.x - before.x).toBeGreaterThan(60);
      await heading.hover();
      await button.click();
      const input = title.locator('input');
      await expect(input).toBeFocused();
      await input.fill('Cancelled');
      await input.press('Escape');
      await expect(heading).toHaveText('Short title');
      await heading.hover(); await button.click();
      const longName = 'Long title '.repeat(18).trim();
      await input.fill(longName); await input.press('Enter');
      await expect(heading).toHaveText(longName);
      await heading.hover();
      await expect(button).toHaveCSS('opacity', '1');
      const bounds = (await card.boundingBox())!, edit = (await button.boundingBox())!;
      expect(edit.x + edit.width).toBeLessThan(bounds.x + bounds.width);
      await page.screenshot({ path: `../.tmp/card-name-${type}.png` });
      await expect.poll(async () => {
        const nodes = await (await request.get('/api/nodes')).json();
        return nodes.find((node: { id: string }) => node.id === id)?.name;
      }).toBe(longName);
      await page.reload();
      await expect(heading).toHaveText(longName);
    } finally { await request.delete(`/api/nodes/${id}`); }
  });
}

