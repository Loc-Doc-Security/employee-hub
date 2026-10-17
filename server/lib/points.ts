// Points ledger + automatic point rules.
//
// The balance is always the sum of point_transactions; nothing stores a running total that could
// drift. Charges lock the employee row first, so two orders submitted at once can't both spend the
// same points.
//
// Rules (managed by Shop Admins) are applied by runPointRules(), which runs hourly and is safe to
// run any number of times: point_rule_awards has one row per (rule, person, period), so a person is
// paid at most once per period. It catches up on anything missed in the last 7 days (e.g. the server
// was down on someone's birthday).
import type pg from "pg";

type Db = pg.Pool | pg.PoolClient | pg.Client;

export async function balanceOf(db: Db, employeeId: string): Promise<number> {
  return Number((await db.query("SELECT coalesce(sum(amount), 0)::int AS b FROM employee_hub.point_transactions WHERE employee_id = $1", [employeeId])).rows[0].b);
}

export type Posting = {
  companyId: string; employeeId: string; amount: number;
  kind: "grant" | "rule" | "order_charge" | "order_settle" | "order_refund";
  reason: string; orderId?: string | null; ruleId?: string | null; createdById?: string | null;
  /** Refuse if this would take the balance below zero (true for spending). */
  mustCover?: boolean;
};

/** Writes one ledger row. Call inside a transaction (client) when combined with other writes. */
export async function post(db: pg.PoolClient | pg.Client, p: Posting): Promise<{ id: string; balance: number }> {
  if (!Number.isInteger(p.amount) || p.amount === 0) throw new Error("Points must be a whole, non-zero number.");
  await db.query("SELECT id FROM employee_hub.employees WHERE id = $1 FOR UPDATE", [p.employeeId]);
  const before = await balanceOf(db, p.employeeId);
  if (p.mustCover && before + p.amount < 0) throw new Error(`Not enough points: this needs ${-p.amount}, the balance is ${before}.`);
  const id = (await db.query(
    `INSERT INTO employee_hub.point_transactions (company_id, employee_id, amount, kind, reason, order_id, rule_id, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [p.companyId, p.employeeId, p.amount, p.kind, p.reason, p.orderId ?? null, p.ruleId ?? null, p.createdById ?? null])).rows[0].id;
  return { id, balance: before + p.amount };
}

/** Who is due for a rule today, and for which period. Pure: `today` and `people` are given. */
export function dueForRule(
  rule: { trigger: string; effective_from: string | null },
  people: { id: string; birthday_md: string | null; hired_on: string | null }[],
  today: string,
): { employeeId: string; period: string }[] {
  const days = Array.from({ length: 8 }, (_, k) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - k);
    return d.toISOString().slice(0, 10);
  }); // today and the 7 days before (catch-up window)
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const out: { employeeId: string; period: string }[] = [];
  for (const p of people) {
    if (rule.trigger === "birthday" && p.birthday_md) {
      for (const d of days) {
        const y = Number(d.slice(0, 4));
        const md = p.birthday_md === "02-29" && !leap(y) ? "02-28" : p.birthday_md;
        if (d.slice(5) === md) { out.push({ employeeId: p.id, period: String(y) }); break; }
      }
    }
    if (rule.trigger === "on_hire" && p.hired_on && rule.effective_from && p.hired_on >= rule.effective_from && p.hired_on <= today) {
      out.push({ employeeId: p.id, period: "once" });
    }
    if (rule.trigger === "hire_anniversary" && p.hired_on) {
      for (const d of days) {
        const years = Number(d.slice(0, 4)) - Number(p.hired_on.slice(0, 4));
        if (years >= 1 && d.slice(5) === p.hired_on.slice(5)) { out.push({ employeeId: p.id, period: d.slice(0, 4) }); break; }
      }
    }
    if (rule.trigger === "monthly") out.push({ employeeId: p.id, period: today.slice(0, 7) });
  }
  return out;
}

const LABEL: Record<string, string> = { birthday: "Happy birthday!", on_hire: "Welcome aboard!", hire_anniversary: "Happy work anniversary!", monthly: "Monthly points" };

/** Applies every active rule with an amount. Returns how many awards were paid. */
export async function runPointRules(pool: pg.Pool, today: string): Promise<number> {
  const rules = (await pool.query(
    "SELECT id, company_id, name, trigger, amount, effective_from::text AS effective_from FROM employee_hub.point_rules WHERE is_active AND amount IS NOT NULL")).rows;
  let paid = 0;
  for (const rule of rules) {
    const people = (await pool.query(
      "SELECT id, birthday_md, hired_on::text AS hired_on FROM employee_hub.employees WHERE company_id = $1 AND is_active", [rule.company_id])).rows;
    for (const due of dueForRule(rule, people, today)) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query(
          "SELECT 1 FROM employee_hub.point_rule_awards WHERE rule_id = $1 AND employee_id = $2 AND period = $3", [rule.id, due.employeeId, due.period]);
        if (!claimed.rows.length) {
          const t = await post(client, { companyId: rule.company_id, employeeId: due.employeeId, amount: rule.amount, kind: "rule",
            reason: `${LABEL[rule.trigger] ?? rule.name} (${rule.name})`, ruleId: rule.id });
          await client.query("INSERT INTO employee_hub.point_rule_awards (rule_id, employee_id, period, transaction_id) VALUES ($1,$2,$3,$4)",
            [rule.id, due.employeeId, due.period, t.id]);
          paid++;
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        if ((err as { code?: string }).code !== "23505") throw err; // a concurrent run already paid it
      } finally {
        client.release();
      }
    }
  }
  return paid;
}
