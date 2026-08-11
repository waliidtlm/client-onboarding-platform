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
  { label: "bearer credential", pattern: /bearer\s+[a-z0-9._~+/-]+/i },
  { label: "authorization header", pattern: /authorization\s*:/i },
  { label: "Windows user path", pattern: /c:\\users\\/i },
  { label: "Unix user path", pattern: /\/users\//i },
  { label: "private key", pattern: /-----begin [a-z ]*private key-----/i },
  { label: "64-character hexadecimal value", pattern: /\b[a-f0-9]{64}\b/i },
];

async function assertSafePage(page, label) {
  const visibleText = await page.locator("body").innerText();
  const forbiddenSecretValues = [
    { label: "demo password", value: password },
    { label: "authentication secret", value: process.env.AUTH_SECRET },
    { label: "object-storage secret", value: process.env.OBJECT_STORAGE_SECRET_KEY },
    { label: "rate-limit HMAC secret", value: process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET },
    { label: "Phase 7 service token", value: process.env.AUTOMATION_PHASE7_SERVICE_TOKEN },
  ].filter(({ value }) => Boolean(value));
  const visiblePattern = forbiddenVisibleText.find(({ pattern }) => pattern.test(visibleText));
  const visibleSecret = forbiddenSecretValues.find(({ value }) => visibleText.includes(value));
  const violation =
    visiblePattern?.label ??
    visibleSecret?.label ??
    (new URL(page.url()).hash ? "URL fragment" : null);
  if (violation) throw new Error(`${label} failed redaction rule: ${violation}`);
}

async function capture(page, filename, label) {
  await page.evaluate(() => window.scrollTo(0, 0));
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
  await page.goto(`${baseUrl}/onboardings`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Onboardings" }).waitFor();
  await capture(page, "dashboard.jpg", "workflow overview screenshot");

  const fixtureLink = page
    .getByRole("row")
    .filter({ hasText: "Atlas Fitness Studio — Phase 7 Isolated Demo" })
    .filter({ hasText: "COMPLETED" })
    .getByRole("link", { name: "Atlas Fitness Studio — Phase 7 Isolated Demo" });
  await Promise.all([
    page.waitForURL((url) => /^\/onboardings\/[^/]+$/.test(url.pathname)),
    fixtureLink.click(),
  ]);
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("heading", { name: "Atlas Fitness Studio — Phase 7 Isolated Demo" })
    .waitFor();
  const fingerprintField = page.getByText("Source fingerprint", { exact: true }).locator("..");
  if (await fingerprintField.isVisible()) {
    await fingerprintField.evaluate((element) => {
      element.style.display = "none";
    });
  }
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
