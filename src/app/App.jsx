import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Header from "../components/layout/Header.jsx";
import MobileBottomNav from "../components/layout/MobileBottomNav.jsx";
import DueSoonBanner from "../features/bills/components/DueSoonBanner.jsx";
import BillsTable from "../features/bills/components/BillsTable.jsx";
import EmptyState from "../components/common/EmptyState.jsx";
import { formatMoney, parseISODate, startOfToday, toISODate } from "../lib/date/date.js";
import {
  buildRestorePlan,
  createBackupPayload,
  validateBackupPayload,
} from "../features/bills/billsService.js";
import {
  changeAccountPassword,
  completePasswordResetWithRecoveryCode,
  createAccount,
  deleteAccount,
  getAccountSession,
  loginAccount,
  logoutAccount,
  pullAccountBackup,
  pushAccountBackup,
} from "../lib/account/accountClient.js";

import {
  BILLS_EXTERNAL_SYNC_EVENT,
  STORAGE_WARNING_EVENT,
  useBills,
} from "../features/bills/hooks/useBills.js";
import { computeBillMeta } from "../features/bills/billsUtils.js";
import { useDueSoonNotifications } from "../features/bills/hooks/useDueSoonNotifications.js";

const SettingsDialog = lazy(() => import("../components/layout/SettingsDialog.jsx"));
const AccountDialog = lazy(() => import("../components/layout/AccountDialog.jsx"));
const BillEditorDialog = lazy(() => import("../features/bills/components/BillEditorDialog.jsx"));
const BillDetailsDialog = lazy(() => import("../features/bills/components/BillDetailsDialog.jsx"));
const CalendarDialog = lazy(() => import("../features/bills/components/CalendarDialog.jsx"));

const MAX_RESTORE_FILE_BYTES = 2 * 1024 * 1024; // 2 MB guard against UI freeze on huge imports.
const STORAGE_WARNING_MESSAGE = "Storage unavailable. Changes may not persist.";
const EXTERNAL_SYNC_NOTICE_MESSAGE = "Updated from another tab.";
const MAX_UNDO_QUEUE = 8;
const LAST_BACKUP_AT_KEY = "bills_last_backup_at";
const LAST_ACCOUNT_SYNC_AT_KEY = "bills_last_account_sync_at";
const ACCOUNT_AUTO_SYNC_KEY = "bills_account_auto_sync";
const ACCOUNT_KNOWN_KEY = "bills_account_known_v1";
const ACCOUNT_LOCAL_USER_KEY = "bills_account_user_v1";
const ACCOUNT_E2E_LOCAL_SESSION_KEY = "__bills_e2e_unlock_session_v1";
const ACCOUNT_PREVIEW_ROTATE_MS = 4200;
const SESSION_RESTORE_TIMEOUT_MS = 3500;
const ACCOUNT_FEATURE_PREVIEWS = [
  {
    id: "tracker",
    badge: "Bills Tracker",
    title: "Track recurring and one-time bills",
    text: "Stay on top of every due date with quick status visibility.",
    statValue: "14",
    statLabel: "Active bills",
    rows: [
      { label: "Rent", status: "Due soon", tone: "soon" },
      { label: "Water bill", status: "Overdue", tone: "danger" },
      { label: "Internet", status: "Paid", tone: "ok" },
    ],
  },
  {
    id: "calendar",
    badge: "Due Calendar",
    title: "See due dates in a calendar view",
    text: "Scan the month and spot overdue or due-today bills faster.",
    statValue: "6",
    statLabel: "This month",
    rows: [
      { label: "Feb 12", status: "2 bills", tone: "soon" },
      { label: "Feb 18", status: "Due today", tone: "today" },
      { label: "Feb 26", status: "Cleared", tone: "ok" },
    ],
  },
  {
    id: "payments",
    badge: "Payments",
    title: "Record full or partial payments",
    text: "Keep payment history per bill and instantly see remaining balance.",
    statValue: "36",
    statLabel: "Payment logs",
    rows: [
      { label: "Electric bill", status: "Partial", tone: "partial" },
      { label: "Car loan", status: "P1,250 posted", tone: "ok" },
      { label: "Receipt note", status: "Saved", tone: "neutral" },
    ],
  },
  {
    id: "plans",
    badge: "Flexible Plans",
    title: "Handle one-time and statement-plan dues",
    text: "Track debts, pay-later plans, and changing monthly amounts in one place.",
    statValue: "4",
    statLabel: "Plan bills",
    rows: [
      { label: "Phone loan", status: "Statement plan", tone: "neutral" },
      { label: "Friend debt", status: "One-time", tone: "soon" },
      { label: "Next due", status: "Apr 25", tone: "today" },
    ],
  },
  {
    id: "insights",
    badge: "Insights",
    title: "Spot risks early with status totals",
    text: "Use due-soon and overdue views to prioritize what to pay first.",
    statValue: "3",
    statLabel: "Overdue",
    rows: [
      { label: "Overdue", status: "3 bills", tone: "danger" },
      { label: "Due soon", status: "5 bills", tone: "soon" },
      { label: "Paid this month", status: "P12,450", tone: "ok" },
    ],
  },
  {
    id: "sync",
    badge: "Account Sync",
    title: "Keep data synced across devices",
    text: "Sign in once to use Pocket Ledger on phone and web with the same records.",
    statValue: "2",
    statLabel: "Devices linked",
    rows: [
      { label: "Phone", status: "Synced", tone: "ok" },
      { label: "Web app", status: "Synced", tone: "ok" },
      { label: "Last update", status: "Just now", tone: "neutral" },
    ],
  },
  {
    id: "safety",
    badge: "Backup & Recovery",
    title: "Protect your data and recover access",
    text: "Use export backup and recovery code reset to avoid data loss and lockout.",
    statValue: "100%",
    statLabel: "You control it",
    rows: [
      { label: "Backup export", status: "JSON ready", tone: "ok" },
      { label: "Recovery code", status: "Reset access", tone: "today" },
      { label: "Account sync", status: "Cross-device", tone: "neutral" },
    ],
  },
];

function parseRetrySecondsFromMessage(message) {
  const value = String(message || "");
  const match = value.match(/(\d+)\s*s\b/i);
  if (!match) return 0;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(1, Math.ceil(seconds));
}

function extractChallengeFromError(errorLike) {
  if (!errorLike || typeof errorLike !== "object") return null;
  const data = errorLike.data;
  if (!data || typeof data !== "object") return null;
  if (!data.challengeRequired) return null;
  const challengeToken =
    typeof data.challengeToken === "string" ? data.challengeToken.trim() : "";
  const challengePrompt =
    typeof data.challengePrompt === "string" ? data.challengePrompt.trim() : "";
  if (!challengeToken || !challengePrompt) return null;
  return {
    token: challengeToken,
    prompt: challengePrompt,
  };
}

