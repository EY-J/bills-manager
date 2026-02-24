import React, { useEffect, useState } from "react";
import { formatMoney, formatShortDate } from "../../../lib/date/date.js";
import { getPlanProgress } from "../billsUtils.js";

function getBillStatus(bill) {
  if (bill.archived) return { label: "Archived", tone: "archived" };
  if (bill.meta.overdue) {
    if (bill.meta.partiallyPaid) {
      return {
        label: `Overdue - ${formatMoney(bill.meta.remainingAmount)} left`,
        tone: "overdue",
      };
    }
    return { label: "Overdue", tone: "overdue" };
  }

  if (bill.meta.partiallyPaid) {
    return {
      label: `Partial - ${formatMoney(bill.meta.remainingAmount)} left`,
      tone: "partial",
    };
  }

  if (bill.meta.daysToDue === 0) {
    return { label: "Due today", tone: "dueSoon" };
  }

  if (bill.meta.dueSoon) {
    return { label: `Due in ${bill.meta.daysToDue}d`, tone: "dueSoon" };
  }

  if (bill.meta.lastPaid) {
    const paid = new Date(bill.meta.lastPaid);
    const now = new Date();
    if (
      paid.getFullYear() === now.getFullYear() &&
      paid.getMonth() === now.getMonth()
    ) {
      return { label: "Paid", tone: "paid" };
    }
  }

  return { label: "Upcoming", tone: "upcoming" };
}

function isInteractiveTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button, a, input, select, textarea, [role='button'], [role='menuitem']"
    )
  );
}

