# Tavaranpaikka: plan

Status: plan for review. No code yet. Written 2026-11-19.

Tavaranpaikka ("the item's place") helps a parish find things in its storerooms and keep track of what is running out. Every item and every storage place gets a short ID code printed as a QR label. Scanning a label opens a phone page that shows what the thing is and, on a photo of the storeroom, a pointer to where it belongs. Anyone signed in can report an item as depleted or broken, and the people responsible are told.

## 1. Goals and non-goals

Goals

- Issue unique ID codes for items and for storage places, and print them as QR labels.
- Show each storeroom as an image with a pointer (pin) marking the place of an item.
- Let a person scan a code and report "depleted", "broken" or "other problem", and notify the responsible people.
- Work well on a phone, first. Finnish UI first, Swedish and English later.
- Run as one more riksunsrk app: Docker image, shared Postgres, MinIO for images, Traefik, Prometheus.
- Sign in with Tunnus (our own OIDC provider). No Microsoft/Entra login.

Non-goals for v1

- Full inventory or stock accounting, purchasing, loans/check-out, barcodes of third parties.
- Member data of any kind. The app holds items and staff/volunteer sign-ins only.
- Native mobile apps. A responsive web app (installable as a PWA) is enough.

## 2. Concepts and data model

```
Storeroom (has an image)
  └─ Place (a shelf, cupboard, box; has a pin on the storeroom image)
       └─ Item (what is stored there)
```

A storeroom may be a whole room, a cupboard or a trailer: anything one photo can show. Places can be nested one level (shelf unit > shelf) through `parent_place_id`; the pin of a child falls back to its parent's pin if it has none.

PostgreSQL tables (names indicative, migrations numbered `001_` onward, idempotent like the other apps):

| Table | Main columns |
|---|---|
| `organizations` | `id`, `slug`, `name`. One row per parish or unit; single-tenant installs have one. Keeps a later multi-parish use open without a rewrite. |
| `storerooms` | `id`, `organization_id`, `name`, `description`, `image_key` (object key), `image_width`, `image_height`, `responsible_group` |
| `places` | `id`, `storeroom_id`, `parent_place_id`, `name`, `description`, `pin_x`, `pin_y` (0..1, relative to image), `pin_label` |
| `items` | `id`, `organization_id`, `place_id`, `name`, `description`, `category`, `quantity_note` (free text such as "about 40"), `photo_key`, `status` (`ok`, `low`, `depleted`, `broken`, `retired`), `responsible_group` |
| `codes` | `code` (PK), `kind` (`item`/`place`/`storeroom`), `target_id`, `created_at`, `printed_at`, `voided_at` |
| `reports` | `id`, `item_id`, `kind` (`depleted`/`broken`/`other`), `note`, `photo_key`, `reporter_sub`, `reporter_name`, `status` (`open`/`acknowledged`/`resolved`/`dismissed`), `created_at`, `resolved_at`, `resolved_by_sub` |
| `report_votes` | `report_id`, `user_sub`, `created_at` ("me too", so duplicates are counted, not re-sent) |
| `notifications` | `id`, `report_id`, `channel`, `recipient_ref`, `state`, `attempts`, `sent_at`. Outbox that the mail worker drains. |
| `users` | `sub` (Tunnus subject), `display_name`, `email`, `last_seen_at`. Cache filled at sign-in. |
| `memberships` | `user_sub`, `organization_id`, `role`, `source` (`oidc`/`manual`) |
| `audit_events` | actor, action, target, scrubbed payload (same approach as liturgos-servus: redact names, emails, free text) |
| `item_history` | item id, from/to place, status changes, who and when. Lets us answer "where was it before". |

Rules

- Codes are never reused. A destroyed label voids the code and a new code is issued.
- Deleting a storeroom, place or item is a soft delete (`archived_at`); history stays. Real deletion happens in cleanup (section 9).
- Items may point to no place ("unplaced"). The scan page then asks the keeper to place it.

