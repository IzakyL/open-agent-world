import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('profile deck placement and sustained canvas dragging', async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    const w = window as any;
    w.renderCounts = {};
    let previous = new Set<any>();
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(),
      inject(renderer: any) { this.renderers.set(1, renderer); return 1; }, onCommitFiberUnmount() {},
      onCommitFiberRoot(_id: number, root: any) {
        const current = new Set<any>();
        const visit = (fiber: any) => {
          if (!fiber) return;
          current.add(fiber);
          const name = fiber.type?.displayName ?? fiber.type?.name;
          if (!previous.has(fiber) && name && (fiber.flags & 1)) w.renderCounts[name] = (w.renderCounts[name] ?? 0) + 1;
          visit(fiber.child); visit(fiber.sibling);
        };
        visit(root.current);
        previous = current;
      },
    };
  });
  const ids: string[] = [];
  try {
    let library = await (await request.get('/api/card-library')).json();
    for (const id of library.available_pack_ids) {
      library = await (await request.post('/api/card-library/actions', { data: {
        action: 'open_pack', id, expected_revision: library.revision,
      } })).json();
    }
    for (let i = 0; i < 30; i++) {
      const response = await request.post('/api/nodes', { data: {
        type: i % 5 === 0 ? 'agent' : 'text', name: `Performance ${i}`,
        position: { x: 300 + i % 6 * 300, y: 260 + Math.floor(i / 6) * 350 },
      } });
      expect(response.ok()).toBe(true);
      ids.push((await response.json()).id);
    }
    await page.goto('/');
    const card = page.locator(`[data-card-id="${ids[1]}"]`).first();
    await expect(card).toBeVisible();
    await page.waitForTimeout(1000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const measure = async (action: () => Promise<void>) => {
      const before = await cdp.send('Performance.getMetrics');
      await page.evaluate(() => {
        const w = window as any;
        w.renderCounts = {}; w.frameGaps = []; w.measureFrames = true;
        let previous = performance.now();
        const tick = (now: number) => {
          w.frameGaps.push(now - previous); previous = now;
          if (w.measureFrames) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await action();
      const samples = await page.evaluate(() => {
        const w = window as any; w.measureFrames = false;
        const gaps = w.frameGaps.slice(1).sort((a: number, b: number) => a - b);
        return { frames: gaps.length, p95: gaps[Math.floor(gaps.length * .95)], max: gaps.at(-1),
          over34ms: gaps.filter((v: number) => v > 34).length, renders: w.renderCounts };
      });
      const after = await cdp.send('Performance.getMetrics');
      return { ...samples, metrics: Object.fromEntries(after.metrics
        .filter(m => /Duration|LayoutCount|RecalcStyleCount/.test(m.name))
        .map(m => [m.name, m.value - (before.metrics.find(b => b.name === m.name)?.value ?? 0)])) };
    };
    const box = (await card.boundingBox())!;
    const drag = await measure(async () => {
      await page.mouse.move(box.x + 25, box.y + 25);
      await page.mouse.down();
      for (let i = 1; i <= 60; i++) {
        await page.mouse.move(box.x + 25 + i * 3, box.y + 25 + Math.sin(i / 12) * 50);
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
      await page.waitForTimeout(300);
    });
    await expect.poll(async () => (await card.boundingBox())!.x - box.x).toBeGreaterThan(100);
    const tray = page.getByRole('complementary', { name: 'Active card deck' });
    library = await (await request.get('/api/card-library')).json();
    const edited = await request.post('/api/card-library/actions', { data: {
      action: 'update_deck', id: library.active_deck_id, entries: [{ kind: 'node', id: 'text' }], expected_revision: library.revision,
    } });
    expect(edited.ok()).toBe(true);
    await page.reload();
    await expect(card).toBeVisible();
    await tray.hover();
    const source = tray.locator('[data-palette-card="text"]');
    await expect(source).toBeVisible();
    const placement = await measure(async () => {
      const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/card-library/nodes') && response.request().method() === 'POST');
      await source.dragTo(page.locator('#oaw-world-map .react-flow__pane'), { targetPosition: { x: 1100, y: 260 } });
      const created = await (await createdResponse).json();
      ids.push(created.id);
      await expect(page.locator(`[data-card-id="${created.id}"]`).first()).toBeVisible();
      await page.waitForTimeout(400);
    });
    await page.screenshot({ path: '../.outputs/canvas-performance.png' });
    const report = { drag, placement };
    console.log('CANVAS_PERFORMANCE', JSON.stringify(report));
    if (process.env.OAW_PERF_REPORT) await writeFile(process.env.OAW_PERF_REPORT, JSON.stringify(report, null, 2));
  } finally {
    for (const id of ids) await request.delete(`/api/nodes/${id}`);
  }
});
