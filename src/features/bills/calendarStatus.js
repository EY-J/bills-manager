import { formatMoney } from "../../lib/date/date.js";

const TONE_PRIORITY = {
  overdue: 6,
  dueToday: 5,
  dueSoon: 4,
  partial: 3,
  upcoming: 2,
  paid: 1,
  archived: 0,
};

export function getCalendarBillTone(bill) {
  if (bill?.archived) return "archived";
  if (bill?.meta?.settledInFull) return "paid";
  if (bill?.meta?.overdue) return "overdue";
  if (bill?.meta?.daysToDue === 0) return "dueToday";
  if (bill?.meta?.partiallyPaid) return "partial";
  if (bill?.meta?.dueSoon) return "dueSoon";
  return "upcoming";
}

export function getCalendarBillStatusLabel(bill) {
  if (bill?.archived) return "Archived";
  if (bill?.meta?.settledInFull) return "Paid in full";
  if (bill?.meta?.overdue) {
    if (bill?.meta?.partiallyPaid) {
      return `Overdue - ${formatMoney(bill.meta.remainingAmount)} left`;
    }
    return "Overdue";
  }
  if (bill?.meta?.daysToDue === 0) {
    if (bill?.meta?.partiallyPaid) {
      return `Due today - ${formatMoney(bill.meta.remainingAmount)} left`;
    }
    return "Due today";
  }
  if (bill?.meta?.partiallyPaid) {
    return `Partial - ${formatMoney(bill.meta.remainingAmount)} left`;
  }
  if (bill?.meta?.dueSoon) return `Due in ${bill.meta.daysToDue}d`;
  if (bill?.meta?.hasDueDate === false) return "No due date";
  return "Upcoming";
}

function readCalendarBillTone(entry) {
  if (typeof entry?.tone === "string" && TONE_PRIORITY[entry.tone] !== undefined) {
    return entry.tone;
  }
  return getCalendarBillTone(entry);
}

function readCalendarPaymentTone(entry) {
  if (typeof entry?.tone === "string" && TONE_PRIORITY[entry.tone] !== undefined) {
    return entry.tone;
  }
  return "paid";
}

export function pickCalendarActivityTone(dayBills, dayPayments = []) {
  if (Array.isArray(dayBills) && dayBills.length > 0) {
    return dayBills.slice(1).reduce((best, bill) => {
      const nextTone = readCalendarBillTone(bill);
      if (TONE_PRIORITY[nextTone] > TONE_PRIORITY[best]) return nextTone;
      return best;
    }, readCalendarBillTone(dayBills[0]));
  }

  if (Array.isArray(dayPayments) && dayPayments.length > 0) {
    return dayPayments.slice(1).reduce((best, payment) => {
      const nextTone = readCalendarPaymentTone(payment);
      if (TONE_PRIORITY[nextTone] > TONE_PRIORITY[best]) return nextTone;
      return best;
    }, readCalendarPaymentTone(dayPayments[0]));
  }

  return "upcoming";
}
