import React from "react";

export default function EmptyState({ title, subtitle }) {
  return (
    <div className="empty">
      <div className="emptyTitle">{title}</div>
      {subtitle ? <div className="muted">{subtitle}</div> : null}
    </div>
  );
}
