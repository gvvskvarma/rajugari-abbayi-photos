interface AdminClientDraft {
  fullName: string
  email: string
  phone: string
  notes: string
}

interface AdminClientEditFormProps {
  draft: AdminClientDraft
  onDraftChange: (updater: (current: AdminClientDraft) => AdminClientDraft) => void
  onSave: () => void
  onCancel: () => void
  busy: boolean
}

export function AdminClientEditForm({ draft, onDraftChange, onSave, onCancel, busy }: AdminClientEditFormProps) {
  return (
    <div className="admin-client-form">
      <label>
        Full name
        <input
          type="text"
          value={draft.fullName}
          onChange={(event) =>
            onDraftChange((current) => ({ ...current, fullName: event.target.value }))
          }
        />
      </label>
      <label>
        Email
        <input
          type="email"
          value={draft.email}
          onChange={(event) =>
            onDraftChange((current) => ({ ...current, email: event.target.value }))
          }
        />
      </label>
      <label>
        Phone
        <input
          type="text"
          value={draft.phone}
          onChange={(event) =>
            onDraftChange((current) => ({ ...current, phone: event.target.value }))
          }
        />
      </label>
      <label>
        Notes
        <textarea
          rows={4}
          value={draft.notes}
          onChange={(event) =>
            onDraftChange((current) => ({ ...current, notes: event.target.value }))
          }
        />
      </label>
      <div className="admin-form-actions">
        <button className="button primary" type="button" onClick={onSave} disabled={busy}>
          Save client
        </button>
        <button className="button ghost" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}
