import React from "react";

export default function DueSoonBanner({ dueSoonBills, onOpen }) {
  if (!dueSoonBills || dueSoonBills.length === 0) return null;

  return (
    <div className="banner">
      <div className="bannerTitle">Due within reminder window</div>
      <div className="bannerChips">
        {dueSoonBills.slice(0, 8).map((b) => (
          <button key={b.id} className="chip" onClick={() => onOpen(b.id)}>
            <span className="chipName">{b.name}</span>
            <span className="chipMeta">| {b.meta.daysToDue}d</span>
          </button>
        ))}
        {dueSoonBills.length > 8 ? (
          <span className="muted">+{dueSoonBills.length - 8} more</span>
        ) : null}
      </div>
    </div>
  );
}

