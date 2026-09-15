import { expect, type Page } from '@playwright/test';

export async function prepareTutorialDeck(page: Page, verifyNarrow = false) {
  const initialLibrary = await (await page.request.get('/api/card-library')).json();
  const initialEntries = initialLibrary.decks.find((deck: { id: string }) => deck.id === 'starter')?.entries;
  await page.getByRole('button', { name: 'Open Library', exact: true }).click();
  await expect(page.locator('.tutorial-bubble')).toHaveAttribute('data-step', /starter-pack|starter-cards/);
  if (await page.locator('.tutorial-bubble').getAttribute('data-step') === 'starter-pack') await page.locator('.library-pack[data-tutorial-highlight] .pack-touch-area').click();
  await expect(page.locator('.tutorial-bubble')).toHaveAttribute('data-step', 'starter-cards');
  await page.locator('.library-pack[data-tutorial-highlight] .pack-touch-area').click();
  await expect(page.locator('.tutorial-bubble')).toHaveAttribute('data-step', 'deck-build');
  const useDeck = page.getByRole('button', { name: 'Use this deck', exact: true });
  // Choose a new destination explicitly, leaving the original hand untouched.
  const rail = page.getByRole('complementary', { name: 'Deck destinations' });
  await rail.getByRole('textbox', { name: 'New deck name' }).fill('My first workflow');
  await rail.getByRole('button', { name: 'Create deck', exact: true }).click();
  await expect(useDeck).toBeDisabled();
  const destination = rail.locator('.library-deck-destination.is-selected');
  await expect(destination).toBeVisible();
  const originalViewport = page.viewportSize()!;
  await expect(page.locator('.tutorial-deck-arrow-path')).toBeVisible();
  await expect(page.locator('.library-card[data-tutorial-highlight]')).toHaveCount(4);
  expect(await page.locator('.tutorial-guide').evaluate(element => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(
    await page.locator('.tutorial-spotlight-layer').evaluate(element => Number(getComputedStyle(element).zIndex)));
  await expect(page.locator('.tutorial-guide')).toHaveAttribute('data-moving', 'false');
  await page.screenshot({ path: `test-results/tutorial-deck-guidance-${originalViewport.width}.png` });
  if (verifyNarrow) await page.setViewportSize({ width: 720, height: 760 });
  for (const id of ['text', 'agent', 'conversation', 'sandbox']) {
    await page.locator(`[data-library-card="${id}"]`).scrollIntoViewIfNeeded();
    await expect(page.locator(`.tutorial-spotlight[data-spotlight-target="library-card-${id}"]`)).toBeVisible();
    if (id === 'text' && verifyNarrow) {
      await expect(page.locator('.tutorial-guide')).toHaveAttribute('data-moving', 'false');
      const cardBox = await page.locator('[data-library-card="text"]').boundingBox();
      const bubbleBox = await page.locator('.tutorial-bubble').boundingBox();
      expect(cardBox && bubbleBox && Math.max(0, Math.min(cardBox.x + cardBox.width, bubbleBox.x + bubbleBox.width) - Math.max(cardBox.x, bubbleBox.x))
        * Math.max(0, Math.min(cardBox.y + cardBox.height, bubbleBox.y + bubbleBox.height) - Math.max(cardBox.y, bubbleBox.y))).toBe(0);
      await page.screenshot({ path: 'test-results/tutorial-deck-guidance-720.png' });
    }
    await page.locator(`[data-library-card="${id}"]`).dragTo(destination.locator('.library-deck-destination-select'));
    await expect(destination.locator('li')).toHaveCount(['text', 'agent', 'conversation', 'sandbox'].indexOf(id) + 1);
    await expect(page.locator(`.library-card[data-tutorial-highlight]:has([data-library-card="${id}"])`)).toHaveCount(0);
  }
  const savedLibrary = await (await page.request.get('/api/card-library')).json();
  expect(savedLibrary.decks.find((deck: { id: string }) => deck.id === 'starter')?.entries).toEqual(initialEntries);
  await expect(useDeck).toBeEnabled();
  await expect(page.locator('.tutorial-deck-arrow-path')).not.toBeVisible();
  await page.screenshot({ path: `test-results/tutorial-decks-${page.viewportSize()?.width}.png` });
  if (verifyNarrow) { await page.setViewportSize(originalViewport); await page.screenshot({ path: `test-results/tutorial-decks-${originalViewport.width}.png` }); }
  await useDeck.click();
  await expect(page.locator('.card-library-modal')).not.toBeVisible();
  await expect(page.locator('.tutorial-bubble')).toHaveAttribute('data-step', 'place-demo');
}
