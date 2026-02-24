import { useEffect } from "react";
import { startOfToday, toISODate } from "../../../lib/date/date.js";

function dueLabel(daysToDue) {
  if (daysToDue <= 0) return "today";
  return `in ${daysToDue} day${daysToDue === 1 ? "" : "s"}`;
}

const INSTANT_PREFIX = "bills_notified_instant_";
const DIGEST_PREFIX = "bills_notified_digest_";
const DIGEST_RETENTION_DAYS = 45;
const INSTANT_RETENTION_DAYS = 45;

function collectNotificationKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith(INSTANT_PREFIX) || key.startsWith(DIGEST_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

function pruneNotificationKeys(today) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const digestCutoff = new Date(today);
  digestCutoff.setDate(digestCutoff.getDate() - DIGEST_RETENTION_DAYS);
  digestCutoff.setHours(0, 0, 0, 0);

  const instantCutoff = new Date(today);
  instantCutoff.setDate(instantCutoff.getDate() - INSTANT_RETENTION_DAYS);
  instantCutoff.setHours(0, 0, 0, 0);

  const keys = collectNotificationKeys();
  keys.forEach((key) => {
    if (key.startsWith(DIGEST_PREFIX)) {
      const iso = key.slice(DIGEST_PREFIX.length);
      const dt = new Date(iso);
      const valid = Number.isFinite(dt.getTime());
      if (!valid || dt < digestCutoff) {
        localStorage.removeItem(key);
      }
      return;
    }

    if (key.startsWith(INSTANT_PREFIX)) {
      // Pattern: bills_notified_instant_<billId>_<YYYY-MM-DD>
      const match = key.match(/_(\d{4}-\d{2}-\d{2})$/);
      if (!match) {
        localStorage.removeItem(key);
        return;
      }
      const due = new Date(match[1]);
      if (!Number.isFinite(due.getTime())) {
        localStorage.removeItem(key);
        return;
      }
      const ageMs = today.getTime() - due.getTime();
      if (ageMs > INSTANT_RETENTION_DAYS * msPerDay) {
        localStorage.removeItem(key);
      }
    }
  });
}

export function useDueSoonNotifications({ enabled, dueSoonBills, mode = "digest" }) {
  useEffect(() => {
    if (!enabled) return;
    if (!dueSoonBills || dueSoonBills.length === 0) return;

    const run = async () => {
      try {
        if (!("Notification" in window)) return;
        const today = startOfToday();
        pruneNotificationKeys(today);

        if (Notification.permission !== "granted") return;

        if (mode === "instant") {
          dueSoonBills.slice(0, 12).forEach((bill) => {
            const key = `${INSTANT_PREFIX}${bill.id}_${bill.dueDate}`;
            if (localStorage.getItem(key) === "true") return;
            new Notification(`Due ${dueLabel(bill.meta.daysToDue)}`, {
              body: `${bill.name} | ${bill.category || "Other"} | ${bill.meta.daysToDue}d`,
            });
            localStorage.setItem(key, "true");
          });
          return;
        }

        const key = `${DIGEST_PREFIX}${toISODate(today)}`;
        if (localStorage.getItem(key) === "true") return;

        const top = dueSoonBills.slice(0, 3);
        const body = top
          .map((b) => `${b.name} | due ${dueLabel(b.meta.daysToDue)}`)
          .join("\n");

        new Notification("Bills due soon", {
          body: body + (dueSoonBills.length > 3 ? `\n+${dueSoonBills.length - 3} more` : ""),
        });

        localStorage.setItem(key, "true");
      } catch {
        // ignore
      }
    };

    run();
  }, [enabled, dueSoonBills, mode]);
}
