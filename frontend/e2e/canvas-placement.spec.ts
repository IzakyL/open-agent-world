import { expect, test } from '@playwright/test';

test('deck placement commits equipment and container ownership in the create request', async ({ page, request }) => {
  await page.setViewportSize({ width: 1800, height: 1100 });
  const ids: string[] = [];
  try {
    let library = await (await request.get('/api/card-library')).json();
    for (const id of library.available_pack_ids) library = await (await request.post('/api/card-library/actions', {
      data: { action: 'open_pack', id, expected_revision: library.revision },
    })).json();
    await page.goto('/');
    const tray = page.getByRole('complementary', { name: 'Active card deck' });
    await expect(tray).toBeVisible();
    library = await (await request.get('/api/card-library')).json();
    expect((await request.post('/api/card-library/actions', { data: {
      action: 'update_deck', id: library.active_deck_id, entries: [{ kind: 'node', id: 'text' }], expected_revision: library.revision,
    } })).ok()).toBe(true);
    for (const input of [
      { type: 'agent', name: 'Placement owner', position: { x: 320, y: 220 } },
      { type: 'core.shadow-collection', name: 'Placement collection', position: { x: 980, y: 200 }, config: { display_state: 'expanded' } },
    ]) {
      const response = await request.post('/api/nodes', { data: input });
      expect(response.ok()).toBe(true);
      ids.push((await response.json()).id);
    }
    await page.reload();
    await page.getByRole('button', { name: 'Equipment for Placement owner', exact: true }).click();
    const slot = page.locator(`[data-equipment-panel="${ids[0]}"]`);
    await expect(slot).toBeVisible();
    const source = tray.locator('[data-palette-card="text"]');
    const place = async (target: typeof slot, point: { x: number; y: number }) => {
      await tray.hover();
      await expect(source).toBeVisible();
      const response = page.waitForResponse(r => r.url().endsWith('/api/card-library/nodes') && r.request().method() === 'POST');
      await source.dragTo(target, { targetPosition: point });
      const result = await response;
      expect(result.status()).toBe(201);
      const card = await result.json();
      ids.push(card.id);
      return { card, input: result.request().postDataJSON() };
    };
    const equipped = await place(slot, { x: 230, y: 90 });
    expect(equipped.input.equipment.owner_id).toBe(ids[0]);
    expect(equipped.card.equipment.owner_id).toBe(ids[0]);
    await expect(page.locator(`[data-card-id="${equipped.card.id}"]`)).toHaveClass(/equipment-card/);
    const container = page.locator(`.react-flow__node[data-id="${ids[1]}"]`);
    await expect(container).toBeVisible();
    const contained = await place(container, { x: 190, y: 170 });
    expect(contained.input.parent_id).toBe(ids[1]);
    expect(contained.card.parent_id).toBe(ids[1]);
    await expect(page.locator(`[data-card-id="${contained.card.id}"]`)).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await request.get(`/api/nodes/${contained.card.id}`)).status()).toBe(404);
    await expect(page.getByText(`Place ${contained.card.name} undone`, { exact: true })).toBeVisible();
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => (await (await request.get(`/api/nodes/${contained.card.id}`)).json()).parent_id).toBe(ids[1]);
  } finally {
    for (const id of ids.reverse()) await request.delete(`/api/nodes/${id}`);
  }
});

test('preview cards defer editors and preserve unsaved text when collapsed', async ({ page, request }) => {
  const card = await (await request.post('/api/nodes', { data: {
    type: 'text', name: 'Deferred editor', position: { x: 500, y: 300 }, size: { width: 96, height: 96 },
  } })).json();
  try {
    await page.goto('/');
    const surface = page.locator(`[data-card-id="${card.id}"]`);
    await expect(surface).toBeVisible();
    await expect(surface.locator('.node-inspector-content > *')).toHaveCount(0);
    await surface.click({ position: { x: 100, y: 150 } });
    const editor = surface.getByRole('textbox', { name: 'Contents', exact: true });
    await expect(editor).toBeEnabled();
    await editor.fill('Keep this unsaved draft');
    await surface.getByRole('button', { name: 'Close Deferred editor inspector', exact: true }).click();
    await expect(surface).toHaveAttribute('data-surface-level', 'preview');
    await surface.click({ position: { x: 100, y: 150 } });
    await expect(editor).toHaveValue('Keep this unsaved draft');
  } finally { await request.delete(`/api/nodes/${card.id}`); }
});
