// Monthly peer-assessment list rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAssignments } from "../server/lib/peerAssignments";

const people = (dept: string, n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, departmentIds: [dept] }));

test("everyone in my department + exactly 2 random when that's already 5+", () => {
  const all = [...people("svc", 6, "s"), ...people("acct", 10, "a")]; // me = s0, 5 teammates
  const list = pickAssignments("s0", ["svc"], all, "2026-10-01");
  assert.equal(list.filter((p) => p.reason === "department").length, 5);
  assert.equal(list.filter((p) => p.reason === "random").length, 2);
  assert.ok(list.filter((p) => p.reason === "random").every((p) => p.subjectId.startsWith("a")));
});

test("small department: random picks top the list up to 5", () => {
  const all = [...people("anderson", 2, "n"), ...people("acct", 10, "a")]; // me = n0, 1 teammate
  const list = pickAssignments("n0", ["anderson"], all, "2026-10-01");
  assert.equal(list.length, 5);
  assert.equal(list.filter((p) => p.reason === "random").length, 4);
});

test("no department (e.g. C-Suite): 5 random", () => {
  const list = pickAssignments("x", [], people("acct", 10, "a"), "2026-10-01");
  assert.equal(list.length, 5);
  assert.ok(list.every((p) => p.reason === "random"));
});

test("tiny company: takes whoever exists, never more", () => {
  const list = pickAssignments("a0", [], people("acct", 3, "a"), "2026-10-01");
  assert.equal(list.length, 2);
});

test("never assigns yourself, never repeats anyone", () => {
  const all = [...people("svc", 4, "s"), ...people("acct", 10, "a")];
  const list = pickAssignments("s0", ["svc"], all, "2026-10-01");
  assert.ok(!list.some((p) => p.subjectId === "s0"));
  assert.equal(new Set(list.map((p) => p.subjectId)).size, list.length);
});

test("same person + month = same picks; different month = reshuffled", () => {
  const all = [...people("svc", 3, "s"), ...people("acct", 30, "a")];
  const oct1 = pickAssignments("s0", ["svc"], all, "2026-10-01").map((p) => p.subjectId);
  const oct2 = pickAssignments("s0", ["svc"], all, "2026-10-01").map((p) => p.subjectId);
  assert.deepEqual(oct1, oct2);
  const months = ["2026-11-01", "2026-12-01", "2027-01-01"].map((m) =>
    pickAssignments("s0", ["svc"], all, m).filter((p) => p.reason === "random").map((p) => p.subjectId).join());
  assert.ok(new Set(months).size > 1, "random picks should vary month to month");
});
