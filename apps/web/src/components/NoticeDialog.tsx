import type { ReactNode } from "react";

export interface NoticeAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export default function NoticeDialog({
  title,
  children,
  actions,
  onClose,
}: {
  title: string;
  children: ReactNode;
  actions: NoticeAction[];
  onClose?: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="notice-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h3>{title}</h3>
        <div className="notice-body">{children}</div>
        <div className="notice-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={action.primary ? "btn primary" : "btn ghost"}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
