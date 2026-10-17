// Credit card receipt compliance math (pure). Department and company figures are WEIGHTED:
// total receipts ÷ total purchases, not an average of individual percentages, so a team with 100
// purchases and 99 receipts is 99% even if one person in it is at 0% (unchanged from Wix).
// A group with no purchases shows null ("—"), never a misleading 0%.

export type ExpenseRow = { employeeId: string; department: string; purchases: number; receipts: number };

export const pct = (receipts: number, purchases: number) =>
  purchases > 0 ? Math.round((receipts / purchases) * 1000) / 10 : null;

export function aggregate(rows: ExpenseRow[]) {
  const byDept = new Map<string, { department: string; purchases: number; receipts: number; people: number }>();
  let purchases = 0, receipts = 0;
  for (const r of rows) {
    const d = byDept.get(r.department) ?? { department: r.department, purchases: 0, receipts: 0, people: 0 };
    d.purchases += r.purchases;
    d.receipts += r.receipts;
    d.people += 1;
    byDept.set(r.department, d);
    purchases += r.purchases;
    receipts += r.receipts;
  }
  const departments = [...byDept.values()]
    .map((d) => ({ ...d, percent: pct(d.receipts, d.purchases) }))
    .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || a.department.localeCompare(b.department));
  return { company: { purchases, receipts, percent: pct(receipts, purchases) }, departments };
}
