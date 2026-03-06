import test from "node:test";
import assert from "node:assert/strict";
import {
  addPaymentToBillAndAdvance,
  deletePaymentFromBill,
  markBillPaidAndAdvance,
  updatePaymentInBill,
} from "../src/features/bills/hooks/useBills.js";

test("markBillPaidAndAdvance settles remaining balance and advances one cycle", () => {
  const bill = {
    id: "bill-1",
    name: "Water",
    category: "Housing",
    dueDate: "2026-02-01",
    amount: 100,
    notes: "",
    payments: [],
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 6,
    paidMonths: 1,
    cyclePaidAmount: 40,
  };

  const next = markBillPaidAndAdvance(bill);

  assert.equal(next.dueDate, "2026-03-01");
  assert.equal(next.paidMonths, 2);
  assert.equal(next.cyclePaidAmount, 0);
  assert.equal(next.payments[0].amount, 60);
  assert.equal(next.payments[0].settledCycles, 1);
  assert.equal(next.payments[0].note, "Paid");
});

test("addPaymentToBillAndAdvance can settle multiple cycles with carry", () => {
  const bill = {
    id: "bill-2",
    name: "Internet",
    category: "Utilities",
    dueDate: "2026-02-01",
    amount: 100,
    notes: "",
    payments: [],
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 0,
    paidMonths: 0,
    cyclePaidAmount: 20,
  };

  const next = addPaymentToBillAndAdvance(bill, {
    id: "pay-1",
    date: "2026-02-05",
    amount: 250,
    note: "Bulk payment",
  });

  assert.equal(next.dueDate, "2026-04-01");
  assert.equal(next.cyclePaidAmount, 70);
  assert.equal(next.payments[0].settledCycles, 2);
});

test("updatePaymentInBill rewinds cycle progress when edited amount is reduced", () => {
  const bill = {
    id: "bill-3",
    name: "Electricity",
    category: "Utilities",
    dueDate: "2026-03-01",
    amount: 100,
    notes: "",
    payments: [
      {
        id: "pay-2",
        date: "2026-02-10",
        amount: 120,
        note: "Paid",
        settledCycles: 1,
      },
    ],
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 12,
    paidMonths: 2,
    cyclePaidAmount: 20,
  };

  const next = updatePaymentInBill(bill, "pay-2", { amount: 20 });

  assert.equal(next.dueDate, "2026-02-01");
  assert.equal(next.paidMonths, 1);
  assert.equal(next.cyclePaidAmount, 20);
  assert.equal(next.payments[0].settledCycles, 0);
});

test("deletePaymentFromBill rewinds due date for counted payment", () => {
  const bill = {
    id: "bill-4",
    name: "Loan",
    category: "Debt",
    dueDate: "2026-03-01",
    amount: 100,
    notes: "",
    payments: [
      {
        id: "pay-3",
        date: "2026-02-10",
        amount: 140,
        note: "Paid",
        settledCycles: 1,
      },
    ],
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 5,
    paidMonths: 1,
    cyclePaidAmount: 40,
  };

  const next = deletePaymentFromBill(bill, "pay-3");

  assert.equal(next.dueDate, "2026-02-01");
  assert.equal(next.paidMonths, 0);
  assert.equal(next.cyclePaidAmount, 0);
  assert.equal(next.payments.length, 0);
});

test("deletePaymentFromBill removes non-counted entries without rewinding cycle", () => {
  const bill = {
    id: "bill-5",
    name: "Subscription",
    category: "Subscriptions",
    dueDate: "2026-03-01",
    amount: 100,
    notes: "",
    payments: [
      {
        id: "pay-roll",
        date: "2026-02-20",
        amount: 0,
        note: "Unpaid rollover",
        settledCycles: 0,
      },
      {
        id: "pay-live",
        date: "2026-02-10",
        amount: 40,
        note: "Partial",
        settledCycles: 0,
      },
    ],
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 0,
    paidMonths: 0,
    cyclePaidAmount: 40,
  };

  const next = deletePaymentFromBill(bill, "pay-roll");

  assert.equal(next.dueDate, bill.dueDate);
  assert.equal(next.cyclePaidAmount, bill.cyclePaidAmount);
  assert.equal(next.payments.some((p) => p.id === "pay-roll"), false);
});

