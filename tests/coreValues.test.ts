// Wednesday deck: the weekly pair of core values is always two different values, stable for a date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { weeklyCoreValues, weeklyPrompt, POSITIVE_PROMPTS } from "../src/lib/coreValues";

test("two different values, the same pair every time for a date, and they vary across weeks", () => {
  const seen = new Set<string>();
  for (let w = 0; w < 52; w++) {
    const d = new Date(Date.UTC(2026, 0, 7 + w * 7)).toISOString().slice(0, 10);
    const [a, b] = weeklyCoreValues(d);
    assert.notEqual(a.value, b.value);
    assert.deepEqual(weeklyCoreValues(d), [a, b]);
    seen.add(`${a.value}|${b.value}`);
    assert.ok(POSITIVE_PROMPTS.includes(weeklyPrompt(d)));
  }
  assert.ok(seen.size > 5, "pairs should rotate week to week");
});
