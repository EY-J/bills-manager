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
const EMPTY_DATE_MAP = new Map();
const EMPTY_ITEMS = [];
const MOBILE_OVERVIEW_QUERY = "(max-width: 760px)";
const SWIPE_DISTANCE_THRESHOLD_PX = 42;
const SWIPE_DIRECTION_LOCK_RATIO = 1.2;
const SWIPE_MAX_DURATION_MS = 650;

function shouldCollapseOverviewByDefault() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(MOBILE_OVERVIEW_QUERY).matches;
}

function isMobileSwipeViewport() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(MOBILE_OVERVIEW_QUERY).matches;
}

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

function getCalendarCellCount(viewMonthDate) {
  const firstOfMonth = getMonthStart(viewMonthDate);
  const daysInMonth = new Date(
    firstOfMonth.getFullYear(),
    firstOfMonth.getMonth() + 1,
    0
  ).getDate();
  const leadingDays = firstOfMonth.getDay();
  const weeks = Math.ceil((leadingDays + daysInMonth) / 7);
  return weeks * 7;
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
  const cellCount = getCalendarCellCount(viewMonthDate);
  return Array.from({ length: cellCount }, (_, idx) => {
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
  onAddBillAtDate,
  onSelectDate,
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
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [inlineDropdownOpen, setInlineDropdownOpen] = useState(null);
  const [isMobileOverviewCollapsed, setIsMobileOverviewCollapsed] = useState(() =>
    shouldCollapseOverviewByDefault()
  );
  const [mobileDayActionsVisible, setMobileDayActionsVisible] = useState(false);
  const [mobileDayInfoOpen, setMobileDayInfoOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() => startOfToday().getMonth());
  const [pickerYear, setPickerYear] = useState(() => startOfToday().getFullYear());
  const monthPickerRef = useRef(null);
  const inlineHeaderRef = useRef(null);
  const monthPickerId = useId();
  const swipeStateRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startedAt: 0,
  });
  const suppressNextDayTapRef = useRef(false);

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
    () =>
      buildMonthActivityDates(
        viewMonthKey,
        billsByDate,
        compact ? EMPTY_DATE_MAP : paymentsByDate
      ),
    [billsByDate, compact, paymentsByDate, viewMonthKey]
  );

  const selectedDate = useMemo(() => {
    const isSelectedInMonth = monthKeyFromIso(selectedDateRaw) === viewMonthKey;
    if (isSelectedInMonth) return selectedDateRaw;
    if (monthActivityDates.length > 0) return monthActivityDates[0];
    return toISODate(viewMonthDate);
  }, [selectedDateRaw, monthActivityDates, viewMonthDate, viewMonthKey]);

  const selectedBills = useMemo(
    () => billsByDate.get(selectedDate) || EMPTY_ITEMS,
    [billsByDate, selectedDate]
  );
  const selectedPayments = useMemo(
    () => paymentsByDate.get(selectedDate) || EMPTY_ITEMS,
    [paymentsByDate, selectedDate]
  );
  const selectedDateLabel = formatShortDate(selectedDate);
  const selectedSummary = summarizeSelectedDate(
    selectedBills.length,
    selectedPayments.length
  );
  const selectedDueTitles = useMemo(() => {
    const seen = new Set();
    const titles = [];
    selectedBills.forEach((bill, index) => {
      const name = String(bill?.name || "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      titles.push({
        id: bill?.id || `title-${index}`,
        name,
        tone: bill?.tone || "upcoming",
      });
    });
    return titles;
  }, [selectedBills]);
  const monthOverview = useMemo(() => {
    const dueItems = [];
    const uniqueBillIds = new Set();
    let dueTotal = 0;
    let paidTotal = 0;
    let paymentCount = 0;

    billsByDate.forEach((entries, iso) => {
      if (monthKeyFromIso(iso) !== viewMonthKey) return;
      (entries || []).forEach((entry) => {
        const amount = Number(entry?.displayAmount ?? entry?.amount ?? 0);
        const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
        dueTotal += safeAmount;
        if (entry?.billId) uniqueBillIds.add(entry.billId);
        dueItems.push({
          id: `${iso}:${entry?.id || entry?.billId || dueItems.length}`,
          iso,
          tone: entry?.tone || "upcoming",
          title: entry?.name || "Bill",
          statusLabel: entry?.statusLabel || "Upcoming",
          amount: safeAmount,
        });
      });
    });

    paymentsByDate.forEach((entries, iso) => {
      if (monthKeyFromIso(iso) !== viewMonthKey) return;
      (entries || []).forEach((entry) => {
        const amount = Number(entry?.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) return;
        paidTotal += amount;
        paymentCount += 1;
      });
    });

    dueItems.sort(
      (a, b) =>
        a.iso.localeCompare(b.iso) ||
        Number(b.amount || 0) - Number(a.amount || 0) ||
        String(a.title || "").localeCompare(String(b.title || ""))
    );

    return {
      billCount: uniqueBillIds.size,
      dueCount: dueItems.length,
      dueTotal,
      paidTotal,
      paymentCount,
      dueItems,
    };
  }, [billsByDate, paymentsByDate, viewMonthKey]);

  const rootClassName = `${contained ? "" : "card "}calendarCard${
    compact ? " isCompact" : ""
  }${contained ? " isContained" : ""}`.trim();

  function syncMonthPickerToViewMonth() {
    setPickerMonth(viewMonthDate.getMonth());
    setPickerYear(viewMonthDate.getFullYear());
  }

  function syncMonthPickerToDate(date) {
    setPickerMonth(date.getMonth());
    setPickerYear(date.getFullYear());
  }

  function setCalendarMonth(date) {
    const nextDate = getMonthStart(date);
    setViewMonthDate(nextDate);
    if (monthPickerOpen) {
      syncMonthPickerToDate(nextDate);
    }
  }

  function toggleInlineDropdown(panel) {
    setInlineDropdownOpen((open) => (open === panel ? null : panel));
  }

  function selectInlineMonth(monthIndex) {
    setCalendarMonth(createMonthDate(viewMonthDate.getFullYear(), monthIndex));
    setInlineDropdownOpen(null);
  }

  function selectInlineYear(year) {
    setCalendarMonth(createMonthDate(year, viewMonthDate.getMonth()));
    setInlineDropdownOpen(null);
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
    setCalendarMonth(createMonthDate(safeYear, safeMonth));
    setMonthPickerOpen(false);
  }

  function goToCurrentMonth() {
    setCalendarMonth(startOfToday());
    setMonthPickerOpen(false);
  }

  function handleCalendarGridTouchStart(event) {
    if (!compact || !isMobileSwipeViewport()) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    swipeStateRef.current = {
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      startedAt: Date.now(),
    };
  }

  function handleCalendarGridTouchMove(event) {
    const state = swipeStateRef.current;
    if (!state.active) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    state.lastX = touch.clientX;
    state.lastY = touch.clientY;
  }

  function finishCalendarGridSwipe(endX, endY) {
    const state = swipeStateRef.current;
    if (!state.active) return;
    state.active = false;

    const deltaX = endX - state.startX;
    const deltaY = endY - state.startY;
    const elapsed = Date.now() - state.startedAt;

    if (elapsed > SWIPE_MAX_DURATION_MS) return;
    if (Math.abs(deltaX) < SWIPE_DISTANCE_THRESHOLD_PX) return;
    if (Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_DIRECTION_LOCK_RATIO) return;

    suppressNextDayTapRef.current = true;
    setCalendarMonth(addMonths(viewMonthDate, deltaX < 0 ? 1 : -1));
  }

  function handleCalendarGridTouchEnd(event) {
    const touch = event.changedTouches?.[0];
    if (!touch) {
      swipeStateRef.current.active = false;
      return;
    }
    finishCalendarGridSwipe(touch.clientX, touch.clientY);
  }

  function handleCalendarGridTouchCancel() {
    swipeStateRef.current.active = false;
  }

  function handleCalendarDayClick(iso) {
    if (suppressNextDayTapRef.current) {
      suppressNextDayTapRef.current = false;
      return;
    }
    setSelectedDateRaw(iso);
    onSelectDate?.(iso);
    if (compact) {
      setMobileDayActionsVisible(true);
      setMobileDayInfoOpen(false);
    }
  }

  function closeMobileDayPanel() {
    setMobileDayActionsVisible(false);
    setMobileDayInfoOpen(false);
  }

  useEffect(() => {
    if (!monthPickerOpen && !inlineDropdownOpen) return undefined;

    function closePickers() {
      setMonthPickerOpen(false);
      setInlineDropdownOpen(null);
    }

    function isInsidePickers(target, path = null) {
      const monthRoot = monthPickerRef.current;
      const inlineRoot = inlineHeaderRef.current;
      const roots = [monthRoot, inlineRoot].filter(Boolean);
      if (!target) return false;

      if (Array.isArray(path) && path.length > 0) {
        return roots.some((root) => path.includes(root));
      }

      if (!(target instanceof Node)) return false;
      return roots.some((root) => root.contains(target));
    }

    function onGlobalPointerDown(event) {
      const path =
        typeof event.composedPath === "function" ? event.composedPath() : null;
      if (isInsidePickers(event.target, path)) return;
      closePickers();
    }

    function onFocusIn(event) {
      if (isInsidePickers(event.target)) return;
      closePickers();
    }

    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      setMonthPickerOpen(false);
      setInlineDropdownOpen(null);
    }

    function onWindowBlur() {
      closePickers();
    }

    document.addEventListener("pointerdown", onGlobalPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      document.removeEventListener("pointerdown", onGlobalPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [inlineDropdownOpen, monthPickerOpen]);

  function renderCalendarActions({ includeToday = true } = {}) {
    return (
      <div className="calendarHeaderActions">
        <button
          type="button"
          className="btn small"
          aria-label="Previous month"
          data-testid="calendar-prev-month"
          onClick={() => setCalendarMonth(addMonths(viewMonthDate, -1))}
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
        {includeToday ? (
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
        ) : null}
        <button
          type="button"
          className="btn small"
          aria-label="Next month"
          data-testid="calendar-next-month"
          onClick={() => setCalendarMonth(addMonths(viewMonthDate, 1))}
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

  function renderInlineMonthHeader() {
    const monthIndex = viewMonthDate.getMonth();
    const yearValue = viewMonthDate.getFullYear();

    return (
      <div
        ref={inlineHeaderRef}
        className="calendarInlineHeader"
        aria-label="Month and year picker"
      >
        <div className={`calendarInlineDropdown isMonth ${inlineDropdownOpen === "month" ? "isOpen" : ""}`}>
          <button
            type="button"
            className="calendarInlineTrigger"
            aria-label="Select month"
            aria-haspopup="menu"
            aria-expanded={inlineDropdownOpen === "month"}
            data-testid="calendar-inline-month-trigger"
            onClick={() => toggleInlineDropdown("month")}
          >
            <span>{MONTH_LABELS[monthIndex]}</span>
            <svg className="calendarInlineCaret" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.5 6.5L8 10l3.5-3.5" />
            </svg>
          </button>
          <div className="calendarInlineMenu" role="menu" aria-label="Month options">
            {MONTH_LABELS.map((label, index) => (
              <button
                key={label}
                type="button"
                className={`calendarInlineOption ${index === monthIndex ? "isActive" : ""}`}
                role="menuitemradio"
                aria-checked={index === monthIndex}
                onClick={() => selectInlineMonth(index)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={`calendarInlineDropdown isYear ${inlineDropdownOpen === "year" ? "isOpen" : ""}`}>
          <button
            type="button"
            className="calendarInlineTrigger calendarInlineTriggerYear"
            aria-label="Select year"
            aria-haspopup="menu"
            aria-expanded={inlineDropdownOpen === "year"}
            data-testid="calendar-inline-year-trigger"
            onClick={() => toggleInlineDropdown("year")}
          >
            <span>{yearValue}</span>
            <svg className="calendarInlineCaret" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.5 6.5L8 10l3.5-3.5" />
            </svg>
          </button>
          <div className="calendarInlineMenu" role="menu" aria-label="Year options">
            {calendarYearOptions.map((year) => (
              <button
                key={year}
                type="button"
                className={`calendarInlineOption ${year === yearValue ? "isActive" : ""}`}
                role="menuitemradio"
                aria-checked={year === yearValue}
                onClick={() => selectInlineYear(year)}
              >
                {year}
              </button>
            ))}
          </div>
        </div>
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

  function renderScheduleRail() {
    const isOverviewExpanded = !isMobileOverviewCollapsed;
    return (
      <aside
        className={`calendarScheduleRail ${isMobileOverviewCollapsed ? "isMobileCollapsed" : ""}`}
        aria-label="Monthly bills overview"
      >
        <div className="calendarScheduleHead">
          <strong>Month overview</strong>
          <div className="calendarScheduleHeadActions">
            {onAddBillAtDate ? (
              <button
                type="button"
                className="calendarScheduleQuickAdd"
                aria-label={`Add bill due on ${selectedDateLabel}`}
                title={`Add bill on ${selectedDateLabel}`}
                data-testid="calendar-add-bill-shortcut"
                onClick={() => onAddBillAtDate?.(selectedDate)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M8 3.2v9.6M3.2 8h9.6" />
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              className="calendarScheduleToggle"
              aria-expanded={isOverviewExpanded}
              aria-label={isOverviewExpanded ? "Collapse month overview" : "Expand month overview"}
              onClick={() => setIsMobileOverviewCollapsed((collapsed) => !collapsed)}
            >
              <svg
                className="calendarScheduleToggleIcon"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4.5 6.5L8 10l3.5-3.5" />
              </svg>
            </button>
          </div>
        </div>
        <div className="calendarScheduleSummary" aria-label="Month totals">
          <div className="calendarScheduleSummaryItem">
            <span>Due bills</span>
            <strong>{monthOverview.dueCount}</strong>
          </div>
          <div className="calendarScheduleSummaryItem">
            <span>Due total</span>
            <strong>{formatMoney(monthOverview.dueTotal)}</strong>
          </div>
          <div className="calendarScheduleSummaryItem">
            <span>Paid</span>
            <strong>{formatMoney(monthOverview.paidTotal)}</strong>
          </div>
        </div>
        <div className="calendarScheduleList">
          {monthOverview.dueItems.length === 0 ? (
            <p className="calendarScheduleEmpty muted small">No due bills this month.</p>
          ) : (
            monthOverview.dueItems.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`calendarScheduleItem calendarTone-${entry.tone} ${
                  entry.iso === selectedDate ? "isActive" : ""
                }`}
                onClick={() => {
                  setSelectedDateRaw(entry.iso);
                  onSelectDate?.(entry.iso);
                }}
              >
                <span className={`calendarScheduleToneBar calendarTone-${entry.tone}`} />
                <div className="calendarScheduleItemTop">
                  <span>{formatShortDate(entry.iso)}</span>
                  <span>{entry.statusLabel}</span>
                </div>
                <p className="calendarScheduleTitle">{entry.title}</p>
                <p className="calendarScheduleAmount">
                  {entry.amount > 0 ? formatMoney(entry.amount) : ""}
                </p>
              </button>
            ))
          )}
        </div>
      </aside>
    );
  }

  function renderMobileDayActions() {
    if (!compact || !mobileDayActionsVisible) return null;
    return (
      <div
        className="calendarMobileDayActions"
        data-testid="calendar-mobile-day-actions"
        onMouseDown={closeMobileDayPanel}
      >
        <div className="calendarMobileDayCard" onMouseDown={(event) => event.stopPropagation()}>
          <div className="calendarMobileDayCardHead">
            <strong className="calendarMobileDayActionsDate">{selectedDateLabel}</strong>
            <button
              type="button"
              className="iconBtn modalCloseBtn calendarMobileDayCloseBtn"
              aria-label="Close day actions"
              onClick={closeMobileDayPanel}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
          <p className="calendarMobileDayActionsHint">Quick actions for this date</p>
          <div className="calendarMobileDayActionsBtns">
            <button
              type="button"
              className="btn small calendarMobileDayActionBtn isPrimary"
              onClick={() => {
                onAddBillAtDate?.(selectedDate);
                closeMobileDayPanel();
              }}
              disabled={!onAddBillAtDate}
            >
              Add bill
            </button>
            <button
              type="button"
              className="btn small calendarMobileDayActionBtn"
              aria-expanded={mobileDayInfoOpen}
              onClick={() => setMobileDayInfoOpen((open) => !open)}
            >
              {mobileDayInfoOpen ? "Hide info" : "View info"}
            </button>
          </div>
          {mobileDayInfoOpen ? (
            <div className="calendarMobileDayInfo" data-testid="calendar-mobile-day-info">
              {selectedDueTitles.length === 0 ? (
                <p className="muted small">No due bills on this date.</p>
              ) : (
                <div className="calendarMobileDayInfoList">
                  {selectedDueTitles.map((item) => (
                    <div key={item.id} className="calendarMobileDayInfoItem">
                      <span
                        className={`calendarDayItemBar calendarTone-${item.tone}`}
                        aria-hidden="true"
                      />
                      <span>{item.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section className={rootClassName} aria-label="Bills calendar" data-testid="calendar-card">
      <div className={`calendarStudioLayout ${compact ? "isStudioCompact" : ""}`}>
        <div className="calendarStudioMain">
          {showIntro || !compact ? (
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
          ) : null}

          {compact ? (
            <div className="calendarCompactToolbar">
              <div className="calendarCompactToolbarRow">
                <div className="calendarCompactToolbarMain">{renderInlineMonthHeader()}</div>
                <div className="calendarCompactToolbarActions">
                  {renderCalendarActions({ includeToday: false })}
                </div>
              </div>
            </div>
          ) : null}

          {!compact ? renderMonthPicker() : null}

          <div
            className="calendarGridWrap"
            onTouchStart={handleCalendarGridTouchStart}
            onTouchMove={handleCalendarGridTouchMove}
            onTouchEnd={handleCalendarGridTouchEnd}
            onTouchCancel={handleCalendarGridTouchCancel}
          >
            <div className="calendarWeekdays">
              {WEEKDAY_LABELS.map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>
            <div className="calendarGrid">
              {cells.map((cell) => {
                const rawDayBills = billsByDate.get(cell.iso) || [];
                const rawDayPayments = paymentsByDate.get(cell.iso) || [];
                const dayBills = compact && !cell.inMonth ? [] : rawDayBills;
                const dayPayments = compact ? [] : rawDayPayments;
                const tone = pickCalendarActivityTone(dayBills, dayPayments);
                const isSelected = cell.iso === selectedDate;
                const dueCount = dayBills.length;
                const paymentCount = dayPayments.length;
                const hasActivity = dueCount + paymentCount > 0;
                const label = activityLabel(dueCount, paymentCount);
                const previewItems = [];
                const seenNames = new Set();

                dayBills.forEach((entry) => {
                  const name = String(entry?.name || "").trim();
                  if (!name) return;
                  const nameKey = name.toLowerCase();
                  if (seenNames.has(nameKey)) return;
                  seenNames.add(nameKey);
                  previewItems.push({
                    id: entry?.id || `${cell.iso}-due-${previewItems.length}`,
                    name,
                    tone: entry?.tone || tone,
                  });
                });

                dayPayments.forEach((entry) => {
                  const name = String(entry?.billName || "").trim();
                  if (!name) return;
                  const nameKey = name.toLowerCase();
                  if (seenNames.has(nameKey)) return;
                  seenNames.add(nameKey);
                  previewItems.push({
                    id: entry?.id || `${cell.iso}-payment-${previewItems.length}`,
                    name,
                    tone: entry?.tone || "paid",
                  });
                });
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    className={`calendarDayBtn ${cell.inMonth ? "" : "isOutMonth"} ${
                      isSelected ? "isSelected" : ""
                    } ${hasActivity ? "hasDue" : ""} calendarTone-${tone}`}
                    data-testid={`calendar-day-${cell.iso}`}
                    onClick={() => handleCalendarDayClick(cell.iso)}
                    aria-pressed={isSelected}
                    aria-label={`${formatShortDate(cell.iso)}${
                      label ? `, ${label}` : ""
                    }`}
                  >
                    <span className="calendarDayNum">{cell.date.getDate()}</span>
                    {hasActivity && previewItems.length > 0 ? (
                      <span className="calendarDayItems">
                        {previewItems.map((item) => (
                          <span key={item.id} className="calendarDayItem">
                            <span
                              className={`calendarDayItemBar calendarTone-${item.tone}`}
                              aria-hidden="true"
                            />
                            <span className="calendarDayItemText">{item.name}</span>
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          {compact ? renderMobileDayActions() : null}

          {!compact ? (
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
          ) : null}
        </div>
        {compact ? renderScheduleRail() : null}
      </div>
    </section>
  );
}
