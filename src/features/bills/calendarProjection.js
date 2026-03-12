import {
  isISODateString,
  parseISODate,
  startOfToday,
} from "../../lib/date/date.js";
import { shiftDueDateByCadence } from "./billsUtils.js";
import {
  getCalendarBillStatusLabel,
  getCalendarBillTone,
} from "./calendarStatus.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PROJECTED_CYCLES = 240;
const ROLLOVER_NOTE_RE = /^Unpaid rollover(?: \(\+(\d+) older cycles\))?$/;

function normalizeDateInput(value) {
  if (value instanceof Date) {
    const next = new Date(value);
    next.setHours(0, 0, 0, 0);
    return next;
  }
  if (isISODateString(value)) return parseISODate(value);
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function isWithinRange(isoDate, rangeStart, rangeEnd) {
  if (!isISODateString(isoDate)) return false;
  const time = parseISODate(isoDate).getTime();
  return time >= rangeStart.getTime() && time <= rangeEnd.getTime();
}

function diffDaysFromToday(isoDate, today) {
  return Math.round((parseISODate(isoDate).getTime() - today.getTime()) / DAY_MS);
}

function normalizeMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Number(amount) : 0;
}

function createOccurrence({
  bill,
  dueDate,
  amount,
  displayAmount,
  remainingAmount,
  tone,
  statusLabel,
  variant,
}) {
  return {
    id: `${bill.id}:${dueDate}:${variant}`,
    billId: bill.id,
    dueDate,
    name: bill.name,
    amount,
    displayAmount,
    remainingAmount,
    tone,
    statusLabel,
  };
}

function buildLiveOccurrence(bill) {
  const amount = normalizeMoney(bill?.amount);
  const remainingSource = bill?.meta?.remainingAmount ?? amount;
  const remainingAmount = Math.max(
    0,
    Number.isFinite(Number(remainingSource)) ? Number(remainingSource) : 0
  );
  const tone = getCalendarBillTone(bill);
  const statusLabel = getCalendarBillStatusLabel(bill);

  return createOccurrence({
    bill,
    dueDate: bill.dueDate,
    amount,
    displayAmount: tone === "paid" ? amount : remainingAmount,
    remainingAmount,
    tone,
    statusLabel,
    variant: "live",
  });
}

function buildScheduledOccurrence(bill, dueDate, amount, today) {
  const reminderSource = bill?.meta?.reminderDays ?? bill?.reminderDays ?? 0;
  const reminderDays = Math.max(
    0,
    Number.isFinite(Number(reminderSource)) ? Number(reminderSource) : 0
  );
  const daysToDue = diffDaysFromToday(dueDate, today);

  let tone = "upcoming";
  let statusLabel = "Upcoming";

  if (daysToDue < 0) {
    tone = "overdue";
    statusLabel = "Overdue";
  } else if (daysToDue === 0) {
    tone = "dueToday";
    statusLabel = "Due today";
  } else if (daysToDue <= reminderDays) {
    tone = "dueSoon";
    statusLabel = `Due in ${daysToDue}d`;
  }

  return createOccurrence({
    bill,
    dueDate,
    amount,
    displayAmount: amount,
    remainingAmount: amount,
    tone,
    statusLabel,
    variant: "projected",
  });
}

function buildHistoricalOccurrence(bill, dueDate, amount, tone) {
  return createOccurrence({
    bill,
    dueDate,
    amount,
    displayAmount: amount,
    remainingAmount: tone === "paid" ? 0 : amount,
    tone,
    statusLabel: tone === "paid" ? "Paid" : "Overdue",
    variant: tone,
  });
}

function getRolloverAdvanceCount(payment) {
  const note = typeof payment?.note === "string" ? payment.note.trim() : "";
  const match = ROLLOVER_NOTE_RE.exec(note);
  if (!match) return 0;
  const olderCycles = Number(match[1] || 0);
  return 1 + (Number.isFinite(olderCycles) && olderCycles > 0 ? olderCycles : 0);
}

