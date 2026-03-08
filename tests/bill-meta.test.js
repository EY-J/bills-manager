import test from "node:test";
import assert from "node:assert/strict";
import { computeBillMeta } from "../src/features/bills/billsUtils.js";

test("computeBillMeta treats blank due date on one-time debt as unscheduled", () => {
  const meta = computeBillMeta({
    id: "friend-debt",
    name: "Friend debt",
    category: "Debt",
    dueDate: "",
    amount: 300,
    notes: "",
    payments: [],
    cadence: "one-time",
    reminderDays: 3,
    totalMonths: 0,
    paidMonths: 0,
    cyclePaidAmount: 0,
  });

  assert.equal(meta.hasDueDate, false);
  assert.equal(meta.daysToDue, null);
  assert.equal(meta.dueSoon, false);
  assert.equal(meta.overdue, false);
  assert.equal(meta.monthsPending, 0);
});
