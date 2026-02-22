import { storage } from "../../lib/storage/storage.js";

const KEY = "bills_manager_v1";
const STORAGE_SCHEMA_VERSION = 2;
const BACKUP_SCHEMA_VERSION = 2;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function toISODateToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isValidISODate(value) {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const dt = new Date(year, month - 1, day);
  return (
    dt.getFullYear() === year &&
    dt.getMonth() === month - 1 &&
    dt.getDate() === day
  );
}

function sanitizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function sanitizeWholeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function sanitizeReminderSnooze(value) {
  if (!value || typeof value !== "object") return null;
  if (value.type === "days" && isValidISODate(value.until)) {
    return { type: "days", until: value.until };
  }
  if (value.type === "cycle" && isValidISODate(value.dueDate)) {
    return { type: "cycle", dueDate: value.dueDate };
  }
  return null;
}

function sortPaymentsDesc(payments) {
  return [...payments].sort((a, b) => {
    const at = Date.parse(a?.date || "");
    const bt = Date.parse(b?.date || "");
    const an = Number.isNaN(at) ? 0 : at;
    const bn = Number.isNaN(bt) ? 0 : bt;
    return bn - an;
  });
}

function sanitizePaymentShape(payment, fallbackDate) {
  const safeDate = isValidISODate(payment?.date) ? payment.date : fallbackDate;
  const out = {
    id: isNonEmptyString(payment?.id) ? String(payment.id) : crypto.randomUUID(),
    date: safeDate,
    amount: sanitizeAmount(payment?.amount),
    note: typeof payment?.note === "string" ? payment.note : "",
  };

  if (payment?.autoSeedPaidMonths === true) {
    out.autoSeedPaidMonths = true;
  }

  return out;
}

function sanitizeBillShape(bill, fallbackDate) {
  const dueDate = isValidISODate(bill?.dueDate) ? bill.dueDate : fallbackDate;
  const paymentsRaw = Array.isArray(bill?.payments) ? bill.payments : [];
  const payments = sortPaymentsDesc(
    paymentsRaw.map((p) => sanitizePaymentShape(p, dueDate))
  );

  const totalMonths = sanitizeWholeNumber(bill?.totalMonths);
  let paidMonths = sanitizeWholeNumber(bill?.paidMonths);
  if (totalMonths > 0) paidMonths = Math.min(paidMonths, totalMonths);
  if (totalMonths === 0) paidMonths = 0;

  return {
    id: isNonEmptyString(bill?.id) ? String(bill.id) : crypto.randomUUID(),
    name: isNonEmptyString(bill?.name) ? bill.name.trim() : "Untitled bill",
    category: isNonEmptyString(bill?.category) ? bill.category.trim() : "Other",
    dueDate,
    amount: sanitizeAmount(bill?.amount),
    notes: typeof bill?.notes === "string" ? bill.notes : "",
    payments,
    cadence: typeof bill?.cadence === "string" ? bill.cadence : "monthly",
    reminderDays: Number.isFinite(Number(bill?.reminderDays))
      ? Number(bill.reminderDays)
      : 3,
    reminderSnooze: sanitizeReminderSnooze(bill?.reminderSnooze),
    totalMonths,
    paidMonths,
  };
}

function sanitizeBillsShape(rawBills) {
  if (!Array.isArray(rawBills)) return [];
  const todayIso = toISODateToday();
  return rawBills.map((bill) => sanitizeBillShape(bill, todayIso));
}

function toStorageEnvelope(bills) {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    data: {
      bills: Array.isArray(bills) ? bills : [],
    },
  };
}

