import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const WIDTH = 1200;
const HEIGHT = 630;
const EXPORT_SCALE = 2;
const OUTPUT_DIR = path.resolve("social-assets", "facebook-features");

const COVER_CARD = {
  title: "Pocket Ledger",
  subtitle: "Quick intro before the tour: this app helps make bill tracking less stressful.",
  intro:
    "Swipe through the next cards to see each feature in plain, casual language.",
  accentA: "#1468ff",
  accentB: "#0ccca6",
  metric: "12 Features",
};

const FEATURE_CARDS = [
  {
    slug: "01-recurring-bills",
    title: "Bills on repeat? You are covered.",
    subtitle: "Track monthly, bi-weekly, and weekly bills without overthinking it.",
    bullets: [
      "Add recurring and one-time bills fast",
      "Keep your list clean and always current",
      "Works smoothly on phone and desktop",
    ],
    postCopy:
      "Bills keep repeating every month? Pocket Ledger keeps them organized so you do not miss due dates.",
    accentA: "#1468ff",
    accentB: "#0ccca6",
    metric: "3 Repeat Modes",
  },
  {
    slug: "02-payments-and-history",
    title: "Log every payment, even partial ones.",
    subtitle: "Paid half today and the rest later? That is easy to track here.",
    bullets: [
      "Record payment amount with notes",
      "Edit or delete payment entries anytime",
      "See payment history per bill instantly",
    ],
    postCopy:
      "Full payment or partial payment, both are tracked. You always know what was already paid.",
    accentA: "#ff8f1f",
    accentB: "#ff4d6d",
    metric: "Payment Logs",
  },
  {
    slug: "03-mark-paid-advance",
    title: "Tap paid and move on.",
    subtitle: "One click marks the bill paid and pushes the due date forward.",
    bullets: [
      "Fast workflow for daily bill updates",
      "Automatically follows the bill cadence",
      "Great when you are clearing many bills",
    ],
    postCopy:
      "One tap for Mark Paid and the next due date updates automatically. Super quick for busy days.",
    accentA: "#16a34a",
    accentB: "#22d3ee",
    metric: "1 Tap",
  },
  {
    slug: "04-status-and-alerts",
    title: "See what needs attention fast.",
    subtitle: "Status tags make it obvious what is paid, due soon, or overdue.",
    bullets: [
      "Clear paid, due soon, and overdue states",
      "Prioritize urgent bills in seconds",
      "Less guesswork, less stress",
    ],
    postCopy:
      "No more guessing. Status labels quickly show what to pay now and what can wait.",
    accentA: "#f97316",
    accentB: "#ef4444",
    metric: "Smart Status",
  },
  {
    slug: "05-search-and-filters",
    title: "Find bills in seconds.",
    subtitle: "Use search and quick filters so you can focus on the right list.",
    bullets: [
      "Filter by due soon, overdue, this month, archived",
      "Search by name, category, amount, or notes",
      "Stay focused on what matters today",
    ],
    postCopy:
      "Need one bill fast? Use search and quick filters to jump right to it.",
    accentA: "#7c3aed",
    accentB: "#06b6d4",
    metric: "Quick Filters",
  },
  {
    slug: "06-calendar-view",
    title: "Monthly view, zero guesswork.",
    subtitle: "Open calendar mode and spot busy due-date weeks at a glance.",
    bullets: [
      "Calendar view for planning ahead",
      "See due-date clusters quickly",
      "Helpful for monthly budgeting",
    ],
    postCopy:
      "Calendar view helps you see heavy due-date weeks early, so you can plan your budget better.",
    accentA: "#1d4ed8",
    accentB: "#0ea5e9",
    metric: "Calendar View",
  },
  {
    slug: "07-dashboard-totals",
    title: "Quick money snapshot.",
    subtitle: "Check due this month, overdue amount, and total paid right away.",
    bullets: [
      "Main-screen totals for fast checking",
      "Great for monthly cash planning",
      "Know where your money is going",
    ],
    postCopy:
      "At a glance, you can see how much is due, overdue, and already paid this month.",
    accentA: "#0f766e",
    accentB: "#14b8a6",
    metric: "3 Key Stats",
  },
  {
    slug: "08-undo-protection",
    title: "Made a mistake? Undo it.",
    subtitle: "Accidental delete or edit can be reversed in one tap.",
    bullets: [
      "Undo queue for recent actions",
      "Safer editing and cleanup flow",
      "Less fear of accidental changes",
    ],
    postCopy:
      "Accidentally changed something? Undo is built in, so your data is safer.",
    accentA: "#b45309",
    accentB: "#f59e0b",
    metric: "Undo Ready",
  },
  {
    slug: "09-backup-restore",
    title: "Backup your data anytime.",
    subtitle: "Export JSON backups and restore with built-in validation checks.",
    bullets: [
      "Portable JSON backup file",
      "Restore flow with integrity checks",
      "Great for migration and recovery",
    ],
    postCopy:
      "You can back up your bills anytime and restore safely when needed.",
    accentA: "#2563eb",
    accentB: "#22d3ee",
    metric: "Backup Safe",
  },
  {
    slug: "10-account-sync",
    title: "Same data on phone and web.",
    subtitle: "Sign in once and keep your records synced across devices.",
    bullets: [
      "Optional account login",
      "Cross-device sync support",
      "Use your data anywhere",
    ],
    postCopy:
      "Use Pocket Ledger on phone and web with the same records synced across devices.",
    accentA: "#4f46e5",
    accentB: "#8b5cf6",
    metric: "Multi Device",
  },
  {
    slug: "11-account-recovery",
    title: "Account recovery without panic.",
    subtitle: "Recovery code and password tools are there when you need them.",
    bullets: [
      "One-time recovery code flow",
      "Password change with verification",
      "Practical account safety controls",
    ],
    postCopy:
      "Forgot credentials? Recovery code and password tools help you get back in quickly.",
    accentA: "#0f766e",
    accentB: "#2dd4bf",
    metric: "Secure Access",
  },
  {
    slug: "12-settings-and-pwa",
    title: "Set it up your way.",
    subtitle: "Customize notifications, compact mode, and install it like an app.",
    bullets: [
      "Notification mode and layout controls",
      "Compact and comfortable table density",
      "Installable PWA on supported mobile browsers",
    ],
    postCopy:
      "Pick your preferred layout and reminders, then install it like an app on your phone.",
    accentA: "#1f2937",
    accentB: "#6366f1",
    metric: "Mobile Ready",
  },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderCardHtml(card, index, total, isCover = false) {
  const theme = isCover ? COVER_CARD : card;
  const title = isCover ? COVER_CARD.title : card.title;
  const subtitle = isCover ? COVER_CARD.subtitle : card.subtitle;
  const progressText = isCover ? "Intro" : `Card ${index} of ${total}`;
  const metric = isCover ? COVER_CARD.metric : card.metric;

  const contentHtml = isCover
    ? `<p class="introNote">${escapeHtml(COVER_CARD.intro)}</p>`
    : `<section class="bullets">
        ${card.bullets
          .map(
            (item) =>
              `<div class="bullet"><span class="tick">+</span><span>${escapeHtml(item)}</span></div>`
          )
          .join("")}
      </section>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --a: ${theme.accentA};
      --b: ${theme.accentB};
      --ink: #e8f0ff;
      --panel: rgba(8, 14, 28, 0.74);
      --panel-soft: rgba(7, 12, 24, 0.42);
      --line: rgba(172, 205, 255, 0.35);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      font-family: "Trebuchet MS", "Lucida Sans Unicode", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(680px 430px at 84% 8%, color-mix(in srgb, var(--a) 68%, transparent), transparent 70%),
        radial-gradient(560px 400px at 8% 92%, color-mix(in srgb, var(--b) 68%, transparent), transparent 72%),
        linear-gradient(130deg, #071126 0%, #0d1b3b 40%, #060b19 100%);
      overflow: hidden;
    }
    .frame {
      position: relative;
      width: 100%;
      height: 100%;
      padding: 42px 48px;
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 28px;
      isolation: isolate;
    }
    .grain {
      position: absolute;
      inset: 0;
      opacity: 0.12;
      pointer-events: none;
      background-image:
        radial-gradient(circle at 18% 24%, rgba(255,255,255,0.22) 1px, transparent 1px),
        radial-gradient(circle at 78% 64%, rgba(255,255,255,0.18) 1px, transparent 1px);
      background-size: 18px 18px, 21px 21px;
      z-index: -1;
    }
    .left {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .topline {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 16px;
      letter-spacing: 0.4px;
    }
    .brand-dot {
      width: 14px;
      height: 14px;
      border-radius: 999px;
      background: linear-gradient(135deg, var(--a), var(--b));
      box-shadow: 0 0 22px color-mix(in srgb, var(--a) 74%, transparent);
    }
    .progress {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.9px;
      text-transform: uppercase;
      padding: 7px 12px;
      border-radius: 999px;
      color: #d5e5ff;
      border: 1px solid var(--line);
      background: color-mix(in srgb, var(--panel-soft) 86%, transparent);
    }
    h1 {
      margin: 0;
      font-size: 58px;
      line-height: 0.96;
      letter-spacing: -1.2px;
      max-width: 660px;
      text-wrap: balance;
    }
    .subtitle {
      margin: 0;
      font-size: 24px;
      line-height: 1.3;
      color: #c7dafd;
      max-width: 640px;
      text-wrap: pretty;
    }
    .introNote {
      margin: 2px 0 0;
      font-size: 22px;
      line-height: 1.35;
      color: #d8e7ff;
      max-width: 640px;
      text-wrap: pretty;
    }
    .bullets {
      display: grid;
      gap: 11px;
      margin-top: 2px;
    }
    .bullet {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 20px;
      line-height: 1.25;
      color: #e0ebff;
    }
    .tick {
      width: 24px;
      height: 24px;
      display: inline-grid;
      place-items: center;
      border-radius: 8px;
      font-weight: 900;
      font-size: 15px;
      color: #f4f8ff;
      background: linear-gradient(150deg, var(--a), var(--b));
      box-shadow: 0 8px 18px color-mix(in srgb, var(--a) 40%, transparent);
      flex: none;
    }
    .right {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .device {
      width: 360px;
      min-height: 470px;
      border-radius: 32px;
      padding: 22px 22px 20px;
      background:
        linear-gradient(165deg, rgba(15, 26, 52, 0.95) 0%, rgba(8, 12, 27, 0.95) 100%);
      border: 1px solid rgba(154, 192, 255, 0.2);
      box-shadow:
        0 26px 52px rgba(0, 0, 0, 0.45),
        inset 0 1px 0 rgba(255, 255, 255, 0.12);
      display: grid;
      gap: 14px;
      align-content: start;
    }
    .metric {
      font-size: 14px;
      letter-spacing: 0.7px;
      text-transform: uppercase;
      color: #bdd5ff;
      padding: 11px 14px;
      border-radius: 14px;
      border: 1px solid rgba(166, 198, 255, 0.28);
      background: rgba(6, 11, 24, 0.72);
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }
    .metric strong {
      font-size: 22px;
      color: #f3f8ff;
      letter-spacing: 0;
    }
    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      font-size: 12px;
      font-weight: 700;
      padding: 8px 11px;
      border-radius: 999px;
      letter-spacing: 0.4px;
      color: #ebf4ff;
      border: 1px solid rgba(188, 214, 255, 0.25);
      background: rgba(18, 33, 64, 0.78);
    }
    .chip.is-primary {
      background: linear-gradient(140deg, color-mix(in srgb, var(--a) 26%, #111b34), color-mix(in srgb, var(--b) 24%, #0d1630));
      border-color: color-mix(in srgb, var(--a) 35%, #9fc7ff);
    }
    .mock-list {
      margin-top: 2px;
      display: grid;
      gap: 9px;
    }
    .mock-item {
      padding: 11px 12px;
      border-radius: 13px;
      border: 1px solid rgba(163, 197, 255, 0.2);
      background: rgba(6, 12, 26, 0.66);
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 13px;
      color: #d7e5ff;
    }
    .badge {
      font-size: 12px;
      font-weight: 700;
      color: #f2f7ff;
      border-radius: 999px;
      padding: 4px 10px;
      background: linear-gradient(130deg, var(--a), var(--b));
      box-shadow: 0 6px 16px color-mix(in srgb, var(--a) 38%, transparent);
      white-space: nowrap;
    }
    .footer {
      margin-top: auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      color: #acc6f4;
      font-size: 13px;
      letter-spacing: 0.35px;
    }
    .footer strong {
      color: #eff6ff;
      font-size: 14px;
      letter-spacing: 0.3px;
    }
  </style>
</head>
<body>
  <section class="frame">
    <div class="grain"></div>
    <section class="left">
      <div class="topline">
        <div class="brand"><span class="brand-dot"></span><span>Pocket Ledger</span></div>
        <span class="progress">${escapeHtml(progressText)}</span>
      </div>
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">${escapeHtml(subtitle)}</p>
      ${contentHtml}
    </section>
    <section class="right">
      <article class="device">
        <div class="metric"><span>Feature Highlight</span><strong>${escapeHtml(metric)}</strong></div>
        <div class="chip-row">
          <span class="chip is-primary">Bills Tracker</span>
          <span class="chip">Due Soon</span>
          <span class="chip">Overdue</span>
          <span class="chip">Paid</span>
        </div>
        <div class="mock-list">
          <div class="mock-item"><span>Rent</span><span class="badge">Upcoming</span></div>
          <div class="mock-item"><span>Electric Bill</span><span class="badge">Due Soon</span></div>
          <div class="mock-item"><span>Internet</span><span class="badge">Paid</span></div>
        </div>
        <div class="footer">
          <span>Ready for mobile and web</span>
          <strong>Pocket Ledger</strong>
        </div>
      </article>
    </section>
  </section>
</body>
</html>`;
}

function buildCaptions(cards) {
  const lines = [
    "# Pocket Ledger Casual Facebook Captions",
    "",
    "00-cover.png",
    "Hey friends, quick intro to Pocket Ledger. Swipe through the next cards for a simple feature tour.",
    "",
  ];

  for (const card of cards) {
    lines.push(`${card.slug}.png`);
    lines.push(card.postCopy);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: EXPORT_SCALE,
  });
  const page = await context.newPage();

  const rendered = [];
  const total = FEATURE_CARDS.length;

  const coverCard = FEATURE_CARDS[0];
  await page.setContent(renderCardHtml(coverCard, 0, total, true), { waitUntil: "networkidle" });
  const coverName = "00-cover.png";
  await page.screenshot({ path: path.join(OUTPUT_DIR, coverName), type: "png", scale: "device" });
  rendered.push({
    file: coverName,
    title: COVER_CARD.title,
    subtitle: COVER_CARD.subtitle,
  });

  let index = 1;
  for (const card of FEATURE_CARDS) {
    await page.setContent(renderCardHtml(card, index, total, false), { waitUntil: "networkidle" });
    const fileName = `${card.slug}.png`;
    await page.screenshot({ path: path.join(OUTPUT_DIR, fileName), type: "png", scale: "device" });
    rendered.push({
      file: fileName,
      title: card.title,
      subtitle: card.subtitle,
    });
    index += 1;
  }

  await context.close();
  await browser.close();

  await fs.writeFile(
    path.join(OUTPUT_DIR, "manifest.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        size: {
          cssWidth: WIDTH,
          cssHeight: HEIGHT,
          exportWidth: WIDTH * EXPORT_SCALE,
          exportHeight: HEIGHT * EXPORT_SCALE,
          scale: EXPORT_SCALE,
        },
        images: rendered,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const captionSeed = FEATURE_CARDS.map((card) => ({
    slug: card.slug,
    postCopy: card.postCopy,
  }));
  await fs.writeFile(path.join(OUTPUT_DIR, "captions.txt"), `${buildCaptions(captionSeed)}\n`, "utf8");

  console.log(
    `Generated ${rendered.length} high-quality image files (${WIDTH * EXPORT_SCALE}x${HEIGHT * EXPORT_SCALE}) in ${OUTPUT_DIR}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
