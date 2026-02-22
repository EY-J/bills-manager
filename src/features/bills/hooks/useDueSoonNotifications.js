import { useEffect } from "react";
import { startOfToday, toISODate } from "../../../lib/date/date.js";

export function useDueSoonNotifications({ enabled, dueSoonBills }) {
  useEffect(() => {
    if (!enabled) return;
    if (!dueSoonBills || dueSoonBills.length === 0) return;

    const key = `bills_notified_${toISODate(startOfToday())}`;
    if (localStorage.getItem(key) === "true") return;

    const run = async () => {
      try {
        if (!("Notification" in window)) return;

        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
        if (Notification.permission !== "granted") return;

        const top = dueSoonBills.slice(0, 3);
        const body = top
          .map(
            (b) =>
              `${b.name} | due in ${b.meta.daysToDue} day${
                b.meta.daysToDue === 1 ? "" : "s"
              }`
          )
          .join("\n");

        new Notification("Bills due soon", {
          body:
            body + (dueSoonBills.length > 3 ? `\n+${dueSoonBills.length - 3} more` : ""),
        });

        localStorage.setItem(key, "true");
      } catch {
        // ignore
      }
    };

    run();
  }, [enabled, dueSoonBills]);
}

