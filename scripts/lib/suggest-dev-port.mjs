#!/usr/bin/env node
/** Standalone template: next free dev port from bundled reserved list. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, "../data/lab-dev-listen-ports.json");
const min = 3000;
const max = 3999;

let reserved = new Set([3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007]);
if (fs.existsSync(dataPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    if (Array.isArray(parsed.reserved)) {
      reserved = new Set(parsed.reserved.map(Number).filter((n) => n >= min && n <= max));
    }
  } catch {
    /* use defaults */
  }
}

let next = min;
for (; next <= max; next++) {
  if (!reserved.has(next)) break;
}
if (next > max) {
  console.error("No free dev listen port in 3000-3999");
  process.exit(1);
}
process.stdout.write(String(next));
