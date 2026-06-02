import { Hono } from 'hono'
import type { Env } from '../types'
import {
  responseHeaders, jsonError,
  supabaseRequest, getUserFromBearer,
} from '../lib'

const customer = new Hono<{ Bindings: Env }>()

customer.get('/me', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const profile = await supabaseRequest<Array<{ display_name: string | null }>>(
      c.env,
      `profiles?id=eq.${encodeURIComponent(user.id)}&select=display_name&limit=1`
    )
    return c.json(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: profile[0]?.display_name ?? null,
      },
      200,
      responseHeaders(c)
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load profile', 401)
  }
})

customer.get('/my-pictures', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))

    const recipients = await supabaseRequest<
      Array<{ delivery_id: string; access_mode: 'owner' | 'viewer'; expires_at: string | null }>
    >(
      c.env,
      `delivery_recipients?email=eq.${encodeURIComponent(
        user.email
      )}&select=delivery_id,access_mode,expires_at`
    )

    const activeRecipients = recipients.filter(
      (row) => !row.expires_at || new Date(row.expires_at).getTime() > Date.now()
    )

    if (activeRecipients.length === 0) {
      return c.json({ deliveries: [] }, 200, responseHeaders(c))
    }

    const recipientDeliveryIds = [...new Set(activeRecipients.map((row) => row.delivery_id))]
    const allDeliveryRows = await supabaseRequest<
      Array<{ id: string; project_id: string | null; expired_at: string | null; purged_at: string | null }>
    >(
      c.env,
      `deliveries?id=in.(${recipientDeliveryIds.map((id) => encodeURIComponent(id)).join(',')})&select=id,project_id,expired_at,purged_at`
    )

    /* Retention gate: hide deliveries the lifecycle cron has soft-deleted
       (expired_at) or purged (purged_at). The client no longer sees expired
       galleries even though their recipient row may still be active. */
    const deliveryRows = allDeliveryRows.filter(
      (row) => !row.expired_at && !row.purged_at
    )
    const deliveryIds = deliveryRows.map((row) => row.id)
    if (deliveryIds.length === 0) {
      return c.json({ deliveries: [] }, 200, responseHeaders(c))
    }
    const visibleDeliveryIdSet = new Set(deliveryIds)
    const projectIds = [...new Set(deliveryRows.map((row) => row.project_id).filter((value): value is string => Boolean(value)))]
    const projects = projectIds.length
      ? await supabaseRequest<Array<{ id: string; client_id: string | null; name: string; status: string }>>(
          c.env,
          `projects?id=in.(${projectIds.map((id) => encodeURIComponent(id)).join(',')})&select=id,client_id,name,status`
        )
      : []
    const clientIds = [...new Set(projects.map((project) => project.client_id).filter((value): value is string => Boolean(value)))]
    const clients = clientIds.length
      ? await supabaseRequest<Array<{ id: string; full_name: string }>>(
          c.env,
          `clients?id=in.(${clientIds.map((id) => encodeURIComponent(id)).join(',')})&select=id,full_name`
        )
      : []

    const deliveryToProject = new Map(
      deliveryRows.map((d) => [d.id, d.project_id ?? null] as const)
    )
    const projectById = new Map(projects.map((p) => [p.id, p] as const))
    const projectClientById = new Map(projects.map((p) => [p.id, p.client_id ?? null] as const))
    const clientById = new Map(clients.map((cl) => [cl.id, cl] as const))

    /* Batch: fetch all delivery_assets and assets in 2 queries instead of 2N */
    const deliveryAssetFilter = deliveryIds.map((id) => `delivery_id.eq.${encodeURIComponent(id)}`).join(',')
    const allDeliveryAssets = await supabaseRequest<Array<{ delivery_id: string; asset_id: string }>>(
      c.env,
      `delivery_assets?or=(${deliveryAssetFilter})&select=delivery_id,asset_id`
    )

    /* Group asset IDs by delivery */
    const deliveryAssetMap = new Map<string, string[]>()
    for (const da of allDeliveryAssets) {
      const list = deliveryAssetMap.get(da.delivery_id) ?? []
      list.push(da.asset_id)
      deliveryAssetMap.set(da.delivery_id, list)
    }

    const allAssetIds = [...new Set(allDeliveryAssets.map((da) => da.asset_id))]
    const allAssets = allAssetIds.length
      ? await supabaseRequest<
          Array<{ id: string; filename: string; mime_type: string; bytes: number; r2_object_key: string }>
        >(
          c.env,
          `assets?or=(${allAssetIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',')})&select=id,filename,mime_type,bytes,r2_object_key&order=created_at.desc`
        )
      : []

    const assetById = new Map(allAssets.map((a) => [a.id, a]))

    const deliveryPayloads = activeRecipients
      .filter((recipient) => visibleDeliveryIdSet.has(recipient.delivery_id))
      .map((recipient) => {
      const deliveryId = recipient.delivery_id
      const projectId = deliveryToProject.get(deliveryId) ?? null
      const project = projectId ? projectById.get(projectId) ?? null : null
      const clientId = projectId ? projectClientById.get(projectId) ?? null : null
      const client = clientId ? clientById.get(clientId) ?? null : null
      const visibleAssetIds = deliveryAssetMap.get(deliveryId) ?? []

      const uploadedAssets = visibleAssetIds
        .map((id) => assetById.get(id))
        .filter((asset): asset is NonNullable<typeof asset> =>
          Boolean(asset && !asset.r2_object_key.startsWith('pending/'))
        )

      return {
        deliveryId,
        projectName: project?.name ?? null,
        clientName: client?.full_name ?? null,
        projectStatus: project?.status ?? null,
        accessMode: recipient.access_mode,
        expiresAt: recipient.expires_at,
        assets: uploadedAssets.map((asset) => ({
          ...asset,
          canView: true,
          canDownload: recipient.access_mode !== 'viewer',
        })),
      }
    })

    return c.json(
      {
        deliveries: deliveryPayloads,
      },
      200,
      responseHeaders(c)
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load pictures', 400)
  }
})

export { customer }
