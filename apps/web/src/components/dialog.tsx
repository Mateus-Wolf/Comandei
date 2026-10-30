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
  const backdropPointer = useRef(false);
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
        // A file input's cancel event bubbles; it must not dismiss its dialog.
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        backdropPointer.current =
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom);
      }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom;
        if (
          backdropPointer.current &&
          outside &&
          event.target === event.currentTarget &&
          !busy
        )
          onClose();
        backdropPointer.current = false;
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
