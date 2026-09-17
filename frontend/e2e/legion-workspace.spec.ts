import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function setup(request: APIRequestContext) {
  const profile = await (await request.get('/api/application')).json();
  expect((await request.patch('/api/application/preferences', { data: { profile_id: profile.profile_id, generation: profile.generation, changes: {
    'oaw-onboarding-v1': JSON.stringify({ version: 1, state: { status: 'skipped' } }), 'oaw.locale': 'en',
    'oaw-canvas-viewport-v1': null, 'oaw-node-surfaces-v1': null, 'oaw-theme': 'light',
  } } })).ok()).toBe(true);
  const cards = [];
  for (const [type, name] of [['text', 'Project notes'], ['conversation', 'Conversation'], ['sandbox', 'Sandbox'], ['agent', 'Assistant']]) {
    const response = await request.post('/api/nodes', { data: { type, name, position: { x: 300 + cards.length * 350, y: 300 } } });
    expect(response.status()).toBe(201);
    cards.push(await response.json());
  }
  const response = await request.post('/api/legion-groups', { data: { name: 'Project studio', node_ids: cards.map(card => card.id) } });
  expect(response.ok()).toBe(true);
  return { cards, group: (await response.json())[0] };
}

async function openWorkspace(page: Page, id: string) {
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  await page.locator(`[data-card-id="${id}"]`).getByRole('button', { name: 'Workspace mode', exact: true }).click();
  return page.getByRole('dialog', { name: 'Project studio workspace mode' });
}

test.afterEach(async ({ request }) => {
  const nodes = await (await request.get('/api/nodes')).json();
  if (nodes.length) expect((await request.post('/api/nodes/batch-delete', { data: { node_ids: nodes.map((node: { id: string }) => node.id) } })).ok()).toBe(true);
  for (const template of await (await request.get('/api/legions')).json()) await request.delete(`/api/legions/${template.id}`);
});

