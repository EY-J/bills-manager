import React, { useMemo, useState } from "react";
import {
  formatMoney,
  formatShortDate,
  startOfToday,
  toISODate,
} from "../../../lib/date/date.js";
import { computeBillMeta, shiftDueDateByCadence } from "../billsUtils.js";
const { useEffect } = React;

function formatCadenceLabel(cadence) {
  if (cadence === "one-time") return "One-time";
  if (cadence === "statement-plan") return "Statement plan";
  const raw = String(cadence || "monthly");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function buildStatementTimeline(bill, limit = 8) {
  if (bill?.cadence !== "statement-plan") return [];
  const statementAmounts = Array.isArray(bill?.statementAmounts)
    ? bill.statementAmounts
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (statementAmounts.length === 0) return [];

  const currentIndex = Math.max(
    0,
    Math.min(
      Number.isFinite(Number(bill?.statementIndex))
        ? Math.floor(Number(bill.statementIndex))
        : 0,
      statementAmounts.length - 1
    )
  );

  return statementAmounts
    .slice(currentIndex, currentIndex + limit)
    .map((amount, offset) => ({
      key: `${currentIndex + offset}`,
      dueDate: shiftDueDateByCadence(bill.dueDate, "monthly", offset),
      amount: Number(amount),
    }));
}

function buildPaymentDraft(bill) {
  return {
    date: toISODate(startOfToday()),
    amount: String(bill?.amount ?? 0),
    note: "",
  };
}

function dueDateLabel(bill) {
  return bill?.meta?.hasDueDate ? `Due ${formatShortDate(bill.dueDate)}` : "No due date";
}

export default function BillDetailsDialog({
  open,
  onClose,
  bill,
  onEdit,
  onMarkPaid,
  markPaidLoading = false,
  onArchiveToggle,
  onSnoozeReminder,
  onDuplicate,
  onDelete,
  onAddPayment,
  paymentSubmitLoading = false,
  onUpdatePayment,
  paymentDeletingId = null,
  onDeletePayment,
  onUpdateNotes,
  notesSaveLoading = false,
}) {
  // Hooks must always run (even if open is false)
  const meta = useMemo(() => (bill ? computeBillMeta(bill) : null), [bill]);
  const statementTimeline = useMemo(
    () => (bill ? buildStatementTimeline(bill) : []),
    [bill]
  );

  const [tab, setTab] = useState("overview");
  const [paymentDraft, setPaymentDraft] = useState(() =>
    buildPaymentDraft(bill)
  );
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [notesDraft, setNotesDraft] = useState(bill?.notes || "");
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = React.useRef(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (actionsMenuOpen) {
        setActionsMenuOpen(false);
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, actionsMenuOpen]);

  useEffect(() => {
    if (!actionsMenuOpen) return;
    function handleOutsideClick(event) {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".billActionsMoreWrap")) return;
      setActionsMenuOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [actionsMenuOpen]);

  const paymentBusy = paymentSubmitLoading || Boolean(paymentDeletingId);

  async function handlePaymentSubmit() {
    if (paymentSubmitLoading) return;
    const amt = Number(paymentDraft.amount);
    if (Number.isNaN(amt) || amt < 0) return;

    if (editingPaymentId) {
      await Promise.resolve(
        onUpdatePayment?.(editingPaymentId, {
          date: paymentDraft.date,
          amount: amt,
          note: paymentDraft.note.trim(),
        })
      );
    } else {
      await Promise.resolve(
        onAddPayment?.({
          id: crypto.randomUUID(),
          date: paymentDraft.date,
          amount: amt,
          note: paymentDraft.note.trim(),
        })
      );
    }

    setEditingPaymentId(null);
    setPaymentDraft(buildPaymentDraft(bill));
  }

  async function handleDeletePayment(paymentId) {
    if (!paymentId || paymentDeletingId === paymentId) return;
    await Promise.resolve(onDeletePayment?.(paymentId));

    if (editingPaymentId === paymentId) {
      setEditingPaymentId(null);
      setPaymentDraft(buildPaymentDraft(bill));
    }
  }

  async function handleNotesSave() {
    if (notesSaveLoading) return;
    await Promise.resolve(onUpdateNotes?.(notesDraft));
  }

  // âœ… Safe conditional render after hooks
  if (!open) return null;

  return (
    <div className="modalBackdrop">
      <div
        className="modal modal-lg"
        key={bill?.id || "none"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <div className="truncate">
            <h3 className="truncate">{bill?.name || "Bill Details"}</h3>
            {bill ? (
              <p className="billHeaderMeta">
                <span className="billHeaderMetaItem">{bill.category || "-"}</span>
                <span className="billHeaderMetaSep">|</span>
                <span className="billHeaderMetaItem">{formatCadenceLabel(bill.cadence)}</span>
                <span className="billHeaderMetaSep">|</span>
                <span className="billHeaderMetaItem">{dueDateLabel({ ...bill, meta })}</span>
                <span className="billHeaderMetaSep">|</span>
                <span className="billHeaderMetaAmount">{formatMoney(bill.amount)}</span>
              </p>
            ) : null}
          </div>
          <button className="iconBtn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {!bill ? (
          <div className="modalBody">
            <div className="muted">No bill selected.</div>
          </div>
        ) : (
          <>
            <div className="tabs">
              <button
                className={`tab ${tab === "overview" ? "active" : ""}`}
                onClick={() => setTab("overview")}
              >
                Overview
              </button>
              <button
                className={`tab ${tab === "payments" ? "active" : ""}`}
                onClick={() => setTab("payments")}
              >
                Payments
              </button>
              <button
                className={`tab ${tab === "notes" ? "active" : ""}`}
                onClick={() => setTab("notes")}
              >
                Notes
              </button>
            </div>

            {/* ---------------- Overview ---------------- */}
            {tab === "overview" ? (
              <div className="modalBody">
                <div className="grid3">
                  <Stat
                    label="Due status"
                    value={
                      meta?.settledInFull
                        ? "Paid in full"
                        : !meta?.hasDueDate
                        ? "No due date"
                        : meta?.overdue
                        ? `${Math.abs(meta.daysToDue)} days late`
                        : meta?.daysToDue === 0
                        ? "Due today"
                        : `Due in ${meta?.daysToDue} day(s)`
                    }
                  />
                  <Stat
                    label="Cycle balance"
                    value={
                      meta?.remainingAmount > 0
                        ? formatMoney(meta.remainingAmount)
                        : "Settled"
                    }
                  />
                  <Stat
                    label="Payments"
                    value={String(bill.payments?.length || 0)}
                  />
                </div>

                {statementTimeline.length > 0 ? (
                  <div className="cardInner">
                    <div className="bold">Upcoming statements</div>
                    <div className="muted small">
                      Variable monthly amounts. Current month is first.
                    </div>
                    <div style={{ marginTop: 10 }}>
                      {statementTimeline.map((item) => (
                        <div
                          key={item.key}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "6px 0",
                          }}
                        >
                          <span>{formatShortDate(item.dueDate)}</span>
                          <span className="bold">{formatMoney(item.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="rowGap billOverviewFoot">
                  <div className="muted billOverviewHint">
                    {bill.cadence === "statement-plan"
                      ? "Mark paid applies to the current statement. Full payment moves to next statement amount."
                      : bill.cadence === "one-time"
                      ? "Mark paid adds a payment and closes this one-time bill when the full amount is covered."
                      : "Mark paid adds a payment and advances the due date to the next cycle. If a plan is set, paid months also increases."}
                  </div>
                  <div className="actions billOverviewActions">
                    <button
                      className="btn primary"
                      disabled={bill.archived || markPaidLoading}
                      onClick={onMarkPaid}
                    >
                      {markPaidLoading ? "Marking..." : "Mark paid"}
                    </button>
                    <button className="btn" onClick={onEdit}>
                      Edit
                    </button>

                    <div className="billActionsMoreWrap" ref={actionsMenuRef}>
                      <button
                        className="btn billActionsMoreBtn"
                        onClick={() => setActionsMenuOpen((v) => !v)}
                        aria-expanded={actionsMenuOpen}
                        aria-haspopup="menu"
                      >
                        More
                      </button>

                      {actionsMenuOpen ? (
                        <>
                          <button
                            type="button"
                            className="billActionsMenuBackdrop"
                            aria-label="Close more actions"
                            onClick={() => setActionsMenuOpen(false)}
                          />
                          <div className="billActionsMenu" role="menu" aria-label="More actions">
                            <button
                              className="btn billActionsMenuItem"
                              role="menuitem"
                              onClick={() => {
                                onDuplicate?.();
                                setActionsMenuOpen(false);
                              }}
                            >
                              Duplicate bill
                            </button>
                            <button
                              className="btn billActionsMenuItem"
                              role="menuitem"
                              onClick={() => {
                                onArchiveToggle?.(!bill.archived);
                                setActionsMenuOpen(false);
                              }}
                            >
                              {bill.archived ? "Restore bill" : "Archive bill"}
                            </button>
                            {meta?.hasDueDate ? (
                              <>
                                <button
                                  className="btn billActionsMenuItem"
                                  role="menuitem"
                                  onClick={() => {
                                    onSnoozeReminder?.("1d");
                                    setActionsMenuOpen(false);
                                  }}
                                >
                                  Snooze reminders 1 day
                                </button>
                                <button
                                  className="btn billActionsMenuItem"
                                  role="menuitem"
                                  onClick={() => {
                                    onSnoozeReminder?.("3d");
                                    setActionsMenuOpen(false);
                                  }}
                                >
                                  Snooze reminders 3 days
                                </button>
                                <button
                                  className="btn billActionsMenuItem"
                                  role="menuitem"
                                  onClick={() => {
                                    onSnoozeReminder?.("cycle");
                                    setActionsMenuOpen(false);
                                  }}
                                >
                                  Snooze this cycle
                                </button>
                                <button
                                  className="btn billActionsMenuItem"
                                  role="menuitem"
                                  onClick={() => {
                                    onSnoozeReminder?.("clear");
                                    setActionsMenuOpen(false);
                                  }}
                                >
                                  Clear reminder snooze
                                </button>
                              </>
                            ) : null}
                            <button
                              className="btn danger billActionsMenuItem"
                              role="menuitem"
                              onClick={() => {
                                onDelete?.();
                                setActionsMenuOpen(false);
                              }}
                            >
                              Delete bill
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ---------------- Payments ---------------- */}
            {tab === "payments" ? (
              <div className="modalBody">
                <div className="cardInner">
                  <div className="bold">Add payment</div>
                  <div className="muted small">
                    {bill.cadence === "statement-plan"
                      ? "Adds a payment record. Once statement amount is fully paid, due date moves to the next month's statement."
                      : bill.cadence === "one-time"
                      ? "Adds a payment record. This one-time bill stays complete once the full amount is paid."
                      : "Adds a payment record. Due date advances only after the cycle balance is fully paid."}
                  </div>

                  {/* âœ… Responsive grid to prevent overflow */}
                  <div className="paymentGrid" style={{ marginTop: 10 }}>
                    <div className="field">
                      <label>Date</label>
<input
  className="input dateField"
  type="date"
  value={paymentDraft.date}
  disabled={paymentBusy}
  onChange={(e) =>
    setPaymentDraft((d) => ({ ...d, date: e.target.value }))
  }
/>

                    </div>

                    <div className="field">
                      <label>Amount</label>
<input
  className="input amountField"
  inputMode="decimal"
  value={paymentDraft.amount}
  disabled={paymentBusy}
  onChange={(e) =>
    setPaymentDraft((d) => ({ ...d, amount: e.target.value }))
  }
/>

                    </div>

                    <div className="field">
                      <label>Status</label>
                      <input
                        className="input"
                        value={paymentDraft.note}
                        disabled={paymentBusy}
                        onChange={(e) =>
                          setPaymentDraft((d) => ({
                            ...d,
                            note: e.target.value,
                          }))
                        }
                        placeholder="Optional"
                      />
                    </div>

                    <button
                      className="btn primary"
                      disabled={paymentBusy}
                      onClick={handlePaymentSubmit}
                    >
                      {paymentSubmitLoading
                        ? editingPaymentId
                          ? "Saving..."
                          : "Adding..."
                        : editingPaymentId
                        ? "Save changes"
                        : "+ Add payment"}
                    </button>

                    {editingPaymentId ? (
                      <button
                        className="btn"
                        disabled={paymentBusy}
                        onClick={() => {
                          setEditingPaymentId(null);
                          setPaymentDraft(buildPaymentDraft(bill));
                        }}
                      >
                        Cancel edit
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="cardInner">
                  <div className="bold">Payment history</div>

                  <div className="tableWrap" style={{ marginTop: 10 }}>
                    <table className="table paymentHistoryTable">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th className="amountCol">Amount</th>
                          <th className="noteCol">Status</th>
                          <th className="right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(bill.payments || []).length === 0 ? (
                          <tr>
                            <td colSpan={4} className="muted">
                              No payments yet.
                            </td>
                          </tr>
                        ) : (
                          bill.payments.map((p) => (
                            <tr key={p.id}>
                              <td>{formatShortDate(p.date)}</td>
                              <td className="amountCol bold">
                                {formatMoney(p.amount)}
                              </td>
                              <td className="muted noteCol">{p.note || "-"}</td>
                              <td className="right" onClick={(e) => e.stopPropagation()}>
                                {!p.autoSeedPaidMonths && p.note !== "Unpaid rollover" ? (
                                  <div className="paymentRowActions">
                                    <button
                                      className="btn small"
                                      disabled={paymentBusy}
                                      onClick={() => {
                                        setEditingPaymentId(p.id);
                                        setPaymentDraft({
                                          date: p.date,
                                          amount: String(p.amount ?? 0),
                                          note: p.note || "",
                                        });
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      className="btn small danger"
                                      disabled={paymentBusy}
                                      onClick={() => handleDeletePayment(p.id)}
                                    >
                                      {paymentDeletingId === p.id ? "Deleting..." : "Delete"}
                                    </button>
                                  </div>
                                ) : (
                                  <span className="muted small">Auto</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ---------------- Notes ---------------- */}
            {tab === "notes" ? (
              <div className="modalBody">
                <div className="field">
                  <label>Notes</label>
                  <textarea
                    className="textarea"
                    value={notesDraft}
                    disabled={notesSaveLoading}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Add notes..."
                  />
                </div>

                <div className="actions right">
                  <button
                    className="btn"
                    disabled={notesSaveLoading}
                    onClick={() => setNotesDraft(bill.notes || "")}
                  >
                    Reset
                  </button>
                  <button
                    className="btn primary"
                    disabled={notesSaveLoading}
                    onClick={handleNotesSave}
                  >
                    {notesSaveLoading ? "Saving..." : "Save notes"}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}

      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="muted small">{label}</div>
      <div className="bold">{value}</div>
    </div>
  );
}

