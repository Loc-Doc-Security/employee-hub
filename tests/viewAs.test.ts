// "View as" must never be available in production, whatever else is configured.
// Run: npx tsx --test tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { devViewAsEnabled } from "../server/auth/currentEmployee";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved = { NODE_ENV: process.env.NODE_ENV, LAB_DEV_SIMPLE_AUTH: process.env.LAB_DEV_SIMPLE_AUTH };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try { fn(); } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

test("production: View as is off, even if local sign-in is switched on", () => {
  withEnv({ NODE_ENV: "production", LAB_DEV_SIMPLE_AUTH: "1" }, () => assert.equal(devViewAsEnabled(), false));
  withEnv({ NODE_ENV: "production", LAB_DEV_SIMPLE_AUTH: undefined }, () => assert.equal(devViewAsEnabled(), false));
});

test("local dev without local sign-in: off", () => {
  withEnv({ NODE_ENV: "development", LAB_DEV_SIMPLE_AUTH: undefined }, () => assert.equal(devViewAsEnabled(), false));
});

test("local dev with local sign-in: on", () => {
  withEnv({ NODE_ENV: "development", LAB_DEV_SIMPLE_AUTH: "1" }, () => assert.equal(devViewAsEnabled(), true));
});