## 3. ID codes and QR

Code format: 8 characters of Crockford base32 (no `I`, `L`, `O`, `U`) plus one check character, written in groups, for example `K7M2-QX4D-9`. About 40 bits, randomly generated, collision-checked in the database. Random rather than sequential, so the codes cannot be guessed or enumerated and the printed number tells nothing about the stock size. The human-readable form is printed under the QR so a label can still be typed in when the camera cannot read it.

The QR encodes a URL, not the bare code: `https://<host>/c/<code>` (one route for all kinds, the server knows what the code points to). A phone's own camera app opens the page without installing anything. The URL is short, so QR version 2-3 with error-correction level M is enough and prints small and sturdily.

Printing

- Server-side QR generation (npm `qrcode`, SVG output). Labels are made as a PDF (`pdfkit`) in a few layouts: A4 sticker sheets (for example 3x8 and 5x13) and a roll/label-printer size. Each label shows the QR, the code, the name and, for items, the place name.
- "Print labels" works from a selection: choose items or places, or "all not yet printed". Sets `printed_at`.
- Label text sizes are chosen so a label is readable at arm's length in a dim storeroom.
- A place label can also be a poster on the storeroom door: opening it shows the storeroom image with all pins.

Scan behaviour (`/c/<code>`)

- Unknown or voided code: a friendly page, no data revealed.
- Item code: item name, photo, status, quantity note, and the **storeroom image with the pointer on its place**. Buttons "Mark depleted", "Mark broken", "Other problem". Keepers also see "Move", "Edit", "Resolve".
- Place code: place name, the storeroom image with the pointer, and the list of items in that place.
- Not signed in: redirected to Tunnus sign-in and back to the same URL.

## 4. Storeroom image and pointer

- A storeroom image is uploaded by a keeper (JPEG/PNG/WebP, up to about 15 MB). The server validates the type by content, strips EXIF (location data), rotates by orientation, and stores an original-bounded copy (max 2400 px) and a 1000 px display copy using `sharp`.
- The pin position is stored as relative coordinates (`x`,`y` between 0 and 1), so it stays correct at any display size and after the image is replaced by one of the same framing.
- Placing a pin: the keeper opens the place, taps the image where it is, and can drag to adjust. Pinch-zoom for large images (a small pointer-events implementation, no heavy library).
- Display: SVG overlay on the image, a pulsing marker with a short label, and an arrow if the pin is outside the visible zoomed area. The overlay is an accessible element too: the place name and "shelf 2 from the top" style description (`pin_label`) are always shown as text beside the image, so it works for screen readers and poor connections.
- Replacing the image: a keeper uploads a new image and the app offers to keep or re-place the pins. Old images are kept until cleanup so history is not broken.
- Images are not public. They are served through the app with an authorization check, or through short-lived presigned MinIO URLs issued after the check.
- Photo guidance in the UI: photograph shelves, not people. No face detection in v1, but the privacy notice and upload page say so (section 8).

## 5. Reporting depleted or broken

Flow

1. Scan the label (or search by name). On the item page tap "Depleted" or "Broken".
2. Optional note (500 chars) and optional photo (broken items benefit from one). One tap suffices for "depleted": the note is optional.
3. The report is created `open`. The item status changes to `depleted` or `broken` automatically.
4. If an open report of the same kind exists for the item, the new tap only adds a "me too" vote and an optional note. People are not spammed and the keepers see how many noticed.
5. Notification goes to the responsible people (section 6).
6. A keeper acknowledges ("I'll buy it", "ordered"), later resolves ("restocked", "repaired", "retired") or dismisses. Resolving puts the item status back to `ok` (or `retired`), and the reporter sees the state on the item page.

Details

