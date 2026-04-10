import { useEffect } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface DeleteConfirmationModalProps {
  title: string
  description: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmationModal({
  title,
  description,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: DeleteConfirmationModalProps) {
  const trapRef = useFocusTrap(true)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog backdrop dismiss
    <div
      ref={trapRef}
      className="admin-confirm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-confirm-title"
      aria-describedby="admin-confirm-description"
      onClick={onCancel}
      onKeyDown={(event) => { if (event.key === 'Escape') onCancel() }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- stop propagation on panel */}
      <div className="admin-confirm-panel" role="document" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <div className="admin-confirm-copy">
          <p className="eyebrow">Confirm delete</p>
          <h3 id="admin-confirm-title">{title}</h3>
          <p id="admin-confirm-description">{description}</p>
        </div>
        <div className="admin-confirm-actions">
          <button className="button ghost" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="button primary admin-confirm-destructive"
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Deleting...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
