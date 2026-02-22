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

function rollBillToCurrentPeriod(bill, today) {
  let dueDateObj = parseISODate(bill.dueDate);
  if (!shouldRollForward(dueDateObj, bill.cadence, today)) return bill;

  const payments = [...(bill.payments || [])];
  let dueDate = bill.dueDate;
  let changed = false;

  // Auto-create missed cycles and carry them in history.
  while (shouldRollForward(dueDateObj, bill.cadence, today)) {
    payments.unshift({
      id: crypto.randomUUID(),
      date: toISODate(today),
      amount: 0,
      note: "Unpaid rollover",
    });
    dueDate = advanceDueDateByCadence(dueDate, bill.cadence);
    dueDateObj = parseISODate(dueDate);
    changed = true;
  }

  if (!changed) return bill;
  return { ...bill, dueDate, payments };
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

function normalizeBillShape(bill) {
  const plan = normalizePlan(bill?.totalMonths, bill?.paidMonths);
  return {
    ...bill,
    cadence: normalizeCadence(bill?.cadence),
    reminderDays: normalizeReminderDays(bill?.reminderDays),
    totalMonths: plan.totalMonths,
    paidMonths: plan.paidMonths,
    payments: Array.isArray(bill?.payments) ? bill.payments : [],
    archived: Boolean(bill?.archived),
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
      // ignore
    }
  }, [bills]);

  // Persist notification toggle.
  useEffect(() => {
    try {
      localStorage.setItem("bills_notify_enabled", String(notifyEnabled));
    } catch {
      // ignore
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
      prev.map((b) => {
        if (b.id !== id) return b;
        const payment = makePayment({ amount: b.amount, note: "Paid" });
        const totalMonths = Math.max(0, Number(b.totalMonths || 0));
        const paidMonths =
          totalMonths > 0
            ? Math.min(totalMonths, Math.max(0, Number(b.paidMonths || 0)) + 1)
            : 0;
        return {
          ...b,
          payments: [payment, ...(b.payments || [])],
          dueDate: advanceDueDateByCadence(b.dueDate, b.cadence),
          paidMonths,
        };
      })
    );
  }

  // Manual add payment also advances due date by cadence.
  function addPaymentAndAdvance(id, payment) {
    setBills((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const totalMonths = Math.max(0, Number(b.totalMonths || 0));
        const paidMonths =
          totalMonths > 0
            ? Math.min(totalMonths, Math.max(0, Number(b.paidMonths || 0)) + 1)
            : 0;
        return {
          ...b,
          payments: [payment, ...(b.payments || [])],
          dueDate: advanceDueDateByCadence(b.dueDate, b.cadence),
          paidMonths,
        };
      })
    );
  }

  function updatePayment(id, paymentId, patch) {
    setBills((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const nextPayments = (b.payments || []).map((p) =>
          p.id === paymentId
            ? {
                ...p,
                date: patch.date ?? p.date,
                amount:
                  patch.amount === undefined ? Number(p.amount || 0) : Number(patch.amount || 0),
                note: patch.note ?? p.note,
              }
            : p
        );
        return syncSeedPaidHistory({ ...b, payments: nextPayments });
      })
    );
  }

  function deletePayment(id, paymentId) {
    setBills((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const payments = b.payments || [];
        const target = payments.find((p) => p.id === paymentId);
        if (!target) return b;

        const nextPayments = payments.filter((p) => p.id !== paymentId);
        const countedPayment =
          Number(target.amount || 0) > 0 &&
          !target.autoSeedPaidMonths &&
          target.note !== "Unpaid rollover";

        if (!countedPayment) {
          return syncSeedPaidHistory({ ...b, payments: nextPayments });
        }

        const totalMonths = Math.max(0, Number(b.totalMonths || 0));
        const paidMonths =
          totalMonths > 0 ? Math.max(0, Number(b.paidMonths || 0) - 1) : 0;

        return syncSeedPaidHistory({
          ...b,
          payments: nextPayments,
          dueDate: shiftDueDateByCadence(b.dueDate, b.cadence, -1),
          paidMonths,
        });
      })
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
      // ignore
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