- Idempotence and abuse: one report per user, item and kind per open report; rate limit per user (for example 20 reports/hour); note text length limits and HTML escaping.
- Reporter identity: stored as `sub` plus display name. Keepers see who reported (a practical need: "ask her what exactly broke"), the public item page does not.
- A "Reports" inbox for keepers: filter by storeroom, kind, status; bulk acknowledge; export CSV for a shopping list (depleted items grouped by storeroom).
- Anonymous reporting is not offered in v1 (see open questions): everything requires a Tunnus sign-in, which keeps accountability and abuse under control.

## 6. Notification delivery

Channels

- **In-app inbox** (always): the report list for keepers, with an unread badge.
- **Email** (main push channel): sent through the same pattern as Tunnus, with a provider switch `MAIL_PROVIDER=console|smtp|brevo`, so we use Brevo in production and the console in development. The message includes item name, place, kind, note, reporter display name, and a deep link to the report. Optional Brevo templates by id (`BREVO_TEMPLATE_REPORT_ID`, `_FI/_SV/_EN`), with plain-text fallback exactly as Tunnus does it, so a template problem never loses a report.
- **Digest**: per recipient, either "immediately" or "once a day at 8:00" (a shopping-list style summary). Default: immediate for `broken`, digest for `depleted`. Preference stored per membership.
- Later, if wanted: a generic webhook (Teams is out, because no Microsoft integration; Matrix/Slack/ntfy would be possible), and web push for installed PWAs.

Recipients

