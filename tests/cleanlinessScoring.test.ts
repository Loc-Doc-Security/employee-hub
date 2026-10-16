// Cleanliness scoring matches the Wix version: (yes answers + photos) / (questions + photo slots).
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAudit } from "../server/lib/cleanliness";

test("office only, all yes, photo attached = 100", () => {
  const r = scoreAudit({ vehicle: false, office: true },
    { office: { organized: true, floor: true, bathroom: true } }, { "office.office": "u1" });
  assert.equal(r.score, 100);
  assert.equal(r.officeScore, 100);
  assert.equal(r.vehicleScore, null);
  assert.deepEqual([r.passCount, r.totalCount], [3, 3]);
});

test("photos count toward the score", () => {
  const r = scoreAudit({ vehicle: false, office: true },
    { office: { organized: true, floor: true, bathroom: true } }, {});
  assert.equal(r.score, 75); // 3 of 4
});

test("vehicle + office combine across both sections", () => {
  const r = scoreAudit({ vehicle: true, office: true },
    { vehicle: { organized: true, floor: true, shelves: true, cab: true, outside: false, tires: false } },
    { "vehicle.cab": "u1" });
  // vehicle: 4 yes + 1 photo = 5 of 9 = 56; office: 0 of 4 = 0; overall 5 of 13 = 38
  assert.equal(r.vehicleScore, 56);
  assert.equal(r.officeScore, 0);
  assert.equal(r.score, 38);
});

test("ignores answers/photos for inactive sections and unknown keys", () => {
  const r = scoreAudit({ vehicle: false, office: true },
    { vehicle: { floor: true }, office: { organized: true, hacked: true } as Record<string, boolean> },
    { "vehicle.cab": "u9", "office.nope": "u8" });
  assert.equal(r.answers.vehicle, undefined);
  assert.equal("hacked" in (r.answers.office ?? {}), false);
  assert.deepEqual(r.photos, {});
});
