import React from "react";

export default function Header({
  onOpenSettings,
  onOpenAccount,
  onOpenCalendar,
  accountSignedIn,
}) {
  return (
    <div className="header">
      <div className="headerInner">
        <button
          type="button"
          className="mobileMenuBtn settingsIconBtn"
          aria-label="Open settings"
          data-testid="open-settings-button-mobile"
          onClick={onOpenSettings}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.94a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01A1.7 1.7 0 0 0 10.06 3H10a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.35 15Z" />
          </svg>
        </button>

        <div className="headerMain">
          <div className="appBrand">
            <img className="appLogo" src="/logo.svg" alt="" aria-hidden="true" />
            <h1 className="appTitle">Pocket Ledger</h1>
          </div>
        </div>

        <div className="headerRightSpacer" aria-hidden="true" />

        <div className="headerActions">
          <button
            type="button"
            className="btn headerBtn desktopActionsBtn settingsIconBtn"
            aria-label="Open due date calendar"
            data-testid="open-calendar-button"
            onClick={onOpenCalendar}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
              <path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17" />
              <path d="M8.5 13h2M13.5 13h2M8.5 17h2" />
            </svg>
          </button>
          <button
            type="button"
            className={`btn headerBtn desktopActionsBtn settingsIconBtn accountIconBtn ${
              accountSignedIn ? "isSignedIn" : ""
            }`}
            aria-label={accountSignedIn ? "Open account (signed in)" : "Open account"}
            data-testid="open-account-button"
            onClick={onOpenAccount}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="3.25" />
              <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
            </svg>
          </button>
          <button
            type="button"
            className="btn headerBtn desktopActionsBtn settingsIconBtn"
            aria-label="Open settings"
            data-testid="open-settings-button-desktop"
            onClick={onOpenSettings}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.94a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01A1.7 1.7 0 0 0 10.06 3H10a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.35 15Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
