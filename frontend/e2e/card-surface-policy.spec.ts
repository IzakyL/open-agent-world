import { expect, test } from '@playwright/test';

for (const type of ['conversation', 'sandbox']) {
  test(`${type} drops as a window, skips details, and preserves compact state on reload`, async ({ page, request }, info) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 1800, height: 1100 });
    const profile = await (await request.get('/api/application')).json();
    expect((await request.patch('/api/application/preferences', { data: {
      profile_id: profile.profile_id, generation: profile.generation, changes: {
        'oaw-onboarding-v1': JSON.stringify({ version: 1, state: { status: 'skipped' } }),
        'oaw-canvas-viewport-v1': null, 'oaw-node-surfaces-v1': null, 'oaw.locale': 'en',
      },
    } })).ok()).toBe(true);
    let library = await (await request.get('/api/card-library')).json();
    for (const id of library.available_pack_ids) library = await (await request.post('/api/card-library/actions', {
      data: { action: 'open_pack', id, expected_revision: library.revision },
    })).json();
    expect((await request.post('/api/card-library/actions', { data: {
      action: 'update_deck', id: library.active_deck_id, entries: [{ kind: 'node', id: type }], expected_revision: library.revision,
    } })).ok()).toBe(true);
    let id: string | undefined;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto('/');
      const tray = page.locator('[data-tutorial="deck"]');
      await tray.hover();
      const source = tray.locator(`[data-palette-card="${type}"]`);
      await source.hover();
      const box = (await source.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(800, 460, { steps: 12 });
      const created = page.waitForResponse(r => r.url().endsWith('/api/card-library/nodes') && r.request().method() === 'POST');
      await page.mouse.up();
      const response = await created;
      expect(response.status()).toBe(201);
      id = (await response.json()).id;
      const card = page.locator(`.world-card[data-card-id="${id}"]`);
      await expect(card).toHaveAttribute('data-surface-level', 'workspace');
      await expect(card.locator('.workspace-titlebar')).toBeVisible();
      const before = (await card.boundingBox())!;
      const header = (await card.locator('.workspace-titlebar').boundingBox())!;
      await page.mouse.move(header.x + 400, header.y + 18);
      await page.mouse.down();
      await page.mouse.move(header.x + 430, header.y + 38, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => (await card.boundingBox())!.x - before.x).toBeGreaterThan(20);
      await card.getByRole('button', { name: 'Rename', exact: true }).click();
      await card.getByRole('textbox', { name: `${type === 'sandbox' ? 'Sandbox' : 'Conversation'} name`, exact: true }).fill(`${type} surface test`);
      await card.getByRole('textbox', { name: / name$/ }).press('Enter');
      await expect(card.locator('.workspace-titlebar strong')).toHaveText(`${type} surface test`);
      await card.screenshot({ path: info.outputPath(`${type}-initial-window.png`) });
      await card.getByRole('button', { name: 'Close workspace', exact: true }).click();
      await expect(card).toHaveAttribute('data-surface-level', 'preview');
      await card.getByRole('heading').click();
      await expect(card).toHaveAttribute('data-surface-level', 'workspace');
      await page.keyboard.press('Escape');
      await expect(card).toHaveAttribute('data-surface-level', 'preview');
      await card.getByRole('button', { name: /^Collapse / }).click();
      await expect(card).toHaveAttribute('data-surface-level', 'node');
      await expect.poll(async () => {
        const saved = (await (await request.get('/api/application')).json()).values['oaw-node-surfaces-v1'];
        return saved && JSON.parse(saved).state.surfaceLevels[id!];
      }).toBe('node');
      await page.reload();
      await expect(card).toHaveAttribute('data-surface-level', 'node');
      await card.locator('.card-kind-icon').click();
      await expect(card).toHaveAttribute('data-surface-level', 'workspace');
      await card.getByRole('button', { name: 'Close workspace', exact: true }).click();
      await expect(card).toHaveAttribute('data-surface-level', 'node');
      await card.getByRole('button', { name: /^Expand / }).click();
      await expect(card).toHaveAttribute('data-surface-level', 'preview');
      await card.getByRole('heading').click();
      await card.getByRole('button', { name: `Remove ${type} surface test`, exact: true }).click();
      await expect(card).toHaveCount(0);
      await page.keyboard.press('Control+z');
      await expect(card).toHaveAttribute('data-surface-level', 'workspace');
      expect(errors).toEqual([]);
    } finally {
      if (!page.isClosed()) await page.mouse.up();
      if (id) await request.delete(`/api/nodes/${id}`);
    }
  });
}
