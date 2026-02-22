import { addMonthsKeepDay, parseISODate, startOfToday, toISODate } from "../../lib/date/date.js";

export const BILL_CADENCE_OPTIONS = ["monthly", "bi-weekly", "weekly"];
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
  const overdue = daysToDue < 0;
  const dueSoon = daysToDue >= 0 && daysToDue <= reminderDays;

  // months pending = ceil of month distance when overdue
  const monthsPending = overdue ? monthDiffCeil(due, today) : 0;

  const lastPaid = bill.payments?.[0]?.date || null;

  return {
    daysToDue,
    reminderDays,
    overdue,
    dueSoon,
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
