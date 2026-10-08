const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const out = path.join(__dirname, "..", "playwright-browsers");
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.resolve(out) };
try {
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["playwright", "install", "chromium"], { stdio: "inherit", env });
} catch (e) {
  console.error("Playwright Chromium install failed:", e.message);
  process.exit(1);
}
