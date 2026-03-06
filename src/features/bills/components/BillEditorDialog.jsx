import React, { useEffect, useMemo, useState } from "react";
import { startOfToday, toISODate } from "../../../lib/date/date.js";
import { BILL_CADENCE_OPTIONS, BILL_REMINDER_OPTIONS } from "../billsUtils.js";
const { useRef } = React;

const CATEGORIES = [
  "Housing",
  "Utilities",
  "Transportation",
  "Insurance",
  "Credit",
  "Debt",
  "Education",
  "Subscriptions",
  "Healthcare",
  "Family",
  "Other",
];

function formatCadenceOptionLabel(cadence) {
  if (cadence === "one-time") return "One-time";
  if (cadence === "statement-plan") return "Statement plan (variable)";
  const raw = String(cadence || "monthly");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function parseStatementAmountsInput(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Number(n.toFixed(2)));
}

function buildInitialDraft(bill) {
  return {
    name: bill?.name || "",
    category: bill?.category || "Other",
    dueDate: bill?.dueDate || toISODate(startOfToday()),
    amount: String(bill?.amount ?? 0),
    cadence: bill?.cadence || "monthly",
    reminderDays: String(bill?.reminderDays ?? 3),
    notes: bill?.notes || "",
    totalMonths: String(bill?.totalMonths ?? 0),
    paidMonths: String(bill?.paidMonths ?? 0),
    statementAmounts: Array.isArray(bill?.statementAmounts)
      ? bill.statementAmounts.join(", ")
      : "",
  };
}

function normalizeDraftForCompare(draft) {
  return {
    name: String(draft.name || "").trim(),
    category: draft.category || "Other",
    dueDate: draft.dueDate || "",
    amount: Number(draft.amount || 0),
    cadence: draft.cadence || "monthly",
    reminderDays: Number(draft.reminderDays || 3),
    notes: draft.notes || "",
    totalMonths: Number(draft.totalMonths || 0),
    paidMonths: Number(draft.paidMonths || 0),
    statementAmounts: parseStatementAmountsInput(draft.statementAmounts).join(","),
  };
}

