import React, { useMemo, useState } from "react";
import {
  formatMoney,
  formatShortDate,
  startOfToday,
  toISODate,
} from "../../../lib/date/date.js";
import { computeBillMeta, getPlanProgress } from "../billsUtils.js";
const { useEffect } = React;

function formatCadenceLabel(cadence) {
  const raw = String(cadence || "monthly");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function buildPaymentDraft(bill) {
  return {
    date: toISODate(startOfToday()),
    amount: String(bill?.amount ?? 0),
    note: "",
  };
}

export default function BillDetailsDialog({
  open,
  onClose,
  bill,
  onEdit,
  onMarkPaid,
  onArchiveToggle,
  onSnoozeReminder,
  onDuplicate,
  onDelete,
  onAddPayment,
  onUpdatePayment,
  onDeletePayment,
  onUpdateNotes,
}) {
  // Hooks must always run (even if open is false)
  const meta = useMemo(() => (bill ? computeBillMeta(bill) : null), [bill]);
  const plan = useMemo(() => getPlanProgress(bill), [bill]);

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
                <span className="billHeaderMetaItem">Due {formatShortDate(bill.dueDate)}</span>
                <span className="billHeaderMetaSep">|</span>
                <span className="billHeaderMetaAmount">{formatMoney(bill.amount)}</span>
              </p>
            ) : null}
          </div>
          <button className="iconBtn" onClick={onClose} aria-label="Close">
            X
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
                      meta?.overdue
                        ? `${Math.abs(meta.daysToDue)} days late`
                        : meta?.daysToDue === 0
                        ? "Due today"
                        : `Due in ${meta?.daysToDue} day(s)`
                    }
                  />
                  <Stat
                    label="Months left"
                    value={
                      plan.enabled
                        ? `${plan.monthsLeft} of ${plan.totalMonths}`
                        : "Not set"
                    }
                  />
                  <Stat
                    label="Payments"
                    value={String(bill.payments?.length || 0)}
                  />
                </div>

                <div className="rowGap billOverviewFoot">
                  <div className="muted billOverviewHint">
                    Mark paid adds a payment and advances the due date to the
                    next cycle. If a plan is set, paid months also increases.
                  </div>
                  <div className="actions billOverviewActions">
                    <button
                      className="btn primary"
                      disabled={bill.archived}
                      onClick={onMarkPaid}
                    >
                      Mark paid
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
                    Adds a payment record and advances due date to next month.
                  </div>

                  {/* âœ… Responsive grid to prevent overflow */}
                  <div className="paymentGrid" style={{ marginTop: 10 }}>
                    <div className="field">
                      <label>Date</label>
<input
  className="input dateField"
  type="date"
  value={paymentDraft.date}
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
                      onClick={() => {
                        const amt = Number(paymentDraft.amount);
                        if (Number.isNaN(amt) || amt < 0) return;

                        if (editingPaymentId) {
                          onUpdatePayment?.(editingPaymentId, {
                            date: paymentDraft.date,
                            amount: amt,
                            note: paymentDraft.note.trim(),
                          });
                        } else {
                          onAddPayment({
                            id: crypto.randomUUID(),
                            date: paymentDraft.date,
                            amount: amt,
                            note: paymentDraft.note.trim(),
                          });
                        }

                        // reset draft after save
                        setEditingPaymentId(null);
                        setPaymentDraft(buildPaymentDraft(bill));
                      }}
                    >
                      {editingPaymentId ? "Save changes" : "+ Add payment"}
                    </button>

                    {editingPaymentId ? (
                      <button
                        className="btn"
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
                                      onClick={() => onDeletePayment?.(p.id)}
                                    >
                                      Delete
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
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Add notes..."
                  />
                </div>

                <div className="actions right">
                  <button
                    className="btn"
                    onClick={() => setNotesDraft(bill.notes || "")}
                  >
                    Reset
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => onUpdateNotes(notesDraft)}
                  >
                    Save notes
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