export default function BillsTable({
  bills,
  query,
  isMarkPaidLoading,
  onRowClick,
  onEdit,
  onDelete,
  onMarkPaid,
  onArchiveToggle,
  onDuplicate,
}) {
  const [openMenuId, setOpenMenuId] = useState(null);
  const [expandedRowId, setExpandedRowId] = useState(null);
  const q = (query || "").trim();

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!(event.target instanceof Element)) return;
      if (
        event.target.closest(".rowMenu") ||
        event.target.closest(".rowMenuTrigger")
      ) {
        return;
      }
      setOpenMenuId(null);
    }

    function handleEscape(event) {
      if (event.key === "Escape") setOpenMenuId(null);
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className="tableWrap billsTableWrap">
      <table className="table billsTable">
        <thead>
          <tr>
            <th>
              <span className="headerLabelDesktop">Bill name</span>
              <span className="headerLabelMobile">Bill</span>
            </th>
            <th>Category</th>
            <th>
              <span className="headerLabelDesktop">Due date</span>
              <span className="headerLabelMobile">Due</span>
            </th>
            <th className="right">Amount</th>
            <th>Status</th>
            <th>Last paid</th>
            <th className="actionsHeaderCell" aria-label="More actions">
              <span className="headerLabelDesktop">More</span>
              <span className="headerLabelMobile" aria-hidden="true"></span>
            </th>
          </tr>
        </thead>

        <tbody>
          {bills.map((b) => {
            const plan = getPlanProgress(b);
            const status = getBillStatus(b);
            const markPaidLoading = Boolean(isMarkPaidLoading?.(b.id));
            const mobileStatus =
              status.tone === "overdue"
                ? "Overdue"
                : status.tone === "partial"
                  ? "Partial"
                  : status.tone === "dueSoon"
                    ? b.meta.daysToDue === 0
                      ? "Due today"
                      : "Due soon"
                    : status.tone === "paid"
                      ? "Paid"
                      : status.tone === "archived"
                        ? "Archived"
                        : "Upcoming";
            const noteHit =
              q.length > 0 &&
              (b.notes || "").toLowerCase().includes(q.toLowerCase());
            const showDetails = expandedRowId === b.id || noteHit;
            const compactMetaParts = [formatCadenceLabel(b.cadence)];
            if (plan.enabled) compactMetaParts.push(`${plan.monthsLeft} left`);
            else if (b.meta.monthsPending > 0) {
              compactMetaParts.push(
                `${b.meta.monthsPending} month${b.meta.monthsPending === 1 ? "" : "s"} pending`
              );
            }
            return (
              <tr
                key={b.id}
                className={`row ${showDetails ? "expanded" : ""}`}
                tabIndex={0}
                aria-label={`Open ${b.name} details`}
                onClick={() => onRowClick(b.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  if (isInteractiveTarget(event.target)) return;
                  event.preventDefault();
                  onRowClick(b.id);
                }}
              >
                <td>
                  <div className="billName">
                    <span className="bold">{renderHighlightedText(b.name, q)}</span>
                  </div>

                  <div className="muted small billMetaLine">
                    <span>{compactMetaParts.join(" | ")}</span>
                    <button
                      type="button"
                      className={`billExpandHint ${showDetails ? "open" : ""}`}
                      aria-label={showDetails ? "Hide row details" : "Show row details"}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedRowId((current) => (current === b.id ? null : b.id));
                      }}
                    >
                      <svg viewBox="0 0 20 20" fill="none">
                        <path
                          d="M6 8l4 4 4-4"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>

                  <div className="muted small billMobileMeta">
                    <div className="billMobileMetaPrimary">
                      <span className="billMobileCategory">{b.category || "-"}</span>
                      <span className="billMetaDivider">|</span>
                      <span className="billMobileAmount">{formatMoney(b.amount)}</span>
                      <span className="billMetaDivider">|</span>
                      <span className={`billMobileStatus billMobileStatus-${status.tone}`}>
                        {mobileStatus}
                      </span>
                    </div>
                    {b.meta.lastPaid ? (
                      <div className="billMobileMetaSecondary">
                        {`Paid ${formatShortDate(b.meta.lastPaid)}`}
                      </div>
                    ) : null}
                  </div>

                  {showDetails ? (
                    <div className="muted small billExtra">
                      {plan.enabled ? (
                        <div className="billExtraLine">
                          {plan.paidMonths}/{plan.totalMonths} paid
                        </div>
                      ) : null}
                      {b.meta.monthsPending > 0 ? (
                        <div className="billExtraLine">
                          {b.meta.monthsPending} month
                          {b.meta.monthsPending === 1 ? "" : "s"} pending
                        </div>
                      ) : null}
                      {noteHit ? (
                        <div className="billExtraLine billNote">
                          {renderHighlightedText(b.notes, q)}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </td>

                <td className="muted">{renderHighlightedText(b.category || "-", q)}</td>

                <td>
                  <div className="dueCell">
                    <span className="dueDesktopText">{formatShortDate(b.dueDate)}</span>
                    <span className="dueMobileText">{formatMobileDate(b.dueDate)}</span>
                    <span className="muted small dueDesktopDelta">
                      (
                      {b.meta.daysToDue < 0
                        ? `${Math.abs(b.meta.daysToDue)}d late`
                        : `${b.meta.daysToDue}d`}
                      )
                    </span>
                    <span className="muted small dueMobileDelta">
                      {formatMobileDueDelta(b.meta.daysToDue)}
                    </span>
                  </div>
                </td>

                <td className="right bold">
                  {renderHighlightedText(formatMoney(b.amount), q)}
                  {b.meta.remainingAmount > 0 ? (
                    <div className="muted small remainingInline">
                      Left {formatMoney(b.meta.remainingAmount)}
                    </div>
                  ) : null}
                </td>

                <td>
                  <span className={`statusBadge ${status.tone}`}>
                    <StatusIcon tone={status.tone} />
                    {status.label}
                  </span>
                </td>

                <td className="muted">
                  {b.meta.lastPaid ? formatShortDate(b.meta.lastPaid) : "-"}
                </td>

                <td className="right" onClick={(e) => e.stopPropagation()}>
                  <div className="actions rowActionsDesktop">
                    <button
                      className="btn small primary iconActionBtn"
                      onClick={() => onMarkPaid(b.id)}
                      disabled={b.archived || markPaidLoading}
                      aria-label={markPaidLoading ? "Marking paid" : "Mark paid"}
                      title={markPaidLoading ? "Marking..." : "Mark paid"}
                      aria-busy={markPaidLoading ? "true" : undefined}
                    >
                      <span className="actionIcon" aria-hidden="true">
                        {markPaidLoading ? (
                          <svg
                            className="btnLoadingSpin"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
                          </svg>
                        ) : (
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        )}
                      </span>
                      <span className="actionText">
                        {markPaidLoading ? "Marking..." : "Mark paid"}
                      </span>
                    </button>
                    <button
                      className="btn small iconActionBtn"
                      onClick={() => onEdit(b.id)}
                      aria-label="Edit"
                      title="Edit"
                    >
                      <span className="actionIcon" aria-hidden="true">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 20h9" />
                          <path d="m16.5 3.5 4 4L7 21l-4 1 1-4z" />
                        </svg>
                      </span>
                      <span className="actionText">Edit</span>
                    </button>
                    <button
                      className="btn small iconActionBtn"
                      onClick={() => onDuplicate?.(b.id)}
                      aria-label="Duplicate"
                      title="Duplicate"
                    >
                      <span className="actionIcon" aria-hidden="true">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="9" y="9" width="11" height="11" rx="2" />
                          <rect x="4" y="4" width="11" height="11" rx="2" />
                        </svg>
                      </span>
                      <span className="actionText">Duplicate</span>
                    </button>
                    <button
                      className="btn small iconActionBtn"
                      onClick={() => onArchiveToggle?.(b.id, !b.archived)}
                      aria-label={b.archived ? "Restore" : "Archive"}
                      title={b.archived ? "Restore" : "Archive"}
                    >
                      <span className="actionIcon" aria-hidden="true">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="3" y="4" width="18" height="4" rx="1" />
                          <path d="M5 8h14l-1 11H6L5 8Z" />
                        </svg>
                      </span>
                      <span className="actionText">
                        {b.archived ? "Restore" : "Archive"}
                      </span>
                    </button>
                    <button
                      className="btn small danger iconActionBtn"
                      onClick={() => onDelete(b.id)}
                      aria-label="Delete"
                      title="Delete"
                    >
                      <span className="actionIcon" aria-hidden="true">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M19 6l-1 14H6L5 6" />
                        </svg>
                      </span>
                      <span className="actionText">Delete</span>
                    </button>
                  </div>

                  <div className="rowActionsMobile">
                    <button
                      className={`btn small rowMenuTrigger ${
                        openMenuId === b.id ? "open" : ""
                      }`}
                      aria-label={openMenuId === b.id ? "Close actions" : "Open actions"}
                      title={openMenuId === b.id ? "Close actions" : "More options"}
                      aria-expanded={openMenuId === b.id}
                      aria-haspopup="menu"
                      onClick={() =>
                        setOpenMenuId((currentId) =>
                          currentId === b.id ? null : b.id
                        )
                      }
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <circle cx="10" cy="4.5" r="1.6" />
                        <circle cx="10" cy="10" r="1.6" />
                        <circle cx="10" cy="15.5" r="1.6" />
                      </svg>
                    </button>

                    {openMenuId === b.id ? (
                      <div className="rowMenu" role="menu" aria-label="Row actions">
                        <button
                          className="btn small rowMenuItem"
                          aria-label={markPaidLoading ? "Marking paid" : "Mark paid"}
                          title={markPaidLoading ? "Marking..." : "Mark paid"}
                          disabled={b.archived || markPaidLoading}
                          aria-busy={markPaidLoading ? "true" : undefined}
                          onClick={() => {
                            onMarkPaid(b.id);
                            setOpenMenuId(null);
                          }}
                        >
                          <span className="actionIcon" aria-hidden="true">
                            {markPaidLoading ? (
                              <svg
                                className="btnLoadingSpin"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M21 12a9 9 0 1 1-2.6-6.4" />
                              </svg>
                            ) : (
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                            )}
                          </span>
                        </button>

                      <button
                        className="btn small rowMenuItem"
                        aria-label="Edit"
                        title="Edit"
                        onClick={() => {
                          onEdit(b.id);
                          setOpenMenuId(null);
                        }}
                      >
                        <span className="actionIcon" aria-hidden="true">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 20h9" />
                            <path d="m16.5 3.5 4 4L7 21l-4 1 1-4z" />
                          </svg>
                        </span>
                      </button>

                      <button
                        className="btn small rowMenuItem"
                        aria-label="Duplicate"
                        title="Duplicate"
                        onClick={() => {
                          onDuplicate?.(b.id);
                          setOpenMenuId(null);
                        }}
                      >
                        <span className="actionIcon" aria-hidden="true">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="9" y="9" width="11" height="11" rx="2" />
                            <rect x="4" y="4" width="11" height="11" rx="2" />
                          </svg>
                        </span>
                      </button>

                      <button
                        className="btn small rowMenuItem"
                        aria-label={b.archived ? "Restore" : "Archive"}
                        title={b.archived ? "Restore" : "Archive"}
                        onClick={() => {
                          onArchiveToggle?.(b.id, !b.archived);
                          setOpenMenuId(null);
                        }}
                      >
                        <span className="actionIcon" aria-hidden="true">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="3" y="4" width="18" height="4" rx="1" />
                            <path d="M5 8h14l-1 11H6L5 8Z" />
                          </svg>
                        </span>
                      </button>

                      <button
                        className="btn small danger rowMenuItem rowMenuItemDanger"
                        aria-label="Delete"
                        title="Delete"
                        onClick={() => {
                          onDelete(b.id);
                          setOpenMenuId(null);
                        }}
                      >
                        <span className="actionIcon" aria-hidden="true">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M19 6l-1 14H6L5 6" />
                          </svg>
                        </span>
                      </button>
                    </div>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function renderHighlightedText(text, query) {
  const raw = String(text ?? "");
  const q = (query || "").trim();
  if (!q) return raw;

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = raw.split(new RegExp(`(${escaped})`, "ig"));

  return parts.map((part, idx) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark className="rowMatch" key={`${part}-${idx}`}>
        {part}
      </mark>
    ) : (
      <React.Fragment key={`${part}-${idx}`}>{part}</React.Fragment>
    )
  );
}

function formatCadenceLabel(cadence) {
  const raw = String(cadence || "monthly");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatMobileDate(isoDate) {
  if (typeof isoDate !== "string") return formatShortDate(isoDate);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return formatShortDate(isoDate);
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatMobileDueDelta(daysToDue) {
  if (daysToDue === 0) return "today";
  if (daysToDue < 0) return `${Math.abs(daysToDue)}d late`;
  return `${daysToDue}d`;
}

function StatusIcon({ tone }) {
  if (tone === "paid") {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3.5 8.2 6.6 11.2 12.5 5.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === "overdue") {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 2.2 2.4 12h11.2L8 2.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 5.6v3.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="10.9" r=".7" fill="currentColor" />
      </svg>
    );
  }
  if (tone === "dueSoon") {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 5.2V8l2 1.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === "partial") {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 8V2.5a5.5 5.5 0 0 1 5.2 5.5H8Z" fill="currentColor" fillOpacity=".4" />
      </svg>
    );
  }
  if (tone === "archived") {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2.3" y="3" width="11.4" height="2.6" rx=".8" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 5.8h10l-.8 6.8H3.8L3 5.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 8h3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