function isErrorNoticeMessage(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes("no account found") ||
    text.includes("failed") ||
    text.includes("could not") ||
    text.includes("invalid") ||
    text.includes("denied") ||
    text.includes("error") ||
    text.includes("unsupported") ||
    text.includes("not configured") ||
    text.includes("not supported") ||
    text.includes("rate limit")
  );
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function readLocalE2EAccountSessionUser() {
  if (typeof window === "undefined") return null;
  if (!isLoopbackHost(window.location.hostname)) return null;

  try {
    if (localStorage.getItem(ACCOUNT_E2E_LOCAL_SESSION_KEY) !== "1") {
      return null;
    }
  } catch {
    return null;
  }

  return {
    id: "local-e2e-session",
    email: "qa@local.test",
  };
}

function normalizeStoredAccountUser(value) {
  if (!value || typeof value !== "object") return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) return null;
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  return { id, email };
}

function readCachedAccountUser() {
  const e2eUser = readLocalE2EAccountSessionUser();
  if (e2eUser) return e2eUser;
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(ACCOUNT_LOCAL_USER_KEY);
    if (!raw) return null;
    return normalizeStoredAccountUser(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCachedAccountUser(user) {
  if (typeof window === "undefined") return;
  const normalized = normalizeStoredAccountUser(user);
  try {
    if (!normalized) {
      localStorage.removeItem(ACCOUNT_LOCAL_USER_KEY);
      return;
    }
    localStorage.setItem(ACCOUNT_LOCAL_USER_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage failures; auth still resolves from the server session.
  }
}

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
  const initialLocalSessionUserRef = useRef(undefined);

  if (initialLocalSessionUserRef.current === undefined) {
    initialLocalSessionUserRef.current = readCachedAccountUser();
  }

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | dueSoon | overdue | thisMonth | archived
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [undoQueue, setUndoQueue] = useState([]);
  const [noticeToast, setNoticeToast] = useState(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [accountEntryAuthMode, setAccountEntryAuthMode] = useState("signin");
  const [accountRecoveryCode, setAccountRecoveryCode] = useState("");
  const [hasKnownAccount, setHasKnownAccount] = useState(() => {
    try {
      if (readCachedAccountUser()) {
        return true;
      }
      return localStorage.getItem(ACCOUNT_KNOWN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [accountPreviewIndex, setAccountPreviewIndex] = useState(0);
  const [showSplash, setShowSplash] = useState(true);
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [compactMode, setCompactMode] = useState(() => {
    try {
      return localStorage.getItem("bills_compact_mode") === "true";
    } catch {
      return false;
    }
  });
  const [tableDensity, setTableDensity] = useState(() => {
    try {
      return localStorage.getItem("bills_table_density") === "compact"
        ? "compact"
        : "comfortable";
    } catch {
      return "comfortable";
    }
  });
  const [notificationMode, setNotificationMode] = useState(() => {
    try {
      return localStorage.getItem("bills_notify_mode") === "instant"
        ? "instant"
        : "digest";
    } catch {
      return "digest";
    }
  });
  const [lastBackupAt, setLastBackupAt] = useState(() => {
    try {
      const raw = localStorage.getItem(LAST_BACKUP_AT_KEY);
      return typeof raw === "string" ? raw : "";
    } catch {
      return "";
    }
  });
  const [accountSessionReady, setAccountSessionReady] = useState(() =>
    Boolean(initialLocalSessionUserRef.current)
  );
  const [accountUser, setAccountUser] = useState(
    () => initialLocalSessionUserRef.current || null
  );
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountSyncBusy, setAccountSyncBusy] = useState(false);
  const [accountStorageMode, setAccountStorageMode] = useState("unknown");
  const [accountAutoSync, setAccountAutoSync] = useState(() => {
    try {
      const raw = localStorage.getItem(ACCOUNT_AUTO_SYNC_KEY);
      if (raw === "false") return false;
      return true;
    } catch {
      return true;
    }
  });
  const [lastAccountSyncAt, setLastAccountSyncAt] = useState(() => {
    try {
      const raw = localStorage.getItem(LAST_ACCOUNT_SYNC_AT_KEY);
      return typeof raw === "string" ? raw : "";
    } catch {
      return "";
    }
  });
  const [riskRestorePoint, setRiskRestorePoint] = useState(null);
  const [mobileTab, setMobileTab] = useState("bills");
  const [actionLoadingMap, setActionLoadingMap] = useState({});
  const actionLoadingRef = useRef(new Set());
  const storageWarningCooldownRef = useRef(0);
  const externalSyncCooldownRef = useRef(0);
  const accountAutoSyncPrimedRef = useRef(false);
  const accountAutoSyncTimerRef = useRef(0);
  const accountSkipNextAutoPushRef = useRef(false);
  const accountSyncBusyRef = useRef(false);
  const accountSessionInitRef = useRef(false);
  const dueSoonRef = useRef(null);
  const billsRef = useRef(null);
  const statsRef = useRef(null);
  const hasBlockingModal =
    settingsOpen || accountOpen || calendarOpen || editorOpen || detailsOpen || clearConfirmOpen;
  const currentUndoToast = undoQueue[0] || null;
  const queuedUndoCount = Math.max(undoQueue.length - 1, 0);
  const noticeToastIsError = isErrorNoticeMessage(noticeToast);
  const accountSignedIn = Boolean(accountUser?.id);
  const accountSessionPending = !accountSessionReady;
  const accountRequired = accountSessionReady && !accountSignedIn;
  const accountBlocked = accountSessionPending || accountRequired;
  const accountEntryMode = hasKnownAccount ? "signin" : "signup";
  const accountPreviewCount = ACCOUNT_FEATURE_PREVIEWS.length;

  const markAccountAsKnown = useCallback(() => {
    setHasKnownAccount(true);
    try {
      localStorage.setItem(ACCOUNT_KNOWN_KEY, "1");
    } catch {
      // Ignore storage failures; in-memory state still hides onboarding nudge.
    }
  }, []);

  useEffect(() => {
    writeCachedAccountUser(accountUser);
  }, [accountUser]);

  const openAccountDialog = useCallback((mode = "signin") => {
    const nextMode = String(mode || "").trim().toLowerCase() === "signup" ? "signup" : "signin";
    setAccountEntryAuthMode(nextMode);
    setAccountOpen(true);
  }, []);

  useEffect(() => {
    if (!accountBlocked) return;
    setSettingsOpen(false);
    setCalendarOpen(false);
    setEditorOpen(false);
    setDetailsOpen(false);
    setClearConfirmOpen(false);
  }, [accountBlocked]);

  const showPrevAccountPreview = useCallback(() => {
    setAccountPreviewIndex((current) =>
      (current - 1 + accountPreviewCount) % accountPreviewCount
    );
  }, [accountPreviewCount]);

  const showNextAccountPreview = useCallback(() => {
    setAccountPreviewIndex((current) => (current + 1) % accountPreviewCount);
  }, [accountPreviewCount]);

  useEffect(() => {
    if (!accountRequired || accountPreviewCount <= 1) return undefined;
    const timer = window.setInterval(() => {
      setAccountPreviewIndex((current) => (current + 1) % accountPreviewCount);
    }, ACCOUNT_PREVIEW_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [accountRequired, accountPreviewCount]);

  useEffect(() => {
    if (!accountRequired) setAccountPreviewIndex(0);
  }, [accountRequired]);

  const pushStorageWarning = useCallback((message) => {
    const now = Date.now();
    if (now - storageWarningCooldownRef.current < 2500) return;
    storageWarningCooldownRef.current = now;
    setNoticeToast(
      typeof message === "string" && message.trim()
        ? message.trim()
        : STORAGE_WARNING_MESSAGE
    );
  }, []);

  const pushExternalSyncNotice = useCallback((message) => {
    const now = Date.now();
    if (now - externalSyncCooldownRef.current < 1800) return;
    externalSyncCooldownRef.current = now;
    setNoticeToast(
      typeof message === "string" && message.trim()
        ? message.trim()
        : EXTERNAL_SYNC_NOTICE_MESSAGE
    );
  }, []);

  useEffect(() => {
    accountSyncBusyRef.current = Boolean(accountSyncBusy);
  }, [accountSyncBusy]);

  const enqueueUndoToast = useCallback((message, onUndo) => {
    setUndoQueue((prev) => [
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        message,
        onUndo,
      },
      ...prev,
    ].slice(0, MAX_UNDO_QUEUE));
  }, []);

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
        if (!b.meta.hasDueDate) return false;
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
    if (!currentUndoToast) return;
    const t = setTimeout(() => {
      setUndoQueue((prev) => prev.slice(1));
    }, 5000);
    return () => clearTimeout(t);
  }, [currentUndoToast]);

  useEffect(() => {
    if (!noticeToast) return;
    const t = setTimeout(() => setNoticeToast(null), 2200);
    return () => clearTimeout(t);
  }, [noticeToast]);

  useEffect(() => {
    function onUpdateReady() {
      setUpdateReady(true);
    }
    window.addEventListener("app:update-ready", onUpdateReady);
    return () => window.removeEventListener("app:update-ready", onUpdateReady);
  }, []);

  useEffect(() => {
    if (showSplash) return;
    const firstRunTipKey = "bills_first_run_tip_v1";
    let shouldShowTip = true;

    try {
      shouldShowTip = localStorage.getItem(firstRunTipKey) !== "1";
      if (shouldShowTip) {
        localStorage.setItem(firstRunTipKey, "1");
      }
    } catch {
      shouldShowTip = true;
    }

    if (!shouldShowTip) return;
    const t = setTimeout(() => {
      setNoticeToast("Tip: Use quick filters and tap a bill row for details.");
    }, 650);
    return () => clearTimeout(t);
  }, [showSplash]);

  useEffect(() => {
    function onStorageWarning(event) {
      pushStorageWarning(event?.detail?.message);
    }
    window.addEventListener(STORAGE_WARNING_EVENT, onStorageWarning);
    return () => window.removeEventListener(STORAGE_WARNING_EVENT, onStorageWarning);
  }, [pushStorageWarning]);

  useEffect(() => {
    function onExternalSync(event) {
      pushExternalSyncNotice(event?.detail?.message);
    }
    window.addEventListener(BILLS_EXTERNAL_SYNC_EVENT, onExternalSync);
    return () => window.removeEventListener(BILLS_EXTERNAL_SYNC_EVENT, onExternalSync);
  }, [pushExternalSyncNotice]);

  useEffect(() => {
    try {
      localStorage.setItem("bills_compact_mode", String(compactMode));
    } catch {
      pushStorageWarning();
    }
  }, [compactMode, pushStorageWarning]);

  useEffect(() => {
    try {
      localStorage.setItem("bills_table_density", tableDensity);
    } catch {
      pushStorageWarning();
    }
  }, [tableDensity, pushStorageWarning]);

  useEffect(() => {
    try {
      localStorage.setItem("bills_notify_mode", notificationMode);
    } catch {
      pushStorageWarning();
    }
  }, [notificationMode, pushStorageWarning]);

  useEffect(() => {
    try {
      localStorage.setItem(ACCOUNT_AUTO_SYNC_KEY, String(Boolean(accountAutoSync)));
    } catch {
      pushStorageWarning();
    }
  }, [accountAutoSync, pushStorageWarning]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LAST_ACCOUNT_SYNC_AT_KEY,
        String(lastAccountSyncAt || "").trim()
      );
    } catch {
      pushStorageWarning();
    }
  }, [lastAccountSyncAt, pushStorageWarning]);

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
      if (!b.meta.hasDueDate) return sum;
      const due = b.meta.dueDateObj;
      if (due.getMonth() !== month || due.getFullYear() !== year) return sum;
      return sum + Number((b.meta.remainingAmount ?? b.amount) || 0);
    }, 0);

    const overdueAmount = activeEnriched.reduce((sum, b) => {
      if (!b.meta.overdue) return sum;
      return sum + Number((b.meta.remainingAmount ?? b.amount) || 0);
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
    mode: notificationMode,
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

  useEffect(() => {
    if (accountSessionInitRef.current) return undefined;
    accountSessionInitRef.current = true;
    let cancelled = false;
    let sessionTimeoutId = 0;
    (async () => {
      try {
        const result = await Promise.race([
          getAccountSession(),
          new Promise((_, reject) => {
            sessionTimeoutId = window.setTimeout(() => {
              reject(new Error("Session restore timed out."));
            }, SESSION_RESTORE_TIMEOUT_MS);
          }),
        ]);
        if (cancelled) return;
        if (result?.storageMode) {
          setAccountStorageMode(result.storageMode);
        }
        if (result?.user) {
          setAccountUser(result.user || null);
          markAccountAsKnown();
          setAccountSyncBusy(true);
          try {
            const remote = await pullAccountBackup();
            if (cancelled) return;
            if (remote?.storageMode) {
              setAccountStorageMode(remote.storageMode);
            }
            if (remote?.payload) {
              const validation = validateBackupPayload(remote.payload);
              if (validation.ok) {
                accountSkipNextAutoPushRef.current = true;
                replaceAllBills(validation.data.bills);
                setNotifyEnabled(Boolean(validation.data.notifyEnabled));
                setLastAccountSyncAt(remote?.updatedAt || new Date().toISOString());
              }
            } else {
              const payload = createBackupPayload({ bills, notifyEnabled });
              const pushed = await pushAccountBackup(payload);
              if (pushed?.storageMode) {
                setAccountStorageMode(pushed.storageMode);
              }
              setLastAccountSyncAt(pushed?.updatedAt || new Date().toISOString());
            }
          } catch {
            // keep local-first behavior on sync bootstrap failures
          } finally {
            if (!cancelled) {
              setAccountSyncBusy(false);
            }
          }
        } else {
          setAccountUser(null);
        }
      } catch {
        // Ignore session restore failures and continue offline-first.
      } finally {
        if (sessionTimeoutId) {
          window.clearTimeout(sessionTimeoutId);
        }
        if (!cancelled) {
          setAccountSessionReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bills, notifyEnabled, replaceAllBills, setNotifyEnabled, markAccountAsKnown]);

  useEffect(() => {
    if (!accountUser?.id || !accountAutoSync) {
      accountAutoSyncPrimedRef.current = false;
      if (accountAutoSyncTimerRef.current) {
        clearTimeout(accountAutoSyncTimerRef.current);
        accountAutoSyncTimerRef.current = 0;
      }
      return;
    }

    if (!accountAutoSyncPrimedRef.current) {
      accountAutoSyncPrimedRef.current = true;
      return;
    }

    if (accountSkipNextAutoPushRef.current) {
      accountSkipNextAutoPushRef.current = false;
      return;
    }

    if (accountAutoSyncTimerRef.current) {
      clearTimeout(accountAutoSyncTimerRef.current);
    }
    accountAutoSyncTimerRef.current = setTimeout(() => {
      if (accountSyncBusyRef.current) return;
      setAccountSyncBusy(true);
      const payload = createBackupPayload({ bills, notifyEnabled });
      pushAccountBackup(payload)
        .then((result) => {
          if (result?.storageMode) {
            setAccountStorageMode(result.storageMode);
          }
          setLastAccountSyncAt(result?.updatedAt || new Date().toISOString());
        })
        .catch(() => {
          // Silent mode: keep local-first without noisy toasts.
        })
        .finally(() => {
          setAccountSyncBusy(false);
        });
    }, 1500);

    return () => {
      if (accountAutoSyncTimerRef.current) {
        clearTimeout(accountAutoSyncTimerRef.current);
        accountAutoSyncTimerRef.current = 0;
      }
    };
  }, [bills, notifyEnabled, accountUser?.id, accountAutoSync]);

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

  async function handleNotifyToggle(nextEnabled) {
    if (!nextEnabled) {
      setNotifyEnabled(false);
      return;
    }

    if (!("Notification" in window)) {
      setNotifyEnabled(false);
      setNoticeToast("Notifications are not supported.");
      return;
    }

    try {
      if (Notification.permission === "granted") {
        setNotifyEnabled(true);
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        setNotifyEnabled(true);
      } else {
        setNotifyEnabled(false);
        setNoticeToast("Allow notifications first.");
      }
    } catch {
      setNotifyEnabled(false);
      setNoticeToast("Could not enable notifications.");
    }
  }

  async function handleAccountPush({ silent = false } = {}) {
    if (!accountUser?.id) return { ok: false, skipped: true };
    if (accountSyncBusy) return { ok: false, skipped: true };

    setAccountSyncBusy(true);
    try {
      const payload = createBackupPayload({ bills, notifyEnabled });
      const result = await pushAccountBackup(payload);
      if (result?.storageMode) {
        setAccountStorageMode(result.storageMode);
      }
      const syncedAt = result?.updatedAt || new Date().toISOString();
      setLastAccountSyncAt(syncedAt);
      if (!silent) {
        setNoticeToast("Account sync updated.");
      }
      return { ok: true };
    } catch (error) {
      if (!silent) {
        setNoticeToast(error instanceof Error ? error.message : "Account sync failed.");
      }
      return { ok: false };
    } finally {
      setAccountSyncBusy(false);
    }
  }

  async function handleAccountPull({ silent = false } = {}) {
    if (!accountUser?.id) return { ok: false, skipped: true };
    if (accountSyncBusy) return { ok: false, skipped: true };

    setAccountSyncBusy(true);
    try {
      const result = await pullAccountBackup();
      if (result?.storageMode) {
        setAccountStorageMode(result.storageMode);
      }
      if (!result?.payload) {
        return { ok: true, empty: true };
      }

      const validation = validateBackupPayload(result.payload);
      if (!validation.ok) {
        if (!silent) {
          setNoticeToast(validation.reason || "Cloud account data is invalid.");
        }
        return { ok: false };
      }

      const beforeBills = snapshotBills();
      const beforeNotifyEnabled = notifyEnabled;
      accountSkipNextAutoPushRef.current = true;
      replaceAllBills(validation.data.bills);
      setNotifyEnabled(Boolean(validation.data.notifyEnabled));
      enqueueUndoToast("Account data restored", () => {
        replaceAllBills(beforeBills);
        setNotifyEnabled(beforeNotifyEnabled);
      });

      const syncedAt = result?.updatedAt || new Date().toISOString();
      setLastAccountSyncAt(syncedAt);
      if (!silent) {
        setNoticeToast("Account data synced.");
      }
      return { ok: true };
    } catch (error) {
      if (!silent) {
        setNoticeToast(error instanceof Error ? error.message : "Account pull failed.");
      }
      return { ok: false };
    } finally {
      setAccountSyncBusy(false);
    }
  }

  async function bootstrapAccountAfterSignIn({ silent = false } = {}) {
    setAccountSyncBusy(true);
    try {
      const remote = await pullAccountBackup();
      if (remote?.storageMode) {
        setAccountStorageMode(remote.storageMode);
      }
      if (remote?.payload) {
        const validation = validateBackupPayload(remote.payload);
        if (validation.ok) {
          const beforeBills = snapshotBills();
          const beforeNotifyEnabled = notifyEnabled;
          accountSkipNextAutoPushRef.current = true;
          replaceAllBills(validation.data.bills);
          setNotifyEnabled(Boolean(validation.data.notifyEnabled));
          enqueueUndoToast("Account data restored", () => {
            replaceAllBills(beforeBills);
            setNotifyEnabled(beforeNotifyEnabled);
          });
          setLastAccountSyncAt(remote?.updatedAt || new Date().toISOString());
          return { ok: true, restored: true };
        }
      }

      const payload = createBackupPayload({ bills, notifyEnabled });
      const pushed = await pushAccountBackup(payload);
      if (pushed?.storageMode) {
        setAccountStorageMode(pushed.storageMode);
      }
      setLastAccountSyncAt(pushed?.updatedAt || new Date().toISOString());
      return { ok: true, restored: false };
    } catch (error) {
      if (!silent) {
        setNoticeToast(error instanceof Error ? error.message : "Account sync failed.");
      }
      return { ok: false };
    } finally {
      setAccountSyncBusy(false);
    }
  }

  async function handleAccountLoginSubmit({ email, password }) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    if (!cleanEmail || !cleanPassword) {
      setNoticeToast("Enter email and password.");
      return { ok: false };
    }
    if (accountBusy) return { ok: false };

    setAccountBusy(true);
    try {
      const result = await loginAccount({
        email: cleanEmail,
        password: cleanPassword,
      });

      setAccountUser(result?.user || null);
      markAccountAsKnown();
      if (result?.storageMode) {
        setAccountStorageMode(result.storageMode);
      }
      const recoveryCode =
        typeof result?.recoveryCode === "string" ? result.recoveryCode.trim() : "";
      if (recoveryCode) {
        setAccountRecoveryCode(recoveryCode);
      }

      await bootstrapAccountAfterSignIn({ silent: true });
      setNoticeToast(
        recoveryCode
          ? "Signed in. Save your new recovery code in Account settings."
          : "Signed in."
      );
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign in failed.";
      setNoticeToast(message);

      const lower = String(message || "").toLowerCase();
      if (lower.includes("too many") || lower.includes("rate limit")) {
        return {
          ok: false,
          reason: "rate-limited",
          retryAfterSeconds: parseRetrySecondsFromMessage(message),
        };
      }
      if (lower.includes("invalid email or password")) {
        return { ok: false, reason: "invalid-credentials" };
      }
      return { ok: false };
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleAccountSignupCreate({
    email,
    password,
    challengeToken = "",
    challengeAnswer = "",
  }) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    if (!cleanEmail || !cleanPassword) {
      setNoticeToast("Enter email and password.");
      return { ok: false };
    }
    if (accountBusy) return { ok: false };

    setAccountBusy(true);
    try {
      const result = await createAccount({
        email: cleanEmail,
        password: cleanPassword,
        challengeToken: String(challengeToken || "").trim(),
        challengeAnswer: String(challengeAnswer || "").trim(),
      });

      setAccountUser(result?.user || null);
      markAccountAsKnown();
      if (result?.storageMode) {
        setAccountStorageMode(result.storageMode);
      }
      const recoveryCode =
        typeof result?.recoveryCode === "string" ? result.recoveryCode.trim() : "";
      setAccountRecoveryCode(recoveryCode);
      await bootstrapAccountAfterSignIn({ silent: true });
      setNoticeToast(
        recoveryCode
          ? "Account created. Save your recovery code in Account settings."
          : "Account created."
      );
      return { ok: true };
    } catch (error) {
      const challenge = extractChallengeFromError(error);
      const message = error instanceof Error ? error.message : "Could not create account.";
      setNoticeToast(message);
      if (challenge) {
        return {
          ok: false,
          reason: "challenge-required",
          challenge,
          message,
        };
      }
      return { ok: false };
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleAccountRecoveryReset({
    email,
    recoveryCode,
    password,
    challengeToken = "",
    challengeAnswer = "",
  }) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanRecoveryCode = String(recoveryCode || "").trim();
    const cleanPassword = String(password || "");
    if (!cleanEmail) {
      return { ok: false, message: "Enter your email first." };
    }
    if (!cleanRecoveryCode) {
      return { ok: false, message: "Enter your recovery code." };
    }
    if (!cleanPassword) {
      return { ok: false, message: "Enter your new password." };
    }
    if (accountBusy) return { ok: false, message: "Please wait..." };

    setAccountBusy(true);
    try {
      const result = await completePasswordResetWithRecoveryCode({
        email: cleanEmail,
        recoveryCode: cleanRecoveryCode,
        password: cleanPassword,
        challengeToken: String(challengeToken || "").trim(),
        challengeAnswer: String(challengeAnswer || "").trim(),
      });
      const nextStorageMode = String(result?.storageMode || "").trim();
      if (nextStorageMode) {
        setAccountStorageMode(nextStorageMode);
      }
      setAccountUser(result?.user || null);
      markAccountAsKnown();
      await bootstrapAccountAfterSignIn({ silent: true });
      setNoticeToast("Password reset complete.");

      return {
        ok: true,
        tone: "success",
        message: "Password reset complete. You are now signed in.",
      };
    } catch (error) {
      const challenge = extractChallengeFromError(error);
      if (challenge) {
        return {
          ok: false,
          reason: "challenge-required",
          challenge,
          message: error instanceof Error ? error.message : "Verification is required.",
        };
      }
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "Could not reset password with recovery code.",
      };
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleAccountChangePassword({ currentPassword, newPassword }) {
    const cleanCurrentPassword = String(currentPassword || "");
    const cleanNewPassword = String(newPassword || "");
    if (!cleanCurrentPassword) {
      return { ok: false, message: "Enter your current password." };
    }
    if (!cleanNewPassword) {
      return { ok: false, message: "Enter your new password." };
    }
    if (accountBusy) {
      return { ok: false, message: "Please wait..." };
    }

    setAccountBusy(true);
    try {
      const result = await changeAccountPassword({
        currentPassword: cleanCurrentPassword,
        newPassword: cleanNewPassword,
      });
      const nextStorageMode = String(result?.storageMode || "").trim();
      if (nextStorageMode) {
        setAccountStorageMode(nextStorageMode);
      }
      if (result?.user) {
        setAccountUser(result.user);
      }
      setNoticeToast("Password changed.");
      return { ok: true, message: "Password changed successfully." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not change password.";
      setNoticeToast(message);
      return { ok: false, message };
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleAccountLogout() {
    if (accountBusy) return;
    setAccountBusy(true);
    try {
      const result = await logoutAccount();
      if (result?.storageMode) {
        setAccountStorageMode(result.storageMode);
      }
    } catch {
      // Ignore logout transport errors; clear local session state regardless.
    } finally {
      setAccountBusy(false);
      setAccountUser(null);
      setAccountRecoveryCode("");
      setNoticeToast("Signed out.");
    }
  }

  async function handleAccountExport() {
    if (!accountUser?.id || accountSyncBusy) return { ok: false, skipped: true };
    setAccountSyncBusy(true);
    try {
      const remote = await pullAccountBackup();
      if (remote?.storageMode) {
        setAccountStorageMode(remote.storageMode);
      }
      const payload = remote?.payload || createBackupPayload({ bills, notifyEnabled });
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `bills-account-export-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNoticeToast("Account export downloaded.");
      return { ok: true };
    } catch (error) {
      setNoticeToast(error instanceof Error ? error.message : "Could not export account data.");
      return { ok: false };
    } finally {
      setAccountSyncBusy(false);
    }
  }

  async function handleAccountDelete({ password }) {
    const cleanPassword = String(password || "");
    if (!cleanPassword) {
      return { ok: false, message: "Enter your password to delete this account." };
    }
    if (accountBusy || accountSyncBusy) {
      return { ok: false, message: "Please wait..." };
    }

    setAccountBusy(true);
    try {
      const result = await deleteAccount({ password: cleanPassword });
      if (result?.storageMode) {
        setAccountStorageMode(result.storageMode);
      }
      setAccountUser(null);
      setAccountRecoveryCode("");
      setLastAccountSyncAt("");
      setHasKnownAccount(false);
      setAccountEntryAuthMode("signin");
      setAccountOpen(false);
      try {
        localStorage.removeItem(ACCOUNT_KNOWN_KEY);
        localStorage.removeItem(LAST_ACCOUNT_SYNC_AT_KEY);
      } catch {
        // Ignore storage failures and continue.
      }
      setNoticeToast("Account deleted.");
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not delete this account.";
      setNoticeToast(message);
      return { ok: false, message };
    } finally {
      setAccountBusy(false);
    }
  }

  function snapshotBills() {
    try {
      return JSON.parse(JSON.stringify(bills));
    } catch {
      return bills;
    }
  }

  function createRiskRestorePoint(reason) {
    setRiskRestorePoint({
      reason,
      createdAt: Date.now(),
      bills: snapshotBills(),
      notifyEnabled,
      notificationMode,
      tableDensity,
      compactMode,
    });
  }

  function rollbackRiskRestorePoint() {
    if (!riskRestorePoint) {
      setNoticeToast("No restore point available.");
      return;
    }
    replaceAllBills(Array.isArray(riskRestorePoint.bills) ? riskRestorePoint.bills : []);
    setNotifyEnabled(Boolean(riskRestorePoint.notifyEnabled));
    setNotificationMode(
      riskRestorePoint.notificationMode === "instant" ? "instant" : "digest"
    );
    setTableDensity(
      riskRestorePoint.tableDensity === "compact" ? "compact" : "comfortable"
    );
    setCompactMode(Boolean(riskRestorePoint.compactMode));
    setRiskRestorePoint(null);
    setNoticeToast("Rolled back to last restore point.");
  }

  function handleDeleteWithUndo(id) {
    const before = snapshotBills();
    createRiskRestorePoint("delete-bill");
    deleteBill(id);
    enqueueUndoToast("Bill deleted", () => replaceAllBills(before));
  }

  function handleClearWithUndo() {
    const before = snapshotBills();
    createRiskRestorePoint("clear-all");
    clearAll();
    enqueueUndoToast("All bills cleared", () => replaceAllBills(before));
  }

  const selectedBill = useMemo(
    () => bills.find((b) => b.id === selectedId) || null,
    [bills, selectedId]
  );

  const selectedActionLoading = useMemo(() => {
    if (!selectedBill) {
      return {
        markPaid: false,
        paymentSubmit: false,
        paymentDeletingId: null,
        notesSave: false,
      };
    }

    const billId = selectedBill.id;
    const paymentDeletePrefix = `bill:${billId}:paymentDelete:`;
    const paymentDeleteKey = Object.keys(actionLoadingMap).find((k) =>
      k.startsWith(paymentDeletePrefix)
    );

    return {
      markPaid: Boolean(actionLoadingMap[`bill:${billId}:markPaid`]),
      paymentSubmit: Boolean(actionLoadingMap[`bill:${billId}:paymentSubmit`]),
      paymentDeletingId: paymentDeleteKey
        ? paymentDeleteKey.slice(paymentDeletePrefix.length)
        : null,
      notesSave: Boolean(actionLoadingMap[`bill:${billId}:notesSave`]),
    };
  }, [selectedBill, actionLoadingMap]);

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
    enqueueUndoToast(message, () => replaceAllBills(before));
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

  function setActionLoading(key, value) {
    setActionLoadingMap((prev) => {
      if (value) return { ...prev, [key]: true };
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function runWithActionLoading(key, action, minMs = 420) {
    if (!key || actionLoadingRef.current.has(key)) return;
    actionLoadingRef.current.add(key);
    const started = Date.now();
    setActionLoading(key, true);
    try {
      await Promise.resolve(action());
    } finally {
      const elapsed = Date.now() - started;
      const waitMs = Math.max(0, minMs - elapsed);
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      actionLoadingRef.current.delete(key);
      setActionLoading(key, false);
    }
  }

  async function handleMarkPaidWithUndo(id) {
    await runWithActionLoading(`bill:${id}:markPaid`, () => {
      runWithUndo("Marked as paid", () => {
        markPaidAndAdvance(id);
      });
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

  function createRestorePreviewBundle(nextBills) {
    const replacePlan = buildRestorePlan({
      currentBills: bills,
      incomingBills: nextBills,
      mode: "replace",
      conflictPolicy: "overwrite",
    });
    const mergeOverwritePlan = buildRestorePlan({
      currentBills: bills,
      incomingBills: nextBills,
      mode: "merge",
      conflictPolicy: "overwrite",
    });
    const mergeSkipPlan = buildRestorePlan({
      currentBills: bills,
      incomingBills: nextBills,
      mode: "merge",
      conflictPolicy: "skip",
    });

    const plans = {
      "replace:overwrite": replacePlan.preview,
      "merge:overwrite": mergeOverwritePlan.preview,
      "merge:skip": mergeSkipPlan.preview,
    };

    return {
      defaultMode: "replace",
      defaultConflictPolicy: "overwrite",
      plans,
    };
  }

  function formatRestoreAuditMessage(preview) {
    const added = Number.isFinite(Number(preview?.added)) ? Number(preview.added) : 0;
    const updated = Number.isFinite(Number(preview?.updated)) ? Number(preview.updated) : 0;
    const deleted = Number.isFinite(Number(preview?.deleted)) ? Number(preview.deleted) : 0;
    const conflicts = Number.isFinite(Number(preview?.conflicts))
      ? Number(preview.conflicts)
      : 0;
    const skipped = Number.isFinite(Number(preview?.skipped)) ? Number(preview.skipped) : 0;
    const modeLabel = preview?.mode === "merge" ? "Merge applied" : "Restore applied";
    const conflictLabel =
      conflicts > 0
        ? ` | conflicts:${conflicts}${skipped > 0 ? `, kept:${skipped}` : ""}`
        : "";
    return `${modeLabel} | +${added} / ~${updated} / -${deleted}${conflictLabel}`;
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

    if (Number(file.size || 0) > MAX_RESTORE_FILE_BYTES) {
      return {
        ok: false,
        state: "error",
        title: "File too large",
        message: "This backup file is too large to safely import on this device.",
        hint: "Use a backup under 2 MB, then try again.",
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

      const previewBundle = createRestorePreviewBundle(restoredBills);
      const preview =
        previewBundle.plans[
          `${previewBundle.defaultMode}:${previewBundle.defaultConflictPolicy}`
        ];
      return {
        ok: true,
        state: "preview",
        title: "Restore preview",
        preview,
        data: {
          bills: restoredBills,
          notifyEnabled: Boolean(validation.data.notifyEnabled),
          previewBundle,
          restoreMode: previewBundle.defaultMode,
          conflictPolicy: previewBundle.defaultConflictPolicy,
          preview,
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

      const mode = payload?.restoreMode === "merge" ? "merge" : "replace";
      const conflictPolicy = payload?.conflictPolicy === "skip" ? "skip" : "overwrite";
      const plan = buildRestorePlan({
        currentBills: bills,
        incomingBills: payload.bills,
        mode,
        conflictPolicy,
      });

      const beforeBills = snapshotBills();
      const beforeNotifyEnabled = notifyEnabled;
      createRiskRestorePoint(mode === "merge" ? "restore-merge" : "restore-import");
      replaceAllBills(plan.bills);
      if (mode === "replace") {
        setNotifyEnabled(Boolean(payload.notifyEnabled));
      }
      enqueueUndoToast(formatRestoreAuditMessage(plan.preview), () => {
        replaceAllBills(beforeBills);
        setNotifyEnabled(beforeNotifyEnabled);
      });
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

  function scrollToRef(ref) {
    const node = ref?.current;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className={`app ${compactMode ? "compactMode" : ""} density-${tableDensity}`}>
      <Header
        onOpenSettings={() => {
          if (accountBlocked) {
            if (accountRequired) {
              openAccountDialog(accountEntryMode);
            }
            return;
          }
          setSettingsOpen(true);
        }}
        onOpenAccount={() => {
          if (accountSessionPending) return;
          openAccountDialog(accountRequired ? accountEntryMode : "signin");
        }}
        onOpenCalendar={() => {
          if (accountBlocked) {
            if (accountRequired) {
              openAccountDialog(accountEntryMode);
            }
            return;
          }
          setCalendarOpen(true);
        }}
        accountSignedIn={accountSignedIn}
        onAdd={() => {
          if (accountBlocked) {
            if (accountRequired) {
              openAccountDialog(accountEntryMode);
            }
            return;
          }
          setEditingId(null);
          setEditorOpen(true);
        }}
      />

      {settingsOpen && !accountBlocked ? (
        <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            maxRestoreFileBytes={MAX_RESTORE_FILE_BYTES}
            notifyEnabled={notifyEnabled}
            setNotifyEnabled={handleNotifyToggle}
            notificationMode={notificationMode}
            setNotificationMode={setNotificationMode}
            compactMode={compactMode}
            setCompactMode={setCompactMode}
            tableDensity={tableDensity}
            setTableDensity={setTableDensity}
            lastBackupAt={lastBackupAt}
            hasRiskRestorePoint={Boolean(riskRestorePoint)}
            onRollbackRiskRestore={rollbackRiskRestorePoint}
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
                const backupAt = new Date().toISOString();
                setLastBackupAt(backupAt);
                try {
                  localStorage.setItem(LAST_BACKUP_AT_KEY, backupAt);
                } catch {
                  pushStorageWarning();
                }
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
        </Suspense>
      ) : null}

      {accountOpen ? (
        <Suspense fallback={null}>
          <AccountDialog
            onClose={() => {
              setAccountOpen(false);
              setAccountEntryAuthMode("signin");
              if (mobileTab === "account") {
                setMobileTab("bills");
              }
            }}
            accountUser={accountUser}
            accountBusy={accountBusy}
            accountSyncBusy={accountSyncBusy}
            accountPullBusy={Boolean(actionLoadingMap["account:pull"])}
            accountPushBusy={Boolean(actionLoadingMap["account:push"])}
            accountStorageMode={accountStorageMode}
            accountAutoSync={accountAutoSync}
            setAccountAutoSync={setAccountAutoSync}
            lastAccountSyncAt={lastAccountSyncAt}
            accountRecoveryCode={accountRecoveryCode}
            onClearAccountRecoveryCode={() => setAccountRecoveryCode("")}
            onAuthModeChanged={() => setNoticeToast(null)}
            initialAuthMode={accountEntryAuthMode}
            onAccountLogin={(email, password) =>
              handleAccountLoginSubmit({ email, password })
            }
            onAccountSignupCreate={handleAccountSignupCreate}
            onAccountRecoveryReset={handleAccountRecoveryReset}
            onAccountChangePassword={handleAccountChangePassword}
            onAccountLogout={handleAccountLogout}
            onAccountExport={handleAccountExport}
            onAccountDelete={handleAccountDelete}
            onAccountPull={async () => {
              await runWithActionLoading("account:pull", () =>
                handleAccountPull({ silent: false })
              );
            }}
            onAccountPush={async () => {
              await runWithActionLoading("account:push", () =>
                handleAccountPush({ silent: false })
              );
            }}
          />
        </Suspense>
      ) : null}

      {calendarOpen && !accountBlocked ? (
        <Suspense fallback={null}>
          <CalendarDialog
            open={calendarOpen}
            onClose={() => {
              setCalendarOpen(false);
              if (mobileTab === "calendar") {
                setMobileTab("bills");
              }
            }}
            bills={activeEnriched}
            onOpenBill={(id) => {
              setCalendarOpen(false);
              if (mobileTab === "calendar") {
                setMobileTab("bills");
              }
              setSelectedId(id);
              setDetailsOpen(true);
            }}
          />
        </Suspense>
      ) : null}

      <div className="container">
        {accountSessionPending ? (
          <div className="accountLockedShowcase">
            <section
              className="accountOnboardingNudge"
              aria-label="Restoring account session"
              data-testid="account-session-restore-card"
            >
              <div className="accountOnboardingCopy">
                <p className="accountOnboardingTitle">Restoring session</p>
                <p className="accountOnboardingText">
                  Checking your saved account so this device stays signed in.
                </p>
              </div>
            </section>
          </div>
        ) : accountRequired ? (
          <div className="accountLockedShowcase">
            <section
              className="accountOnboardingNudge"
              aria-label="Account required prompt"
              data-testid="account-locked-card"
            >
              <div className="accountOnboardingCopy">
                <p className="accountOnboardingTitle">Account required</p>
                <p className="accountOnboardingText">
                  Sign in to sync your bills across phone and web.
                </p>
              </div>
              <div className="accountOnboardingActions">
                <button
                  type="button"
                  className="btn headerBtn accountNudgePrimary"
                  data-testid="account-locked-create-button"
                  onClick={() => openAccountDialog("signup")}
                >
                  Create free account
                </button>
                <button
                  type="button"
                  className="btn headerBtn accountNudgeSecondary"
                  data-testid="account-locked-signin-button"
                  onClick={() => openAccountDialog("signin")}
                >
                  Sign in
                </button>
              </div>
            </section>

            <section className="accountPreviewCarousel" aria-label="Pocket Ledger features preview">
              <div className="accountPreviewHeader">
                <p className="accountPreviewKicker">Preview</p>
                <p className="accountPreviewHeadline">What you unlock after sign in</p>
              </div>

              <div className="accountPreviewViewport">
                <div
                  className="accountPreviewTrack"
                  style={{ transform: `translateX(-${accountPreviewIndex * 100}%)` }}
                >
                  {ACCOUNT_FEATURE_PREVIEWS.map((slide) => (
                    <article key={slide.id} className="accountPreviewSlide">
                      <div className={`accountPreviewMock is-${slide.id}`} aria-hidden="true">
                        <div className="accountPreviewMockTop">
                          <span className="accountPreviewMockBadge">{slide.badge}</span>
                          <span className="accountPreviewMockStat">
                            <strong>{slide.statValue}</strong>
                            <span>{slide.statLabel}</span>
                          </span>
                        </div>
                        <div className="accountPreviewMockRows">
                          {slide.rows.map((row) => (
                            <div key={`${slide.id}-${row.label}`} className="accountPreviewMockRow">
                              <span className="accountPreviewMockRowLabel">{row.label}</span>
                              <span className={`accountPreviewMockRowStatus is-${row.tone}`}>
                                {row.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="accountPreviewMeta">
                        <div className="accountPreviewMetaStat" aria-hidden="true">
                          <strong className="accountPreviewMetaStatValue">{slide.statValue}</strong>
                          <span className="accountPreviewMetaStatLabel">{slide.statLabel}</span>
                        </div>
                        <p className="accountPreviewTitle">{slide.title}</p>
                        <p className="accountPreviewText">{slide.text}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="accountPreviewControls">
                <button
                  type="button"
                  className="btn small accountPreviewControlBtn"
                  aria-label="Previous preview"
                  onClick={showPrevAccountPreview}
                >
                  <span className="accountPreviewControlIcon" aria-hidden="true">
                    {"<"}
                  </span>
                  <span className="accountPreviewControlLabel">Prev</span>
                </button>
                <div className="accountPreviewDots" role="tablist" aria-label="Feature preview slides">
                  {ACCOUNT_FEATURE_PREVIEWS.map((slide, index) => (
                    <button
                      key={slide.id}
                      type="button"
                      className={`accountPreviewDot ${index === accountPreviewIndex ? "is-active" : ""}`}
                      aria-label={`Show ${slide.badge}`}
                      aria-pressed={index === accountPreviewIndex}
                      onClick={() => setAccountPreviewIndex(index)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="btn small accountPreviewControlBtn"
                  aria-label="Next preview"
                  onClick={showNextAccountPreview}
                >
                  <span className="accountPreviewControlIcon" aria-hidden="true">
                    {">"}
                  </span>
                  <span className="accountPreviewControlLabel">Next</span>
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {!accountBlocked ? (
          <>
            <div ref={dueSoonRef}>
              <DueSoonBanner
                dueSoonBills={dueSoonList}
                onOpen={(id) => {
                  setSelectedId(id);
                  setDetailsOpen(true);
                }}
              />
            </div>

            <div ref={billsRef} className="card billsCard" data-testid="bills-tracker-card">
          <div className="cardHeader billsHeader">
            <div className="billsIntro">
              <div className="billsTitleRow">
                <h2 data-testid="bills-tracker-title">Bills Tracker</h2>
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
                data-testid="add-bill-button"
                onClick={() => {
                  setEditingId(null);
                  setEditorOpen(true);
                }}
              >
                + Add bill
              </button>
            </div>
          </div>

          <div ref={statsRef} className="billsMiniStats" aria-label="Bills totals">
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
              isMarkPaidLoading={(id) =>
                Boolean(actionLoadingMap[`bill:${id}:markPaid`])
              }
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
          </>
        ) : null}
      </div>

      {!hasBlockingModal && !accountBlocked ? (
        <MobileBottomNav
          active={mobileTab}
          accountSignedIn={accountSignedIn}
          onSelect={(tab) => {
            setMobileTab(tab);
            if (tab === "bills") scrollToRef(billsRef);
            if (tab === "due") scrollToRef(dueSoonRef);
            if (tab === "calendar") setCalendarOpen(true);
            if (tab === "stats") scrollToRef(statsRef);
            if (tab === "account") openAccountDialog("signin");
          }}
        />
      ) : null}

      {editorOpen && !accountBlocked ? (
        <Suspense fallback={null}>
          <BillEditorDialog
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
        </Suspense>
      ) : null}

      {detailsOpen && !accountBlocked ? (
        <Suspense fallback={null}>
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
              return handleMarkPaidWithUndo(selectedBill.id);
            }}
            markPaidLoading={selectedActionLoading.markPaid}
            onAddPayment={async (payment) => {
              if (!selectedBill) return;
              await runWithActionLoading(`bill:${selectedBill.id}:paymentSubmit`, () => {
                runWithUndo("Payment added", () => {
                  addPaymentAndAdvance(selectedBill.id, payment);
                });
              });
            }}
            paymentSubmitLoading={selectedActionLoading.paymentSubmit}
            onUpdatePayment={async (paymentId, patch) => {
              if (!selectedBill) return;
              await runWithActionLoading(`bill:${selectedBill.id}:paymentSubmit`, () => {
                runWithUndo("Payment updated", () => {
                  updatePayment(selectedBill.id, paymentId, patch);
                });
              });
            }}
            paymentDeletingId={selectedActionLoading.paymentDeletingId}
            onDeletePayment={async (paymentId) => {
              if (!selectedBill) return;
              await runWithActionLoading(
                `bill:${selectedBill.id}:paymentDelete:${paymentId}`,
                () => {
                  createRiskRestorePoint("delete-payment");
                  runWithUndo("Payment deleted", () => {
                    deletePayment(selectedBill.id, paymentId);
                  });
                },
                340
              );
            }}
            onUpdateNotes={async (notes) => {
              if (!selectedBill) return;
              await runWithActionLoading(`bill:${selectedBill.id}:notesSave`, () => {
                runWithUndo("Notes updated", () => {
                  updateNotes(selectedBill.id, notes);
                });
              });
            }}
            notesSaveLoading={selectedActionLoading.notesSave}
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
        </Suspense>
      ) : null}

      {clearConfirmOpen && !accountBlocked ? (
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

      {currentUndoToast || noticeToast || updateReady ? (
        <div className="toastDock">
          {updateReady ? (
            <div className="appToast updateToast" role="status" aria-live="polite">
              <span className="noticeToastIcon updateToastIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M20 12a8 8 0 1 1-2.3-5.6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M20 4v5h-5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span>New version available</span>
              <button
                type="button"
                className="toastInlineAction"
                onClick={() => window.location.reload()}
              >
                Refresh
              </button>
            </div>
          ) : null}

          {!currentUndoToast && noticeToast ? (
            <div
              className={`appToast noticeToast ${noticeToastIsError ? "is-error" : ""}`}
              role="status"
              aria-live="polite"
            >
              <span
                className={`noticeToastIcon ${noticeToastIsError ? "is-error" : ""}`}
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" fill="none">
                  {noticeToastIsError ? (
                    <path
                      d="M8 8l8 8M16 8l-8 8"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : (
                    <path
                      d="m6.8 12.4 3.2 3.2 7.2-7.2"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </svg>
              </span>
              <span>{noticeToast}</span>
            </div>
          ) : null}

          {currentUndoToast ? (
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
              <span>{currentUndoToast.message}</span>
              {queuedUndoCount > 0 ? (
                <span className="muted small">{`+${queuedUndoCount} more`}</span>
              ) : null}
              <button
                type="button"
                className="toastInlineAction"
                onClick={() => {
                  currentUndoToast.onUndo?.();
                  setUndoQueue((prev) => prev.slice(1));
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


