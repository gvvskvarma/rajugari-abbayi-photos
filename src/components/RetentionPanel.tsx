import { useClientDeliveries, type ClientDelivery } from '../hooks/queries/useClientDeliveries'

const DAY_MS = 24 * 60 * 60 * 1000

const formatDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

type Retention = { label: string; tone: 'ok' | 'warn' | 'gone'; canExtend: boolean; sub: string }

/** Derive the client-facing retention state from the lifecycle timestamps. */
function retentionState(d: ClientDelivery): Retention {
  if (d.purgedAt) {
    return { label: 'Removed', tone: 'gone', canExtend: false, sub: `Files deleted ${formatDate(d.purgedAt)}` }
  }
  if (d.expiredAt) {
    return { label: 'Expired', tone: 'gone', canExtend: true, sub: `Access ended ${formatDate(d.expiredAt)} · extend to restore` }
  }
  if (!d.expiresAt) {
    return { label: 'No expiry', tone: 'ok', canExtend: true, sub: 'No retention set' }
  }
  const daysLeft = Math.ceil((new Date(d.expiresAt).getTime() - Date.now()) / DAY_MS)
  if (daysLeft <= 0) {
    /* Past the cutoff but the cron hasn't soft-deleted yet (e.g. dry-run, or
       before the next daily run). Surface it as due, not negative days. */
    return { label: 'Expiring now', tone: 'warn', canExtend: true, sub: `Past cutoff (${formatDate(d.expiresAt)}) · removed on next run` }
  }
  if (daysLeft <= 3) {
    return { label: 'Expiring soon', tone: 'warn', canExtend: true, sub: `${daysLeft}d left · removed ${formatDate(d.expiresAt)}` }
  }
  return { label: 'Active', tone: 'ok', canExtend: true, sub: `${daysLeft}d left · expires ${formatDate(d.expiresAt)}` }
}

const toneColor: Record<Retention['tone'], string> = {
  ok: '#0f4d5c',
  warn: '#d44b24',
  gone: '#8a8278',
}

export function RetentionPanel({ clientId }: { clientId: string }) {
  const { data: deliveries, isLoading, error, extend } = useClientDeliveries(clientId)

  return (
    <section className="portal-section admin-screen retention-panel">
      <div className="portal-head">
        <div>
          <h2>Retention</h2>
          <p>Galleries auto-expire 45 days after upload. Extend any a client still needs.</p>
        </div>
      </div>

      {isLoading && <p className="portal-hint">Loading deliveries…</p>}
      {error && <p className="portal-error">{error instanceof Error ? error.message : 'Failed to load deliveries'}</p>}
      {!isLoading && !error && (!deliveries || deliveries.length === 0) && (
        <p className="portal-hint">No deliveries yet for this client.</p>
      )}

      {deliveries && deliveries.length > 0 && (
        <ul className="retention-list">
          {deliveries.map((d) => {
            const state = retentionState(d)
            const busy = extend.isPending && extend.variables === d.deliveryId
            return (
              <li key={d.deliveryId} className="retention-row">
                <div className="retention-main">
                  <strong>{d.title}</strong>
                  <span className="retention-meta">
                    {d.assetCount} file{d.assetCount === 1 ? '' : 's'} · uploaded {formatDate(d.createdAt)}
                  </span>
                  <span className="retention-meta">{state.sub}</span>
                </div>
                <div className="retention-actions">
                  <span className="retention-badge" style={{ color: toneColor[state.tone], borderColor: toneColor[state.tone] }}>
                    {state.label}
                  </span>
                  <button
                    className="button ghost"
                    type="button"
                    disabled={!state.canExtend || busy}
                    onClick={() => extend.mutate(d.deliveryId)}
                    title={state.canExtend ? 'Push expiry 45 days out' : 'Files already permanently removed'}
                  >
                    {busy ? 'Extending…' : 'Extend 45 days'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {extend.isError && (
        <p className="portal-error">{extend.error instanceof Error ? extend.error.message : 'Could not extend retention'}</p>
      )}
    </section>
  )
}
