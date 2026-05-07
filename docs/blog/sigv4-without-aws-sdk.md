# Signing S3-compatible URLs in a Cloudflare Worker without the AWS SDK

> ~50 lines of `crypto.subtle` instead of a 500 KB SDK.
> Why I did it, the gotchas, and the full code.

---

I run a small photography delivery platform on Cloudflare Workers + R2.
Every photo download goes through a short-lived **pre-signed URL** that the
worker mints and hands to the browser. The browser then talks to R2 directly —
the worker never sees the bytes, which is the whole point of running this on
the edge.

The obvious way to mint those URLs is the AWS SDK for JavaScript: it speaks
S3 (which R2 is compatible with), it handles SigV4, you import
`getSignedUrl` and you're done. So I tried that first. Then I looked at my
worker bundle and gave up.

## Why the SDK didn't fit

Cloudflare Workers have a **1 MB total compressed bundle limit on the free
tier** (10 MB on paid plans). The AWS SDK for JavaScript v3, even
tree-shaken to just the S3 client and the request-presigner, lands at
**~500 KB unminified**. That's 30%+ of the budget gone for one operation:
mint a pre-signed URL.

I don't need:
- multipart upload (R2 supports it but I don't use it yet)
- retry middleware (the worker calls R2 once per request)
- the full S3 API surface (~hundreds of operations)

I need exactly *one thing*: take an `(method, bucket, key, expiresIn)` and
return `https://<host>/<bucket>/<key>?X-Amz-Signature=...`.

That's a job for `crypto.subtle`.

## What SigV4 actually is

[AWS Signature Version 4](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_aws-signing-version-4.html)
is the signing protocol AWS uses to authenticate requests. For pre-signed URLs
in particular ("query parameter authentication"), the recipe is:

1. Build a **canonical request** — a deterministic string representation of
   the request (method, path, query params, headers, payload hash).
2. Hash it (`SHA-256`).
3. Wrap it in a **string to sign** with the date, region, and service.
4. Derive a **signing key** by HMAC-chaining your secret access key through
   date → region → service → `"aws4_request"`.
5. HMAC-sign the string-to-sign with the signing key.
6. Stick the signature into the URL as `X-Amz-Signature`.

That's it. Web Crypto exposes both `SHA-256` and HMAC, so a Worker can do all
of this natively.

## The actual code

The version that runs in production:

```ts
const toHex = (buffer: ArrayBuffer | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const sha256Hex = async (value: string): Promise<string> => {
  const data = new TextEncoder().encode(value)
  return toHex(await crypto.subtle.digest('SHA-256', data))
}

const hmacSha256 = async (key: Uint8Array, value: string): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value))
  return new Uint8Array(sig)
}

const asUtcDateParts = (date: Date) => {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0')
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = date.getUTCDate().toString().padStart(2, '0')
  const hh = date.getUTCHours().toString().padStart(2, '0')
  const mi = date.getUTCMinutes().toString().padStart(2, '0')
  const ss = date.getUTCSeconds().toString().padStart(2, '0')
  return {
    dateStamp: `${yyyy}${mm}${dd}`,
    amzDate: `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`,
  }
}

export const buildR2SignedUrl = async (
  env: { R2_ACCOUNT_ID: string; R2_BUCKET: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string },
  method: 'GET' | 'PUT',
  objectKey: string,
  expiresInSec: number,
) => {
  const now = new Date()
  const { dateStamp, amzDate } = asUtcDateParts(now)
  const region = 'auto'
  const service = 's3'
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

  // Path-style addressing — encode each segment, leave slashes alone
  const encodedKey = objectKey.split('/').map((s) => encodeURIComponent(s)).join('/')
  const canonicalUri = `/${env.R2_BUCKET}/${encodedKey}`

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`

  const baseParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${env.R2_ACCESS_KEY_ID}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSec),
    'X-Amz-SignedHeaders': 'host',
  })

  // Canonical query string: sorted by key, then encoded
  const canonicalQuery = [...baseParams.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,    // canonical headers (note trailing newline)
    'host',              // signed headers list
    'UNSIGNED-PAYLOAD',  // payload hash placeholder for pre-signed URLs
  ].join('\n')

  const canonicalRequestHash = await sha256Hex(canonicalRequest)

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join('\n')

  // Derive the signing key by HMAC-chaining
  const kDate    = await hmacSha256(new TextEncoder().encode(`AWS4${env.R2_SECRET_ACCESS_KEY}`), dateStamp)
  const kRegion  = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  const kSigning = await hmacSha256(kService, 'aws4_request')

  const signature = toHex(await hmacSha256(kSigning, stringToSign))

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}
```

That's the whole thing. Bundle cost: **a few hundred bytes**.

## Gotchas I hit

A few things that took longer than they should have:

### 1. The trailing newline on the canonical headers

Look at this line carefully:

```ts
`host:${host}\n`,    // canonical headers (note trailing newline)
```

The canonical headers section is supposed to end with a newline *before* the
empty line that separates it from the signed-headers list. Miss the `\n` and
R2 returns:

```
HTTP/1.1 403 Forbidden
Content-Length: 0
```

No body, no error code, no hint. I bisected my way to the missing newline by
diffing against a known-good URL from the AWS SDK.

### 2. `region: 'auto'` and not `'us-east-1'`

R2 uses `auto` as its region string. Most S3 SigV4 examples use `us-east-1`.
Wrong region → another silent 403.

### 3. Path-style addressing vs virtual-hosted-style

For R2, the canonical URI is `/<bucket>/<key>`, with the host being
`<account_id>.r2.cloudflarestorage.com`. If you used virtual-hosted-style
(bucket as a subdomain) you'd put just `/<key>` in the canonical URI and the
bucket in the host. Pick one and be consistent — mixing them returns 403.

### 4. URL encoding the key path segments individually

```ts
const encodedKey = objectKey.split('/').map((s) => encodeURIComponent(s)).join('/')
```

You want each path segment encoded, but the slashes between them preserved.
`encodeURIComponent` on the whole key would also encode the slashes, breaking
the path.

### 5. `UNSIGNED-PAYLOAD` for pre-signed URLs

Pre-signed URLs use the literal string `UNSIGNED-PAYLOAD` as the payload hash
in the canonical request. This trips people up because regular SigV4
(non-pre-signed) requires the actual SHA-256 of the body.

## When to use this

Use this approach if:

- You're on Cloudflare Workers, Deno, Bun, or anywhere with `crypto.subtle`
- Your bundle size matters (Workers free tier, edge functions)
- You only need pre-signed `GET` and `PUT` URLs

**Don't** use this if you need:

- **Multipart upload** — that's its own SigV4 flow with multiple signatures
- **Server-mediated requests** (not pre-signed) — those need the payload
  hash and signed Content-Type header
- **Conditional requests, encryption headers, or anything beyond the basic
  GET/PUT flow** — at that point, the SDK weight starts paying for itself

## When to use the SDK instead

If you're on Node and bundle size doesn't matter, just use
`@aws-sdk/s3-request-presigner`. It's well-tested, handles every edge case,
and is the right call for ~95% of S3-touching projects.

This 50-line approach is for the 5% where you *can't* afford the SDK and you
only need one operation.

---

If you want to see this in production, the full implementation lives in
[the photography-platform repo](https://github.com/gvvskvarma/rajugari-abbayi-photos) —
specifically [`worker/src/lib.ts`](https://github.com/gvvskvarma/rajugari-abbayi-photos/blob/main/worker/src/lib.ts)
in the `R2 / Signed URLs` section. The README explains the broader context
(it's a photo delivery platform I built for my own freelance photography
business — clients upload via the worker, share-link viewers download via
the same signed-URL mechanism).

---

*Vishnu Varma — software engineer + freelance photographer.
[Portfolio](https://gvvskvarma.github.io/vishnu-portfolio/) ·
[Live photography platform](https://rajugariabbayishots.vercel.app)*