export default function BillEditorDialog({ onClose, bill, onSave }) {
  // Hooks must always run
  const initialDraft = useMemo(() => buildInitialDraft(bill), [bill]);
  const [draft, setDraft] = useState(initialDraft);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (discardConfirmOpen) {
        setDiscardConfirmOpen(false);
        return;
      }
      if (isSaving) return;
      setDiscardConfirmOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [discardConfirmOpen, isSaving, onClose]);

  // âœ… Hooks BEFORE any return
  const canSave = useMemo(() => {
    if (!draft.name.trim()) return false;
    const amount = Number(draft.amount);
    const isStatementPlan = draft.cadence === "statement-plan";
    const statementAmounts = parseStatementAmountsInput(draft.statementAmounts);
    const totalMonths = Number(draft.totalMonths);
    const paidMonths = Number(draft.paidMonths);
    if (Number.isNaN(amount) || amount < 0) return false;
    if (isStatementPlan && statementAmounts.length === 0) return false;
    if (isStatementPlan) return true;
    if (!Number.isInteger(totalMonths) || totalMonths < 0) return false;
    if (!Number.isInteger(paidMonths) || paidMonths < 0) return false;
    if (totalMonths === 0 && paidMonths > 0) return false;
    if (totalMonths > 0 && paidMonths > totalMonths) return false;
    return true;
  }, [
    draft.name,
    draft.amount,
    draft.cadence,
    draft.statementAmounts,
    draft.totalMonths,
    draft.paidMonths,
  ]);

  const isDirty = useMemo(() => {
    const current = normalizeDraftForCompare(draft);
    const initial = normalizeDraftForCompare(initialDraft);
    return JSON.stringify(current) !== JSON.stringify(initial);
  }, [draft, initialDraft]);

  function buildPayloadFromDraft() {
    return {
      name: draft.name.trim(),
      category: draft.category,
      dueDate: draft.dueDate,
      amount: Number(draft.amount),
      cadence: draft.cadence,
      reminderDays: Number(draft.reminderDays || 3),
      notes: draft.notes,
      totalMonths: Number(draft.totalMonths || 0),
      paidMonths: Number(draft.paidMonths || 0),
      statementAmounts: parseStatementAmountsInput(draft.statementAmounts),
    };
  }

  function handleRequestClose() {
    if (isSaving) return;
    setDiscardConfirmOpen(true);
  }

  function handleConfirmDiscard() {
    setDiscardConfirmOpen(false);
    onClose();
  }

  function handleSaveClick() {
    if (isSaving) return;
    const payload = buildPayloadFromDraft();
    setIsSaving(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onSave(payload);
      setIsSaving(false);
      saveTimerRef.current = null;
    }, 500);
  }

  return (
    <div className="modalBackdrop">
      <div
        className="modal modal-md billEditorModal"
        key={bill?.id || "new"} // reset when switching bills/new
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <div>
            <div className="modalTitleRow">
              <h3>{bill ? "Edit bill" : "Add bill"}</h3>
              {isDirty ? (
                <span className="dirtyIndicator" aria-live="polite">
                  Unsaved
                </span>
              ) : null}
            </div>
            <p className="muted">
              Set the due date and amount. Recurring bills roll to the next cycle
              when fully paid, while one-time and statement-plan bills support
              full payoff behavior.
            </p>
          </div>
          <button className="iconBtn" disabled={isSaving} onClick={handleRequestClose} aria-label="Close editor">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="modalBody">
          <div className="field">
            <label>Bill name</label>
            <input
              className="input"
              disabled={isSaving}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g., Water & Sewer"
            />
          </div>

          <div className="grid2">
            <div className="field">
              <label>Category</label>
              <select
                className="select"
                disabled={isSaving}
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, category: e.target.value }))
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Due date</label>
              <input
                className="input"
                disabled={isSaving}
                type="date"
                value={draft.dueDate}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, dueDate: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="field">
            <label>Amount</label>
            <input
              className="input"
              disabled={isSaving}
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) =>
                setDraft((d) => ({ ...d, amount: e.target.value }))
              }
              />
              {draft.cadence === "statement-plan" ? (
                <div className="muted small" style={{ marginTop: 6 }}>
                  For statement plans, this is fallback only. Real monthly dues
                  come from the statement amounts below.
                </div>
              ) : null}
          </div>

          {draft.cadence === "statement-plan" ? (
            <div className="field">
              <label>Statement amounts (monthly order)</label>
              <textarea
                className="textarea"
                disabled={isSaving}
                value={draft.statementAmounts}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, statementAmounts: e.target.value }))
                }
                placeholder="e.g. 1646.82, 876.93, 721.69, 576.39"
              />
              <div className="muted small" style={{ marginTop: 6 }}>
                Use comma or new line per amount. Due date starts from the first
                month and moves monthly.
              </div>
            </div>
          ) : null}

          {draft.cadence !== "statement-plan" ? (
            <div className="grid2">
              <div className="field">
                <label>Total months</label>
                <input
                  className="input"
                  disabled={isSaving}
                  type="number"
                  min="0"
                  step="1"
                  value={draft.totalMonths}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, totalMonths: e.target.value }))
                  }
                  placeholder="0 = no plan"
                />
              </div>

              <div className="field">
                <label>Already paid months</label>
                <input
                  className="input"
                  disabled={isSaving}
                  type="number"
                  min="0"
                  step="1"
                  value={draft.paidMonths}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, paidMonths: e.target.value }))
                  }
                />
              </div>
            </div>
          ) : null}

          <div className="grid2">
            <div className="field">
              <label>Payment cadence</label>
              <select
                className="select"
                disabled={isSaving}
                value={draft.cadence}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, cadence: e.target.value }))
                }
              >
                {BILL_CADENCE_OPTIONS.map((cadence) => (
                  <option key={cadence} value={cadence}>
                    {formatCadenceOptionLabel(cadence)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Reminder lead time</label>
              <select
                className="select"
                disabled={isSaving}
                value={draft.reminderDays}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, reminderDays: e.target.value }))
                }
              >
                {BILL_REMINDER_OPTIONS.map((days) => (
                  <option key={days} value={String(days)}>
                    {days} day{days === 1 ? "" : "s"} before
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Notes</label>
            <textarea
              className="textarea"
              disabled={isSaving}
              value={draft.notes}
              onChange={(e) =>
                setDraft((d) => ({ ...d, notes: e.target.value }))
              }
              placeholder="Optional..."
            />
          </div>
        </div>

        <div className="modalFooter editorModalFooter">
          <button
            className="btn editorCancelBtn"
            disabled={isSaving}
            onClick={handleRequestClose}
          >
            Cancel
          </button>
          <button
            className="btn primary editorSaveBtn"
            disabled={!canSave || isSaving}
            onClick={handleSaveClick}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>

        {discardConfirmOpen ? (
          <div
            className="modalBackdrop confirmBackdrop"
            onMouseDown={() => setDiscardConfirmOpen(false)}
          >
            <div
              className="modal modal-sm confirmModal"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="confirmBody">
                <div className="confirmTitleRow">
                  <h3>Discard changes?</h3>
                </div>
                <p className="muted confirmText">
                  Your edits will be lost if you close this form now.
                </p>
                <div className="confirmActions">
                  <button
                    className="btn small"
                    disabled={isSaving}
                    onClick={() => setDiscardConfirmOpen(false)}
                  >
                    Keep editing
                  </button>
                  <button
                    className="btn small danger confirmDangerBtn"
                    disabled={isSaving}
                    onClick={handleConfirmDiscard}
                  >
                    Discard changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

