import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  formatMoney,
  formatShortDate,
  isISODateString,
  parseISODate,
  startOfToday,
  toISODate,
} from "../../../lib/date/date.js";
import { buildCalendarDueOccurrencesByDate } from "../calendarProjection.js";
import { pickCalendarActivityTone } from "../calendarStatus.js";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const CALENDAR_CELL_COUNT = 42;
const LEGEND_TAP_HIDE_MS = 2200;
const LEGEND_HOLD_HIDE_MS = 5200;
const LEGEND_HOLD_THRESHOLD_MS = 420;

function getMonthStart(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addMonths(date, step) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + step);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function monthKeyFromIso(isoDate) {
  if (!isISODateString(isoDate)) return "";
  return monthKeyFromDate(parseISODate(isoDate));
}

function getGridStart(viewMonthDate) {
  const firstOfMonth = getMonthStart(viewMonthDate);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  gridStart.setHours(0, 0, 0, 0);
  return gridStart;
}

function formatMonthTitle(viewMonthDate) {
  return viewMonthDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function createMonthDate(year, monthIndex) {
  const next = new Date(year, monthIndex, 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function buildCalendarYearOptions(bills, anchorYear) {
  const years = [anchorYear, startOfToday().getFullYear()];

  (Array.isArray(bills) ? bills : []).forEach((bill) => {
    if (isISODateString(bill?.dueDate)) {
      years.push(parseISODate(bill.dueDate).getFullYear());
    }

    const payments = Array.isArray(bill?.payments) ? bill.payments : [];
    payments.forEach((payment) => {
      if (isISODateString(payment?.date)) {
        years.push(parseISODate(payment.date).getFullYear());
      }
    });
  });

  const minYear = Math.min(...years) - 5;
  const maxYear = Math.max(...years) + 10;

  return Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index);
}

function paymentToneForBill(bill) {
  if (bill?.archived) return "archived";
  if (bill?.meta?.partiallyPaid) return "partial";
  return "paid";
}

function isVisibleCalendarPayment(payment) {
  if (!payment || payment.autoSeedPaidMonths === true) return false;
  if (payment.note === "Unpaid rollover") return false;
  if (typeof payment.date !== "string" || !payment.date.trim()) return false;
  return Number(payment.amount || 0) > 0;
}

function paymentMetaLabel(entry) {
  const amountLabel = `Paid ${formatMoney(entry.amount)}`;
  if (entry.note) return `${amountLabel} | ${entry.note}`;
  if (entry.tone === "partial") return `${amountLabel} | Partial payment`;
  return `${amountLabel} | Payment recorded`;
}

function buildPaymentEntriesByDate(bills) {
  const out = new Map();
  (Array.isArray(bills) ? bills : []).forEach((bill) => {
    const payments = Array.isArray(bill?.payments) ? bill.payments : [];
    payments.forEach((payment, index) => {
      if (!isVisibleCalendarPayment(payment)) return;
      const iso = String(payment.date || "").trim();
      if (!iso) return;
      const existing = out.get(iso) || [];
      existing.push({
        id: `${bill.id}:${payment.id || iso}:${index}`,
        billId: bill.id,
        billName: bill.name,
        amount: Number(payment.amount || 0),
        note: typeof payment.note === "string" ? payment.note.trim() : "",
        tone: paymentToneForBill(bill),
      });
      out.set(iso, existing);
    });
  });

  out.forEach((entries, key) => {
    entries.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    out.set(key, entries);
  });

  return out;
}

function buildMonthActivityDates(viewMonthKey, dueEntriesByDate, paymentsByDate) {
  const dates = new Set();
  dueEntriesByDate.forEach((_, iso) => {
    if (monthKeyFromIso(iso) === viewMonthKey) {
      dates.add(iso);
    }
  });
  paymentsByDate.forEach((_, iso) => {
    if (monthKeyFromIso(iso) === viewMonthKey) {
      dates.add(iso);
    }
  });
  return Array.from(dates).sort((a, b) => a.localeCompare(b));
}

function summarizeSelectedDate(dueCount, paymentCount) {
  const parts = [];
  if (dueCount > 0) {
    parts.push(`${dueCount} due bill${dueCount === 1 ? "" : "s"}`);
  }
  if (paymentCount > 0) {
    parts.push(`${paymentCount} payment${paymentCount === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return "No activity";
  return parts.join(" | ");
}

function activityLabel(dueCount, paymentCount) {
  const parts = [];
  if (dueCount > 0) {
    parts.push(`${dueCount} due bill${dueCount === 1 ? "" : "s"}`);
  }
  if (paymentCount > 0) {
    parts.push(`${paymentCount} payment${paymentCount === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}

function buildCells(viewMonthDate) {
  const start = getGridStart(viewMonthDate);
  return Array.from({ length: CALENDAR_CELL_COUNT }, (_, idx) => {
    const d = new Date(start);
    d.setDate(start.getDate() + idx);
    d.setHours(0, 0, 0, 0);
    return {
      iso: toISODate(d),
      date: d,
      inMonth:
        d.getMonth() === viewMonthDate.getMonth() &&
        d.getFullYear() === viewMonthDate.getFullYear(),
    };
  });
}

export default function BillsCalendarCard({
  bills,
  onOpenBill,
  compact = false,
  contained = false,
  showIntro = true,
}) {
  const [viewMonthDate, setViewMonthDate] = useState(() =>
    getMonthStart(startOfToday())
  );
  const [selectedDateRaw, setSelectedDateRaw] = useState(() =>
    toISODate(startOfToday())
  );
  const [legendOpen, setLegendOpen] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() => startOfToday().getMonth());
  const [pickerYear, setPickerYear] = useState(() => startOfToday().getFullYear());
  const legendWrapRef = useRef(null);
  const monthPickerRef = useRef(null);
  const legendPressStartRef = useRef(0);
  const legendPressDurationRef = useRef(0);
  const legendAutoHideTimerRef = useRef(null);
  const monthPickerId = useId();

  const dueBills = useMemo(
    () => (Array.isArray(bills) ? bills.filter((bill) => !bill.archived) : []),
    [bills]
  );
  const calendarYearOptions = useMemo(
    () => buildCalendarYearOptions(dueBills, viewMonthDate.getFullYear()),
    [dueBills, viewMonthDate]
  );
  const cells = useMemo(() => buildCells(viewMonthDate), [viewMonthDate]);
  const visibleRangeStart = cells[0]?.iso || toISODate(viewMonthDate);
  const visibleRangeEnd = cells[cells.length - 1]?.iso || toISODate(viewMonthDate);
  const billsByDate = useMemo(
    () => buildCalendarDueOccurrencesByDate(dueBills, visibleRangeStart, visibleRangeEnd),
    [dueBills, visibleRangeEnd, visibleRangeStart]
  );
  const paymentsByDate = useMemo(() => buildPaymentEntriesByDate(dueBills), [dueBills]);

  const viewMonthKey = monthKeyFromDate(viewMonthDate);
  const monthActivityDates = useMemo(
    () => buildMonthActivityDates(viewMonthKey, billsByDate, paymentsByDate),
    [billsByDate, paymentsByDate, viewMonthKey]
  );

  const selectedDate = useMemo(() => {
    const isSelectedInMonth = monthKeyFromIso(selectedDateRaw) === viewMonthKey;
    if (isSelectedInMonth) return selectedDateRaw;
    if (monthActivityDates.length > 0) return monthActivityDates[0];
    return toISODate(viewMonthDate);
  }, [selectedDateRaw, monthActivityDates, viewMonthDate, viewMonthKey]);

  const selectedBills = billsByDate.get(selectedDate) || [];
  const selectedPayments = paymentsByDate.get(selectedDate) || [];
  const selectedDateLabel = formatShortDate(selectedDate);
  const selectedSummary = summarizeSelectedDate(
    selectedBills.length,
    selectedPayments.length
  );

  const rootClassName = `${contained ? "" : "card "}calendarCard${
    compact ? " isCompact" : ""
  }${contained ? " isContained" : ""}`.trim();

  function syncMonthPickerToViewMonth() {
    setPickerMonth(viewMonthDate.getMonth());
    setPickerYear(viewMonthDate.getFullYear());
  }

  function clearLegendAutoHideTimer() {
    if (!legendAutoHideTimerRef.current) return;
    window.clearTimeout(legendAutoHideTimerRef.current);
    legendAutoHideTimerRef.current = null;
  }

  function handleLegendPressStart() {
    legendPressStartRef.current = Date.now();
    legendPressDurationRef.current = 0;
  }

  function handleLegendPressEnd() {
    const startedAt = legendPressStartRef.current;
    legendPressStartRef.current = 0;
    if (!startedAt) return;
    legendPressDurationRef.current = Math.max(0, Date.now() - startedAt);
  }

  function handleLegendToggleClick() {
    setLegendOpen((open) => {
      if (open) {
        clearLegendAutoHideTimer();
        return false;
      }
      return true;
    });
  }

  function toggleMonthPicker() {
    if (!monthPickerOpen) {
      syncMonthPickerToViewMonth();
    }
    setMonthPickerOpen((open) => !open);
  }

  function applyMonthPicker() {
    const safeMonth =
      Number.isFinite(Number(pickerMonth)) && Number(pickerMonth) >= 0 && Number(pickerMonth) <= 11
        ? Number(pickerMonth)
        : viewMonthDate.getMonth();
    const safeYear =
      Number.isFinite(Number(pickerYear)) && Number(pickerYear) >= 1
        ? Number(pickerYear)
        : viewMonthDate.getFullYear();
    setViewMonthDate(createMonthDate(safeYear, safeMonth));
    setMonthPickerOpen(false);
  }

  function goToCurrentMonth() {
    setViewMonthDate(getMonthStart(startOfToday()));
    setMonthPickerOpen(false);
  }

  useEffect(() => {
    if (!compact || !legendOpen) return undefined;
    const holdDurationMs = legendPressDurationRef.current;
    legendPressDurationRef.current = 0;
    const hideDelay =
      holdDurationMs >= LEGEND_HOLD_THRESHOLD_MS
        ? LEGEND_HOLD_HIDE_MS
        : LEGEND_TAP_HIDE_MS;
    clearLegendAutoHideTimer();
    legendAutoHideTimerRef.current = window.setTimeout(() => {
      setLegendOpen(false);
      legendAutoHideTimerRef.current = null;
    }, hideDelay);
    return () => {
      clearLegendAutoHideTimer();
    };
  }, [compact, legendOpen]);

  useEffect(() => {
    if (!compact || !legendOpen) return undefined;
    function onPointerDown(event) {
      const root = legendWrapRef.current;
      if (!root) return;
      if (root.contains(event.target)) return;
      clearLegendAutoHideTimer();
      setLegendOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [compact, legendOpen]);

  useEffect(
    () => () => {
      clearLegendAutoHideTimer();
    },
    []
  );

  useEffect(() => {
    if (!monthPickerOpen) return undefined;

    function onPointerDown(event) {
      const root = monthPickerRef.current;
      if (!root) return;
      if (root.contains(event.target)) return;
      setMonthPickerOpen(false);
    }

    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      setMonthPickerOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [monthPickerOpen]);

  useEffect(() => {
    if (monthPickerOpen) {
      syncMonthPickerToViewMonth();
    }
  }, [monthPickerOpen, viewMonthDate]);

  function renderCalendarInfoTip() {
    return (
      <button
        type="button"
        className="infoTip calendarInfoTip"
        aria-label="Calendar day selection info"
        title="Tap a date to view due bills for that day."
      >
        i
        <span className="infoTipBubble" role="tooltip">
          Tap a date to view due bills for that day.
        </span>
      </button>
    );
  }

  function renderCalendarActions() {
    return (
      <div className="calendarHeaderActions">
        <button
          type="button"
          className="btn small"
          aria-label="Previous month"
          data-testid="calendar-prev-month"
          onClick={() => setViewMonthDate((prev) => addMonths(prev, -1))}
        >
          <svg
            className="calendarActionIcon"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 3.5L5.5 8 10 12.5" />
          </svg>
          <span className="calendarActionLabel">Prev</span>
        </button>
        <button
          type="button"
          className="btn small"
          aria-label="Go to current month"
          data-testid="calendar-current-month"
          onClick={goToCurrentMonth}
        >
          <svg
            className="calendarActionIcon"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="4.2" />
            <circle cx="8" cy="8" r="1.4" />
          </svg>
          <span className="calendarActionLabel">Today</span>
        </button>
        <button
          type="button"
          className="btn small"
          aria-label="Next month"
          data-testid="calendar-next-month"
          onClick={() => setViewMonthDate((prev) => addMonths(prev, 1))}
        >
          <svg
            className="calendarActionIcon"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 3.5L10.5 8 6 12.5" />
          </svg>
          <span className="calendarActionLabel">Next</span>
        </button>
      </div>
    );
  }

  function renderMonthPicker() {
    return (
      <div ref={monthPickerRef} className="calendarMonthPickerWrap">
        <button
          type="button"
          className={`calendarMonthTitle calendarMonthTrigger ${monthPickerOpen ? "isOpen" : ""}`}
          aria-live="polite"
          aria-haspopup="dialog"
          aria-expanded={monthPickerOpen}
          aria-controls={monthPickerId}
          data-testid="calendar-month-title"
          onClick={toggleMonthPicker}
        >
          <span>{formatMonthTitle(viewMonthDate)}</span>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M4.5 6.5L8 10l3.5-3.5" />
          </svg>
        </button>
        <div
          id={monthPickerId}
          className={`calendarMonthPicker ${monthPickerOpen ? "isOpen" : ""}`}
          role="dialog"
          aria-label="Choose month and year"
          data-testid="calendar-month-picker"
        >
          <div className="calendarMonthPickerHead">
            <span className="calendarMonthPickerEyebrow">Jump to</span>
            <p>Pick a month and year</p>
          </div>
          <div className="calendarMonthPickerFields">
            <label className="calendarMonthPickerField calendarMonthPickerFieldMonth">
              <span>Month</span>
              <select
                className="select calendarMonthPickerSelect"
                aria-label="Month"
                value={String(pickerMonth)}
                data-testid="calendar-month-select"
                onChange={(event) => setPickerMonth(Number(event.target.value))}
              >
                {MONTH_LABELS.map((label, index) => (
                  <option key={label} value={String(index)}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="calendarMonthPickerField calendarMonthPickerFieldYear">
              <span>Year</span>
              <select
                className="select calendarMonthPickerSelect"
                aria-label="Year"
                value={String(pickerYear)}
                data-testid="calendar-year-select"
                onChange={(event) => setPickerYear(Number(event.target.value))}
              >
                {calendarYearOptions.map((year) => (
                  <option key={year} value={String(year)}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="calendarMonthPickerActions">
            <button type="button" className="btn small" onClick={goToCurrentMonth}>
              Today
            </button>
            <button
              type="button"
              className="btn small primary"
              data-testid="calendar-month-apply"
              onClick={applyMonthPicker}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className={rootClassName} aria-label="Bills calendar" data-testid="calendar-card">
      <div className="cardHeader calendarHeader">
        {showIntro ? (
          <div className="calendarIntro">
            <h2>Due Date Calendar</h2>
            <p className="muted">
              Due dates are color coded by status so you can scan upcoming risk fast.
            </p>
          </div>
        ) : null}
        {!compact ? renderCalendarActions() : null}
      </div>

      {compact ? (
        <div className="calendarLegendToggleRow">
          <div ref={legendWrapRef} className="calendarLegendHover">
            <span className="calendarLegendLabel">Legend:</span>
            <button
              type="button"
              className="calendarLegendToggle"
              aria-label="Status colors"
              aria-expanded={legendOpen}
              aria-controls="calendar-legend-popover"
              data-testid="calendar-legend-toggle"
              onMouseDown={handleLegendPressStart}
              onMouseUp={handleLegendPressEnd}
              onMouseLeave={handleLegendPressEnd}
              onTouchStart={handleLegendPressStart}
              onTouchEnd={handleLegendPressEnd}
              onTouchCancel={handleLegendPressEnd}
              onClick={handleLegendToggleClick}
            >
              <span>Status colors</span>
            </button>
            <div
              id="calendar-legend-popover"
              className={`calendarLegend calendarLegendPopover ${legendOpen ? "isOpen" : ""}`}
              aria-label="Calendar legend"
              data-testid="calendar-legend-popover"
            >
              <Legend tone="overdue" label="Overdue" />
              <Legend tone="dueToday" label="Due today" />
              <Legend tone="dueSoon" label="Due soon" />
              <Legend tone="partial" label="Partial" />
              <Legend tone="upcoming" label="Upcoming" />
              <Legend tone="paid" label="Paid" />
            </div>
          </div>
          {renderCalendarActions()}
        </div>
      ) : null}

      {compact ? (
        <div className="calendarCompactBar">
          <div className="calendarCompactTitle">
            {renderMonthPicker()}
            {!showIntro ? renderCalendarInfoTip() : null}
          </div>
        </div>
      ) : (
        renderMonthPicker()
      )}

      {!compact ? (
        <div className="calendarLegendWrap">
          <p className="calendarLegendLabel">Legend</p>
          <div className="calendarLegend" aria-label="Calendar legend">
            <Legend tone="overdue" label="Overdue" />
            <Legend tone="dueToday" label="Due today" />
            <Legend tone="dueSoon" label="Due soon" />
            <Legend tone="partial" label="Partial" />
            <Legend tone="upcoming" label="Upcoming" />
            <Legend tone="paid" label="Paid" />
          </div>
        </div>
      ) : null}

      <div className="calendarGridWrap">
        <div className="calendarWeekdays">
          {WEEKDAY_LABELS.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>
        <div className="calendarGrid">
          {cells.map((cell) => {
            const dayBills = billsByDate.get(cell.iso) || [];
            const dayPayments = paymentsByDate.get(cell.iso) || [];
            const tone = pickCalendarActivityTone(dayBills, dayPayments);
            const isSelected = cell.iso === selectedDate;
            const dueCount = dayBills.length;
            const paymentCount = dayPayments.length;
            const activityCount = dueCount + paymentCount;
            const hasActivity = activityCount > 0;
            const label = activityLabel(dueCount, paymentCount);
            return (
              <button
                key={cell.iso}
                type="button"
                className={`calendarDayBtn ${cell.inMonth ? "" : "isOutMonth"} ${
                  isSelected ? "isSelected" : ""
                } ${hasActivity ? "hasDue" : ""} calendarTone-${tone}`}
                data-testid={`calendar-day-${cell.iso}`}
                onClick={() => setSelectedDateRaw(cell.iso)}
                aria-pressed={isSelected}
                aria-label={`${formatShortDate(cell.iso)}${
                  label ? `, ${label}` : ""
                }`}
              >
                <span className="calendarDayNum">{cell.date.getDate()}</span>
                {hasActivity ? (
                  <span className="calendarDayMeta">
                    <span className={`calendarDayDot calendarTone-${tone}`} aria-hidden="true" />
                    <span>{activityCount}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="calendarSelectedPanel" data-testid="calendar-selected-panel">
        <div className="calendarSelectedHead">
          <strong>{selectedDateLabel}</strong>
          <span className="muted small">{selectedSummary}</span>
        </div>

        {selectedBills.length === 0 && selectedPayments.length === 0 ? (
          <p className="muted small">No due bills or payments on this date.</p>
        ) : null}

        {selectedBills.length > 0 ? (
          <>
            <p className="muted small">Due bills</p>
            <div className="calendarDueList">
              {selectedBills.map((bill) => {
                const tone = bill?.tone || "upcoming";
                return (
                  <button
                    key={bill.id}
                    type="button"
                    className={`calendarDueItem calendarTone-${tone}`}
                    data-testid={`calendar-due-item-${bill.billId}`}
                    onClick={() => onOpenBill?.(bill.billId)}
                  >
                    <span className="calendarDueName">{bill.name}</span>
                    <span className="calendarDueMeta">
                      {formatMoney(bill.displayAmount ?? bill.amount)} | {bill.statusLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {selectedPayments.length > 0 ? (
          <>
            <p className="muted small">Payments recorded</p>
            <div className="calendarDueList">
              {selectedPayments.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`calendarDueItem calendarTone-${entry.tone}`}
                  data-testid={`calendar-payment-item-${entry.id}`}
                  onClick={() => onOpenBill?.(entry.billId)}
                >
                  <span className="calendarDueName">{entry.billName}</span>
                  <span className="calendarDueMeta">{paymentMetaLabel(entry)}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function Legend({ tone, label }) {
  return (
    <span className="calendarLegendItem">
      <span className={`calendarLegendDot calendarTone-${tone}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
