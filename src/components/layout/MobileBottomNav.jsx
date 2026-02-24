import React from "react";

const ITEMS = [
  { id: "bills", label: "Bills", icon: BillsIcon },
  { id: "due", label: "Due", icon: BellIcon },
  { id: "stats", label: "Stats", icon: ChartIcon },
];

export default function MobileBottomNav({ active, onSelect }) {
  return (
    <nav className="mobileBottomNav" aria-label="Primary navigation">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={`mobileBottomNavBtn ${isActive ? "active" : ""}`}
            onClick={() => onSelect?.(item.id)}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function BillsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 8h8M8 12h8M8 16h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15.5 17H8.5l1-1.5v-4a2.5 2.5 0 1 1 5 0v4L15.5 17Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10.5 18a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 19.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="6.5" y="11" width="2.8" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="10.6" y="8" width="2.8" height="9.5" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14.7" y="5" width="2.8" height="12.5" rx="1" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
