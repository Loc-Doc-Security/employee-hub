// Geotab Expanded scorecard row rules, using the real-world quirks the Wix parser was built against.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, clusterRows, extractDateRange, parseDataRow, parseNameCell } from "../server/lib/driverScorecardParse";

const RULES = ["98", "100", "95.5", "89", "91.7", "100"];

test("name cell: dash spacing varies, blank names, pool vans", () => {
  assert.deepEqual(parseNameCell("147 - Sol Sasscer"), { vehicle: "147", name: "Sol Sasscer" });
  assert.deepEqual(parseNameCell("214- Kevin Tench"), { vehicle: "214", name: "Kevin Tench" });
  assert.deepEqual(parseNameCell("145 -Craig Smith"), { vehicle: "145", name: "Craig Smith" });
  assert.deepEqual(parseNameCell("210-"), { vehicle: "210", name: "" });
  assert.deepEqual(parseNameCell("Van 144 ALT"), { vehicle: "Van 144 ALT", name: "" });
  assert.deepEqual(parseNameCell("IB2A22204884"), { vehicle: "IB2A22204884", name: "" });
});

test("a normal driver row, with group text split across several items", () => {
  const r = parseDataRow(["132 - Quen Greenlee", "Anderson", "Team,", "Vehicle", "#REF!", "95.6", "Low Risk", ...RULES])!;
  assert.equal(r.vehicle, "132");
  assert.equal(r.group, "Anderson Team, Vehicle");
  assert.equal(r.score, 95.6);
  assert.deepEqual(r.rules, [98, 100, 95.5, 89, 91.7, 100]);
  assert.equal(r.noActivity, false);
});

test("No Activity rows are kept, with no scores", () => {
  const r = parseDataRow(["210-", "Charlotte", "#REF!", "-", "No Activity", "-", "-", "-", "-", "-", "-"])!;
  assert.equal(r.noActivity, true);
  assert.equal(r.score, null);
  assert.deepEqual(r.rules, [null, null, null, null, null, null]);
});

test("non-table lines (chart labels, summary boxes) are ignored", () => {
  assert.equal(parseDataRow(["Average Fleet Score", "95.7"]), null);
  assert.equal(parseDataRow(["147 - Sol", "Group", "#REF!", "90", "Low Risk", "1", "2"]), null); // wrong rule count
  assert.equal(parseDataRow(["147 - Sol", "Group", "#REF!", "abc", "Low Risk", ...RULES]), null); // unreadable score
});

test("rows are grouped by height on the page, cells ordered left to right", () => {
  const rows = clusterRows([
    { str: "Low Risk", transform: [1, 0, 0, 1, 300, 500] },
    { str: "132 - Quen", transform: [1, 0, 0, 1, 10, 500.8] },
    { str: " ", transform: [1, 0, 0, 1, 50, 500] },
    { str: "Next row", transform: [1, 0, 0, 1, 10, 480] },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].cells.map((c) => c.str), ["132 - Quen", "Low Risk"]);
});

test("date range comes from the From / To labels", () => {
  assert.deepEqual(extractDateRange(["Driver", "From", "Oct 4, 2026", "To", "Oct 10, 2026"]), { dateFrom: "2026-10-04", dateTo: "2026-10-10" });
  assert.throws(() => extractDateRange(["no dates here"]), /From \/ To/);
});

test("report summary: fleet score from scored rows only; too few rows is an error", () => {
  const row = (v: string, score: number) => parseDataRow([`${v} - X`, "G", "#REF!", String(score), "Low Risk", ...RULES])!;
  const idle = parseDataRow(["999-", "G", "#REF!", "-", "No Activity", "-", "-", "-", "-", "-", "-"])!;
  const rep = buildReport("2026-10-04", "2026-10-10", [row("1", 90), row("2", 100), row("3", 80), row("4", 90), row("5", 90), idle]);
  assert.equal(rep.fleetScore, 90);
  assert.equal(rep.daysReported, 7);
  assert.equal(rep.weekLabel, "Oct 4 – Oct 10");
  assert.throws(() => buildReport("2026-10-04", "2026-10-10", [row("1", 90)]), /Only found 1/);
});
