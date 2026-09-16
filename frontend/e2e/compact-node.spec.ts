import { expect, test } from '@playwright/test';

for (const type of ['agent', 'text', 'image', 'sandbox', 'conversation']) {
  test(`${type} collapses to a circle with a centered read-only title`, async ({ page, request }, info) => {
    const response = await request.post('/api/nodes', { data: { type, name: '材料结构分析', position: { x: 550, y: 340 } } });
    expect(response.ok()).toBe(true);
    const { id } = await response.json();
    try {
      const profile = await (await request.get('/api/application')).json();
      expect((await request.patch('/api/application/preferences', { data: {
        profile_id: profile.profile_id, generation: profile.generation, changes: {
          'oaw-canvas-viewport-v1': null,
          'oaw-node-surfaces-v1': JSON.stringify({ state: { surfaceLevels: { [id]: 'preview' } }, version: 3 }),
        },
      } })).ok()).toBe(true);
      await page.goto('/');
      const card = page.locator(`.world-card[data-card-id="${id}"]`);
      await expect(card).toHaveAttribute('data-surface-level', 'preview');
      await card.getByRole('button', { name: /^Collapse / }).click();
      await expect(card).toHaveAttribute('data-surface-level', 'node');
      await expect(card).toHaveCSS('width', '96px');
      await expect(card).toHaveCSS('height', '96px');
      await expect(card).toHaveCSS('border-radius', '48px');
      const heading = card.locator('.card-name h2');
      const button = card.locator('.card-name-edit');
      for (const hover of [false, true]) {
        if (hover) await heading.hover(); else await page.mouse.move(5, 5);
        await expect(button).toHaveCount(0);
        expect(await heading.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        const bounds = (await card.boundingBox())!, title = (await heading.boundingBox())!;
        expect(Math.abs(title.x + title.width / 2 - bounds.x - bounds.width / 2)).toBeLessThan(1);
      }
      await card.screenshot({ path: info.outputPath(`${type}-node.png`) });
      await expect(heading).toHaveAttribute('title', '材料结构分析');
      await expect(card.locator('.card-name-input')).toHaveCount(0);
      await page.reload();
      await expect(card).toHaveCSS('width', '96px');
      await expect(card).toHaveCSS('height', '96px');
    } finally { await request.delete(`/api/nodes/${id}`); }
  });
}
