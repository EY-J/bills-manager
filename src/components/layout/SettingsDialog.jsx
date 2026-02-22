import React, { useEffect, useRef, useState } from "react";

export default function SettingsDialog({
  open,
  onClose,
  notifyEnabled,
  setNotifyEnabled,
  compactMode,
  setCompactMode,
  canInstall,
  onInstall,
  onBackup,
  onRestorePreview,
  onRestoreApply,
  onTestNotification,
  onClear,
}) {
  const restoreInputRef = useRef(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isApplyingRestore, setIsApplyingRestore] = useState(false);
  const [restoreState, setRestoreState] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null);

  useEffect(() => {
    if (!open) {
      setIsRestoring(false);
      setIsApplyingRestore(false);
      setRestoreState(null);
      setPendingRestore(null);
    }
  }, [open]);

  if (!open) return null;

  function handleRestoreClick() {
    setRestoreState(null);
    setPendingRestore(null);
    restoreInputRef.current?.click();
  }

  async function handleRestoreFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsRestoring(true);
    setRestoreState(null);
    setPendingRestore(null);
    let result = null;
    try {
      result = await onRestorePreview?.(file);
    } catch {
      result = {
        ok: false,
        state: "error",
        title: "Import failed",
        message: "We could not import that file.",
        hint: "Use a valid JSON backup exported from this app.",
      };
    }

    event.target.value = "";

    if (result?.ok) {
      if (result.data) {
        setPendingRestore(result.data);
      }
      setRestoreState(result);
      setIsRestoring(false);
      return;
    }

    setIsRestoring(false);
    setRestoreState(
      result || {
        ok: false,
        state: "error",
        title: "Restore failed",
        message: "The selected backup could not be restored.",
        hint: "Try another backup file exported from this app.",
      }
    );
  }

  async function handleApplyRestore() {
    if (!pendingRestore || isApplyingRestore) return;

    setIsApplyingRestore(true);
    try {
      const result = await onRestoreApply?.(pendingRestore);
      if (result?.ok) {
        setIsApplyingRestore(false);
        onClose?.();
        return;
      }

      setRestoreState(
        result || {
          ok: false,
          state: "error",
          title: "Restore failed",
          message: "The restore could not be applied.",
          hint: "Try another backup file.",
        }
      );
    } catch {
      setRestoreState({
        ok: false,
        state: "error",
        title: "Restore failed",
        message: "The restore could not be applied.",
        hint: "Try another backup file.",
      });
    } finally {
      setIsApplyingRestore(false);
    }
  }

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modal modal-sm settingsModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <h3>Settings</h3>
            <p className="muted">Manage notifications, backup, and app actions.</p>
          </div>
          <button className="iconBtn" onClick={onClose} aria-label="Close settings">
            X
          </button>
        </div>

        <div className="modalBody settingsBody">
          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json,.json"
            className="hiddenFileInput"
            onChange={handleRestoreFileChange}
          />

          <section className="settingsSection">
            <p className="settingsSectionTitle">Preferences</p>
            <div className="settingsRow">
              <div className="settingsMeta">
                <span className="settingsLabel">Notifications</span>
                <span className="settingsHint">Turn due reminders on or off.</span>
              </div>
              <label className="toggle switchToggle settingsSwitch" aria-label="Toggle notifications">
                <input
                  type="checkbox"
                  checked={notifyEnabled}
                  onChange={(e) => setNotifyEnabled(e.target.checked)}
                />
                <span className="switchTrack" aria-hidden="true">
                  <span className="switchThumb" />
                </span>
              </label>
            </div>

            <div className="settingsRow">
              <div className="settingsMeta">
                <span className="settingsLabel">Compact mode</span>
                <span className="settingsHint">Reduce spacing for smaller phone screens.</span>
              </div>
              <label className="toggle switchToggle settingsSwitch" aria-label="Toggle compact mode">
                <input
                  type="checkbox"
                  checked={Boolean(compactMode)}
                  onChange={(e) => setCompactMode?.(e.target.checked)}
                />
                <span className="switchTrack" aria-hidden="true">
                  <span className="switchThumb" />
                </span>
              </label>
            </div>
          </section>

          <section className="settingsSection">
            <p className="settingsSectionTitle">Data</p>
            <div className="settingsActions settingsDataActions">
              {canInstall ? (
                <button
                  className="btn headerBtn settingsInstallBtn"
                  onClick={async () => {
                    await onInstall?.();
                    onClose?.();
                  }}
                >
                  Install app
                </button>
              ) : null}

              <button
                className="btn headerBtn"
                onClick={() => {
                  onBackup?.();
                  onClose?.();
                }}
              >
                Backup data
              </button>

              <button
                className="btn headerBtn"
                disabled={isRestoring || isApplyingRestore}
                onClick={handleRestoreClick}
              >
                {isRestoring ? "Importing..." : "Restore data"}
              </button>
            </div>

            {restoreState ? (
              <div className={`settingsImportState ${restoreState.state || "error"}`}>
                <div className="settingsImportTitle">{restoreState.title || "Restore failed"}</div>
                <div className="settingsImportText">
                  {restoreState.message || "The selected file could not be restored."}
                </div>
                {restoreState.preview ? (
                  <div className="settingsRestorePreview">
                    <span>Incoming: {restoreState.preview.incoming}</span>
                    <span>Added: {restoreState.preview.added}</span>
                    <span>Updated: {restoreState.preview.updated}</span>
                    <span>Removed: {restoreState.preview.deleted}</span>
                  </div>
                ) : null}
                {restoreState.hint ? (
                  <div className="settingsImportHint">{restoreState.hint}</div>
                ) : null}

                <div className="settingsImportActions">
                  {pendingRestore ? (
                    <button
                      className="btn small primary"
                      disabled={isApplyingRestore}
                      onClick={handleApplyRestore}
                    >
                      {isApplyingRestore ? "Applying..." : "Apply restore"}
                    </button>
                  ) : null}
                  <button className="btn small" onClick={handleRestoreClick}>
                    Try another file
                  </button>
                  <button
                    className="btn small"
                    onClick={() => {
                      onBackup?.();
                    }}
                  >
                    Backup current data
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="settingsSection">
            <p className="settingsSectionTitle">Actions</p>
            <div className="settingsActions">
              <button
                className="btn headerBtn testNotifyBtn settingsPrimaryAction"
                onClick={async () => {
                  await onTestNotification?.();
                  onClose?.();
                }}
              >
                Send test
              </button>
            </div>
          </section>

          <section className="settingsSection settingsSectionDanger">
            <p className="settingsSectionTitle">Danger zone</p>
            <span className="settingsDangerHint">This permanently removes your current bill list.</span>

            <button
              className="btn danger headerBtn"
              onClick={() => {
                onClear?.();
                onClose?.();
              }}
            >
              Clear all bills
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
