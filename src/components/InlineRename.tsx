import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/shared/i18n";

interface InlineRenameProps {
  value: string;
  onCommit: (next: string) => void | Promise<void>;
  className?: string;
  inputClassName?: string;
  title?: string;
  disabled?: boolean;
  /** Shown while empty during edit; commit rejects blank. */
  placeholder?: string;
}

/**
 * Click (or Enter) to edit a label in place. Escape cancels; blur / Enter saves.
 */
export function InlineRename({
  value,
  onCommit,
  className,
  inputClassName,
  title,
  disabled = false,
  placeholder,
}: InlineRenameProps) {
  const { t } = useI18n();
  const resolvedTitle = title ?? t("rename.click");
  const resolvedPlaceholder = placeholder ?? t("rename.placeholder");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const begin = () => {
    if (disabled || busy) return;
    setDraft(value);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const commit = async () => {
    const next = draft.trim();
    if (!next || next === value) {
      cancel();
      return;
    }
    try {
      setBusy(true);
      await onCommit(next);
      setEditing(false);
    } catch {
      // Parent surfaces errors; keep editing so the user can retry / Escape.
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={inputClassName ?? "inline-rename-input"}
        value={draft}
        disabled={busy}
        placeholder={resolvedPlaceholder}
        aria-label={resolvedTitle}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <button
      type="button"
      className={className ?? "inline-rename-trigger"}
      title={disabled ? value : resolvedTitle}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        begin();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        begin();
      }}
    >
      <span className="inline-rename-text">{value || resolvedPlaceholder}</span>
    </button>
  );
}
