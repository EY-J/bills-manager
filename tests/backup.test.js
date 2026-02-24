import test from "node:test";
import assert from "node:assert/strict";
import {
  createBackupPayload,
  validateBackupPayload,
} from "../src/features/bills/billsService.js";

function sampleBill() {
  return {
    id: "bill-1",
    name: "Water",
    category: "Utilities",
    dueDate: "2026-03-01",
    amount: 400,
    notes: "",
    payments: [],
    cadence: "monthly",
    reminderDays: 3,
    totalMonths: 12,
    paidMonths: 1,
    cyclePaidAmount: 0,
  };
}

test("backup payload validates successfully when untouched", () => {
  const payload = createBackupPayload({
    bills: [sampleBill()],
    notifyEnabled: true,
  });

  const result = validateBackupPayload(payload);
  assert.equal(result.ok, true);
  assert.equal(Array.isArray(result.data.bills), true);
  assert.equal(result.data.notifyEnabled, true);
});

test("backup checksum detects tampering", () => {
  const payload = createBackupPayload({
    bills: [sampleBill()],
    notifyEnabled: false,
  });
  payload.checksum = "deadbeef";

  const result = validateBackupPayload(payload);
  assert.equal(result.ok, false);
  assert.match(result.reason, /checksum/i);
});

test("future backup schema is rejected by migration guard", () => {
  const payload = createBackupPayload({
    bills: [sampleBill()],
    notifyEnabled: false,
  });

  const future = {
    ...payload,
    schemaVersion: Number(payload.schemaVersion) + 1,
  };

  const result = validateBackupPayload(future);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Unsupported backup version/i);
});
