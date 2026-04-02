import { apiBaseUrl } from '../lib/constants'

export async function workerRequest<T>(
  path: string,
  token: string,
  options?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    body?: unknown
  }
): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error('Set VITE_API_BASE_URL to enable gallery APIs.')
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  let payload: Record<string, unknown> = {}
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>
    } catch {
      if (response.ok) {
        throw new Error(`Unexpected response from server: ${text.slice(0, 120)}`)
      }
    }
  }
  if (!response.ok) {
    const maybeError = payload.error as { message?: string } | undefined
    throw new Error(maybeError?.message ?? (text.trim() || 'Request failed'))
  }
  return payload as T
}

export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function loadWorkerBlob(
  path: string,
  token: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }
) {
  if (!apiBaseUrl) {
    throw new Error('Set VITE_API_BASE_URL to enable gallery APIs.')
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    const text = await response.text()
    let message = text.trim() || 'Request failed'
    try {
      const payload = JSON.parse(text) as { error?: { message?: string } }
      message = payload.error?.message ?? message
    } catch {
      // Keep the raw text fallback.
    }
    throw new Error(message)
  }

  return response.blob()
}
