import { expect, test } from '@playwright/test';

for (const width of [1280, 800]) test(`model setup guide follows settings controls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/application', async route => {
    const response = await route.fetch();
    const profile = await response.json();
    await route.fulfill({ json: { ...profile, values: { ...profile.values, 'oaw.locale': 'en',
      'oaw-onboarding-v1': JSON.stringify({ version: 1, state: { status: 'started', session: {
        id: 'model-guide-test', step: 'model-settings', refs: {}, demos: [], initialIds: [],
      } } }),
    } } });
  });
  // Exercise the real settings form without storing credentials or calling a provider.
  let failSave = true;
  await page.route('**/api/settings/models', async route => {
    if (route.request().method() === 'PUT') {
      if (failSave) return route.fulfill({ status: 500, json: { detail: 'Test save failed' } });
      const draft = route.request().postDataJSON();
      return route.fulfill({ json: { ...draft, revision: 1 } });
    }
    await route.fulfill({ json: { revision: 1, default_model: null, connections: [] } });
  });
  await page.goto('/');
  const guide = page.getByRole('region', { name: 'Tutorial guide' });
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  const target = (name: string) => page.locator(`[data-tutorial="${name}"]`);
  const check = async (step: string, name: string) => {
    await expect(guide).toHaveAttribute('data-step', step);
    await expect(target(name)).toHaveAttribute('data-tutorial-highlight', 'true');
    await expect.poll(async () => {
      const bubble = (await guide.boundingBox())!;
      const control = (await target(name).boundingBox())!;
      return bubble.x >= 0 && bubble.y >= 0 && bubble.x + bubble.width <= width && bubble.y + bubble.height <= 800
        && (bubble.x + bubble.width <= control.x || bubble.x >= control.x + control.width
          || bubble.y + bubble.height <= control.y || bubble.y >= control.y + control.height);
    }).toBe(true);
  };
  await check('model-settings', 'settings');
  await page.screenshot({ path: `test-results/model-guide-settings-${width}.png` });
  await target('settings').click();
  await check('model-connection', 'model-connection');
  await expect(page.getByRole('button', { name: 'Use this connection', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await check('model-credentials', 'model-credentials');
  await page.screenshot({ path: `test-results/model-guide-key-${width}.png` });
  await page.getByLabel('API key', { exact: true }).fill('test-only-placeholder');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await check('model-credentials', 'settings');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await target('settings').click();
  // Reopening discards the unsaved draft; the guide points back to Add connection.
  await check('model-credentials', 'model-connection');
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await page.getByLabel('API key', { exact: true }).fill('test-only-placeholder');
  await page.getByLabel(/^Base URL/).fill('https://example.test/v1');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await check('model-list', 'model-list');
  await page.getByRole('button', { name: 'Add model', exact: true }).click();
  await expect(target('model-list').getByLabel('Model 1 display name', { exact: true })).toBeVisible();
  await expect(target('model-list').getByLabel('Model 1 ID', { exact: true })).toBeVisible();
  await expect(target('model-list').getByLabel('Model 1 ID', { exact: true })).toBeInViewport();
  await page.screenshot({ path: `test-results/model-guide-inputs-${width}.png` });
  await page.getByLabel('Model 1 display name', { exact: true }).fill('Test model');
  await page.getByLabel('Model 1 ID', { exact: true }).fill('test-model');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await check('model-save', 'model-save');
  await target('model-save').click();
  await expect(page.getByRole('alert')).toContainText('Test save failed');
  await expect(guide).toHaveAttribute('data-step', 'model-save');
  failSave = false;
  await target('model-save').click();
  await expect(guide).toHaveAttribute('data-step', 'configure');
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
});
