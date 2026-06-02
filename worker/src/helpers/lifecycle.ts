import type { Env } from '../types'
import { supabaseRequest } from './http'
import { deleteStoredAssets } from '../lib'
import { ensureAuthUser, generateSignInLink } from './magic-link'
import { sendExpiryWarning } from './email'

/**
 * Delivery retention lifecycle (runs daily via the worker cron trigger).
 *
 * Timeline per delivery (RETENTION_DAYS = 45, GRACE_DAYS = 3):
 *   day 0   uploaded; deliveries.expires_at = created_at + 45d
 *   day 42  WARN     — email "expires on <date>", set expiry_warning_sent_at
 *   day 45  SOFT-DEL — set expired_at; client access revoked (queries gate on it)
 *   day 48  PURGE    — delete R2 objects + asset rows; set purged_at (irreversible)
 *
 * DRY RUN: when env.LIFECYCLE_DRY_RUN !== "false" (the default), every stage
 * is computed and logged but NO email is sent and NO write/delete happens.
 * This lets us watch a week of real output before enabling destructive runs.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const WARN_LEAD_DAYS = 3
const GRACE_DAYS = 3
const RETENTION_DAYS = 45

const firstName = (fullName: string | null | undefined): string => {
  const trimmed = (fullName ?? '').trim()
  if (!trimmed) return ''
  const first = trimmed.split(/\s+/)[0]
  return first.charAt(0).toUpperCase() + first.slice(1)
}

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

type WarnRow = {
  id: string
  expires_at: string
  clients: { email: string; full_name: string | null } | null
  projects: { name: string | null } | null
}

type ExpireRow = { id: string; expires_at: string }
type PurgeRow = { id: string; expired_at: string }

export type LifecycleReport = {
  dryRun: boolean
  ranAt: string
  warned: number
  softDeleted: number
  purged: number
  warnErrors: number
  notes: string[]
}

export const runLifecycle = async (env: Env): Promise<LifecycleReport> => {
  const dryRun = (env.LIFECYCLE_DRY_RUN ?? 'true').toLowerCase() !== 'false'
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const warnHorizonIso = new Date(now + WARN_LEAD_DAYS * DAY_MS).toISOString()
  const purgeThresholdIso = new Date(now - GRACE_DAYS * DAY_MS).toISOString()

  const report: LifecycleReport = {
    dryRun,
    ranAt: nowIso,
    warned: 0,
    softDeleted: 0,
    purged: 0,
    warnErrors: 0,
    notes: [],
  }
  const log = (msg: string) => {
    report.notes.push(msg)
    console.log(`[lifecycle]${dryRun ? ' DRY-RUN' : ''} ${msg}`)
  }

  log(`start (retention=${RETENTION_DAYS}d, warn=-${WARN_LEAD_DAYS}d, grace=+${GRACE_DAYS}d)`)

  /* ── 1. WARN: in the 3-day window before expiry, not yet warned ── */
  const warnRows = await supabaseRequest<WarnRow[]>(
    env,
    `deliveries?select=id,expires_at,clients(email,full_name),projects(name)` +
      `&expires_at=gt.${encodeURIComponent(nowIso)}` +
      `&expires_at=lte.${encodeURIComponent(warnHorizonIso)}` +
      `&expiry_warning_sent_at=is.null&expired_at=is.null&purged_at=is.null`
  )
  for (const row of warnRows) {
    const email = row.clients?.email?.trim()
    const title = row.projects?.name?.trim() || 'your shoot'
    const removalDate = formatDate(row.expires_at)
    const daysLeft = Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - now) / DAY_MS))
    if (!email) {
      log(`WARN skip delivery=${row.id} (no client email)`)
      continue
    }
    if (dryRun) {
      log(`WARN would email ${email} — "${title}" removed ${removalDate} (${daysLeft}d)`)
      report.warned++
      continue
    }
    try {
      await ensureAuthUser(env, email)
      const magicLink = await generateSignInLink(env, email)
      await sendExpiryWarning(env, {
        to: email,
        clientName: firstName(row.clients?.full_name),
        deliveryTitle: title,
        magicLink,
        removalDate,
        daysLeft,
      })
      await supabaseRequest(
        env,
        `deliveries?id=eq.${encodeURIComponent(row.id)}`,
        { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ expiry_warning_sent_at: nowIso }) },
        true
      )
      log(`WARN emailed ${email} — "${title}" removed ${removalDate} (${daysLeft}d)`)
      report.warned++
    } catch (error) {
      report.warnErrors++
      log(`WARN ERROR delivery=${row.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /* ── 2. SOFT-DELETE: past the cutoff, not yet soft-deleted ── */
  const expireRows = await supabaseRequest<ExpireRow[]>(
    env,
    `deliveries?select=id,expires_at&expires_at=lte.${encodeURIComponent(nowIso)}` +
      `&expired_at=is.null&purged_at=is.null`
  )
  for (const row of expireRows) {
    if (dryRun) {
      log(`SOFT-DELETE would revoke access delivery=${row.id} (expired ${formatDate(row.expires_at)})`)
      report.softDeleted++
      continue
    }
    await supabaseRequest(
      env,
      `deliveries?id=eq.${encodeURIComponent(row.id)}`,
      { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ expired_at: nowIso, status: 'expired' }) },
      true
    )
    log(`SOFT-DELETE revoked access delivery=${row.id}`)
    report.softDeleted++
  }

  /* ── 3. PURGE: soft-deleted at least GRACE_DAYS ago, not yet purged ── */
  const purgeRows = await supabaseRequest<PurgeRow[]>(
    env,
    `deliveries?select=id,expired_at&expired_at=lte.${encodeURIComponent(purgeThresholdIso)}` +
      `&purged_at=is.null`
  )
  for (const row of purgeRows) {
    /* Gather asset object keys for this delivery (canonical mapping table). */
    const links = await supabaseRequest<Array<{ asset_id: string }>>(
      env,
      `delivery_assets?delivery_id=eq.${encodeURIComponent(row.id)}&select=asset_id`
    )
    const assetIds = links.map((l) => l.asset_id)
    const assets = assetIds.length
      ? await supabaseRequest<Array<{ id: string; r2_object_key: string }>>(
          env,
          `assets?or=(${assetIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',')})&select=id,r2_object_key`
        )
      : []
    const objectKeys = assets.map((a) => a.r2_object_key)

    if (dryRun) {
      log(`PURGE would delete delivery=${row.id} — ${assets.length} asset(s), ${objectKeys.length} R2 object(s)`)
      report.purged++
      continue
    }

    /* R2 first (idempotent on missing keys → safe to retry), then DB rows,
       then stamp purged_at. If anything throws mid-way, purged_at stays null
       and the next daily run retries cleanly. */
    await deleteStoredAssets(env, objectKeys)
    await supabaseRequest(
      env,
      `delivery_assets?delivery_id=eq.${encodeURIComponent(row.id)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
      true
    )
    if (assetIds.length) {
      await supabaseRequest(
        env,
        `assets?or=(${assetIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',')})`,
        { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
        true
      )
    }
    await supabaseRequest(
      env,
      `deliveries?id=eq.${encodeURIComponent(row.id)}`,
      { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ purged_at: nowIso, status: 'expired' }) },
      true
    )
    log(`PURGE deleted delivery=${row.id} — ${objectKeys.length} R2 object(s)`)
    report.purged++
  }

  log(`done — warned=${report.warned}(err ${report.warnErrors}) softDeleted=${report.softDeleted} purged=${report.purged}`)
  return report
}