function getPaidAdvanceCount(payment) {
  if (!payment) return 0;
  if (payment.autoSeedPaidMonths === true) return 1;
  const amount = normalizeMoney(payment.amount);
  if (amount <= 0) return 0;
  const settledCycles = Number(payment.settledCycles || 0);
  return Number.isFinite(settledCycles) && settledCycles > 0
    ? Math.floor(settledCycles)
    : 0;
}

function buildRecurringHistoryEvents(bill) {
  const payments = Array.isArray(bill?.payments) ? bill.payments : [];

  return payments
    .map((payment, index) => {
      const date = isISODateString(payment?.date) ? payment.date : null;
      if (!date) return null;

      const rolloverCount = getRolloverAdvanceCount(payment);
      if (rolloverCount > 0) {
        return {
          date,
          index,
          priority: 0,
          count: rolloverCount,
          tone: "overdue",
        };
      }

      const paidCount = getPaidAdvanceCount(payment);
      if (paidCount > 0) {
        return {
          date,
          index,
          priority: 1,
          count: paidCount,
          tone: "paid",
        };
      }

      return null;
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.priority - b.priority ||
        a.index - b.index
    );
}

function estimateForwardStartStep(currentDueDate, cadence, rangeStart) {
  if (cadence === "monthly" || cadence === "statement-plan") {
    const currentMonthIndex =
      currentDueDate.getFullYear() * 12 + currentDueDate.getMonth();
    const rangeMonthIndex = rangeStart.getFullYear() * 12 + rangeStart.getMonth();
    return Math.max(rangeMonthIndex - currentMonthIndex - 1, 0);
  }

  const cadenceDays = cadence === "bi-weekly" ? 14 : 7;
  const diffMs = rangeStart.getTime() - currentDueDate.getTime();
  return Math.max(Math.floor(diffMs / (cadenceDays * DAY_MS)) - 1, 0);
}

function getRemainingRecurringCycles(bill) {
  const totalMonths = Math.max(0, Number(bill?.totalMonths || 0));
  if (totalMonths <= 0) return Number.POSITIVE_INFINITY;
  const paidMonths = Math.max(0, Number(bill?.paidMonths || 0));
  return Math.max(totalMonths - Math.min(paidMonths, totalMonths), 0);
}

function buildRecurringOccurrencesForRange(bill, rangeStart, rangeEnd, today) {
  if (!isISODateString(bill?.dueDate)) return [];

  const amount = normalizeMoney(bill?.amount);
  const currentDueDate = parseISODate(bill.dueDate);
  const historyEvents = buildRecurringHistoryEvents(bill);
  const remainingRecurringCycles = getRemainingRecurringCycles(bill);
  const totalHistorySteps = historyEvents.reduce((sum, event) => sum + event.count, 0);
  let cursorDueDate = shiftDueDateByCadence(
    bill.dueDate,
    bill.cadence,
    -totalHistorySteps
  );
  const occurrences = [];

  historyEvents.forEach((event) => {
    for (let step = 0; step < event.count; step += 1) {
      if (isWithinRange(cursorDueDate, rangeStart, rangeEnd)) {
        occurrences.push(
          buildHistoricalOccurrence(bill, cursorDueDate, amount, event.tone)
        );
      }
      cursorDueDate = shiftDueDateByCadence(cursorDueDate, bill.cadence, 1);
    }
  });

  let forwardStep = estimateForwardStartStep(currentDueDate, bill.cadence, rangeStart);
  for (
    let guard = 0;
    guard < MAX_PROJECTED_CYCLES && forwardStep < remainingRecurringCycles;
    guard += 1
  ) {
    const dueDate = shiftDueDateByCadence(bill.dueDate, bill.cadence, forwardStep);
    const dueDateObj = parseISODate(dueDate);
    if (dueDateObj.getTime() > rangeEnd.getTime()) break;

    if (dueDateObj.getTime() >= rangeStart.getTime()) {
      occurrences.push(
        forwardStep === 0
          ? buildLiveOccurrence(bill)
          : buildScheduledOccurrence(bill, dueDate, amount, today)
      );
    }

    forwardStep += 1;
  }

  return occurrences;
}

function buildStatementPlanOccurrencesForRange(bill, rangeStart, rangeEnd, today) {
  if (!isISODateString(bill?.dueDate)) return [];

  const statementAmountsRaw = Array.isArray(bill?.statementAmounts)
    ? bill.statementAmounts
    : [];
  const statementAmounts =
    statementAmountsRaw.length > 0
      ? statementAmountsRaw.map((value) => normalizeMoney(value))
      : [normalizeMoney(bill?.amount)];
  const currentIndex = Math.max(
    0,
    Math.min(
      Number.isFinite(Number(bill?.statementIndex))
        ? Math.floor(Number(bill.statementIndex))
        : 0,
      Math.max(statementAmounts.length - 1, 0)
    )
  );
  const occurrences = [];

  for (let index = 0; index < currentIndex; index += 1) {
    const step = index - currentIndex;
    const dueDate = shiftDueDateByCadence(bill.dueDate, "monthly", step);
    if (!isWithinRange(dueDate, rangeStart, rangeEnd)) continue;
    occurrences.push(
      buildHistoricalOccurrence(bill, dueDate, statementAmounts[index] || 0, "paid")
    );
  }

  const currentDueDate = parseISODate(bill.dueDate);
  if (
    currentDueDate.getTime() >= rangeStart.getTime() &&
    currentDueDate.getTime() <= rangeEnd.getTime()
  ) {
    occurrences.push(buildLiveOccurrence(bill));
  }

  for (let index = currentIndex + 1; index < statementAmounts.length; index += 1) {
    const dueDate = shiftDueDateByCadence(bill.dueDate, "monthly", index - currentIndex);
    const dueDateObj = parseISODate(dueDate);
    if (dueDateObj.getTime() > rangeEnd.getTime()) break;
    if (dueDateObj.getTime() < rangeStart.getTime()) continue;
    occurrences.push(
      buildScheduledOccurrence(bill, dueDate, statementAmounts[index] || 0, today)
    );
  }

  return occurrences;
}

function buildOneTimeOccurrencesForRange(bill, rangeStart, rangeEnd) {
  if (!isISODateString(bill?.dueDate)) return [];
  if (!isWithinRange(bill.dueDate, rangeStart, rangeEnd)) return [];
  return [buildLiveOccurrence(bill)];
}

export function buildCalendarDueOccurrencesByDate(
  bills,
  rangeStart,
  rangeEnd,
  today = startOfToday()
) {
  const startDate = normalizeDateInput(rangeStart);
  const endDate = normalizeDateInput(rangeEnd);
  const todayDate = normalizeDateInput(today);
  const occurrencesByDate = new Map();

  (Array.isArray(bills) ? bills : []).forEach((bill) => {
    let occurrences = [];

    if (bill?.cadence === "one-time") {
      occurrences = buildOneTimeOccurrencesForRange(bill, startDate, endDate);
    } else if (bill?.cadence === "statement-plan") {
      occurrences = buildStatementPlanOccurrencesForRange(
        bill,
        startDate,
        endDate,
        todayDate
      );
    } else {
      occurrences = buildRecurringOccurrencesForRange(
        bill,
        startDate,
        endDate,
        todayDate
      );
    }

    occurrences.forEach((occurrence) => {
      const existing = occurrencesByDate.get(occurrence.dueDate) || [];
      existing.push(occurrence);
      occurrencesByDate.set(occurrence.dueDate, existing);
    });
  });

  occurrencesByDate.forEach((entries, key) => {
    entries.sort(
      (a, b) =>
        Number(a.amount || 0) - Number(b.amount || 0) ||
        String(a.name || "").localeCompare(String(b.name || "")) ||
        String(a.billId || "").localeCompare(String(b.billId || ""))
    );
    occurrencesByDate.set(key, entries);
  });

  return occurrencesByDate;
}
