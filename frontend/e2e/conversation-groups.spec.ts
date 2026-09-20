import { expect, test } from '@playwright/test';

test('creates groups inline with an adjacent agent picker and a single-agent default', async ({ page, request }) => {
  await page.setViewportSize({ width: 1800, height: 1100 });
  const room = await (await request.post('/api/nodes', { data: { type: 'conversation', name: 'Group creation QA', position: { x: 800, y: 450 } } })).json();
  const agent = await (await request.post('/api/nodes', { data: { type: 'agent', name: 'Research Agent', position: { x: 200, y: 300 } } })).json();
  try {
    expect((await request.post('/api/edges', { data: { source: agent.id, target: room.id, relationship: 'participate' } })).ok()).toBeTruthy();
    await page.goto('/');
    const workspace = page.locator(`[data-workspace-node-id="${room.id}"]`);
    await expect(workspace.getByText('1 active participants')).toBeVisible();
    await workspace.getByRole('button', { name: 'New group', exact: true }).click();
    const name = workspace.getByRole('textbox', { name: 'Group name' });
    const picker = workspace.getByRole('group', { name: 'Participants', exact: true });
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('New group');
    await expect(picker.getByRole('checkbox', { name: 'Research Agent' })).toBeChecked();
    await expect(workspace.getByText('Create session', { exact: true })).toHaveCount(0);
    const row = await workspace.locator('.conversation-group-draft').boundingBox();
    const popup = await picker.boundingBox();
    expect(row!.height).toBeLessThan(45);
    expect(popup!.x).toBeGreaterThanOrEqual(row!.x + row!.width);
    expect(Math.abs(popup!.y - row!.y)).toBeLessThan(2);
    const header = (await workspace.locator('.workspace-titlebar').boundingBox())!;
    await page.mouse.move(header.x + header.width / 2, header.y + 20);
    await page.mouse.down();
    for (const distance of [40, 80, 120]) {
      await page.mouse.move(header.x + header.width / 2 + distance, header.y + 20 + distance / 2, { steps: 4 });
      const movedRow = (await workspace.locator('.conversation-group-draft').boundingBox())!;
      const movedPicker = (await picker.boundingBox())!;
      expect(movedRow.x - row!.x).toBeGreaterThan(distance / 2);
      expect(Math.abs((movedPicker.x - movedRow.x) - (popup!.x - row!.x))).toBeLessThan(2);
      expect(Math.abs(movedPicker.y - movedRow.y)).toBeLessThan(2);
    }
    await page.mouse.up();
    // Canvas panning must move the popup and its owning row together, too.
    const beforePan = (await workspace.locator('.conversation-group-draft').boundingBox())!;
    await page.mouse.move(1550, 950);
    await page.mouse.down();
    await page.mouse.move(1470, 900, { steps: 8 });
    await page.mouse.up();
    const pannedRow = (await workspace.locator('.conversation-group-draft').boundingBox())!;
    const pannedPicker = (await picker.boundingBox())!;
    expect(Math.abs(pannedRow.x - beforePan.x)).toBeGreaterThan(40);
    expect(Math.abs((pannedPicker.x - pannedRow.x) - (popup!.x - row!.x))).toBeLessThan(2);
    expect(Math.abs(pannedPicker.y - pannedRow.y)).toBeLessThan(2);
    await picker.getByRole('checkbox').uncheck();
    await expect(workspace.getByRole('button', { name: 'Create group', exact: true })).toBeDisabled();
    await picker.getByRole('checkbox').check();
    await name.fill('Research group');
    await page.screenshot({ path: '../.outputs/conversation-group-inline.png' });
    await name.press('Enter');
    await expect(name).toHaveCount(0);
    await expect(workspace.getByRole('button', { name: 'Research group', exact: true })).toBeVisible();
    const summary = await (await request.get(`/api/conversations/${room.id}`)).json();
    expect(summary.sessions.find((item: { group_title: string }) => item.group_title === 'Research group').participant_ids).toEqual([agent.id]);
    await workspace.getByRole('button', { name: 'New group', exact: true }).click();
    await name.press('Escape');
    await expect(name).toHaveCount(0);
    await expect(workspace.getByRole('button', { name: 'New group', exact: true })).toBeFocused();
  } finally {
    await request.delete(`/api/nodes/${room.id}`);
    await request.delete(`/api/nodes/${agent.id}`);
  }
});
