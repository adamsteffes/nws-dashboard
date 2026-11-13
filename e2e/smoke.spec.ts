import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test("loads and renders the placeholder dashboard", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await page.goto("./");

  await expect(
    page.getByRole("heading", { name: "NWS Weather" }),
  ).toBeVisible();
  await expect(page.getByText(/Version \d+\.\d+\.\d+/)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(overflow, "no horizontal overflow").toBe(true);

  await attachScreenshot(page, testInfo, "light");
  expect(consoleErrors).toEqual([]);
});

test("dark mode changes the background", async ({ page }, testInfo) => {
  const background = () =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("./");
  const light = await background();

  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).not.toBe(light);

  await attachScreenshot(page, testInfo, "dark");
});
