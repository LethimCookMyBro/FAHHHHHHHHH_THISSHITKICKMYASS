import { AlertTriangle, Trash2, X } from "lucide-react";
import { useEffect } from "react";
import { useT } from "../../utils/i18n";

export default function DeleteChatDialog({
  isOpen,
  chatTitle = "",
  onCancel,
  onConfirm,
}) {
  const { t } = useT();

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onCancel?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="chat-dialog-overlay" onClick={onCancel} aria-hidden="true">
      <div
        className="chat-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-chat-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="chat-dialog-close"
          onClick={onCancel}
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <X size={16} />
        </button>

        <div className="chat-dialog-icon">
          <AlertTriangle size={18} />
        </div>

        <h3 id="delete-chat-dialog-title" className="chat-dialog-title">
          {t("chat.confirmDeleteTitle")}
        </h3>

        <p className="chat-dialog-body">
          {t("chat.confirmDeleteBody")}
          <strong className="chat-dialog-chat-name">"{chatTitle}"</strong>
        </p>

        <p className="chat-dialog-warning">{t("chat.confirmDeleteWarning")}</p>

        <div className="chat-dialog-actions">
          <button
            type="button"
            className="chat-dialog-btn chat-dialog-btn-secondary"
            onClick={onCancel}
          >
            {t("chat.cancelDelete")}
          </button>
          <button
            type="button"
            className="chat-dialog-btn chat-dialog-btn-danger"
            onClick={onConfirm}
          >
            <Trash2 size={14} />
            {t("chat.confirmDeleteAction")}
          </button>
        </div>
      </div>
    </div>
  );
}
