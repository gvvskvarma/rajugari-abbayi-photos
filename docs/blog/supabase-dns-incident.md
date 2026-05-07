# The DNS incident that took down my Supabase project for an afternoon

> A debugging story about why "Healthy" in a dashboard is not the same as
> "reachable on the public internet."

---

I shipped a clean refactor on a Friday afternoon. CI passed. Local tests
green. Worker deployed. Frontend deployed. I clicked through the app and
hit a 500 on every Supabase-backed endpoint.

This is the story of the next two hours.

## The first wrong assumption

When the API starts throwing 500s right after a refactor, the obvious
suspect is the refactor. So I did the obvious thing: rolled back the worker,
hit `/api/v1/live-config` again, still 500. Rolled back the frontend,
still 500.

The worker logs showed:

```json
{"error":{"message":"Supabase request failed (530): error code: 1016"}}
```

`530` is Cloudflare's "origin not reachable." `1016` is the specific
sub-code for **Origin DNS Error** — Cloudflare's edge could not resolve the
upstream hostname. The hostname in question was the one I'd been using for
months:

```
ogcafgdhchzheennyzva.supabase.co
```

The bug wasn't in my code. The hostname itself wasn't resolving.

## Confirming it wasn't just the worker

The first thing I did was open the Supabase URL directly in a browser:

```
https://ogcafgdhchzheennyzva.supabase.co/rest/v1/
```

Chrome incognito returned `DNS_PROBE_FINISHED_NXDOMAIN`. So this wasn't
specific to Cloudflare's resolver — the public internet didn't think this
hostname existed.

Except... my **regular Chrome window worked.** The site loaded. Logged-in
sessions still functioned.

That looked like a contradiction. It wasn't. It was DNS caching. Chrome
incognito doesn't share DNS cache with the main profile. The main profile
had a stale-but-still-working A record from an earlier session.

So the real state was:

- **Supabase dashboard:** project shows "Healthy"
- **Public DNS:** hostname returns NXDOMAIN/SERVFAIL
- **Workers, incognito browsers, fresh resolvers:** can't connect
- **Cached browsers:** still work, until the cache TTL expires

The dashboard "Healthy" status reflects the project's *internal* services
(database, auth, etc.). It doesn't tell you whether DNS is propagating to
the public internet. That's a real distinction worth knowing.

## Going deeper with `dig`

I went straight to `dig`:

```bash
$ dig ogcafgdhchzheennyzva.supabase.co +short
$ dig @8.8.8.8 ogcafgdhchzheennyzva.supabase.co
;; ->>HEADER<<- opcode: QUERY, status: SERVFAIL, id: 54364
```

Empty answer. SERVFAIL from Google's resolver. SERVFAIL from Cloudflare's
1.1.1.1 too.

`SERVFAIL` is interesting because it's *not* `NXDOMAIN`. NXDOMAIN means
"this name definitely doesn't exist." SERVFAIL means "I tried to look it up
and got an error somewhere." Different failure modes. Mine was the second.

So I traced the delegation chain:

```bash
$ dig +trace ogcafgdhchzheennyzva.supabase.co A
```

The trace stopped after the root servers. The `.co` TLD delegation never
completed. I tried a known-good `.co` domain — same result. I tried
`google.co` from my network — also no resolution.

That was the "huh" moment. **The entire `.co` TLD was failing to resolve
from where I was.** Not Supabase's project, not my network — something
broader. Probably a TLD-level routing issue or a ISP-side resolver hiccup
that was rolling through.

## Talking to support

By the time I'd worked through this much, I opened a Supabase support
ticket with what I had:

- Project ref (no vanity subdomain)
- The exact hostname
- `dig` outputs from local resolver, 8.8.8.8, and 1.1.1.1, all SERVFAIL
- Traceroute showing `.co` delegation failing
- The fact that the Supabase dashboard still showed "Healthy"

Support's response was reasonable: SERVFAIL across multiple resolvers points
to something upstream, possibly the authoritative chain for that hostname.
They asked me to confirm I hadn't ever set up a vanity subdomain (I hadn't),
and to send `dig +trace` output.

While I was assembling that, I noticed something on a `curl` retry:

```bash
$ curl -s "https://photography-api.gvvskvarma-account.workers.dev/api/v1/live-config"
{"config":{"title":"Akhil Namburi & Bindu Challa's wedding...
```

It worked. For exactly one request. Then the next one was back to 530/1016.

DNS was flickering back. The records were starting to propagate. Within
another half hour they'd stabilized. The app came back up on its own.

## What it actually was

The honest answer: I don't fully know. The most likely cause is a transient
DNS routing issue at either the `.co` TLD level or a specific intermediate
resolver chain that affected my region. It self-resolved before Supabase
support got far enough to tell me anything definitive.

But the *experience* taught me a few things that stuck.

## What I'd do differently

A few real takeaways I keep thinking about:

**"Healthy" in a dashboard tells you about the service, not about
reachability.** A status page can be all green while the public internet
can't find your hostname. If your monitoring depends only on the provider's
status, you have a blind spot. I now hit my actual prod URL from an
external uptime check, not just the provider's dashboard.

**Reading `dig +trace` is a real skill, not a curiosity.** SERVFAIL vs
NXDOMAIN is a meaningful distinction when something's broken. So is
"delegation chain stops at the TLD" vs "stops at the authoritative
nameserver." A debugger who can't read DNS output can lose hours guessing.

**Browser DNS cache will lie to you.** If your prod site "still works for
me" but is broken in incognito and broken from the worker, the difference is
almost always cache. Test in fresh contexts before assuming things are fine.

**Multi-resolver checks are worth their weight.** `dig` from local, then
`@8.8.8.8`, then `@1.1.1.1`. If all three SERVFAIL, the problem isn't your
ISP. Knowing that fast saves you from chasing a non-existent local config
issue.

**Edge workers fail differently than browser fetches.** Cloudflare's
origin-DNS error code (1016) is a specific signal. If you're running on
edge infra, learn the [Cloudflare error reference](https://developers.cloudflare.com/support/troubleshooting/cloudflare-errors/troubleshooting-cloudflare-5xx-errors/)
once — when the next 530 lands you'll save half an hour just by knowing
where to look.

The whole thing was, ultimately, a non-event. The platform was down for an
afternoon. No clients tried to log in during that window. No data was lost.

But it was the kind of incident where you spend two hours in `dig` output
and come out the other side with a slightly clearer mental model of how DNS
actually works in production. Which is most of why I'm writing it down.

---

The platform in question is the photography delivery system I built for my
own freelance photography business — Cloudflare Workers + R2 + Supabase.
Code at [github.com/gvvskvarma/rajugari-abbayi-photos](https://github.com/gvvskvarma/rajugari-abbayi-photos),
running at [rajugariabbayishots.vercel.app](https://rajugariabbayishots.vercel.app).

---

*Vishnu Varma — software engineer + freelance photographer.
[Portfolio](https://gvvskvarma.github.io/vishnu-portfolio/) ·
[Live photography platform](https://rajugariabbayishots.vercel.app)*
