import React, { useEffect, useMemo, useState } from "react";
import Header from "../components/layout/Header.jsx";
import SettingsDialog from "../components/layout/SettingsDialog.jsx";
import DueSoonBanner from "../features/bills/components/DueSoonBanner.jsx";
import BillsTable from "../features/bills/components/BillsTable.jsx";
import BillEditorDialog from "../features/bills/components/BillEditorDialog.jsx";
import BillDetailsDialog from "../features/bills/components/BillDetailsDialog.jsx";
import EmptyState from "../components/common/EmptyState.jsx";
import { formatMoney, parseISODate, startOfToday, toISODate } from "../lib/date/date.js";
import {
  createBackupPayload,
  validateBackupPayload,
} from "../features/bills/billsService.js";

import { useBills } from "../features/bills/hooks/useBills.js";
import { computeBillMeta } from "../features/bills/billsUtils.js";
import { useDueSoonNotifications } from "../features/bills/hooks/useDueSoonNotifications.js";

export default function App() {
  const {
    bills,
    addBill,
    updateBill,
    deleteBill,
    setBillArchived,
    duplicateBill,
    setBillReminderSnooze,
    markPaidAndAdvance,
    addPaymentAndAdvance,
    updatePayment,
    deletePayment,
    updateNotes,
    clearAll,
    replaceAllBills,
    notifyEnabled,
    setNotifyEnabled,
  } = useBills();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | dueSoon | overdue | thisMonth | archived
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [undoToast, setUndoToast] = useState(null);
  const [noticeToast, setNoticeToast] = useState(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [compactMode, setCompactMode] = useState(() => {
    try {
      return localStorage.getItem("bills_compact_mode") === "true";
    } catch {
      return false;
    }
  });

  const enriched = useMemo(() => {
    return bills
      .map((b) => ({ ...b, meta: computeBillMeta(b) }))
      .sort((a, b) => a.meta.dueDateObj - b.meta.dueDateObj);
  }, [bills]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    return enriched.filter((b) => {
      const isArchived = Boolean(b.archived);

      if (filter === "archived") {
        if (!isArchived) return false;
      } else if (isArchived) {
        return false;
      }

      if (q) {
        const hit =
          b.name.toLowerCase().includes(q) ||
          (b.category || "").toLowerCase().includes(q) ||
          (b.notes || "").toLowerCase().includes(q) ||
          String(b.amount ?? "").toLowerCase().includes(q) ||
          formatMoney(b.amount).toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (filter === "dueSoon") return b.meta.dueSoon;
      if (filter === "overdue") return b.meta.overdue;
      if (filter === "thisMonth") {
        const due = b.meta.dueDateObj;
        return (
          due.getMonth() === currentMonth && due.getFullYear() === currentYear
        );
      }
      return true;
    });
  }, [enriched, query, filter]);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const isMobile = window.matchMedia("(max-width: 700px)").matches;

    const visibleMs = prefersReducedMotion ? 0 : isMobile ? 500 : 650;
    const fadeMs = prefersReducedMotion ? 0 : 180;

    let hideTimer = null;
    const showTimer = setTimeout(() => {
      if (fadeMs === 0) {
        setShowSplash(false);
        return;
      }
      setSplashLeaving(true);
      hideTimer = setTimeout(() => {
        setShowSplash(false);
      }, fadeMs);
    }, visibleMs);

    return () => {
      clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => {
    if (!undoToast) return;
    const t = setTimeout(() => setUndoToast(null), 5000);
    return () => clearTimeout(t);
  }, [undoToast]);

  useEffect(() => {
    if (!noticeToast) return;
    const t = setTimeout(() => setNoticeToast(null), 2200);
    return () => clearTimeout(t);
  }, [noticeToast]);

  useEffect(() => {
    try {
      localStorage.setItem("bills_compact_mode", String(compactMode));
    } catch {
      // ignore
    }
  }, [compactMode]);

  useEffect(() => {
    if (!clearConfirmOpen) return;
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setClearConfirmOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [clearConfirmOpen]);

  const activeEnriched = useMemo(
    () => enriched.filter((b) => !b.archived),
    [enriched]
  );

  const dueSoonList = useMemo(
    () => activeEnriched.filter((b) => b.meta.dueSoon),
    [activeEnriched]
  );

  function isReminderSnoozed(bill) {
    const snooze = bill?.reminderSnooze;
    if (!snooze || typeof snooze !== "object") return false;

    if (snooze.type === "days" && typeof snooze.until === "string") {
      try {
        const today = startOfToday();
        const until = parseISODate(snooze.until);
        return today <= until;
      } catch {
        return false;
      }
    }

    if (snooze.type === "cycle" && typeof snooze.dueDate === "string") {
      return snooze.dueDate === bill?.dueDate;
    }

    return false;
  }

  const dueSoonForNotifications = useMemo(
    () => dueSoonList.filter((bill) => !isReminderSnoozed(bill)),
    [dueSoonList]
  );

  const dashboardTotals = useMemo(() => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    const totalDueThisMonth = activeEnriched.reduce((sum, b) => {
      const due = b.meta.dueDateObj;
      if (due.getMonth() !== month || due.getFullYear() !== year) return sum;
      return sum + Number(b.amount || 0);
    }, 0);

    const overdueAmount = activeEnriched.reduce((sum, b) => {
      if (!b.meta.overdue) return sum;
      return sum + Number(b.amount || 0);
    }, 0);

    const paidThisMonth = activeEnriched.reduce((sum, b) => {
      const payments = Array.isArray(b.payments) ? b.payments : [];
      return (
        sum +
        payments.reduce((inner, p) => {
          const paidDate = new Date(p.date);
          if (
            paidDate.getMonth() !== month ||
            paidDate.getFullYear() !== year ||
            Number.isNaN(paidDate.getTime())
          ) {
            return inner;
          }
          return inner + Number(p.amount || 0);
        }, 0)
      );
    }, 0);

    return {
      totalDueThisMonth,
      overdueAmount,
      paidThisMonth,
    };
  }, [activeEnriched]);

  useDueSoonNotifications({
    enabled: notifyEnabled,
    dueSoonBills: dueSoonForNotifications,
  });

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setInstallPromptEvent(event);
    }

    function handleAppInstalled() {
      setInstallPromptEvent(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function handleInstallApp() {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
  }

  async function handleTestNotification() {
    if (!("Notification" in window)) {
      setNoticeToast("Notifications are not supported.");
      return;
    }

    try {
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }

      if (Notification.permission !== "granted") {
        setNoticeToast("Allow notifications first.");
        return;
      }

      new Notification("Pocket Ledger test", {
        body: "Notifications are working.",
      });
      setNoticeToast("Test sent.");
    } catch {
      setNoticeToast("Could not send test.");
    }
  }

  function snapshotBills() {
    try {
      return JSON.parse(JSON.stringify(bills));
    } catch {
      return bills;
    }
  }

  function handleDeleteWithUndo(id) {
    const before = snapshotBills();
    deleteBill(id);
    setUndoToast({
      message: "Bill deleted",
      onUndo: () => replaceAllBills(before),
    });
  }

  function handleClearWithUndo() {
    const before = snapshotBills();
    clearAll();
    setUndoToast({
      message: "All bills cleared",
      onUndo: () => replaceAllBills(before),
    });
  }

  const selectedBill = useMemo(
    () => bills.find((b) => b.id === selectedId) || null,
    [bills, selectedId]
  );
  const editingBill = useMemo(
    () => bills.find((b) => b.id === editingId) || null,
    [bills, editingId]
  );

  if (showSplash) {
    return (
      <div
        className={`app splashScreen ${splashLeaving ? "isLeaving" : ""}`}
        role="status"
        aria-live="polite"
      >
        <div className="splashCard">
          <div className="splashLogoWrap" aria-hidden="true">
            <img className="splashLogo" src="/logo.svg" alt="" />
            <div className="splashSpinnerInLogo" />
          </div>
          <h1 className="splashTitle">Pocket Ledger</h1>
          <p className="muted splashText">Loading your bills...</p>
        </div>
      </div>
    );
  }

  function runWithUndo(message, action) {
    const before = snapshotBills();
    setNoticeToast(null);
    action();
    setUndoToast({
      message,
      onUndo: () => replaceAllBills(before),
    });
  }

  function handleArchiveToggleWithUndo(id, archived) {
    runWithUndo(archived ? "Bill archived" : "Bill restored", () => {
      setBillArchived(id, archived);
    });
  }

  function handleDuplicateWithUndo(id) {
    runWithUndo("Bill duplicated", () => {
      duplicateBill(id);
    });
  }

  function handleMarkPaidWithUndo(id) {
    runWithUndo("Marked as paid", () => {
      markPaidAndAdvance(id);
    });
  }

  function shiftTodayByDays(days) {
    const d = startOfToday();
    d.setDate(d.getDate() + Number(days || 0));
    return toISODate(d);
  }

  function handleReminderSnoozeWithUndo(id, mode) {
    if (mode === "clear") {
      runWithUndo("Reminder snooze cleared", () => {
        setBillReminderSnooze(id, null);
      });
      return;
    }

    const target = bills.find((b) => b.id === id);
    if (!target) return;

    if (mode === "1d") {
      runWithUndo("Reminder snoozed for 1 day", () => {
        setBillReminderSnooze(id, { type: "days", until: shiftTodayByDays(1) });
      });
      return;
    }

    if (mode === "3d") {
      runWithUndo("Reminder snoozed for 3 days", () => {
        setBillReminderSnooze(id, { type: "days", until: shiftTodayByDays(3) });
      });
      return;
    }

    if (mode === "cycle") {
      runWithUndo("Reminder snoozed this cycle", () => {
        setBillReminderSnooze(id, { type: "cycle", dueDate: target.dueDate });
      });
    }
  }

  function createRestorePreview(nextBills) {
    const currentById = new Map(
      (Array.isArray(bills) ? bills : []).map((b) => [String(b.id), b])
    );
    const nextById = new Map(
      (Array.isArray(nextBills) ? nextBills : []).map((b) => [String(b.id), b])
    );

    let added = 0;
    let updated = 0;
    let deleted = 0;

    nextById.forEach((nextBill, id) => {
      const current = currentById.get(id);
      if (!current) {
        added += 1;
        return;
      }
      if (JSON.stringify(current) !== JSON.stringify(nextBill)) {
        updated += 1;
      }
    });

    currentById.forEach((_, id) => {
      if (!nextById.has(id)) deleted += 1;
    });

    return {
      added,
      updated,
      deleted,
      incoming: nextById.size,
      current: currentById.size,
    };
  }

  async function handleRestorePreview(file) {
    if (!file) {
      return {
        ok: false,
        state: "error",
        title: "Restore failed",
        message: "No file was selected.",
        hint: "Pick a backup .json file from this app.",
      };
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const validation = validateBackupPayload(parsed);
      if (!validation.ok) {
        return {
          ok: false,
          state: "error",
          title: "Restore failed",
          message: validation.reason || "The backup file is invalid.",
          hint: "Use a backup exported from this app, then try again.",
        };
      }

      const restoredBills = Array.isArray(validation.data.bills)
        ? validation.data.bills
        : [];
      if (restoredBills.length === 0) {
        return {
          ok: false,
          state: "empty",
          title: "Backup is empty",
          message: "This file has no bills to restore.",
          hint: "Pick another backup file or create bills first.",
        };
      }

      return {
        ok: true,
        state: "preview",
        title: "Restore preview",
        preview: createRestorePreview(restoredBills),
        data: {
          bills: restoredBills,
          notifyEnabled: Boolean(validation.data.notifyEnabled),
        },
      };
    } catch {
      return {
        ok: false,
        state: "error",
        title: "Import error",
        message: "We could not read this file.",
        hint: "Make sure it is a valid .json backup file.",
      };
    }
  }

  async function handleRestoreApply(payload) {
    try {
      if (!payload || !Array.isArray(payload.bills)) {
        return {
          ok: false,
          state: "error",
          title: "Restore failed",
          message: "Restore payload is invalid.",
          hint: "Try another backup file.",
        };
      }

      replaceAllBills(payload.bills);
      setNotifyEnabled(Boolean(payload.notifyEnabled));
      setNoticeToast("Backup restored.");
      return { ok: true };
    } catch {
      return {
        ok: false,
        state: "error",
        title: "Restore failed",
        message: "Could not apply this backup.",
        hint: "Try again or choose another backup file.",
      };
    }
  }

  return (
    <div className={`app ${compactMode ? "compactMode" : ""}`}>
      <Header
        onOpenSettings={() => setSettingsOpen(true)}
        onAdd={() => {
          setEditingId(null);
          setEditorOpen(true);
        }}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        notifyEnabled={notifyEnabled}
        setNotifyEnabled={setNotifyEnabled}
        compactMode={compactMode}
        setCompactMode={setCompactMode}
        canInstall={Boolean(installPromptEvent)}
        onInstall={handleInstallApp}
        onBackup={() => {
          try {
            const payload = createBackupPayload({ bills, notifyEnabled });
            const blob = new Blob([JSON.stringify(payload, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const stamp = new Date().toISOString().slice(0, 10);
            a.download = `bills-backup-${stamp}.json`;
            a.click();
            URL.revokeObjectURL(url);
            setNoticeToast("Backup downloaded.");
          } catch {
            setNoticeToast("Backup failed.");
          }
        }}
        onRestorePreview={handleRestorePreview}
        onRestoreApply={handleRestoreApply}
        onTestNotification={handleTestNotification}
        onClear={() => setClearConfirmOpen(true)}
      />

      <div className="container">
        <DueSoonBanner
          dueSoonBills={dueSoonList}
          onOpen={(id) => {
            setSelectedId(id);
            setDetailsOpen(true);
          }}
        />

        <div className="card billsCard">
          <div className="cardHeader billsHeader">
            <div className="billsIntro">
              <div className="billsTitleRow">
                <h2>Bills Tracker</h2>
                <button
                  type="button"
                  className="infoTip"
                  aria-label="Bills Tracker info"
                  title='Click a bill to see history. "Mark paid" auto-advances due date to next month.'
                >
                  i
                  <span className="infoTipBubble" role="tooltip">
                    Click a bill to see history. "Mark paid" auto-advances due
                    date to next month.
                  </span>
                </button>
              </div>
            </div>

            <div className="toolbar billsToolbar">
              <div
                className={`billsFiltersRow ${mobileSearchOpen ? "searchOpen" : ""}`}
              >
                <button
                  type="button"
                  className="searchToggleBtn"
                  aria-label="Toggle search"
                  aria-expanded={mobileSearchOpen}
                  onClick={() => setMobileSearchOpen((open) => !open)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </button>

                <input
                  className="input billsSearchInput"
                  placeholder="Search bills or categories..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />

                <select
                  className="select billsFilterSelect"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="dueSoon">Due soon (&lt;= 3 days)</option>
                  <option value="overdue">Overdue</option>
                  <option value="thisMonth">This month</option>
                  <option value="archived">Archived</option>
                </select>

                <div
                  className="quickFilterChips"
                  role="tablist"
                  aria-label="Quick filters"
                >
                  <button
                    type="button"
                    className={`quickFilterChip ${filter === "all" ? "active" : ""}`}
                    onClick={() => setFilter("all")}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={`quickFilterChip ${filter === "dueSoon" ? "active" : ""}`}
                    onClick={() => setFilter("dueSoon")}
                  >
                    Due soon
                  </button>
                  <button
                    type="button"
                    className={`quickFilterChip ${filter === "overdue" ? "active" : ""}`}
                    onClick={() => setFilter("overdue")}
                  >
                    Overdue
                  </button>
                  <button
                    type="button"
                    className={`quickFilterChip ${filter === "thisMonth" ? "active" : ""}`}
                    onClick={() => setFilter("thisMonth")}
                  >
                    This month
                  </button>
                  <button
                    type="button"
                    className={`quickFilterChip ${filter === "archived" ? "active" : ""}`}
                    onClick={() => setFilter("archived")}
                  >
                    Archived
                  </button>
                </div>
              </div>

              <button
                className="btn primary"
                onClick={() => {
                  setEditingId(null);
                  setEditorOpen(true);
                }}
              >
                + Add bill
              </button>
            </div>
          </div>

          <div className="billsMiniStats" aria-label="Bills totals">
            <div className="billsMiniStat">
              <span className="billsMiniStatLabel">Due this month</span>
              <strong className="billsMiniStatValue">
                {formatMoney(dashboardTotals.totalDueThisMonth)}
              </strong>
            </div>
            <div className="billsMiniStat">
              <span className="billsMiniStatLabel">Overdue amount</span>
              <strong className="billsMiniStatValue">
                {formatMoney(dashboardTotals.overdueAmount)}
              </strong>
            </div>
            <div className="billsMiniStat">
              <span className="billsMiniStatLabel">Paid this month</span>
              <strong className="billsMiniStatValue">
                {formatMoney(dashboardTotals.paidThisMonth)}
              </strong>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No bills found"
              subtitle="Add a bill or change your filters/search."
            />
          ) : (
            <BillsTable
              bills={filtered}
              query={query}
              onRowClick={(id) => {
                setSelectedId(id);
                setDetailsOpen(true);
              }}
              onEdit={(id) => {
                setEditingId(id);
                setEditorOpen(true);
              }}
              onDelete={handleDeleteWithUndo}
              onMarkPaid={handleMarkPaidWithUndo}
              onArchiveToggle={handleArchiveToggleWithUndo}
              onDuplicate={handleDuplicateWithUndo}
            />
          )}

        </div>
      </div>

      <BillEditorDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        bill={editingBill}
        onSave={(data) => {
          if (editingBill) {
            runWithUndo("Bill updated", () => {
              updateBill(editingBill.id, data);
            });
          } else {
            runWithUndo("Bill added", () => {
              addBill(data);
            });
          }
          setEditorOpen(false);
        }}
      />

      <BillDetailsDialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        bill={selectedBill}
        onEdit={() => {
          if (!selectedBill) return;
          setDetailsOpen(false);
          setEditingId(selectedBill.id);
          setEditorOpen(true);
        }}
        onMarkPaid={() => {
          if (!selectedBill) return;
          handleMarkPaidWithUndo(selectedBill.id);
        }}
        onAddPayment={(payment) => {
          if (!selectedBill) return;
          runWithUndo("Payment added", () => {
            addPaymentAndAdvance(selectedBill.id, payment);
          });
        }}
        onUpdatePayment={(paymentId, patch) => {
          if (!selectedBill) return;
          runWithUndo("Payment updated", () => {
            updatePayment(selectedBill.id, paymentId, patch);
          });
        }}
        onDeletePayment={(paymentId) => {
          if (!selectedBill) return;
          runWithUndo("Payment deleted", () => {
            deletePayment(selectedBill.id, paymentId);
          });
        }}
        onUpdateNotes={(notes) => {
          if (!selectedBill) return;
          runWithUndo("Notes updated", () => {
            updateNotes(selectedBill.id, notes);
          });
        }}
        onArchiveToggle={(archived) => {
          if (!selectedBill) return;
          handleArchiveToggleWithUndo(selectedBill.id, archived);
        }}
        onSnoozeReminder={(mode) => {
          if (!selectedBill) return;
          handleReminderSnoozeWithUndo(selectedBill.id, mode);
        }}
        onDuplicate={() => {
          if (!selectedBill) return;
          handleDuplicateWithUndo(selectedBill.id);
        }}
        onDelete={() => {
          if (!selectedBill) return;
          handleDeleteWithUndo(selectedBill.id);
          setDetailsOpen(false);
        }}
      />

      {clearConfirmOpen ? (
        <div
          className="modalBackdrop confirmBackdrop"
          onMouseDown={() => setClearConfirmOpen(false)}
        >
          <div className="modal modal-sm confirmModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="confirmBody">
              <div className="confirmTitleRow">
                <span className="confirmIcon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 3 2.7 19.5h18.6L12 3Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <path d="M12 9v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    <circle cx="12" cy="16.5" r="1" fill="currentColor" />
                  </svg>
                </span>
                <h3>Clear all bills?</h3>
              </div>
              <p className="muted confirmText">
                This will remove your current list. You can still tap Undo right after.
              </p>
              <div className="confirmActions">
                <button className="btn small" onClick={() => setClearConfirmOpen(false)}>
                  Cancel
                </button>
                <button
                  className="btn small danger confirmDangerBtn"
                  onClick={() => {
                    handleClearWithUndo();
                    setClearConfirmOpen(false);
                  }}
                >
                  Yes, clear
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {undoToast || noticeToast ? (
        <div className="toastDock">
          {!undoToast && noticeToast ? (
            <div className="appToast noticeToast" role="status" aria-live="polite">
              <span className="noticeToastIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="m6.8 12.4 3.2 3.2 7.2-7.2"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span>{noticeToast}</span>
            </div>
          ) : null}

          {undoToast ? (
            <div className="appToast undoToast" role="status" aria-live="polite">
              <span className="noticeToastIcon undoToastIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="m6.8 12.4 3.2 3.2 7.2-7.2"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span>{undoToast.message}</span>
              <button
                type="button"
                className="toastInlineAction"
                onClick={() => {
                  undoToast.onUndo?.();
                  setUndoToast(null);
                }}
              >
                Undo
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

