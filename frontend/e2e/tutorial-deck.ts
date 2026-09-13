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
  await expect(useDeck).toBeDisabled();
  // Choose a new destination explicitly, leaving the original hand untouched.
  const rail = page.getByRole('complementary', { name: 'Deck destinations' });
  await rail.getByRole('textbox', { name: 'New deck name' }).fill('My first workflow');
  await rail.getByRole('button', { name: 'Create deck', exact: true }).click();
  const destination = rail.locator('.library-deck-destination.is-selected');
  await expect(destination).toBeVisible();
  const originalViewport = page.viewportSize()!;
  if (verifyNarrow) await page.setViewportSize({ width: 720, height: 760 });
  for (const id of ['text', 'agent', 'conversation', 'sandbox']) {
    await page.locator(`[data-library-card="${id}"]`).dragTo(destination.locator('.library-deck-destination-select'));
    await expect(destination.locator('li')).toHaveCount(['text', 'agent', 'conversation', 'sandbox'].indexOf(id) + 1);
  }
  const savedLibrary = await (await page.request.get('/api/card-library')).json();
  expect(savedLibrary.decks.find((deck: { id: string }) => deck.id === 'starter')?.entries).toEqual(initialEntries);
  await expect(useDeck).toBeEnabled();
  await page.screenshot({ path: `test-results/tutorial-decks-${page.viewportSize()?.width}.png` });
  if (verifyNarrow) { await page.setViewportSize(originalViewport); await page.screenshot({ path: `test-results/tutorial-decks-${originalViewport.width}.png` }); }
  await useDeck.click();
  await expect(page.locator('.card-library-modal')).not.toBeVisible();
  await expect(page.locator('.tutorial-bubble')).toHaveAttribute('data-step', 'place-demo');
}