function parseStoredBills(raw) {
  // Legacy v0/v1: plain array.
  if (Array.isArray(raw)) {
    return { bills: raw, needsWriteBack: true, supported: true };
  }

  if (!raw || typeof raw !== "object") {
    return { bills: [], needsWriteBack: true, supported: true };
  }

  // Legacy object: { bills: [...] } without schema marker.
  if (!Object.prototype.hasOwnProperty.call(raw, "schemaVersion")) {
    const legacyBills = Array.isArray(raw.bills) ? raw.bills : [];
    return { bills: legacyBills, needsWriteBack: true, supported: true };
  }

  const schemaVersion = Number(raw.schemaVersion);
  if (!Number.isFinite(schemaVersion)) {
    return { bills: [], needsWriteBack: true, supported: true };
  }

  if (schemaVersion > STORAGE_SCHEMA_VERSION) {
    // Migration guard: do not mutate unknown future schema.
    return { bills: [], needsWriteBack: false, supported: false };
  }

  if (schemaVersion < STORAGE_SCHEMA_VERSION) {
    const legacyBills = Array.isArray(raw?.data?.bills)
      ? raw.data.bills
      : Array.isArray(raw?.bills)
        ? raw.bills
        : [];
    return { bills: legacyBills, needsWriteBack: true, supported: true };
  }

  const currentBills = Array.isArray(raw?.data?.bills) ? raw.data.bills : [];
  return { bills: currentBills, needsWriteBack: false, supported: true };
}

export function loadBills() {
  const raw = storage.get(KEY);
  const parsed = parseStoredBills(raw);

  if (!parsed.supported) {
    console.warn(
      "[bills] Unsupported stored schema version. Data was not modified."
    );
    return [];
  }

  const repairedBills = sanitizeBillsShape(parsed.bills);

  const parsedString = JSON.stringify(parsed.bills || []);
  const repairedString = JSON.stringify(repairedBills);
  const changedByHealthCheck = parsedString !== repairedString;

  if (parsed.needsWriteBack || changedByHealthCheck) {
    storage.set(KEY, toStorageEnvelope(repairedBills));
  }

  return repairedBills;
}

export function saveBills(bills) {
  const repairedBills = sanitizeBillsShape(bills);
  storage.set(KEY, toStorageEnvelope(repairedBills));
}

export function clearBills() {
  storage.remove(KEY);
}

function checksumFromString(value) {
  // FNV-1a 32-bit hash for lightweight integrity checks.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function baseBackupPayload({ bills, notifyEnabled }) {
  const repairedBills = sanitizeBillsShape(bills);
  return {
    app: "bills-manager",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      bills: repairedBills,
      notifyEnabled: Boolean(notifyEnabled),
    },
  };
}

export function createBackupPayload({ bills, notifyEnabled }) {
  const base = baseBackupPayload({ bills, notifyEnabled });
  const checksum = checksumFromString(JSON.stringify(base));
  return { ...base, checksum };
}

export function validateBackupPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "Invalid backup format." };
  }

  if (payload.app !== "bills-manager") {
    return { ok: false, reason: "This backup is not from Bills Manager." };
  }

  const version = Number(payload.schemaVersion);
  if (!Number.isFinite(version)) {
    return { ok: false, reason: "Unsupported backup version." };
  }

  if (version > BACKUP_SCHEMA_VERSION) {
    return { ok: false, reason: "Unsupported backup version." };
  }

  if (!payload.data || typeof payload.data !== "object") {
    return { ok: false, reason: "Backup data is missing." };
  }

  if (!Array.isArray(payload.data.bills)) {
    return { ok: false, reason: "Backup bills data is invalid." };
  }

  const { checksum } = payload;
  if (typeof checksum !== "string" || checksum.length === 0) {
    return { ok: false, reason: "Backup checksum is missing." };
  }

  const { checksum: _, ...withoutChecksum } = payload;
  const expected = checksumFromString(JSON.stringify(withoutChecksum));
  if (expected !== checksum) {
    return { ok: false, reason: "Backup checksum mismatch." };
  }

  return {
    ok: true,
    data: {
      bills: sanitizeBillsShape(payload.data.bills),
      notifyEnabled: Boolean(payload.data.notifyEnabled),
    },
  };
}
