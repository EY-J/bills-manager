import test from "node:test";
import assert from "node:assert/strict";
import { parseISODate } from "../src/lib/date/date.js";
import { computeBillMeta } from "../src/features/bills/billsUtils.js";
import { buildCalendarDueOccurrencesByDate } from "../src/features/bills/calendarProjection.js";

function withMeta(bill) {
  return {
    ...bill,
    meta: computeBillMeta(bill),
  };
}

test("calendar projects recurring bills into future months", () => {
  const bill = withMeta({
    id: "water",
    name: "Water",
    category: "Utilities",
    dueDate: "2026-04-08",
    amount: 12,
    notes: "",
    payments: [
      {
        id: "pay-water",
        date: "2026-03-08",
        amount: 12,
        note: "Paid",
        settledCycles: 1,
      },
    ],
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 0,
    paidMonths: 0,
    cyclePaidAmount: 0,
    archived: false,
  });

  const projected = buildCalendarDueOccurrencesByDate(
    [bill],
    "2026-05-01",
    "2026-05-31",
    parseISODate("2026-03-12")
  );

  assert.equal(projected.has("2026-05-08"), true);
  assert.equal(projected.get("2026-05-08")?.[0]?.tone, "upcoming");
  assert.equal(projected.get("2026-05-08")?.[0]?.statusLabel, "Upcoming");
});

test("calendar reconstructs rollover history before later paid cycles", () => {
  const bill = withMeta({
    id: "rent",
    name: "Rent",
    category: "Housing",
    dueDate: "2026-03-01",
    amount: 100,
    notes: "",
    payments: [
      {
        id: "pay-rent",
        date: "2026-02-15",
        amount: 100,
        note: "Paid",
        settledCycles: 1,
      },
      {
        id: "roll-rent",
        date: "2026-02-10",
        amount: 0,
        note: "Unpaid rollover",
        settledCycles: 0,
      },
    ],
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 0,
    paidMonths: 0,
    cyclePaidAmount: 0,
    archived: false,
  });

  const projected = buildCalendarDueOccurrencesByDate(
    [bill],
    "2026-01-01",
    "2026-02-28",
    parseISODate("2026-03-20")
  );

  assert.equal(projected.get("2026-01-01")?.[0]?.tone, "overdue");
  assert.equal(projected.get("2026-01-01")?.[0]?.statusLabel, "Overdue");
  assert.equal(projected.get("2026-02-01")?.[0]?.tone, "paid");
  assert.equal(projected.get("2026-02-01")?.[0]?.statusLabel, "Paid");
});

test("calendar stops projecting completed recurring installment plans", () => {
  const bill = withMeta({
    id: "phone-loan",
    name: "Phone loan",
    category: "Debt",
    dueDate: "2027-01-08",
    amount: 50,
    notes: "",
    payments: [
      {
        id: "pay-final",
        date: "2026-12-08",
        amount: 50,
        note: "Paid",
        settledCycles: 1,
      },
    ],
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 12,
    paidMonths: 12,
    cyclePaidAmount: 0,
    archived: false,
  });

  const projected = buildCalendarDueOccurrencesByDate(
    [bill],
    "2027-01-01",
    "2027-12-31",
    parseISODate("2026-12-15")
  );

  assert.equal(projected.size, 0);
});