test("markBillPaidAndAdvance settles one-time bills without advancing due date", () => {
  const bill = {
    id: "bill-one-time",
    name: "Friend debt",
    category: "Debt",
    dueDate: "2026-02-10",
    amount: 500,
    notes: "",
    payments: [],
    cadence: "one-time",
    reminderDays: 3,
    totalMonths: 0,
    paidMonths: 0,
    cyclePaidAmount: 120,
  };

  const next = markBillPaidAndAdvance(bill);

  assert.equal(next.dueDate, bill.dueDate);
  assert.equal(next.cyclePaidAmount, 500);
  assert.equal(next.payments[0].amount, 380);
  assert.equal(next.payments[0].settledCycles, 1);
});

test("deletePaymentFromBill recalculates one-time paid state from remaining history", () => {
  const bill = {
    id: "bill-one-time-delete",
    name: "Laptop debt",
    category: "Debt",
    dueDate: "2026-02-10",
    amount: 200,
    notes: "",
    payments: [
      {
        id: "pay-over",
        date: "2026-02-12",
        amount: 40,
        note: "Extra",
        settledCycles: 0,
      },
      {
        id: "pay-settle",
        date: "2026-02-11",
        amount: 120,
        note: "Paid",
        settledCycles: 1,
      },
      {
        id: "pay-start",
        date: "2026-02-10",
        amount: 80,
        note: "Partial",
        settledCycles: 0,
      },
    ],
    cadence: "one-time",
    reminderDays: 3,
    totalMonths: 0,
    paidMonths: 0,
    cyclePaidAmount: 200,
  };

  const next = deletePaymentFromBill(bill, "pay-over");

  assert.equal(next.dueDate, bill.dueDate);
  assert.equal(next.cyclePaidAmount, 200);
  assert.equal(next.payments.some((p) => p.id === "pay-over"), false);
});

test("statement-plan payment settles current statement and carries remainder", () => {
  const bill = {
    id: "bill-statement-1",
    name: "Tiktok PayLater",
    category: "Debt",
    dueDate: "2026-10-25",
    amount: 1000,
    notes: "",
    payments: [],
    cadence: "statement-plan",
    statementAmounts: [1000, 876.93, 721.69],
    statementIndex: 0,
    reminderDays: 3,
    totalMonths: 3,
    paidMonths: 0,
    cyclePaidAmount: 0,
  };

  const next = addPaymentToBillAndAdvance(bill, {
    id: "pay-plan-1",
    date: "2026-10-25",
    amount: 1120,
    note: "Payment",
  });

  assert.equal(next.dueDate, "2026-11-25");
  assert.equal(next.statementIndex, 1);
  assert.equal(next.amount, 876.93);
  assert.equal(next.cyclePaidAmount, 120);
  assert.equal(next.payments[0].settledCycles, 1);
});

test("statement-plan mark paid on final statement keeps due date and marks full", () => {
  const bill = {
    id: "bill-statement-final",
    name: "Tiktok PayLater",
    category: "Debt",
    dueDate: "2026-12-25",
    amount: 721.69,
    notes: "",
    payments: [],
    cadence: "statement-plan",
    statementAmounts: [1000, 876.93, 721.69],
    statementIndex: 2,
    reminderDays: 3,
    totalMonths: 3,
    paidMonths: 2,
    cyclePaidAmount: 200,
  };

  const next = markBillPaidAndAdvance(bill);

  assert.equal(next.dueDate, bill.dueDate);
  assert.equal(next.statementIndex, 2);
  assert.equal(next.amount, 721.69);
  assert.equal(next.cyclePaidAmount, 721.69);
  assert.equal(next.payments[0].settledCycles, 1);
});
