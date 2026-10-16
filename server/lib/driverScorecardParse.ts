// Deterministic parser for the weekly Geotab "Driver Safety Scorecard (Expanded)" PDF. Ported
// unchanged in behavior from the Wix version (teamwix-v2 backend/driverScorecardParse.js), which
// has handled the real report since 2026-09-22. No AI fallback (Levi, 2026-10-16): if Geotab
// changes the layout, the upload fails with a clear message and the parser gets updated.
//
// The report is a real text table (not a scan). Text items are grouped into rows by y-position,
// then a row is accepted only if it has the exact shape of a driver row:
//   "147 - Sol Sasscer" | group words… | #REF! column | total score | classification | 6 rule scores
// Known quirks handled: dash spacing varies ("214- Kevin Tench", "145 -Craig Smith"), blank names
// ("210-"), pool vans without a number ("Van 144 ALT", raw asset tags), "No Activity" rows, group
// text split across several items, and broken "#REF!" labels (the six rule scores are always in
// the same order, so position is used, never the printed label).

export const RULE_KEYS = ["hard_acceleration", "harsh_braking", "harsh_cornering", "seatbelt", "speeding", "distracted"] as const;
const CLASSIFICATIONS = ["Low Risk", "Mild Risk", "Medium Risk", "High Risk", "No Activity"];
const ROW_Y_EPSILON = 2; // points: text items this close vertically are one table row

export type ParsedRow = {
  vehicle: string; name: string; group: string; classification: string;
  noActivity: boolean; score: number | null; rules: (number | null)[];
};
export type ParsedReport = {
  weekStart: string; weekEnd: string; weekLabel: string; daysReported: number;
  fleetScore: number | null; rows: ParsedRow[];
};

type TextItem = { str?: string; transform: number[] };

function num(s: string): number | null {
  const v = parseFloat(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(v) ? v : null;
}

export function clusterRows(items: TextItem[]) {
  const rows: { y: number; cells: { x: number; str: string }[] }[] = [];
  for (const it of items) {
    const s = (it.str || "").trim();
    if (!s) continue;
    const [x, y] = [it.transform[4], it.transform[5]];
    let row = rows.find((r) => Math.abs(r.y - y) < ROW_Y_EPSILON);
    if (!row) { row = { y, cells: [] }; rows.push(row); }
    row.cells.push({ x, str: s });
  }
  rows.forEach((r) => r.cells.sort((a, b) => a.x - b.x));
  return rows;
}

const VEHICLE_NAME_RE = /^(\d+)\s*-\s*(.*)$/;
export function parseNameCell(raw: string) {
  const m = VEHICLE_NAME_RE.exec(raw);
  return m ? { vehicle: m[1], name: m[2].trim() } : { vehicle: raw.trim(), name: "" };
}

export function parseDataRow(strs: string[]): ParsedRow | null {
  if (strs.length < 4) return null;
  const classIdx = strs.findIndex((s) => CLASSIFICATIONS.includes(s));
  if (classIdx < 2) return null;
  const trailing = strs.slice(classIdx + 1);
  if (trailing.length !== RULE_KEYS.length) return null;
  const { vehicle, name } = parseNameCell(strs[0]);
  if (!vehicle) return null;
  const classification = strs[classIdx];
  const totalScoreStr = strs[classIdx - 1];
  const group = strs.slice(1, classIdx - 2).join(" "); // strs[classIdx - 2] is the unlabeled #REF! column
  const noActivity = classification === "No Activity" || totalScoreStr === "-";
  const score = noActivity ? null : num(totalScoreStr);
  const rules = noActivity ? RULE_KEYS.map(() => null) : trailing.map(num);
  if (!noActivity && (score == null || rules.some((v) => v == null))) return null;
  return { vehicle, name, group, classification, noActivity, score, rules };
}

export function extractDateRange(flat: string[]) {
  const dateRe = /^[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}$/;
  const fromStr = flat[flat.indexOf("From") + 1];
  const toStr = flat[flat.indexOf("To") + 1];
  if (!flat.includes("From") || !flat.includes("To") || !dateRe.test(fromStr ?? "") || !dateRe.test(toStr ?? "")) {
    throw new Error("Couldn't find the report's From / To dates on page 1. Is this the Geotab Expanded scorecard?");
  }
  const from = new Date(`${fromStr} UTC`), to = new Date(`${toStr} UTC`);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) throw new Error(`Unreadable date range: "${fromStr}" to "${toStr}".`);
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) };
}

/** Validates and summarizes parsed rows (the same checks the Wix version ran). */
export function buildReport(dateFrom: string, dateTo: string, rows: ParsedRow[]): ParsedReport {
  if (rows.length < 5) throw new Error(`Only found ${rows.length} driver row(s). This doesn't look like the Expanded report, or Geotab changed the layout.`);
  for (const r of rows) {
    if (r.noActivity) continue;
    if (r.score == null || r.score < 0 || r.score > 100) throw new Error(`Bad total score for vehicle ${r.vehicle}: ${r.score}`);
    if (r.rules.some((v) => v == null || v < 0 || v > 100)) throw new Error(`Bad rule score for vehicle ${r.vehicle}.`);
  }
  const scored = rows.filter((r) => !r.noActivity);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const f = (d: string) => { const x = new Date(`${d}T00:00:00Z`); return `${months[x.getUTCMonth()]} ${x.getUTCDate()}`; };
  return {
    weekStart: dateFrom, weekEnd: dateTo, weekLabel: `${f(dateFrom)} – ${f(dateTo)}`,
    daysReported: Math.round((Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000) + 1,
    fleetScore: scored.length ? scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length : null,
    rows,
  };
}

export async function parseScorecardPdf(pdf: Uint8Array): Promise<ParsedReport> {
  // Loaded on demand so a pdfjs problem can only fail an upload, never the server start-up.
  const ns = (await import("pdfjs-dist/legacy/build/pdf.js")) as unknown as { getDocument?: unknown; default?: { getDocument: unknown } };
  const pdfjs = (ns.getDocument ? ns : ns.default) as { getDocument: (o: object) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: TextItem[] }> }> }> } };
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: pdf, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
  } catch {
    throw new Error("That file couldn't be opened as a PDF.");
  }
  const rows: ParsedRow[] = [];
  let flat: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    if (p === 1) flat = content.items.map((i) => (i.str || "").trim()).filter(Boolean);
    for (const row of clusterRows(content.items)) {
      const parsed = parseDataRow(row.cells.map((c) => c.str));
      if (parsed) rows.push(parsed);
    }
  }
  const { dateFrom, dateTo } = extractDateRange(flat);
  return buildReport(dateFrom, dateTo, rows);
}
