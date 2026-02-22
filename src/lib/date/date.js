export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function toISODate(d) {
  const dt = typeof d === "string" ? new Date(d) : d;
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function addMonthsKeepDay(isoDate, monthsToAdd = 1) {
  const d = parseISODate(isoDate);
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();

  const absMonth = m + monthsToAdd;
  const targetYear = y + Math.floor(absMonth / 12);
  const targetMonthIndex = ((absMonth % 12) + 12) % 12;

  const maxDay = lastDayOfMonth(targetYear, targetMonthIndex);
  const clampedDay = Math.min(day, maxDay);

  const out = new Date(targetYear, targetMonthIndex, clampedDay);
  out.setHours(0, 0, 0, 0);
  return toISODate(out);
}

export function formatMoney(n) {
  const num = Number(n || 0);
  return num.toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  });
}

export function formatShortDate(isoOrDate) {
  const dt = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}
