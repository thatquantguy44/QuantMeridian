// InventoryBallast 0018 T-029 / NFR-005 / AC-014 / AC-032: the IBAL demo path at the three
// presentation viewports. Every step of the header presenter and of the guided showcase (all three
// books) must render with no horizontal overflow, no overlapping controls, keyboard reach to every
// control on the path, and zero console errors. Local only (CI runs the smoke specs): start the IBAL
// service on the pinned engine and the built terminal, then
//   BASE_URL=http://127.0.0.1:3000 npx playwright test test/ibal-demo-path.spec.ts --retries=0
import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const STEPS = ["base", "shock", "diagnose", "repair", "compare"];

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  return errors;
}

/** Controls of one demo region: buttons, links, selects and inputs that are rendered and visible. */
const CONTROLS = "button, a[href], select, input, textarea, [tabindex]:not([tabindex='-1'])";

/** No horizontal scroll on the page or any scrolling ancestor of the region (the app shell scrolls in
 * its own container, not the document), no control past the right edge, and no two controls
 * overlapping. Every problem is reported at once. */
async function audit(page: Page, region: string, label: string) {
  const problems = await page.evaluate(({ region, controls }) => {
    const root = document.querySelector(region);
    if (!root) return [`${region} is not rendered`];
    const found: string[] = [];
    const width = document.documentElement.clientWidth;
    for (let el: Element | null = root; el; el = el.parentElement) {
      const scrolls = el === document.documentElement || getComputedStyle(el).overflowX !== "visible";
      const extra = el.scrollWidth - el.clientWidth;
      if (scrolls && extra > 1) found.push(`horizontal scroll of ${extra}px on <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 40)}">`);
    }
    const name = (el: Element) =>
      (el.getAttribute("aria-label") || el.getAttribute("data-testid") || el.textContent || el.tagName).trim().slice(0, 40);
    const items = [...root.querySelectorAll(controls)]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((el) => ({ el, rect: el.getBoundingClientRect() }));
    for (const { el, rect } of items) {
      if (rect.left < -1 || rect.right > width + 1) found.push(`past the viewport edge: ${name(el)}`);
    }
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i], b = items[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (x > 1 && y > 1) found.push(`overlap: ${name(a.el)} × ${name(b.el)}`);
      }
    }
    return found;
  }, { region, controls: CONTROLS });
  expect(problems, `${label}: layout problems`).toEqual([]);
}

/** Tab from the top of the page and report which controls of the region never receive focus. */
async function unreachableByTab(page: Page, region: string, limit = 600): Promise<string[]> {
  const total = await page.evaluate(({ region, controls }) => {
    const items = [...(document.querySelector(region)?.querySelectorAll(controls) ?? [])]
      .filter((el) => !(el as HTMLButtonElement).disabled && el.getBoundingClientRect().width > 0);
    items.forEach((el, index) => el.setAttribute("data-kb-probe", String(index)));
    return items.length;
  }, { region, controls: CONTROLS });
  expect(total, `${region} has controls to reach`).toBeGreaterThan(0);
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  const reached = new Set<string>();
  for (let press = 0; press < limit && reached.size < total; press += 1) {
    await page.keyboard.press("Tab");
    const probe = await page.evaluate(() => document.activeElement?.closest("[data-kb-probe]")?.getAttribute("data-kb-probe") ?? null);
    if (probe !== null) reached.add(probe);
  }
  return page.evaluate((seen) => [...document.querySelectorAll("[data-kb-probe]")]
    .filter((el) => !seen.includes(el.getAttribute("data-kb-probe")!))
    .map((el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40)), [...reached]);
}

async function openWorkbench(page: Page) {
  await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status", { name: "Optimizer engine status" }).getByText("PIN VERIFIED")).toBeVisible({ timeout: 15_000 });
}

for (const viewport of VIEWPORTS) {
  test.describe(`IBAL demo path ${viewport.name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("header presenter: every step by keyboard", async ({ page }) => {
      test.setTimeout(240_000);
      const errors = watchConsole(page);
      await openWorkbench(page);

      const present = page.getByRole("button", { name: "Present" });
      await present.focus();
      await page.keyboard.press("Enter");
      const bar = page.getByTestId("presenter-bar");
      await expect(bar).toBeVisible();
      await expect(page.getByTestId("presenter-warm")).toContainText(/Warm · \d+ ms/, { timeout: 15_000 });
      await audit(page, '[data-testid="presenter-bar"]', "presenter open");
      expect(await unreachableByTab(page, '[data-testid="presenter-bar"]'), "presenter controls unreachable by Tab").toEqual([]);

      const current = bar.locator('[aria-current="step"]');
      const run = page.getByTestId("presenter-run");
      const expected = ["Solve the base case", "Stress one scenario", "Rank every stress", "Compare what-ifs"];
      await expect(current).toContainText("Generate a book");
      for (const next of expected) {
        await run.focus();
        await page.keyboard.press("Enter");
        await expect(current).toContainText(next, { timeout: 90_000 });
        await expect(page.getByTestId("presenter-say")).not.toBeEmpty();
        await audit(page, '[data-testid="presenter-bar"]', `presenter at "${next}"`);
      }
      await run.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText(/Completed \d+ what-if scenarios\./)).toBeVisible({ timeout: 90_000 });
      await expect(bar.locator("ol button svg.text-term-up")).toHaveCount(6);
      await audit(page, '[data-testid="presenter-bar"]', "presenter complete");

      // Arrow keys move between steps and Escape leaves presenter mode.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("ArrowLeft");
      await expect(current).toContainText("Rank every stress");
      await page.keyboard.press("Escape");
      await expect(bar).toBeHidden();
      expect(errors).toEqual([]);
    });

    test("guided showcase: all three books, every step", async ({ page }) => {
      test.setTimeout(300_000);
      const errors = watchConsole(page);
      await openWorkbench(page);
      const region = '[data-testid="ibal-showcase"]';
      const showcase = page.locator(region);
      await expect(showcase).toBeVisible({ timeout: 15_000 });
      await audit(page, region, "showcase idle");

      for (const book of ["principal", "agency", "prime"]) {
        const select = page.getByRole("combobox", { name: "Showcase book" });
        await select.selectOption(book);
        const start = page.getByRole("button", { name: "Start guided run" });
        await start.focus();
        await page.keyboard.press("Enter");
        const steps = page.getByRole("group", { name: "Guided steps" });
        await expect(steps).toBeVisible({ timeout: 120_000 });
        if (book === "principal") {
          expect(await unreachableByTab(page, region), "showcase controls unreachable by Tab").toEqual([]);
        }
        for (const [index, step] of STEPS.entries()) {
          await expect(steps.locator('[aria-current="step"]')).toContainText(`${index + 1}. ${step}`);
          await expect(showcase.getByRole("status").first()).not.toBeEmpty();
          if (book === "prime" && step === "diagnose") {
            await expect(showcase.getByText(/Elastic diagnostic:/)).toBeVisible();
          }
          await audit(page, region, `${book} · ${step}`);
          if (index < STEPS.length - 1) {
            await page.getByRole("button", { name: "Next →" }).focus();
            await page.keyboard.press("Enter");
          }
        }
      }
      expect(errors).toEqual([]);
    });
  });
}
