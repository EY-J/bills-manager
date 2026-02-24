import test from "node:test";
import assert from "node:assert/strict";
import { recalculateBillCycleFromPayments } from "../src/features/bills/hooks/useBills.js";

test("payment edit decreasing amount rewinds cycle progress", () => {
  const bill = {
    id: "bill-1",
    name: "Water",
    category: "Housing",
    dueDate: "2026-03-01",
    amount: 100,
    notes: "",
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 12,
    paidMonths: 2,
    cyclePaidAmount: 20,
    payments: [
      {
        id: "pay-1",
        date: "2026-02-10",
        amount: 120,
        note: "Paid",
        settledCycles: 1,
      },
    ],
  };

  const nextPayments = [
    {
      id: "pay-1",
      date: "2026-02-10",
      amount: 20,
      note: "Paid",
      settledCycles: 1,
    },
  ];

  const recalculated = recalculateBillCycleFromPayments(bill, nextPayments);
  assert.equal(recalculated.dueDate, "2026-02-01");
  assert.equal(recalculated.paidMonths, 1);
  assert.equal(recalculated.cyclePaidAmount, 20);
  assert.equal(recalculated.payments[0].settledCycles, 0);
});

test("payment edit increasing amount advances multiple cycles", () => {
  const bill = {
    id: "bill-2",
    name: "Internet",
    category: "Utilities",
    dueDate: "2026-03-01",
    amount: 100,
    notes: "",
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 10,
    paidMonths: 2,
    cyclePaidAmount: 10,
    payments: [
      {
        id: "pay-2",
        date: "2026-02-12",
        amount: 110,
        note: "Paid",
        settledCycles: 1,
      },
    ],
  };

  const nextPayments = [
    {
      id: "pay-2",
      date: "2026-02-12",
      amount: 250,
      note: "Paid",
      settledCycles: 1,
    },
  ];

  const recalculated = recalculateBillCycleFromPayments(bill, nextPayments);
  assert.equal(recalculated.dueDate, "2026-04-01");
  assert.equal(recalculated.paidMonths, 3);
  assert.equal(recalculated.cyclePaidAmount, 50);
  assert.equal(recalculated.payments[0].settledCycles, 2);
});
