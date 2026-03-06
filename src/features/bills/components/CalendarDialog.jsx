import React, { useEffect } from "react";
import BillsCalendarCard from "./BillsCalendarCard.jsx";

export default function CalendarDialog({ open, onClose, bills, onOpenBill }) {
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
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modalHeader">
          <div>
            <h3>Due Date Calendar</h3>
            <p className="muted">View all bill due dates in one place.</p>
          </div>
          <button
            className="iconBtn"
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
          />
        </div>
      </div>
    </div>
  );
}
