import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { addMonthsKeepDay, parseISODate, toISODate } from "../src/lib/date/date.js";

test("toISODate keeps YYYY-MM-DD stable", () => {
  assert.equal(toISODate("2026-02-16"), "2026-02-16");
});

test("addMonthsKeepDay clamps end-of-month correctly", () => {
  assert.equal(addMonthsKeepDay("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsKeepDay("2028-01-31", 1), "2028-02-29");
});

test("parseISODate round-trips with toISODate", () => {
  const parsed = parseISODate("2026-03-05");
  assert.equal(toISODate(parsed), "2026-03-05");
});

test("formatShortDate treats date-only strings as local dates in US timezones", () => {
  const script = [
    "import { formatShortDate, parseISODate } from './src/lib/date/date.js';",
    "const a = formatShortDate('2026-02-16');",
    "const b = formatShortDate(parseISODate('2026-02-16'));",
    "console.log(a === b ? 'OK' : `BAD:${a}|${b}`);",
  ].join(" ");

  const out = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: process.cwd(),
      env: { ...process.env, TZ: "America/Los_Angeles" },
      encoding: "utf8",
    }
  ).trim();

  assert.equal(out, "OK");
});
