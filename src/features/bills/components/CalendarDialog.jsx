import React, { useEffect } from "react";
import BillsCalendarCard from "./BillsCalendarCard.jsx";

export default function CalendarDialog({
  open,
  onClose,
  bills,
  onOpenBill,
  onAddBillAtDate,
  onSelectDate,
}) {
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modalBackdrop" onMouseDown={() => onClose?.()} data-testid="calendar-dialog-backdrop">
      <div
        className="modal modal-lg calendarModal"
        data-testid="calendar-dialog"
        aria-label="Due Date Calendar"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modalHeader calendarModalHeader">
          <div className="calendarModalHeaderMain">
            <span className="calendarModalHeaderIcon" aria-hidden="true">
              <svg viewBox="0 0 16 16" focusable="false">
                <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
                <path d="M2.5 6.5h11" />
                <path d="M5.25 2.5v2" />
                <path d="M10.75 2.5v2" />
              </svg>
            </span>
            <div className="calendarModalHeaderText">
              <h3>Calendar</h3>
              <p className="muted">Track monthly due dates at a glance.</p>
            </div>
          </div>
          <button
            className="iconBtn modalCloseBtn calendarModalCloseBtn"
            data-testid="calendar-close-button"
            onClick={() => onClose?.()}
            aria-label="Close calendar"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="modalBody calendarModalBody is-scrollable">
          <BillsCalendarCard
            bills={bills}
            compact
            contained
            showIntro={false}
            onOpenBill={(billId) => onOpenBill?.(billId)}
            onAddBillAtDate={(isoDate) => onAddBillAtDate?.(isoDate)}
            onSelectDate={(isoDate) => onSelectDate?.(isoDate)}
          />
        </div>
      </div>
    </div>
  );
}