- Each storeroom (and optionally item or category) has a `responsible_group`, a Tunnus group claim value such as `/parish/riihimaki/kappeli-varasto`, and/or explicit extra email addresses for people who do not sign in (for example a caretaker's work address). Resolution order: item, then place, then storeroom, then organization default.
- Group members are known only after they have signed in once (Tunnus gives `groups` at sign-in). For group-based routing we use the cached `users` + `memberships` rows. Notifying people who never signed in is done through the explicit address list.

Reliability

- Transactional outbox: the report and its `notifications` rows are written in one transaction. A worker (in-process interval, one per instance using `FOR UPDATE SKIP LOCKED`) sends, retries with backoff and records the result. Failed mail never blocks the reporter.
- Metrics: reports created, notifications sent/failed, outbox age.

## 7. Authentication and authorization

- **Tunnus OIDC client** using `openid-client`, authorization code + PKCE, scopes `openid profile email groups`. A client entry is added to Tunnus's `CLIENTS_FILE` (`first_party: true`, `always_include_groups: true`, redirect URI `https://<host>/auth/callback`, post-logout URI). Environment names follow the liturgos-servus convention (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, ...) so one mental model fits all parish apps.
- Session: server-side session in a signed httpOnly, SameSite=Lax cookie; session lifetime shorter than the refresh horizon (e.g. 14 days, sliding); CSRF protection by an origin check plus a per-session token for state-changing requests (done from the start, unlike the gap noted for liturgos-servus).
- Roles (stored in `memberships`, derived from groups when the group is mapped, otherwise assigned manually by an admin):

| Role | Can |
|---|---|
| `member` (any signed-in user of the organization) | View, scan, report, "me too", search |
| `keeper` | + create/edit items, places, storerooms, images and pins; print labels; acknowledge and resolve reports |
| `admin` | + manage memberships, group mapping, notification settings, retire codes, view audit log |

- Group mapping: `OIDC_GROUP_ROLE_MAP` (JSON), for example `{"/parish/riihimaki": "member", "/parish/riihimaki/tavaranpaikka-keeper": "keeper"}`. Only rows with `source='oidc'` are removed when a group goes away; manual rows stay (same rule as the Vuorot OIDC work).
- Break-glass: a short list of local admin emails/tokens usable when Tunnus is down (Tunnus's own docs ask clients to keep one). Off by default in production unless configured, and every use is audited.
- No Microsoft/Entra or M365 login; evl.fi addresses are verified by Tunnus's emailed code.
- A later phase can place the app behind the "Pyhä pakki" portal; nothing here prevents that, because the app only needs the Tunnus session.

## 8. Data protection

This app holds little personal data, which is the design goal. Based on the church data-protection guidance for our applications:

| Data | Why | Basis (to be confirmed with the parish's data protection officer) | Retention |
|---|---|---|---|
| Tunnus `sub`, display name, email, group list | Sign in, show who reported, route notifications | Legitimate interests / performance of the volunteer or staff role | While the account exists; removed when the account is deleted or has been inactive (see below) |
| Report text, photos, reporter name | Do the work: restock and repair | Legitimate interests | Resolved reports: reporter name replaced by "removed user" after 12 months, report text deleted after 24 months |
| Item data, storeroom images | Operation of the service | Not personal data in itself | Kept while in use; archived items removed after 24 months |
| Audit events | Security and accountability | Legitimate interests | 365 days, IP removed after 30 days (same as Tunnus/Vuorot) |

Principles applied

- **Not special-category data by design.** The app has no member register, no baptism, confirmation or pastoral data, and nothing that reveals religious affiliation. Item names and notes are free text, so the entry form says "do not write about people here" and the report note is for the item only. Being a volunteer in a parish is itself sensitive-adjacent, so the user list is only visible to admins, and group names stay out of public pages.
- **Minimisation.** No phone numbers, no addresses, no birth dates, no location tracking of users. The scan page does not ask for the device location. Only `sub`, name and email are cached; email is used only to send notifications the user is entitled to receive.
- **Images.** EXIF is stripped on upload (it can contain GPS and device data). Upload guidance and the privacy notice say that people should not be photographed; photos are only shown to signed-in users; report photos are deleted with the report. A DPIA is not expected to be needed for this scope; if photos of people or events are ever accepted, reassess first.
- **Transparency.** `/privacy` page (controller: Riihimäen seurakunta, contact, processors, retention table above), with the same structure as Tunnus's privacy notice; linked in the footer and on the first sign-in.
- **Rights.** An admin tool and CLI action to export everything about one `sub` (reports, votes, audit rows) and to erase or anonymise it. The reporter name in reports is denormalised on purpose so anonymising is a single update.
- **Processors.** Brevo (email sending, in the EU; DPA needed), the hosting provider, and Tunnus (same controller). List them in the notice via a `PROCESSORS` setting like Tunnus.
- **Security.** TLS via Traefik, secrets in `infra`'s sops-managed store, database and bucket accessible only on the internal networks, images not publicly listable, audit log scrubbing before storage, rate limits on sign-in-dependent and report endpoints.

## 9. Architecture and technology

- Node.js 24, ESM only, JSDoc-typed JavaScript with `tsc --noEmit` (the house style in liturgos-servus and Tunnus). npm workspaces are not needed: `server/` and `client/`.
- Backend: Express 5, `pg`, `pino`, `prom-client`, `openid-client`, `sharp`, `qrcode`, `pdfkit`, `@aws-sdk/client-s3` (`forcePathStyle: true`), `nodemailer` and the Brevo HTTP client behind one mail-provider interface. Validation with a small shared validators module (like liturgos-servus) or `zod`.
- Frontend: React 19 + React Router + Vite, mobile-first, CSS Modules. Installable PWA (manifest + a minimal service worker that caches the shell, not data). Camera scanning inside the app is optional (`BarcodeDetector` where available, fallback to the native camera app opening the URL), because the URL-in-QR already works with the phone camera.
- Storage abstraction: `STORAGE_DRIVER=local|s3` as in `crowd-source-voice`, so routes never touch `fs`. Local disk for development and tests, MinIO (`tavaranpaikka-storage` bucket) in production.
- Background work in one process: mail outbox worker and the daily cleanup job (disable-able with `CLEANUP_DISABLED=true` for an external run, as in Tunnus).
- API: JSON REST under `/api`, described in `openapi.yaml` (the contract comes first, so tests and any later CLI/MCP can be generated from it). Main routes:

```
GET  /c/:code                         scan landing (SPA route; also /api/codes/:code resolves it)
GET  /api/storerooms, /api/storerooms/:id
POST/PUT/DELETE /api/storerooms[/:id], POST /api/storerooms/:id/image
POST/PUT/DELETE /api/places[/:id]     (pin_x, pin_y)
GET  /api/items?q=&place=&status=     POST/PUT/DELETE /api/items[/:id], POST /api/items/:id/move
POST /api/items/:id/reports           {kind, note, photo?}
GET  /api/reports?status=             POST /api/reports/:id/ack|resolve|dismiss|vote
POST /api/labels/pdf                  {ids|filter, layout}  -> application/pdf
GET  /api/me, /api/memberships, /api/settings/notifications
GET  /health  /metrics (bearer)  /privacy
```

- Search: PostgreSQL `pg_trgm` + `unaccent` on item and place names (Finnish: ä/ö must match "a"/"o" for people typing quickly).
- Testing: Vitest (server unit + client), integration tests against a real PostgreSQL (the cloud pattern from liturgos-servus), Playwright E2E for the scan > report > acknowledge flow with a Tunnus test client or a stubbed OIDC provider. CI also runs `typecheck` and lint.

## 10. Deployment (riksunsrk conventions)

Follows the `riksunsrk-deploy` checklist:

1. **Image**: `Dockerfile` (node:24, non-root user, container healthcheck on `/health`), CI builds and pushes `ghcr.io/jsilvanus/tavaranpaikka` with tags on `main` and `vX.Y.Z`, with provenance/SBOM, and calls a deploy webhook on version tags (same `publish-image` workflow shape as Tunnus). Pin versions in production.
2. **Postgres**: `DATABASE_URL` to `pg.shared.local:5432`, role `tavaranpaikka_user`, database `tavaranpaikka_db`, created with infra's `add-app.sh`. Migrations run at start; backups follow infra's `pg_dump` schedule.
3. **Storage**: bucket `tavaranpaikka-storage` and a scoped IAM user from `add-app-storage.sh`; `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
4. **Compose (deploy side)**: external networks `traefik-public` and `shared_multi_network`; no host port; Traefik labels (`Host(...)`, `websecure`, `letsencrypt`, service port 3000); healthcheck; `.env` from the repo's GitHub Actions secrets.
5. **Metrics**: `/metrics` behind `METRICS_BEARER_TOKEN`, with `METRICS_TOKEN_TAVARANPAIKKA` in infra's secrets, a Prometheus job and a Grafana dashboard (reports by kind/status, outbox lag, mail errors, request latency, image-processing time).
6. **Tunnus**: add the client entry to `CLIENTS_FILE`, set `OIDC_*` in the app's env. Redirect URI exact-match.
7. **Host name**: to be chosen (see questions). Start on the dev domain, like Tunnus at `kehitys.riihimaenseurakunta.fi`, and move later.
8. **Verify** with infra's checklist: `curl -I` routing and TLS, database exists, Prometheus target up, a real label scanned with a real phone.

Key settings (all in `.env.example`): `BASE_URL`, `DATABASE_URL`, `SESSION_SECRET`, `OIDC_*`, `OIDC_GROUP_ROLE_MAP`, `STORAGE_DRIVER`, `S3_*`, `MAIL_PROVIDER`, `MAIL_FROM`, `BREVO_API_KEY`, `BREVO_TEMPLATE_REPORT_ID[_FI|_SV|_EN]`, `CONTROLLER_NAME`, `CONTROLLER_CONTACT`, `PROCESSORS`, `METRICS_BEARER_TOKEN`, `CLEANUP_*`, `REPORT_RETENTION_DAYS`, `BREAK_GLASS_ADMINS`.

## 11. Phases (for Haiku implementation, reviewed by Opus)

Each phase ends with passing tests, `typecheck` and lint, and is one PR. A phase lists what must be true afterwards; implementation detail stays in the PR.

| Phase | Result | Can run in parallel with |
|---|---|---|
| **0. Scaffold** | Repo layout, `package.json` (ESM, Node 24), Express app with `/health`, config validation, Pino, Vitest, ESLint, `tsc`, Dockerfile, GitHub Actions CI, `.env.example`, migrations runner | none |
| **1. Core data + auth** | Migrations for organizations, storerooms, places, items, codes, memberships, users; OIDC sign-in with Tunnus; sessions, CSRF, roles; group mapping; CRUD APIs with authorization tests; `openapi.yaml` | UI shell (SPA, routing, sign-in page) |
| **2. Codes, QR, labels** | Code generator with check char and collision handling; `/c/:code` resolution; QR SVG; label PDF layouts; `printed_at`; void/reissue | Phase 3 |
| **3. Images and pins** | Storage abstraction (local + S3); upload pipeline (type check, EXIF strip, resize); pin placement UI; pinch-zoom display; scan pages with the pointer | Phase 2 |
| **4. Reports and notifications** | Reports + votes, status flows, keeper inbox, outbox worker, mail provider interface (console, SMTP, Brevo + templates), digest, retries | none (needs 1) |
| **5. Privacy, ops, hardening** | `/privacy`, retention cleanup job, data export/erase tool, audit with scrubbing, rate limits, metrics, break-glass, PWA manifest, Playwright E2E, accessibility pass, load check with a few thousand items | none |
| **6. Deploy** | infra provisioning (DB, bucket, metrics token), compose + Traefik labels, Tunnus client entry, dev-domain rollout, label pilot in one real storeroom | none |
| **Later** | CSV/bulk import of existing item lists, low-stock thresholds and quantities, stock counts, item history view, swedish/english UI, web push, webhook channel, connecting to Pyhä pakki | |

Estimate: phases 0-4 are the usable core; the pilot can start after phase 4 on the dev domain while phases 5-6 harden it.

## 12. Risks

- **Labels peel or fade**: choose polyester/laminated labels for damp or cold storerooms; reissue flow is cheap, codes stay valid after reprint because they are looked up, not computed.
- **Stale pins** after moving shelves: the keeper inbox shows items "not verified in 12 months"; a keeper can mark "verified" when passing.
- **Nobody receives the notification**: `responsible_group` empty or all recipients inactive. Admins get a fallback copy, and the settings page warns about storerooms without a recipient.
- **Tunnus outage** blocks reporting: break-glass for admins only; reporters just try again later. The outbox keeps a report even if mail fails.
- **Photos of people** end up in storeroom images: guidance, signed-in-only access, and removal on request.
- **Scope creep into inventory management**: keep `quantity_note` as free text until real use shows a need for counts.

## 13. Open questions for Juha

1. **Who may report?** Plan assumes only signed-in Tunnus users. Do volunteers who have no Tunnus account (visitors, camp helpers) need an anonymous "report problem" form behind a rate limit?
2. **Organization model**: one parish only (Riihimäki) for now, or several parishes from the start (the schema allows it)?
3. **Who are the recipients?** A Tunnus group per storeroom, or one central caretaker list at first?
4. **Language**: Finnish only at launch, or also Swedish and English?
5. **Host name**: for example `tavaranpaikka.riihimaenseurakunta.fi` or a path under the Pyhä pakki portal; the church DNS is slow to change, so a path or the dev domain is faster.
6. **Label hardware**: A4 sticker sheets (plan default) or a label printer such as a Brother/Dymo roll?
7. **Repository owner and image name**: this plan assumes `jsilvanus/tavaranpaikka` and `ghcr.io/jsilvanus/tavaranpaikka`. Should it live under `riksunsrk` like the other deployed parish apps?
8. **Data protection officer review** of the privacy notice and the retention table before go-live.
