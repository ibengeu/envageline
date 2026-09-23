#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

const url = checkedUrl(process.argv[2] || "http://127.0.0.1:8080/");
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const modelResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("pp_doclayout_s.onnx")) {
      modelResponses.push(response.status());
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.waitForFunction(
    () => /[1-9]\d*\s*\/\s*\d+ pages ready/.test(document.body.textContent ?? ""),
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () =>
      performance
        .getEntriesByType("resource")
        .some((entry) => entry.name.includes("pp_doclayout_s.onnx")),
    { timeout: 30_000 },
  );

  const modelResources = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes("pp_doclayout_s.onnx")),
  );

  const developmentAnalysis =
    modelResponses.length === 0
      ? await page.evaluate(async () => {
          try {
            const controller = await import("/src/reader/controller.ts");
            const analysis = controller.getActiveDocumentAnalysis();
            return {
              diagnostics: analysis?.diagnostics ?? [],
              hasLayoutEvidence: Boolean(
                analysis?.elements.some((element) =>
                  element.evidence.some((item) => item.signal === "layout-model"),
                ),
              ),
            };
          } catch {
            return null;
          }
        })
      : null;

  assert.equal(
    modelResponses.every((status) => status === 200),
    true,
  );
  assert.equal(modelResources.length > 0, true);
  assert.equal(
    developmentAnalysis?.diagnostics.some((item) => item.includes("classifier unavailable")) ??
      false,
    false,
  );
  if (developmentAnalysis) assert.equal(developmentAnalysis.hasLayoutEvidence, true);
  const layoutErrors = errors.filter((message) => /layout|onnx|wasm|model/i.test(message));
  assert.deepEqual(layoutErrors, []);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      modelResponses,
      modelResources,
      diagnostics: developmentAnalysis?.diagnostics ?? [],
      ignoredUnrelatedErrors: errors,
    })}\n`,
  );
} finally {
  await browser.close();
}
