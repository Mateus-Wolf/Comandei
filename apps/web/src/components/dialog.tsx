"use client";
import { useEffect, useId, useRef } from "react";
export function Dialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="form-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-heading">
          <h2 id={id}>{title}</h2>
          <button
            type="button"
            className="close-button"
            aria-label="Fechar formulário"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
