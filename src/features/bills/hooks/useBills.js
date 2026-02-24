import { useEffect, useState } from "react";
import { clearBills, loadBills, saveBills } from "../billsService.js";
import {
  advanceDueDateByCadence,
  BILL_CADENCE_OPTIONS,
  BILL_REMINDER_OPTIONS,
  makePayment,
  shiftDueDateByCadence,
} from "../billsUtils.js";
import { parseISODate, startOfToday, toISODate } from "../../../lib/date/date.js";

export const STORAGE_WARNING_EVENT = "bills:storage-warning";
export const MAX_UNPAID_ROLLOVER_ENTRIES = 120;

function emitStorageWarning() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(STORAGE_WARNING_EVENT));
  } catch {
    // ignore
  }
}

function monthIndex(d) {
  return d.getFullYear() * 12 + d.getMonth();
}

function cadenceStepDays(cadence) {
  if (cadence === "weekly") return 7;
  if (cadence === "bi-weekly") return 14;
  return null;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function shouldRollForward(dueDate, cadence, today) {
  if (cadence === "monthly") {
    return monthIndex(dueDate) < monthIndex(today);
  }

  const stepDays = cadenceStepDays(cadence) || 7;
  const duePlusStep = addDays(dueDate, stepDays);
  return duePlusStep <= today;
}

function countRolloverCycles(dueDate, cadence, today) {
  if (!shouldRollForward(dueDate, cadence, today)) return 0;

  if (cadence === "monthly") {
    return Math.max(monthIndex(today) - monthIndex(dueDate), 0);
  }

  const stepDays = cadenceStepDays(cadence) || 7;
  const stepMs = stepDays * 24 * 60 * 60 * 1000;
  const diffMs = today.getTime() - dueDate.getTime();
  return Math.max(Math.floor(diffMs / stepMs), 0);
}

export function rollBillToCurrentPeriod(bill, today) {
  const dueDateObj = parseISODate(bill.dueDate);
  const rolloverCycles = countRolloverCycles(dueDateObj, bill.cadence, today);
  if (rolloverCycles <= 0) return bill;

  // Fast-forward due date and cap rollover history entries to avoid heavy startup loops.
  const nextDueDate = shiftDueDateByCadence(
    bill.dueDate,
    bill.cadence,
    rolloverCycles
  );
  const entriesToStore = Math.min(
    rolloverCycles,
    MAX_UNPAID_ROLLOVER_ENTRIES
  );
  const compressedCycles = rolloverCycles - entriesToStore;
  const nowIso = toISODate(today);
  const rolloverEntries = Array.from({ length: entriesToStore }, (_, idx) => ({
    id: crypto.randomUUID(),
    date: nowIso,
    amount: 0,
    note:
      compressedCycles > 0 && idx === 0
        ? `Unpaid rollover (+${compressedCycles} older cycles)`
        : "Unpaid rollover",
  }));

  return {
    ...bill,
    dueDate: nextDueDate,
    payments: [...rolloverEntries, ...(bill.payments || [])],
  };
}

function normalizePlan(totalMonths, paidMonths) {
  const total = Math.max(0, Number(totalMonths || 0));
  let paid = Math.max(0, Number(paidMonths || 0));
  if (total > 0) paid = Math.min(paid, total);
  if (total === 0) paid = 0;
  return { totalMonths: total, paidMonths: paid };
}

function normalizeCadence(cadence) {
  return BILL_CADENCE_OPTIONS.includes(cadence) ? cadence : "monthly";
}

function normalizeReminderDays(reminderDays) {
  const n = Number(reminderDays);
  return BILL_REMINDER_OPTIONS.includes(n) ? n : 3;
}

function normalizeCyclePaidAmount(cyclePaidAmount, amount) {
  const paid = Number(cyclePaidAmount);
  const safePaid = Number.isFinite(paid) && paid > 0 ? paid : 0;
  const cycleAmount = Math.max(0, Number(amount || 0));
  if (cycleAmount <= 0) return 0;
  return Math.max(0, Math.min(safePaid, cycleAmount));
}

function normalizeSettledCycles(settledCycles) {
  const n = Number(settledCycles);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function applyPaymentToCycle(bill, payment) {
  const cycleAmount = Math.max(0, Number(bill.amount || 0));
  let cyclePaidAmount = normalizeCyclePaidAmount(
    bill.cyclePaidAmount,
    cycleAmount
  );
  const paymentAmount = Math.max(0, Number(payment.amount || 0));

  if (cycleAmount <= 0) {
    return {
      bill: {
        ...bill,
        payments: [payment, ...(bill.payments || [])],
        cyclePaidAmount: 0,
      },
      settledCycles: 0,
    };
  }

  cyclePaidAmount += paymentAmount;
  let settledCycles = 0;
  let nextDueDate = bill.dueDate;

  while (cyclePaidAmount >= cycleAmount) {
    cyclePaidAmount -= cycleAmount;
    nextDueDate = advanceDueDateByCadence(nextDueDate, bill.cadence);
    settledCycles += 1;
  }

  const totalMonths = Math.max(0, Number(bill.totalMonths || 0));
  const nextPaidMonths =
    totalMonths > 0
      ? Math.min(
          totalMonths,
          Math.max(0, Number(bill.paidMonths || 0)) + settledCycles
        )
      : 0;

  return {
    bill: {
      ...bill,
      dueDate: nextDueDate,
      paidMonths: nextPaidMonths,
      cyclePaidAmount,
      payments: [
        { ...payment, settledCycles: normalizeSettledCycles(settledCycles) },
        ...(bill.payments || []),
      ],
    },
    settledCycles,
  };
}

function normalizeBillShape(bill) {
  const plan = normalizePlan(bill?.totalMonths, bill?.paidMonths);
  return {
    ...bill,
    cadence: normalizeCadence(bill?.cadence),
    reminderDays: normalizeReminderDays(bill?.reminderDays),
    totalMonths: plan.totalMonths,
    paidMonths: plan.paidMonths,
    payments: Array.isArray(bill?.payments)
      ? bill.payments.map((p) => ({
          ...p,
          settledCycles: normalizeSettledCycles(p?.settledCycles),
        }))
      : [],
    archived: Boolean(bill?.archived),
    cyclePaidAmount: normalizeCyclePaidAmount(bill?.cyclePaidAmount, bill?.amount),
    reminderSnooze:
      bill?.reminderSnooze && typeof bill.reminderSnooze === "object"
        ? bill.reminderSnooze
        : null,
  };
}

function isSeedPaidHistory(p) {
  return p?.autoSeedPaidMonths === true;
}

function isManualPaidEntry(p) {
  if (!p || isSeedPaidHistory(p)) return false;
  if (p.note === "Unpaid rollover") return false;
  return Number(p.amount || 0) > 0;
}

function sortPaymentsDesc(payments) {
  return [...payments].sort((a, b) => {
    const at = Date.parse(a?.date || "");
    const bt = Date.parse(b?.date || "");
    const an = Number.isNaN(at) ? 0 : at;
    const bn = Number.isNaN(bt) ? 0 : bt;
    return bn - an;
  });
}

function sortPaymentsAsc(payments) {
  return [...payments].sort((a, b) => {
    const at = Date.parse(a?.date || "");
    const bt = Date.parse(b?.date || "");
    const an = Number.isNaN(at) ? 0 : at;
    const bn = Number.isNaN(bt) ? 0 : bt;
    return an - bn;
  });
}

function isCountedPayment(payment) {
  if (!payment) return false;
  if (payment.autoSeedPaidMonths === true) return false;
  if (payment.note === "Unpaid rollover") return false;
  return Number(payment.amount || 0) > 0;
}

export function recalculateBillCycleFromPayments(bill, nextPaymentsRaw) {
  const safeDueDate = typeof bill?.dueDate === "string" ? bill.dueDate : toISODate(startOfToday());
  const safeCadence = bill?.cadence || "monthly";
  const totalMonths = Math.max(0, Number(bill?.totalMonths || 0));
  const cycleAmount = Math.max(0, Number(bill?.amount || 0));
  const currentPaidMonths = totalMonths > 0 ? Math.max(0, Number(bill?.paidMonths || 0)) : 0;

  const previousPayments = Array.isArray(bill?.payments) ? bill.payments : [];
  const previousSettledCycles = previousPayments.reduce((sum, payment) => {
    if (!isCountedPayment(payment)) return sum;
    return sum + normalizeSettledCycles(payment?.settledCycles);
  }, 0);

  // Rewind old settled cycles, then replay edited payments for consistent due/cycle state.
  const baseDueDate = shiftDueDateByCadence(
    safeDueDate,
    safeCadence,
    -previousSettledCycles
  );
  const basePaidMonths = totalMonths > 0
    ? Math.max(0, currentPaidMonths - previousSettledCycles)
    : 0;

  const incomingPayments = Array.isArray(nextPaymentsRaw) ? nextPaymentsRaw : [];
  let carry = 0;
  let totalSettledCycles = 0;

  const replayed = sortPaymentsAsc(incomingPayments).map((payment) => {
    const amount = Math.max(0, Number(payment?.amount || 0));
    let settledCycles = 0;

    if (isCountedPayment({ ...payment, amount }) && cycleAmount > 0) {
      carry += amount;
      while (carry >= cycleAmount) {
        carry -= cycleAmount;
        settledCycles += 1;
      }
    }

    totalSettledCycles += settledCycles;
    return {
      ...payment,
      amount,
      settledCycles: normalizeSettledCycles(settledCycles),
    };
  });

  const nextDueDate = shiftDueDateByCadence(
    baseDueDate,
    safeCadence,
    totalSettledCycles
  );
  const nextPaidMonths = totalMonths > 0
    ? Math.min(totalMonths, basePaidMonths + totalSettledCycles)
    : 0;

  return {
    ...bill,
    dueDate: nextDueDate,
    paidMonths: nextPaidMonths,
    cyclePaidAmount: cycleAmount > 0 ? normalizeCyclePaidAmount(carry, cycleAmount) : 0,
    payments: sortPaymentsDesc(replayed),
  };
}

function buildSeedPaidHistoryEntries({ dueDate, amount, cadence, count }) {
  if (count <= 0) return [];
  const entries = [];

  // Create paid history entries backdated by bill cadence.
  for (let offset = 1; offset <= count; offset += 1) {
    entries.push({
      id: crypto.randomUUID(),
      date: shiftDueDateByCadence(dueDate, cadence || "monthly", -offset),
      amount: Number(amount || 0),
      note: "Paid (history)",
      autoSeedPaidMonths: true,
    });
  }

  return entries;
}

function syncSeedPaidHistory(bill) {
  const payments = Array.isArray(bill?.payments) ? bill.payments : [];
  const nonSeedPayments = payments.filter((p) => !isSeedPaidHistory(p));
  const manualPaidCount = nonSeedPayments.filter(isManualPaidEntry).length;
  const paidMonths = Math.max(0, Number(bill?.paidMonths || 0));
  const seedCountNeeded = Math.max(paidMonths - manualPaidCount, 0);
  const seedEntries = buildSeedPaidHistoryEntries({
    dueDate: bill.dueDate,
    amount: bill.amount,
    cadence: bill.cadence,
    count: seedCountNeeded,
  });

  return {
    ...bill,
    payments: sortPaymentsDesc([...nonSeedPayments, ...seedEntries]),
  };
}

function hydrateRecurringBills(rawBills) {
  if (!Array.isArray(rawBills)) return [];
  const today = startOfToday();
  return rawBills
    .map((bill) => normalizeBillShape(bill))
    .map((bill) => rollBillToCurrentPeriod(bill, today))
    .map((bill) => syncSeedPaidHistory(bill));
}

export function markBillPaidAndAdvance(bill) {
  const cycleAmount = Math.max(0, Number(bill?.amount || 0));
  const cyclePaid = normalizeCyclePaidAmount(bill?.cyclePaidAmount, cycleAmount);
  const remaining = Math.max(cycleAmount - cyclePaid, 0);
  const amountToMarkPaid = cycleAmount > 0 ? remaining || cycleAmount : 0;
  const payment = makePayment({ amount: amountToMarkPaid, note: "Paid" });
  return applyPaymentToCycle(bill, payment).bill;
}

export function addPaymentToBillAndAdvance(bill, payment) {
  return applyPaymentToCycle(bill, payment).bill;
}

export function updatePaymentInBill(bill, paymentId, patch) {
  const nextPayments = (bill?.payments || []).map((p) =>
    p.id === paymentId
      ? {
          ...p,
          date: patch?.date ?? p.date,
          amount:
            patch?.amount === undefined
              ? Number(p.amount || 0)
              : Number(patch.amount || 0),
          note: patch?.note ?? p.note,
          settledCycles: normalizeSettledCycles(p?.settledCycles),
        }
      : p
  );

  return syncSeedPaidHistory(
    recalculateBillCycleFromPayments(bill, nextPayments)
  );
}

export function deletePaymentFromBill(bill, paymentId) {
  const payments = bill?.payments || [];
  const target = payments.find((p) => p.id === paymentId);
  if (!target) return bill;

  const nextPayments = payments.filter((p) => p.id !== paymentId);
  const countedPayment = isCountedPayment(target);

  if (!countedPayment) {
    return syncSeedPaidHistory({ ...bill, payments: nextPayments });
  }

  const settledCycles = normalizeSettledCycles(target?.settledCycles);
  const totalMonths = Math.max(0, Number(bill.totalMonths || 0));
  const paidMonths =
    totalMonths > 0
      ? Math.max(0, Number(bill.paidMonths || 0) - settledCycles)
      : 0;
  const cycleAmount = Math.max(0, Number(bill.amount || 0));
  const nextCyclePaidAmount = normalizeCyclePaidAmount(
    Math.max(0, Number(bill.cyclePaidAmount || 0) - Number(target.amount || 0)),
    cycleAmount
  );

  return syncSeedPaidHistory({
    ...bill,
    payments: nextPayments,
    dueDate: shiftDueDateByCadence(bill.dueDate, bill.cadence, -settledCycles),
    paidMonths,
    cyclePaidAmount: nextCyclePaidAmount,
  });
}

export function useBills() {
  // Load from storage once, during initial state creation.
  const [bills, setBills] = useState(() => {
    try {
      return hydrateRecurringBills(loadBills());
    } catch {
      return [];
    }
  });

  const [notifyEnabled, setNotifyEnabled] = useState(() => {
    try {
      const raw = localStorage.getItem("bills_notify_enabled");
      return raw === "true";
    } catch {
      return false;
    }
  });
  // Persist bills on changes.
  useEffect(() => {
    try {
      saveBills(bills);
    } catch {
      emitStorageWarning();
    }
  }, [bills]);

  // Persist notification toggle.
  useEffect(() => {
    try {
      localStorage.setItem("bills_notify_enabled", String(notifyEnabled));
    } catch {
      emitStorageWarning();
    }
  }, [notifyEnabled]);

  function addBill(data) {
    const plan = normalizePlan(data.totalMonths, data.paidMonths);
    const bill = syncSeedPaidHistory({
      id: crypto.randomUUID(),
      name: data.name.trim(),
      category: data.category || "Other",
      dueDate: data.dueDate,
      amount: Number(data.amount || 0),
      notes: data.notes || "",
      payments: [],
      cadence: normalizeCadence(data.cadence),
      reminderDays: normalizeReminderDays(data.reminderDays),
      totalMonths: plan.totalMonths,
      paidMonths: plan.paidMonths,
      cyclePaidAmount: 0,
    });
    setBills((prev) => [bill, ...prev]);
  }

  function updateBill(id, data) {
    const plan = normalizePlan(data.totalMonths, data.paidMonths);
    setBills((prev) =>
      prev.map((b) =>
        b.id === id
          ? syncSeedPaidHistory({
              ...b,
              name: data.name.trim(),
              category: data.category || "Other",
              dueDate: data.dueDate,
              amount: Number(data.amount || 0),
              notes: data.notes || "",
              cadence: normalizeCadence(data.cadence),
              reminderDays: normalizeReminderDays(data.reminderDays),
              totalMonths: plan.totalMonths,
              paidMonths: plan.paidMonths,
              cyclePaidAmount: normalizeCyclePaidAmount(
                b.cyclePaidAmount,
                Number(data.amount || 0)
              ),
            })
          : b
      )
    );
  }

  function deleteBill(id) {
    setBills((prev) => prev.filter((b) => b.id !== id));
  }

  function setBillArchived(id, archived = true) {
    setBills((prev) =>
      prev.map((b) => (b.id === id ? { ...b, archived: Boolean(archived) } : b))
    );
  }

  function duplicateBill(id) {
    setBills((prev) => {
      const source = prev.find((b) => b.id === id);
      if (!source) return prev;

      const copy = syncSeedPaidHistory({
        ...source,
        id: crypto.randomUUID(),
        name: `${source.name} (copy)`,
        archived: false,
        reminderSnooze: null,
        cyclePaidAmount: 0,
        payments: [],
      });

      return [copy, ...prev];
    });
  }

  function setBillReminderSnooze(id, reminderSnooze) {
    setBills((prev) =>
      prev.map((b) =>
        b.id === id
          ? {
              ...b,
              reminderSnooze: reminderSnooze || null,
            }
          : b
      )
    );
  }

  // Mark paid = add payment + move dueDate based on cadence.
  function markPaidAndAdvance(id) {
    setBills((prev) =>
      prev.map((b) => (b.id === id ? markBillPaidAndAdvance(b) : b))
    );
  }

  // Manual add payment advances due only when cycle amount is fully covered.
  function addPaymentAndAdvance(id, payment) {
    setBills((prev) =>
      prev.map((b) => (b.id === id ? addPaymentToBillAndAdvance(b, payment) : b))
    );
  }

  function updatePayment(id, paymentId, patch) {
    setBills((prev) =>
      prev.map((b) =>
        b.id === id ? updatePaymentInBill(b, paymentId, patch) : b
      )
    );
  }

  function deletePayment(id, paymentId) {
    setBills((prev) =>
      prev.map((b) => (b.id === id ? deletePaymentFromBill(b, paymentId) : b))
    );
  }

  function updateNotes(id, notes) {
    setBills((prev) => prev.map((b) => (b.id === id ? { ...b, notes } : b)));
  }

  function clearAll() {
    setBills([]);
    try {
      clearBills();
    } catch {
      emitStorageWarning();
    }
  }

  function replaceAllBills(nextBills) {
    setBills(hydrateRecurringBills(Array.isArray(nextBills) ? nextBills : []));
  }

  return {
    bills,
    addBill,
    updateBill,
    deleteBill,
    setBillArchived,
    duplicateBill,
    setBillReminderSnooze,
    markPaidAndAdvance,
    addPaymentAndAdvance,
    updatePayment,
    deletePayment,
    updateNotes,
    clearAll,
    replaceAllBills,
    notifyEnabled,
    setNotifyEnabled,
  };
}
