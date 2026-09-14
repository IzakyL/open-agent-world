import { expect, test } from "@playwright/test";
import { TEST_CATALOG } from "../src/state/catalog.fixture";

test("shared sandbox admits a command and cancels only the selected peer", async ({ page }, testInfo) => {
  const card = { id: "shared-lab", type: "sandbox", name: "Shared lab", position: { x: 550, y: 340 },
    size: { width: 96, height: 96 }, expanded: false, status: "running", config: { runtime: "auto" } };
  let receipts = ["a", "b"].map(id => ({ id, caller: `Agent ${id.toUpperCase()}`, state: "running", argv: ["sh", "-c", `edit ${id}.txt`], stdout: `${id} progress` }));
  let executions = 0;
  const cancelled: string[] = [];
  await page.routeWebSocket("**/ws/events", () => {});
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const reply = (json: unknown) => route.fulfill({ json });
    if (path === "/api/catalog") return reply(TEST_CATALOG);
    if (path === "/api/world") return reply({ nodes: [card], edges: [], chunks: ["0:0"] });
    if (path === "/api/legions") return reply([]);
    if (path === "/api/sandbox/runtimes") return reply({ default_runtime: "wsl:Ubuntu", runtimes: [] });
    if (path.endsWith("/document")) return reply({ value: { variables: {} }, revision: 0, summary: {} });
    if (path.endsWith("/credentials")) return reply({});
    if (path.endsWith("/configuration")) return reply({ ready: true, variables: [] });
    if (path.endsWith("/history")) return reply(receipts);
    if (path.endsWith("/files")) return reply([]);
    if (path.endsWith("/cancel")) {
      const id = url.searchParams.get("command_id")!;
      cancelled.push(id);
      receipts = receipts.map(r => r.id === id ? { ...r, state: "cancelled" } : r);
      return reply({ id, state: "cancelled" });
    }
    if (path.endsWith("/execute")) { executions++; return reply({ command_id: "manual", stdout: "independent result", exit_code: 0 }); }
    if (path === `/api/sandboxes/${card.id}`) return reply({ sandbox_id: card.id, state: "running", runtime_id: "wsl:Ubuntu",
      platform: "linux", shell: ["/bin/sh", "-c"], available: true, workspace: "/workspace", workspace_access: "read_write", security_boundary: "Linux namespaces" });
    return route.continue();
  });
  await page.goto("/");
  const panel = page.locator(`[data-card-id="${card.id}"]`);
  await panel.locator(".card-kind-icon").click();
  await panel.getByRole("button", { name: "Open Window", exact: true }).click();
  const window = page.getByRole("dialog", { name: "Shared lab workspace" });
  const command = window.getByRole("textbox", { name: "Command", exact: true });
  await expect(command).toBeEditable();
  await command.fill("echo independent");
  await command.press("Enter");
  await expect.poll(() => executions).toBe(1);
  await window.getByRole("tab", { name: "History", exact: true }).click();
  const a = window.locator(".sandbox-history article").filter({ hasText: "Agent A" });
  const b = window.locator(".sandbox-history article").filter({ hasText: "Agent B" });
  await expect(a).toContainText("running");
  await b.getByRole("button", { name: "Cancel command", exact: true }).click();
  await expect(b).toContainText("cancelled");
  await expect(a).toContainText("running");
  expect(cancelled).toEqual(["b"]);
  await page.screenshot({ path: testInfo.outputPath("shared-sandbox.png") });
});
