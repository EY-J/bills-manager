import test from "node:test";
import assert from "node:assert/strict";
import { buildRestorePlan } from "../src/features/bills/billsService.js";

function bill(id, amount, extra = {}) {
  return {
    id,
    name: `Bill ${id}`,
    category: "Utilities",
    dueDate: "2026-03-01",
    amount,
    notes: "",
    payments: [],
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 0,
    paidMonths: 0,
    cyclePaidAmount: 0,
    ...extra,
  };
}

test("restore plan replace mode reports add/update/delete and replaces list", () => {
  const current = [bill("a", 100), bill("b", 200)];
  const incoming = [bill("b", 250), bill("c", 300)];
  const plan = buildRestorePlan({
    currentBills: current,
    incomingBills: incoming,
    mode: "replace",
    conflictPolicy: "overwrite",
  });

  assert.equal(plan.preview.mode, "replace");
  assert.equal(plan.preview.added, 1);
  assert.equal(plan.preview.updated, 1);
  assert.equal(plan.preview.deleted, 1);
  assert.equal(plan.preview.conflicts, 1);
  assert.equal(plan.preview.skipped, 0);
  assert.deepEqual(
    plan.bills.map((b) => b.id),
    ["b", "c"]
  );
});

test("restore plan merge overwrite updates conflicts and keeps existing others", () => {
  const current = [bill("a", 100), bill("b", 200)];
  const incoming = [bill("b", 250), bill("c", 300)];
  const plan = buildRestorePlan({
    currentBills: current,
    incomingBills: incoming,
    mode: "merge",
    conflictPolicy: "overwrite",
  });

  assert.equal(plan.preview.mode, "merge");
  assert.equal(plan.preview.added, 1);
  assert.equal(plan.preview.updated, 1);
  assert.equal(plan.preview.deleted, 0);
  assert.equal(plan.preview.conflicts, 1);
  assert.equal(plan.preview.skipped, 0);
  assert.deepEqual(
    plan.bills.map((b) => [b.id, b.amount]),
    [
      ["a", 100],
      ["b", 250],
      ["c", 300],
    ]
  );
});

test("restore plan merge keep-existing skips conflicting updates", () => {
  const current = [bill("a", 100), bill("b", 200)];
  const incoming = [bill("b", 250), bill("c", 300)];
  const plan = buildRestorePlan({
    currentBills: current,
    incomingBills: incoming,
    mode: "merge",
    conflictPolicy: "skip",
  });

  assert.equal(plan.preview.mode, "merge");
  assert.equal(plan.preview.added, 1);
  assert.equal(plan.preview.updated, 0);
  assert.equal(plan.preview.deleted, 0);
  assert.equal(plan.preview.conflicts, 1);
  assert.equal(plan.preview.skipped, 1);
  assert.deepEqual(
    plan.bills.map((b) => [b.id, b.amount]),
    [
      ["a", 100],
      ["b", 200],
      ["c", 300],
    ]
  );
});

