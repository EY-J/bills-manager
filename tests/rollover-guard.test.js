import test from "node:test";
import assert from "node:assert/strict";
import { parseISODate } from "../src/lib/date/date.js";
import { shiftDueDateByCadence } from "../src/features/bills/billsUtils.js";
import {
  MAX_UNPAID_ROLLOVER_ENTRIES,
  rollBillToCurrentPeriod,
} from "../src/features/bills/hooks/useBills.js";

test("rollBillToCurrentPeriod caps very old weekly rollover history", () => {
  const today = parseISODate("2026-02-24");
  const dueDate = "2010-01-05";
  const bill = {
    id: "legacy-weekly",
    name: "Legacy bill",
    category: "Other",
    dueDate,
    amount: 100,
    notes: "",
    payments: [],
    cadence: "weekly",
    reminderDays: 3,
    totalMonths: 0,
    paidMonths: 0,
    cyclePaidAmount: 0,
  };

  const out = rollBillToCurrentPeriod(bill, today);
  const dueObj = parseISODate(dueDate);
  const cycles = Math.floor((today.getTime() - dueObj.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const expectedDueDate = shiftDueDateByCadence(dueDate, "weekly", cycles);

  assert.equal(out.dueDate, expectedDueDate);
  assert.equal(out.payments.length, MAX_UNPAID_ROLLOVER_ENTRIES);
  assert.match(out.payments[0].note, /\+\d+ older cycles\)/);
});

test("rollBillToCurrentPeriod keeps full history for small rollover counts", () => {
  const today = parseISODate("2026-02-24");
  const bill = {
    id: "recent-monthly",
    name: "Recent bill",
    category: "Other",
    dueDate: "2025-11-01",
    amount: 100,
    notes: "",
    payments: [],
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 0,
    paidMonths: 0,
    cyclePaidAmount: 0,
  };

  const out = rollBillToCurrentPeriod(bill, today);
  assert.equal(out.dueDate, "2026-02-01");
  assert.equal(out.payments.length, 3);
  assert.equal(out.payments.every((p) => p.note === "Unpaid rollover"), true);
});