test('bottom bar opens unplaced cards and retains drafts through collapse and layout placement', async ({ page, request }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const { cards, group } = await setup(request);
  const [notes, conversation] = cards;
  const layout = { version: 1, root: { kind: 'pane', card_id: conversation.id } };
  expect((await request.patch(`/api/nodes/${group.id}`, { data: { config: { workspace_layout: layout } } })).ok()).toBe(true);
  await page.goto('/');
  const window = await openWorkspace(page, group.id);
  const bar = window.getByRole('navigation', { name: 'Unplaced workspace cards' });
  const icon = bar.getByRole('button', { name: 'Project notes', exact: true });
  const drawer = window.getByRole('region', { name: 'Unplaced card details', exact: true });
  await expect(bar.getByRole('button')).toHaveCount(3);
  await expect(bar.getByRole('button', { name: 'Conversation', exact: true })).toHaveCount(0);
  await icon.click();
  await drawer.getByRole('textbox', { name: 'Contents', exact: true }).fill('Bottom bar draft');
  await icon.click();
  await expect(drawer).toHaveCount(0);
  await icon.click();
  await expect(drawer.getByRole('textbox', { name: 'Contents', exact: true })).toHaveValue('Bottom bar draft');
  await bar.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(drawer.getByRole('region', { name: 'Assistant', exact: true })).toBeVisible();
  await icon.click();
  await expect(drawer.getByRole('textbox', { name: 'Contents', exact: true })).toHaveValue('Bottom bar draft');
  await page.screenshot({ path: 'test-results/legion-bottom-bar-light.png' });
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(window).toBeVisible();
  expect((await (await request.get(`/api/nodes/${group.id}`)).json()).config.workspace_layout).toEqual(layout);
  await window.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await icon.dragTo(window.locator('.legion-pane-titlebar').first());
  await expect(icon).toHaveCount(0);
  await window.getByRole('button', { name: 'Done editing', exact: true }).click();
  await expect(window.getByRole('tabpanel', { name: 'Project notes', exact: true }).getByRole('textbox', { name: 'Contents', exact: true })).toHaveValue('Bottom bar draft');
  await window.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await window.getByRole('button', { name: 'Remove Project notes from layout', exact: true }).click();
  await window.getByRole('button', { name: 'Done editing', exact: true }).click();
  await icon.click();
  await expect(drawer.getByRole('textbox', { name: 'Contents', exact: true })).toHaveValue('Bottom bar draft');
  await drawer.getByRole('button', { name: 'Save text', exact: true }).click();
  await expect(drawer.getByRole('button', { name: 'Save text', exact: true })).toBeDisabled();
  await window.getByRole('button', { name: 'Back to canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await openWorkspace(page, group.id);
  await icon.click();
  await page.screenshot({ path: 'test-results/legion-bottom-bar-dark.png' });
  expect((await request.patch(`/api/nodes/${notes.id}`, { data: { parent_id: null } })).ok()).toBe(true);
  await expect(icon).toHaveCount(0);
  await expect(drawer).toHaveCount(0);
});

test('drag, tile, resize, preview live cards and preserve a reusable window layout', async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { cards, group } = await setup(request);
  const [notes, conversation, sandbox, agent] = cards;
  const positions = cards.map(card => card.position);
  await page.goto('/');
  const window = await openWorkspace(page, group.id);
  const source = (id: string) => window.locator(`[data-workspace-source="${id}"]`);
  const pane = (id: string) => window.locator(`[data-workspace-pane="${id}"]`);
  await source(notes.id).dragTo(window.locator('.legion-layout-empty'));
  await expect(pane(notes.id)).toBeVisible();
  const bounds = await pane(notes.id).boundingBox();
  await source(conversation.id).dragTo(pane(notes.id), { targetPosition: { x: bounds!.width - 8, y: bounds!.height / 2 } });
  await expect(window.locator('[data-workspace-pane]')).toHaveCount(2);
  await source(sandbox.id).click();
  await window.getByRole('button', { name: 'Dock below: Conversation', exact: true }).hover();
  await expect(window.locator('[data-dock-preview="bottom"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/legion-workspace-dock-preview.png' });
  await window.getByRole('button', { name: 'Dock below: Conversation', exact: true }).click();
  await expect(window.locator('[data-workspace-pane]')).toHaveCount(3);
  await expect(source(agent.id)).toBeVisible();
  await expect(pane(agent.id)).toHaveCount(0);
  const divider = window.getByRole('separator', { name: 'Resize workspace regions' }).first();
  const dividerBounds = await divider.boundingBox();
  await page.mouse.move(dividerBounds!.x + 2, dividerBounds!.y + 80);
  await page.mouse.down(); await page.mouse.move(dividerBounds!.x - 100, dividerBounds!.y + 80, { steps: 10 }); await page.mouse.up();
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(50);
  await divider.focus(); await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: 'test-results/legion-workspace-edit-light.png' });
  // Every rectangle shares its boundaries; no card border radii or freeform gaps.
  const [left, upper, lower] = await Promise.all([pane(notes.id).boundingBox(), pane(conversation.id).boundingBox(), pane(sandbox.id).boundingBox()]);
  expect(upper!.x - left!.x - left!.width).toBeCloseTo(5, 0);
  expect(lower!.y - upper!.y - upper!.height).toBeCloseTo(5, 0);
  expect(upper!.width).toBeCloseTo(lower!.width, 0);
  expect(await pane(notes.id).evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
  await window.getByRole('button', { name: 'Done editing', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Save layout', exact: true })).toHaveCount(0);
  await pane(notes.id).getByRole('textbox', { name: 'Contents', exact: true }).fill('A real document draft, retained while editing the layout.');
  await window.getByRole('button', { name: 'Edit layout', exact: true }).click();
  // Move a live pane to another branch without resetting its document draft.
  await source(notes.id).click();
  await window.getByRole('button', { name: 'Dock left: Sandbox', exact: true }).click();
  await window.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(pane(notes.id).getByRole('textbox', { name: 'Contents', exact: true })).toHaveValue('A real document draft, retained while editing the layout.');
  await pane(notes.id).getByRole('button', { name: 'Save text', exact: true }).click();
  await expect(pane(notes.id).getByRole('button', { name: 'Save text', exact: true })).toBeDisabled();
  await expect(pane(conversation.id).getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
  await expect(pane(sandbox.id).getByRole('tab', { name: 'Workspace', exact: true })).toBeVisible();
  await expect(window.getByText('Layout saved', { exact: true })).toBeVisible();
  const saved = (await (await request.get(`/api/nodes/${group.id}`)).json()).config.workspace_layout;
  await page.screenshot({ path: 'test-results/legion-workspace-preview-light.png' });
  await window.getByRole('button', { name: 'Back to canvas', exact: true }).click();
  await expect(window).toHaveCount(0);
  const actualPositions = await Promise.all(cards.map(async card => (await (await request.get(`/api/nodes/${card.id}`)).json()).position));
  expect(actualPositions).toEqual(positions);
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await openWorkspace(page, group.id);
  await page.screenshot({ path: 'test-results/legion-workspace-preview-dark.png' });
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(window.getByRole('button', { name: 'Back to canvas', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/legion-workspace-small.png' });
  await page.reload();
  await openWorkspace(page, group.id);
  await expect(window.locator('[data-workspace-pane]')).toHaveCount(3);
  expect((await (await request.get(`/api/nodes/${group.id}`)).json()).config.workspace_layout).toEqual(saved);
  await window.getByRole('button', { name: 'Back to canvas', exact: true }).click();
  const captured = page.waitForResponse(response => response.url().endsWith('/api/legions') && response.request().method() === 'POST');
  await page.locator(`[data-card-id="${group.id}"]`).getByRole('button', { name: 'Save to library', exact: true }).click();
  const template = await (await captured).json();
  // Deploy independently after deleting the source; only the saved blueprint
  // should supply the layout and document, with no original IDs remaining.
  expect((await request.post('/api/nodes/batch-delete', { data: { node_ids: [group.id, ...cards.map(card => card.id)] } })).ok()).toBe(true);
  await expect(page.locator(`[data-card-id="${group.id}"]`)).toHaveCount(0);
  const deployed = page.waitForResponse(response => response.url().includes(`/api/legions/${template.id}/instances`) && response.request().method() === 'POST');
  await page.getByRole('tab', { name: /Legions/ }).click();
  await page.getByRole('button', { name: 'Place Project studio', exact: true }).click();
  const instanceResponse = await deployed;
  expect(instanceResponse.status()).toBe(201);
  const instance = await instanceResponse.json();
  const copy = instance.nodes.find((node: { type: string }) => node.type === 'legion');
  expect(JSON.stringify(copy.config.workspace_layout)).not.toContain(notes.id);
  await openWorkspace(page, copy.id);
  for (const original of [notes, conversation, sandbox]) {
    const node = instance.nodes.find((node: { name: string }) => node.name === original.name);
    await expect(window.locator(`[data-workspace-pane="${node.id}"]`)).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('compact live workspace resizes and saves ratios without allowing rearrangement', async ({ page, request }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const { cards, group } = await setup(request);
  const originalRoot = { kind: 'split', axis: 'horizontal', ratio: .5,
    first: { kind: 'pane', card_id: cards[0].id }, second: { kind: 'pane', card_id: cards[1].id } };
  expect((await request.patch(`/api/nodes/${group.id}`, { data: { config: { workspace_layout: { version: 1, root: originalRoot } } } })).ok()).toBe(true);
  await page.goto('/');
  const window = await openWorkspace(page, group.id);
  const box = await window.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(1390);
  expect(box!.height).toBeGreaterThanOrEqual(890);
  expect((await window.locator('.legion-window-titlebar').boundingBox())!.height).toBeLessThanOrEqual(40);
  expect((await window.locator('.legion-pane-titlebar').first().boundingBox())!.height).toBeLessThanOrEqual(28);
  await expect(window.getByText('LEGION WORKSPACE', { exact: true })).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Save layout', exact: true })).toHaveCount(0);
  await expect(window.locator('.legion-pane-titlebar[draggable="true"]')).toHaveCount(0);
  await expect(window.locator('.legion-workspace-tab[draggable="true"]')).toHaveCount(0);
  await expect(window.locator('[data-dock-side]')).toHaveCount(0);
  let saves = 0;
  page.on('request', request => { if (request.method() === 'PATCH' && request.url().endsWith(`/api/nodes/${group.id}`)) saves++; });
  const divider = window.getByRole('separator', { name: 'Resize workspace regions' });
  const bounds = await divider.boundingBox();
  await page.mouse.move(bounds!.x + 2, bounds!.y + 60);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 100, bounds!.y + 60, { steps: 10 });
  expect(saves).toBe(0);
  await page.mouse.up();
  await expect(window.getByText('Layout saved', { exact: true })).toBeVisible();
  expect(saves).toBe(1);
  const saved = (await (await request.get(`/api/nodes/${group.id}`)).json()).config.workspace_layout;
  expect(saved.root.ratio).toBeGreaterThan(.55);
  expect({ ...saved.root, ratio: .5 }).toEqual(originalRoot);
  // Native pointer cancellation restores the previous size without a write.
  const prior = await divider.getAttribute('aria-valuenow');
  const currentBounds = await divider.boundingBox();
  await page.mouse.move(currentBounds!.x + 2, currentBounds!.y + 60);
  await page.mouse.down();
  await page.mouse.move(currentBounds!.x + 50, currentBounds!.y + 60, { steps: 5 });
  await divider.dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  expect(saves).toBe(1);
  await page.reload();
  await openWorkspace(page, group.id);
  await expect(divider).toHaveAttribute('aria-valuenow', prior!);
  // Failed automatic saves remain recoverable without exposing an ordinary Save button.
  await page.route(`**/api/nodes/${group.id}`, route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Unavailable"}' }) : route.continue());
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(window.getByRole('alert')).toContainText('Your draft is still here');
  await expect(window.getByRole('button', { name: 'Save layout', exact: true })).toHaveCount(0);
  await page.unroute(`**/api/nodes/${group.id}`);
  await window.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(window.getByRole('alert')).toHaveCount(0);
  await expect(window.getByText('Layout saved', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/legion-workspace-compact-live.png' });
});

test('failed saves keep the draft; close can discard; detached panes collapse', async ({ page, request }) => {
  const { cards, group } = await setup(request);
  await page.goto('/');
  const window = await openWorkspace(page, group.id);
  await window.locator(`[data-workspace-source="${cards[0].id}"]`).click();
  await window.getByRole('button', { name: 'Place selected card', exact: true }).click();
  await page.route(`**/api/nodes/${group.id}`, route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Layout save unavailable' }) }) : route.continue());
  await window.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(window.getByRole('alert')).toContainText('Your draft is still here');
  await expect(window.locator('[data-workspace-pane]')).toHaveCount(1);
  await page.unroute(`**/api/nodes/${group.id}`);
  await window.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(window.getByText('Layout saved', { exact: true })).toBeVisible();
  await window.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await window.getByRole('button', { name: 'Remove Project notes from layout', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(window.getByRole('button', { name: 'Discard layout and close', exact: true })).toBeVisible();
  await window.getByRole('button', { name: 'Discard layout and close', exact: true }).click();
  await openWorkspace(page, group.id);
  await expect(window.locator('[data-workspace-pane]')).toHaveCount(1);
  expect((await request.patch(`/api/nodes/${cards[0].id}`, { data: { parent_id: null } })).ok()).toBe(true);
  await expect(window.locator('[data-workspace-pane]')).toHaveCount(0);
  await expect(window.getByRole('heading', { name: 'Build your workspace' })).toBeVisible();
});

test('title strips group, reorder and split tabs while preserving live drafts and saved selection', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { cards, group } = await setup(request);
  const notes = cards[0];
  const response = await request.post('/api/nodes', { data: { type: 'text', name: 'Scratchpad', parent_id: group.id, position: { x: 600, y: 650 } } });
  expect(response.status()).toBe(201);
  const scratch = await response.json();
  await page.goto('/');
  const window = await openWorkspace(page, group.id);
  const source = (id: string) => window.locator(`[data-workspace-source="${id}"]`);
  const tabs = window.locator('.legion-pane-tabs');
  const panel = (name: string) => window.getByRole('tabpanel', { name, exact: true });
  await source(notes.id).click();
  await window.getByRole('button', { name: 'Place selected card' }).click();
  const header = window.locator('.legion-pane-titlebar');
  const bounds = await header.boundingBox();
  await source(scratch.id).dragTo(header, { targetPosition: { x: bounds!.width - 5, y: 12 } });
  await expect(window.locator('[data-workspace-pane]')).toHaveCount(1);
  await expect(tabs.getByRole('tab')).toHaveText(['Project notes', 'Scratchpad']);
  await window.getByRole('button', { name: 'Done editing' }).click();
  await expect(panel('Scratchpad')).toBeVisible();
  await panel('Scratchpad').getByRole('textbox', { name: 'Contents', exact: true }).fill('Scratch draft survives switching and moving.');
  await tabs.getByRole('tab', { name: 'Project notes', exact: true }).click();
  await expect(window.getByText('Layout saved', { exact: true })).toBeVisible();
  await expect(panel('Scratchpad')).toHaveCount(0);
  await panel('Project notes').getByRole('textbox', { name: 'Contents', exact: true }).fill('Project draft survives switching and moving.');
  await tabs.getByRole('tab', { name: 'Project notes', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(panel('Scratchpad').getByRole('textbox', { name: 'Contents', exact: true })).toHaveValue('Scratch draft survives switching and moving.');
  await expect(window.getByText('Layout saved', { exact: true })).toBeVisible();
  await window.getByRole('button', { name: 'Edit layout', exact: true }).click();
  // Reorder by dropping before a tab, then add a third card via the accessible button.
  await tabs.getByRole('tab', { name: 'Scratchpad', exact: true }).dragTo(tabs.getByRole('tab', { name: 'Project notes', exact: true }));
  await expect(tabs.getByRole('tab')).toHaveText(['Scratchpad', 'Project notes']);
  await source(cards[1].id).click();
  await window.getByRole('button', { name: 'Add selected card as tab', exact: true }).click();
  await expect(tabs.getByRole('tab')).toHaveText(['Scratchpad', 'Project notes', 'Conversation']);
  await page.screenshot({ path: 'test-results/legion-tabs-editor.png' });
  // An active tab can be split out of its own group by dropping on a content edge.
  const region = window.locator('[data-workspace-pane]');
  const regionBounds = await region.boundingBox();
  await tabs.getByRole('tab', { name: 'Conversation', exact: true }).dragTo(region,
    { targetPosition: { x: regionBounds!.width - 5, y: regionBounds!.height / 2 } });
  await expect(window.locator('[data-workspace-pane]')).toHaveCount(2);
  const rightHeader = window.locator(`[data-workspace-pane="${cards[1].id}"] .legion-pane-titlebar`);
  const rightBounds = await rightHeader.boundingBox();
  await tabs.getByRole('tab', { name: 'Project notes', exact: true }).dragTo(rightHeader,
    { targetPosition: { x: rightBounds!.width - 5, y: 12 } });
  await window.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(panel('Project notes').getByRole('textbox', { name: 'Contents', exact: true })).toHaveValue('Project draft survives switching and moving.');
  await expect(panel('Scratchpad').getByRole('textbox', { name: 'Contents', exact: true })).toHaveValue('Scratch draft survives switching and moving.');
  for (const name of ['Scratchpad', 'Project notes']) {
    await panel(name).getByRole('button', { name: 'Save text', exact: true }).click();
    await expect(panel(name).getByRole('button', { name: 'Save text', exact: true })).toBeDisabled();
  }
  const saved = (await (await request.get(`/api/nodes/${group.id}`)).json()).config.workspace_layout;
  expect(saved.root.second).toEqual({ kind: 'tabs', card_ids: [cards[1].id, notes.id], active_card_id: notes.id });
  await page.screenshot({ path: 'test-results/legion-tabs-live-light.png' });
  await window.getByRole('button', { name: 'Back to canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await page.reload();
  await openWorkspace(page, group.id);
  await expect(tabs.last().getByRole('tab', { name: 'Project notes', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel('Project notes').getByRole('textbox', { name: 'Contents', exact: true })).toHaveValue('Project draft survives switching and moving.');
  await page.screenshot({ path: 'test-results/legion-tabs-live-dark.png' });
  // Removing the active card collapses its tab group to the remaining page.
  expect((await request.patch(`/api/nodes/${notes.id}`, { data: { parent_id: null } })).ok()).toBe(true);
  await expect(tabs.getByRole('tab', { name: 'Project notes', exact: true })).toHaveCount(0);
  await expect(panel('Conversation')).toBeVisible();
  expect(errors).toEqual([]);
});
