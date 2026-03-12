import test from "node:test";
import assert from "node:assert/strict";
import {
  getCalendarBillStatusLabel,
  getCalendarBillTone,
  pickCalendarActivityTone,
} from "../src/features/bills/calendarStatus.js";

test("calendar due entries do not inherit paid status from a prior cycle payment", () => {
  const bill = {
    id: "water",
    name: "Water",
    dueDate: "2026-04-08",
    meta: {
      hasDueDate: true,
      settledInFull: false,
      overdue: false,
      daysToDue: 27,
      partiallyPaid: false,
      dueSoon: false,
      remainingAmount: 12,
      lastPaid: "2026-03-08",
    },
  };

  assert.equal(getCalendarBillTone(bill), "upcoming");
  assert.equal(getCalendarBillStatusLabel(bill), "Upcoming");
});

test("calendar keeps fully settled one-time bills marked paid", () => {
  const bill = {
    id: "friend-debt",
    name: "Friend debt",
    dueDate: "2026-03-08",
    meta: {
      hasDueDate: true,
      settledInFull: true,
      overdue: false,
      daysToDue: -4,
      partiallyPaid: false,
      dueSoon: false,
      remainingAmount: 0,
      lastPaid: "2026-03-08",
    },
  };

  assert.equal(getCalendarBillTone(bill), "paid");
  assert.equal(getCalendarBillStatusLabel(bill), "Paid in full");
});

test("calendar day tone stays paid when all due activity is paid", () => {
  const tone = pickCalendarActivityTone([
    {
      tone: "paid",
    },
  ]);

  assert.equal(tone, "paid");
});
