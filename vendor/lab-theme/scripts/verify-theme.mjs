#!/usr/bin/env node
/**
 * LocDoc theme verification — run from repo root:
 *   node packages/lab-theme/scripts/verify-theme.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const apps = [
  "Lab_Hub",
  "Lab_IT",
  "Lab_EmployeeHub",
  "Lab_PM",
];

const css = readFileSync(join(root, "packages/lab-theme/src/lab-theme.css"), "utf8");
const required = ["#3f5280", "#4f7a3d", "#e4e7ef", "Open Sans", "data-theme=\"light-blue\""];
const missing = required.filter((t) => !css.includes(t));
if (missing.length) {
  console.error("FAIL: lab-theme.css missing tokens:", missing.join(", "));
  process.exit(1);
}

let failed = false;
for (const app of apps) {
  const indexCss = join(root, app, "src/index.css");
  const pkg = join(root, app, "package.json");
  if (!existsSync(indexCss)) {
    console.error(`FAIL: ${app}/src/index.css not found`);
    failed = true;
    continue;
  }
  const index = readFileSync(indexCss, "utf8");
  if (!index.includes("lab-theme/lab-theme.css") || !index.includes('@import "tailwindcss"')) {
    console.error(`FAIL: ${app} index.css must import tailwindcss then lab-theme`);
    failed = true;
  }
  const pkgJson = JSON.parse(readFileSync(pkg, "utf8"));
  if (!pkgJson.dependencies?.["lab-theme"]) {
    console.error(`FAIL: ${app} package.json missing lab-theme dependency`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("OK: LocDoc theme wired in all 4 apps");
console.log("OK: Brand tokens present in shared CSS");
console.log("");
console.log("Manual QA matrix (each app):");
console.log("  - Routes: login, main shell, settings/appearance");
console.log("  - Themes: Light, Dark (primary blue + secondary green)");
