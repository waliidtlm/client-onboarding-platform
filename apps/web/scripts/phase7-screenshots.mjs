import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const FIXTURE_MARKER = "PHASE7_DEMO_FIXTURE_v1";
const fixtureMarker = process.env.PHASE7_DEMO_FIXTURE_MARKER;
const password = process.env.DEMO_STAFF_PASSWORD;
const baseUrl = process.env.APP_PUBLIC_ORIGIN;

if (fixtureMarker !== FIXTURE_MARKER || !password || !baseUrl) {
  throw new Error("Screenshot capture requires the exact isolated Phase 7 fixture environment");
}
if (new URL(baseUrl).hostname !== "127.0.0.1") {
  throw new Error("Screenshot capture is restricted to the isolated loopback demo");
}

const screenshotDirectory = path.resolve(import.meta.dirname, "../../../docs/screenshots");
const viewport = { width: 1440, height: 1000 };
const forbiddenVisibleText = [
  /bearer\s+[a-z0-9._~+/-]+/i,
  /authorization\s*:/i,
  /c:\\users\\/i,
  /\/users\//i,
  /-----begin [a-z ]*private key-----/i,
  /\b[a-f0-9]{64}\b/i,
];

async function assertSafePage(page, label) {
  const visibleText = await page.locator("body").innerText();
  const forbiddenSecretValues = [
    password,
    process.env.AUTH_SECRET,
    process.env.OBJECT_STORAGE_SECRET_KEY,
    process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET,
    process.env.AUTOMATION_PHASE7_SERVICE_TOKEN,
  ].filter(Boolean);
  if (
    forbiddenVisibleText.some((pattern) => pattern.test(visibleText)) ||
    forbiddenSecretValues.some((value) => visibleText.includes(value)) ||
    new URL(page.url()).hash
  ) {
    throw new Error(`${label} contains forbidden visible data`);
  }
}

async function capture(page, filename, label) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: "*,*::before,*::after{animation:none!important;transition:none!important}",
  });
  await assertSafePage(page, label);
  await page.screenshot({
    path: path.join(screenshotDirectory, filename),
    type: "jpeg",
    quality: 86,
    fullPage: false,
  });
}

await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
const page = await context.newPage();

try {
  await page.goto(`${baseUrl}/signin`, { waitUntil: "networkidle" });
  await page.getByLabel("Staff email").fill("admin@northstar.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${baseUrl}/dashboard`);
  await capture(page, "dashboard.jpg", "dashboard screenshot");

  await page.goto(`${baseUrl}/onboardings`, { waitUntil: "networkidle" });
  const fixtureLink = page
    .getByRole("row")
    .filter({ hasText: "Atlas Fitness Studio — Phase 7 Isolated Demo" })
    .filter({ hasText: "COMPLETED" })
    .getByRole("link", { name: "Atlas Fitness Studio — Phase 7 Isolated Demo" });
  await fixtureLink.click();
  await page.waitForLoadState("networkidle");
  await capture(page, "onboarding-completed.jpg", "completed onboarding screenshot");

  await page.goto(`${baseUrl}/automation-events`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Automation events" }).waitFor();
  await capture(page, "automation-recovery.jpg", "automation recovery screenshot");
} finally {
  await context.close();
  await browser.close();
}

process.stdout.write(
  "Generated three redaction-checked Phase 7 screenshots from the isolated fixture.\n",
);
