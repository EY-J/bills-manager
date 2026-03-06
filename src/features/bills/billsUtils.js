import { addMonthsKeepDay, parseISODate, startOfToday, toISODate } from "../../lib/date/date.js";

export const BILL_CADENCE_OPTIONS = [
  "monthly",
  "bi-weekly",
  "weekly",
  "one-time",
  "statement-plan",
];
export const BILL_REMINDER_OPTIONS = [1, 3, 7];

function cadenceDays(cadence) {
  if (cadence === "weekly") return 7;
  if (cadence === "bi-weekly") return 14;
  return null;
}

function shiftIsoByDays(isoDate, days) {
  const d = parseISODate(isoDate);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function computeBillMeta(bill) {
  const today = startOfToday();
  const due = parseISODate(bill.dueDate);
  const daysToDue = Math.round((due.getTime() - today.getTime()) / 86400000);
  const reminderDays = BILL_REMINDER_OPTIONS.includes(Number(bill?.reminderDays))
    ? Number(bill.reminderDays)
    : 3;
  const cycleAmount = Math.max(0, Number(bill?.amount || 0));
  const cyclePaidAmount = Math.max(0, Number(bill?.cyclePaidAmount || 0));
  const remainingAmount = Math.max(cycleAmount - cyclePaidAmount, 0);
  const isStatementPlan = bill?.cadence === "statement-plan";
  const statementAmounts = Array.isArray(bill?.statementAmounts)
    ? bill.statementAmounts.filter((n) => Number.isFinite(Number(n)) && Number(n) > 0)
    : [];
  const statementIndex = Math.max(
    0,
    Math.min(
      Number.isFinite(Number(bill?.statementIndex))
        ? Math.floor(Number(bill.statementIndex))
        : 0,
      Math.max(statementAmounts.length - 1, 0)
    )
  );
  const isStatementPlanLastCycle =
    isStatementPlan &&
    statementAmounts.length > 0 &&
    statementIndex >= statementAmounts.length - 1;
  const settledInFull =
    (bill?.cadence === "one-time" && cycleAmount > 0 && remainingAmount <= 0) ||
    (isStatementPlan && isStatementPlanLastCycle && cycleAmount > 0 && remainingAmount <= 0);
  const overdue = !settledInFull && daysToDue < 0;
  const dueSoon = !settledInFull && daysToDue >= 0 && daysToDue <= reminderDays;
  const partiallyPaid = cyclePaidAmount > 0 && remainingAmount > 0;

  // months pending = ceil of month distance when overdue
  const monthsPending = overdue ? monthDiffCeil(due, today) : 0;

  const lastPaid = bill.payments?.[0]?.date || null;

  return {
    daysToDue,
    reminderDays,
    overdue,
    dueSoon,
    cycleAmount,
    cyclePaidAmount,
    remainingAmount,
    settledInFull,
    partiallyPaid,
    monthsPending,
    lastPaid,
    dueDateObj: due,
  };
}

export function monthDiffCeil(fromDate, toDate) {
  const a = new Date(fromDate);
  const b = new Date(toDate);

  const yearDiff = b.getFullYear() - a.getFullYear();
  const monthDiff = b.getMonth() - a.getMonth() + yearDiff * 12;
  const dayDiff = b.getDate() - a.getDate();

  let m = monthDiff;
  if (dayDiff > 0) m += 1; // partial month counts
  if (m < 0) m = 0;
  return m;
}

export function makePayment({ amount, note = "" }) {
  return {
    id: crypto.randomUUID(),
    date: toISODate(startOfToday()),
    amount: Number(amount || 0),
    note,
  };
}

export function advanceDueDateOneMonth(isoDueDate) {
  return addMonthsKeepDay(isoDueDate, 1);
}

export function shiftDueDateByCadence(isoDueDate, cadence = "monthly", steps = 1) {
  const safeSteps = Number(steps || 0);
  if (!safeSteps) return isoDueDate;
  if (cadence === "one-time" || cadence === "statement-plan") {
    if (cadence === "statement-plan") {
      return addMonthsKeepDay(isoDueDate, safeSteps);
    }
    return isoDueDate;
  }

  if (cadence === "monthly") {
    return addMonthsKeepDay(isoDueDate, safeSteps);
  }

  const days = cadenceDays(cadence) || 7;
  return shiftIsoByDays(isoDueDate, days * safeSteps);
}

export function advanceDueDateByCadence(isoDueDate, cadence = "monthly") {
  return shiftDueDateByCadence(isoDueDate, cadence, 1);
}

export function getPlanProgress(bill) {
  const totalMonths = Math.max(0, Number(bill?.totalMonths || 0));
  const paidRaw = Math.max(0, Number(bill?.paidMonths || 0));
  const paidMonths = totalMonths > 0 ? Math.min(paidRaw, totalMonths) : paidRaw;
  const monthsLeft = totalMonths > 0 ? Math.max(totalMonths - paidMonths, 0) : 0;

  return {
    enabled: totalMonths > 0,
    totalMonths,
    paidMonths,
    monthsLeft,
  };
}
