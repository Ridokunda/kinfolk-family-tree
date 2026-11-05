import { test, expect, type Page } from "@playwright/test";
import { readFile, copyFile } from "node:fs/promises";
const sample = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore a sample tree" }).click();
  await expect(
    page.getByRole("heading", { name: "The Willow family", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Arthur Willow", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".graph-loading")).toHaveCount(0);
};
test("welcome, interactive graph, search, people, mobile layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Every branch, a story." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/welcome-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Explore a sample tree" }).click();
  await expect(
    page.getByRole("button", { name: "View Arthur Willow", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".graph-loading")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/tree-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "View Evelyn Willow", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Evelyn Willow", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close profile" }).click();
  await page.getByLabel("Search family members").fill("Mia");
  await page.locator(".search-results").getByRole("button").click();
  await expect(
    page.getByRole("heading", { name: "Mia Brooks", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close profile" }).click();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page
    .getByRole("button", { name: "People", exact: false })
    .filter({ has: page.locator("svg") })
    .first()
    .click();
  await page.getByLabel("Filter living status").selectOption("deceased");
  await expect(page.locator(".person-tile")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "Family tree", exact: true }).click();
  await expect(page.locator(".sidebar.open")).toHaveCount(0);
  await expect(page.locator(".graph-loading")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/tree-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("create and edit profiles, attach files and persist after reload", async ({
  page,
}) => {
  await sample(page);
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await page.getByLabel("Given names").fill("Léa");
  await page.getByLabel("Surname", { exact: true }).fill("Test");
  await page.getByLabel("Birth date", { exact: true }).fill("2000-02");
  await page
    .getByLabel("Biography", { exact: true })
    .fill("A synthetic test profile.");
  await page
    .getByRole("button", { name: "Add family member", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Léa Test", exact: true }),
  ).toBeVisible();
  await page
    .locator(
      'input[accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"]',
    )
    .setInputFiles({
      name: "memory.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A synthetic family memory."),
    });
  await expect(page.getByText("memory.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("Birthplace").fill("Pretoria");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".facts")).toContainText("Pretoria");
  await page.reload();
  await page.getByLabel("Search family members").fill("Léa");
  await page.locator(".search-results").getByRole("button").click();
  await expect(page.locator(".facts")).toContainText("Pretoria");
  await expect(page.getByText("memory.txt", { exact: true })).toBeVisible();
});
test("export, verify, and restore a complete backup into a fresh browser context", async ({
  page,
  browser,
}) => {
  await sample(page);
  await page
    .getByRole("button", { name: "View Evelyn Willow", exact: true })
    .click();
  await page
    .locator('input[accept="image/jpeg,image/png,image/webp"]')
    .setInputFiles({
      name: "portrait.png",
      mimeType: "image/png",
      buffer: await readFile("public/icon-192.png"),
    });
  await expect(page.getByText("portrait.webp", { exact: true })).toBeVisible();
  await page
    .locator(
      'input[accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"]',
    )
    .setInputFiles({
      name: "story.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic story with Unicode: Tshilidzi, Léa."),
    });
  await expect(page.getByText("story.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page
    .getByLabel("Backup passphrase", { exact: true })
    .fill("safe synthetic passphrase");
  await page
    .getByLabel("Repeat passphrase", { exact: true })
    .fill("safe synthetic passphrase");
  await page.getByRole("button", { name: "Prepare & validate backup" }).click();
  await expect(page.getByText("Ready to save", { exact: true })).toBeVisible();
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download file", exact: true })
    .click();
  const download = await wait;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.getByLabel("Choose backup file").setInputFiles(path!);
  await page
    .getByLabel("Passphrase, if encrypted")
    .fill("safe synthetic passphrase");
  await page.getByRole("button", { name: "Validate & preview" }).click();
  await expect(
    page.getByText("All integrity checks passed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Record file verification" }).click();
  await expect(page.getByText("File verified", { exact: true })).toBeVisible();
  const second = await browser.newContext();
  const other = await second.newPage();
  await other.goto("/");
  await other
    .getByRole("button", { name: "Restore a backup", exact: true })
    .click();
  await other.getByLabel("Choose backup file").setInputFiles(path!);
  await other
    .getByLabel("Passphrase, if encrypted")
    .fill("safe synthetic passphrase");
  await other.getByRole("button", { name: "Validate & preview" }).click();
  await expect(
    other.getByText("9 people · 13 relationships · 2 files", { exact: true }),
  ).toBeVisible();
  await other.getByRole("button", { name: "Import family tree" }).click();
  await other.getByRole("button", { name: "Family tree", exact: true }).click();
  await expect(
    other.getByRole("heading", {
      name: "The Willow family · restored",
      exact: true,
    }),
  ).toBeVisible();
  await other
    .getByRole("button", { name: "View Evelyn Willow", exact: true })
    .click();
  await expect(other.getByText("portrait.webp", { exact: true })).toBeVisible();
  await expect(other.getByText("story.txt", { exact: true })).toBeVisible();
  await expect(other.locator(".profile-identity img")).toBeVisible();
  await second.close();
});
test("cached application opens and edits offline, including backup generation", async ({
  page,
  context,
}) => {
  await sample(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(
    page.getByRole("button", { name: "View Arthur Willow", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "View Arthur Willow", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await page.getByLabel("Given names").fill("Offline person");
  await page
    .getByRole("button", { name: "Add family member", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Offline person", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page.getByLabel("Protect with a passphrase").uncheck();
  await page.getByRole("button", { name: "Prepare & validate backup" }).click();
  await expect(page.getByText("Ready to save", { exact: true })).toBeVisible();
  await context.setOffline(false);
});

test("add a relative from the tree and export PNG and printable PDF view", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    window.print = () => {};
  });
  await sample(page);
  await page
    .getByRole("button", { name: "Add relative to Oliver Willow", exact: true })
    .click();
  await page.getByLabel("Given names").fill("New relative");
  await page.getByLabel("Relationship type").selectOption("adoptive");
  await page
    .getByRole("button", { name: "Add family member", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "New relative", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".profile-panel")
      .getByText("Adoptive parent", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close profile", exact: true })
    .click();
  await page.getByLabel("Focus person").selectOption("");
  await expect(page.locator(".graph-loading")).toHaveCount(0);
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export tree image", exact: true })
    .click();
  const image = await downloaded;
  const path = await image.path();
  const bytes = await readFile(path!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  const differentPixels = await page.evaluate(
    async (data) => {
      const img = new Image();
      img.src = data;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 210 && pixels[i + 1] < 210) count++;
      return count;
    },
    `data:image/png;base64,${bytes.toString("base64")}`,
  );
  expect(differentPixels).toBeGreaterThan(1000);
  await copyFile(path!, "test-results/tree-export.png");
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Print tree or save PDF", exact: true })
    .click();
  const popup = await opened;
  await expect(
    popup.getByRole("heading", { name: "The Willow family", exact: true }),
  ).toBeVisible();
  await expect(popup.locator("img")).toBeVisible();
  await popup.close();
});
