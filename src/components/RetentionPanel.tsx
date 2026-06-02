import { useState } from 'react'
import { useClientDeliveries, type ClientDelivery } from '../hooks/queries/useClientDeliveries'

const DAY_MS = 24 * 60 * 60 * 1000

const formatDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

type Retention = { label: string; tone: 'ok' | 'warn' | 'gone'; canExtend: boolean; canShare: boolean; sub: string }

/** Derive the client-facing retention state from the lifecycle timestamps. */
function retentionState(d: ClientDelivery): Retention {
  if (d.purgedAt) {
    return { label: 'Removed', tone: 'gone', canExtend: false, canShare: false, sub: `Files deleted ${formatDate(d.purgedAt)}` }
  }
  if (d.expiredAt) {
    return { label: 'Expired', tone: 'gone', canExtend: true, canShare: false, sub: `Access ended ${formatDate(d.expiredAt)} · extend to restore` }
  }
  if (!d.expiresAt) {
    return { label: 'No expiry', tone: 'ok', canExtend: true, canShare: true, sub: 'No retention set' }
  }
  const daysLeft = Math.ceil((new Date(d.expiresAt).getTime() - Date.now()) / DAY_MS)
  if (daysLeft <= 0) {
    return { label: 'Expiring now', tone: 'warn', canExtend: true, canShare: false, sub: `Past cutoff (${formatDate(d.expiresAt)}) · removed on next run` }
  }
  if (daysLeft <= 3) {
    return { label: 'Expiring soon', tone: 'warn', canExtend: true, canShare: true, sub: `${daysLeft}d left · removed ${formatDate(d.expiresAt)}` }
  }
  return { label: 'Active', tone: 'ok', canExtend: true, canShare: true, sub: `${daysLeft}d left · expires ${formatDate(d.expiresAt)}` }
}

const toneColor: Record<Retention['tone'], string> = {
  ok: '#0f4d5c',
  warn: '#d44b24',
  gone: '#8a8278',
}

type ExtendMut = ReturnType<typeof useClientDeliveries>['extend']
type AddMut = ReturnType<typeof useClientDeliveries>['addRecipient']

function DeliveryRow({ d, extend, addRecipient }: { d: ClientDelivery; extend: ExtendMut; addRecipient: AddMut }) {
  const state = retentionState(d)
  const [showShare, setShowShare] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')

  const extendBusy = extend.isPending && extend.variables === d.deliveryId
  const shareBusy = addRecipient.isPending && addRecipient.variables?.deliveryId === d.deliveryId
  const shareError =
    addRecipient.isError && addRecipient.variables?.deliveryId === d.deliveryId
      ? addRecipient.error instanceof Error ? addRecipient.error.message : 'Could not share'
      : ''
  const emailValid = email.trim().includes('@')

  const submitShare = () => {
    if (!emailValid || shareBusy) return
    addRecipient.mutate(
      { deliveryId: d.deliveryId, email: email.trim(), name: name.trim() || undefined },
      {
        onSuccess: () => {
          setEmail('')
          setName('')
          setShowShare(false)
        },
      },
    )
  }

  return (
    <li className="retention-row">
      <div className="retention-row-top">
        <div className="retention-main">
          <strong>{d.title}</strong>
          <span className="retention-meta">
            {d.assetCount} file{d.assetCount === 1 ? '' : 's'} · uploaded {formatDate(d.createdAt)}
          </span>
          <span className="retention-meta">{state.sub}</span>
          {d.recipients.length > 0 && (
            <span className="retention-meta">Shared with: {d.recipients.join(', ')}</span>
          )}
        </div>
        <div className="retention-actions">
          <span className="retention-badge" style={{ color: toneColor[state.tone], borderColor: toneColor[state.tone] }}>
            {state.label}
          </span>
          {state.canShare && (
            <button className="button ghost" type="button" onClick={() => setShowShare((v) => !v)}>
              {showShare ? 'Cancel' : 'Share with family'}
            </button>
          )}
          <button
            className="button ghost"
            type="button"
            disabled={!state.canExtend || extendBusy}
            onClick={() => extend.mutate(d.deliveryId)}
            title={state.canExtend ? 'Push expiry 45 days out' : 'Files already permanently removed'}
          >
            {extendBusy ? 'Extending…' : 'Extend 45 days'}
          </button>
        </div>
      </div>

      {showShare && (
        <div className="retention-share">
          <input
            type="email"
            className="share-link-input"
            placeholder="family@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitShare() }}
            aria-label="Family member email"
          />
          <input
            type="text"
            className="share-link-input"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitShare() }}
            aria-label="Family member name"
          />
          <button className="button" type="button" disabled={!emailValid || shareBusy} onClick={submitShare}>
            {shareBusy ? 'Sending…' : 'Send link'}
          </button>
        </div>
      )}
      {shareError && <p className="portal-error retention-share-error">{shareError}</p>}
    </li>
  )
}

export function RetentionPanel({ clientId }: { clientId: string }) {
  const { data: deliveries, isLoading, error, extend, addRecipient } = useClientDeliveries(clientId)

  return (
    <section className="portal-section admin-screen retention-panel">
      <div className="portal-head">
        <div>
          <h2>Deliveries &amp; retention</h2>
          <p>Galleries auto-expire 45 days after upload. Extend any a client still needs, or share one with a family member.</p>
        </div>
      </div>

      {isLoading && <p className="portal-hint">Loading deliveries…</p>}
      {error && <p className="portal-error">{error instanceof Error ? error.message : 'Failed to load deliveries'}</p>}
      {!isLoading && !error && (!deliveries || deliveries.length === 0) && (
        <p className="portal-hint">No deliveries yet for this client.</p>
      )}

      {deliveries && deliveries.length > 0 && (
        <ul className="retention-list">
          {deliveries.map((d) => (
            <DeliveryRow key={d.deliveryId} d={d} extend={extend} addRecipient={addRecipient} />
          ))}
        </ul>
      )}
    </section>
  )
}
