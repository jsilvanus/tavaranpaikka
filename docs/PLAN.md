# Tavaranpaikka: plan

Status: plan, revised 2026-11-19 after Juha's answers (section 0). No code yet.

Tavaranpaikka ("the item's place") helps a parish find things in its storerooms and keep track of what is running out. Every item and every storage place gets a short ID code printed as a QR label. Scanning a label opens a phone page that shows what the thing is and, on a photo of the storeroom, a pointer to where it belongs. Anyone who scans a label can report an item as depleted or broken, and the people responsible for that storage place are told.

## 0. Decisions (from Juha, 2026-11-19)

1. **Public scan pages.** Scanning a code opens a public page, no sign-in. People find the storage place on the storeroom image and can report depleted or broken from the same page. Sign-in (Tunnus) is for people who manage things.
2. **Two kinds of code, two behaviours.**
   - **Item QR** shows the storage place of that item (image with pointer).
   - **Storage-place QR** shows the place, a list of what should be here, and a report action for each entry on that list.
3. **Two ways to track.** A *tracked item* is an individual thing with its own code and its own place (a projector). An *item group* is a kind of thing that is not tracked individually, only its place is (pencils): it has no code of its own, it is an entry in the place's list.
4. **Reports are configured per storage place** (who is notified, which report kinds are offered, whether notes and photos are allowed).
5. **Multi-tenant-ready, one parish for the MVP.** Every table carries `organization_id` and every query is scoped by it from day one, but the MVP runs one parish with no tenant switching UI.
6. **Languages:** Finnish, Swedish and English eventually; **MVP is Finnish only**, with all text in message catalogues from the start so adding `sv` and `en` needs no code change.
7. **Labels:** A4 sticker sheets are the MVP (print at the office on any printer). A label printer is later, not MVP.
8. **Repository:** development happens in `jsilvanus/tavaranpaikka`. If a deploy stack lives in a repo under `riksunsrk` (compose, env), the app repo still owns the image and its build.

## 1. Goals and non-goals

Goals

- Issue unique ID codes for items and for storage places, and print them as QR labels.
- Show each storeroom as an image with a pointer (pin) marking the place of an item.
- Let anyone who scans a code report "depleted", "broken" or "other problem" without signing in, and notify the people responsible for that storage place.
- Track two things: individual items (own code and place) and item groups such as pencils (only the place is tracked).
- Work well on a phone, first. Finnish UI for the MVP; Swedish and English later through message catalogues.
- Run as one more riksunsrk app: Docker image, shared Postgres, MinIO for images, Traefik, Prometheus.
- Sign in with Tunnus (our own OIDC provider) for keepers and admins. No Microsoft/Entra login.

Non-goals for v1

- Full inventory or stock accounting, purchasing, loans/check-out, barcodes of third parties.
- Label-printer support (A4 sticker sheets only in the MVP).
- Multi-tenant administration screens (the data model is ready, the UI is not).
- Member data of any kind. The app holds items and staff/volunteer sign-ins only.
- Native mobile apps. A responsive web app (installable as a PWA) is enough.

## 2. Concepts and data model

```
Storeroom (has an image)
  └─ Place (a shelf, cupboard, box; has a pin on the storeroom image)
       ├─ Item         tracked individually, own code, lives in one place
       └─ Group entry  "should be here" list entry, not tracked individually (pencils)
```

A storeroom may be a whole room, a cupboard or a trailer: anything one photo can show. Places can be nested one level (shelf unit > shelf) through `parent_place_id`; the pin of a child falls back to its parent's pin if it has none.

**Tracked item vs. item group**

| | Tracked item | Item group |
|---|---|---|
| Example | The projector, the big coffee maker | Pencils, candles, paper cups |
| Own code/QR | Yes (item QR) | No |
| Has a place | Yes (exactly one; may be moved) | Yes, as an entry on the place's "should be here" list |
| Reported depleted/broken | From its own page or from the place page | From the place page |
| Quantity | Not needed | Optional free text ("about 40", "one box") |

A place's list ("what should be here") is made of both: tracked items currently in the place, and group entries. This is what the place QR page shows.

PostgreSQL tables (names indicative, migrations numbered `001_` onward, idempotent like the other apps). **Every table except `codes` and `users` carries `organization_id` and every query filters by it**; the MVP has one organization, selected by configuration (`DEFAULT_ORGANIZATION_SLUG`), and the request context carries the organization so that host- or path-based tenant resolution can be added later without touching queries. `codes` is global because a scanned URL must resolve before the tenant is known; it stores `organization_id` itself.

| Table | Main columns |
|---|---|
| `organizations` | `id`, `slug`, `name`, `default_locale`, `locales` (enabled UI languages) |
| `storerooms` | `id`, `organization_id`, `name`, `description`, `image_key`, `image_width`, `image_height` |
| `places` | `id`, `organization_id`, `storeroom_id`, `parent_place_id`, `name`, `description`, `pin_x`, `pin_y` (0..1, relative to image), `pin_label`, `report_config` (jsonb, see section 5) |
| `items` | `id`, `organization_id`, `place_id`, `name`, `description`, `category`, `photo_key`, `status` (`ok`, `depleted`, `broken`, `retired`) . Tracked items only. |
| `place_entries` | `id`, `organization_id`, `place_id`, `name`, `quantity_note`, `sort_order`, `status` (`ok`, `depleted`, `retired`). Item groups only (pencils). |
| `codes` | `code` (PK), `organization_id`, `kind` (`item`/`place`), `target_id`, `created_at`, `printed_at`, `voided_at` |
| `reports` | `id`, `organization_id`, `place_id`, `item_id` (nullable), `entry_id` (nullable), `kind` (`depleted`/`broken`/`other`), `note`, `photo_key`, `reporter_name` (optional free text), `reporter_sub` (set only if signed in), `reporter_hash` (rotating hash for rate limiting), `locale`, `status` (`open`/`acknowledged`/`resolved`/`dismissed`), `created_at`, `resolved_at`, `resolved_by_sub`. Exactly one of `item_id`/`entry_id` is set, or neither for a whole-place report. |
| `report_votes` | `report_id`, `voter_hash`, `created_at` ("me too", so duplicates are counted, not re-sent) |
| `notifications` | `id`, `organization_id`, `report_id`, `channel`, `recipient_ref`, `state`, `attempts`, `sent_at`. Outbox that the mail worker drains. |
| `users` | `sub` (Tunnus subject), `display_name`, `email`, `last_seen_at`. Cache filled at sign-in (keepers and admins only). |
| `memberships` | `user_sub`, `organization_id`, `role`, `source` (`oidc`/`manual`) |
| `audit_events` | actor, action, target, scrubbed payload (same approach as liturgos-servus) |
| `item_history` | item id, from/to place, status changes, who and when |

Rules

- Codes are never reused. A destroyed label voids the code and a new code is issued.
- Deleting a storeroom, place, item or entry is a soft delete (`archived_at`); history stays. Real deletion happens in cleanup (section 8).
- Tracked items may have no place ("unplaced"); the item page then says "place not set" and keepers are asked to fix it.
- Moving a group entry between places is a normal edit; the entry has no code to reprint.

## 3. ID codes and QR

Code format: 8 characters of Crockford base32 (no `I`, `L`, `O`, `U`) plus one check character, written in groups, for example `K7M2-QX4D-9`. About 40 bits, randomly generated, collision-checked in the database. Random rather than sequential, so the codes cannot be guessed or enumerated and the printed number tells nothing about the stock size. The human-readable form is printed under the QR so a label can still be typed in when the camera cannot read it.

The QR encodes a URL, not the bare code: `https://<host>/c/<code>` (one route for all kinds, the server knows what the code points to). A phone's own camera app opens the page without installing anything. The URL is short, so QR version 2-3 with error-correction level M is enough and prints small and sturdily.

Printing

- Server-side QR generation (npm `qrcode`, SVG output). Labels are made as a PDF (`pdfkit`) as **A4 sticker sheets** (for example 3x8 and 5x13) for the MVP: download, print on any office printer onto sticker paper. A label-printer layout (roll sizes) is a later addition behind the same generator. Each label shows the QR, the code, the name and, for items, the place name.
- "Print labels" works from a selection: choose items or places, or "all not yet printed". A start-position option lets a half-used sticker sheet be reused. Sets `printed_at`.
- Label text sizes are chosen so a label is readable at arm's length in a dim storeroom.
- A place label can also be a poster on the storeroom door: opening it shows the storeroom image with all pins.

Scan behaviour (`/c/<code>`, **public, no sign-in**)

- Unknown or voided code: a friendly page that reveals nothing.
- **Item code** (tracked item): item name, photo and status, and the **storeroom image with the pointer on the item's place**, plus the place name and the text description of the spot. Buttons "Mark depleted" and "Mark broken" (as the place configures, section 5). A link "See everything in this place" goes to the place page.
- **Place code**: place name, the storeroom image with the pointer, and the **"should be here" list** (tracked items and group entries). Every row has the report actions the place allows ("Depleted", "Broken"), and there is a general "Other problem with this place" action.
- Signed-in keepers see extra buttons on the same pages (edit, move, resolve) and are not asked to sign in unless they use them.
- Codes are unguessable (about 40 random bits) but not secret: they are printed on a wall. Public pages therefore show only operational data, never user names or notification recipients.
- Labels in the A4 MVP: item labels and place labels are made from the same sheet layouts. The place label is the one stuck on the shelf or door; an item label is stuck on the item (or its box).

## 4. Storeroom image and pointer

- A storeroom image is uploaded by a keeper (JPEG/PNG/WebP, up to about 15 MB). The server validates the type by content, strips EXIF (location data), rotates by orientation, and stores an original-bounded copy (max 2400 px) and a 1000 px display copy using `sharp`.
- The pin position is stored as relative coordinates (`x`,`y` between 0 and 1), so it stays correct at any display size and after the image is replaced by one of the same framing.
- Placing a pin: the keeper opens the place, taps the image where it is, and can drag to adjust. Pinch-zoom for large images (a small pointer-events implementation, no heavy library).
- Display: SVG overlay on the image, a pulsing marker with a short label, and an arrow if the pin is outside the visible zoomed area. The overlay is an accessible element too: the place name and "shelf 2 from the top" style description (`pin_label`) are always shown as text beside the image, so it works for screen readers and poor connections.
- Replacing the image: a keeper uploads a new image and the app offers to keep or re-place the pins. Old images are kept until cleanup so history is not broken.
- Storeroom images are shown on the public scan pages, so they are served by the app (or by short-lived presigned MinIO URLs the app issues) only for a valid, non-voided code's own storeroom, never as a browsable bucket. Because they are public, nothing in them may identify people (see section 8).
- Photo guidance in the UI: photograph shelves, not people. The upload page says so and the keeper confirms with a checkbox (section 8).

## 5. Reporting depleted or broken

Reporting is **public**: whoever scans the label can report, without signing in.

Flow

1. Scan the item or place label. On a place page tap "Depleted" or "Broken" on the row (a pencil group entry, a tracked item); on an item page tap the button there.
2. Optional note (500 chars), optional photo (if the place allows), optional name (free text, "Maija from the kitchen team"). One tap suffices for "depleted"; nothing is required.
3. The report is created `open` and the entry or item status changes (`depleted` or `broken`). The reporter sees a confirmation and the report's state if they return.
4. If an open report of the same kind exists for that item or entry, the new tap only adds a "me too" vote (and an optional note). People are not spammed and keepers see how many noticed.
5. Notification goes to the recipients configured for the place (section 6).
6. A keeper acknowledges ("I'll buy it"), later resolves ("restocked", "repaired", "retired") or dismisses. Resolving puts the status back to `ok` (or `retired`).

**Per-place report configuration** (`places.report_config`, edited by a keeper on the place; the value inherits from the storeroom, then the organization default, when a field is missing):

| Setting | Meaning |
|---|---|
| `kinds` | Which report kinds the place offers: any of `depleted`, `broken`, `other` |
| `recipients` | Tunnus groups and/or explicit email addresses to notify |
| `delivery` | Per kind: `immediate` or `daily_digest` |
| `allow_note`, `allow_photo`, `ask_name` | What the public form shows |
| `require_signin` | If true, reports need a Tunnus sign-in (for places where that is wanted) |
| `escalate_after_days` | Optional: re-notify if a report stays `open` this long |

Abuse and quality (needed because reporting is public)

- Rate limits per rotating reporter hash and per place (for example 10 reports/hour per hash, 30/hour per place); a hidden honeypot field; a short server-side time-to-submit check. No CAPTCHA in the MVP; add one only if abuse appears.
- Notes and names are length-limited and escaped; photos pass the same image pipeline as storeroom images (type check, EXIF stripped, size limit).
- Keepers can dismiss a report as spam and block a place from public reporting by setting `require_signin`.
- The reporter hash is a keyed hash of IP and user agent with a daily rotating key, so it cannot be traced back to a person after a day and no IP address is stored with the report.
- A keeper inbox with filters (storeroom, place, kind, status), bulk acknowledge, and a CSV export of depleted entries grouped by place or storeroom (a shopping list).

## 6. Notification delivery

Channels

- **In-app inbox** (always): the report list for keepers, with an unread badge. This works even when a place has no recipients, so nothing is lost.
- **Email** (main push channel): sent through the same pattern as Tunnus, with a provider switch `MAIL_PROVIDER=console|smtp|brevo`, so we use Brevo in production and the console in development. The message includes item name, place, kind, note, reporter display name, and a deep link to the report. Optional Brevo templates by id (`BREVO_TEMPLATE_REPORT_ID`, `_FI/_SV/_EN`), with plain-text fallback exactly as Tunnus does it, so a template problem never loses a report.
- **Digest**: per recipient, either "immediately" or "once a day at 8:00" (a shopping-list style summary). Default: immediate for `broken`, digest for `depleted`. Preference stored per membership.
- Later, if wanted: a generic webhook (Teams is out, because no Microsoft integration; Matrix/Slack/ntfy would be possible), and web push for installed PWAs.

Recipients

- Recipients come from the place's `report_config.recipients` (section 5): Tunnus group claim values such as `/parish/riihimaki/kappeli-varasto` and/or explicit email addresses for people who do not sign in (for example a caretaker's work address). Resolution order: place, then storeroom default, then organization default.
- Group members are known only after they have signed in once (Tunnus gives `groups` at sign-in). For group-based routing we use the cached `users` + `memberships` rows. Notifying people who never signed in is done through the explicit address list.

Reliability

- Transactional outbox: the report and its `notifications` rows are written in one transaction. A worker (in-process interval, one per instance using `FOR UPDATE SKIP LOCKED`) sends, retries with backoff and records the result. Failed mail never blocks the reporter.
- Metrics: reports created, notifications sent/failed, outbox age.
- Messages are sent in the organization's default locale in the MVP (Finnish). The report records the reporter's `locale` so notifications and Brevo templates can follow it later.

## 7. Authentication and authorization

- Scanning, viewing and reporting are public (sections 3 and 5). Sign-in with Tunnus is needed only to manage content and handle reports.
- **Tunnus OIDC client** using `openid-client`, authorization code + PKCE, scopes `openid profile email groups`. A client entry is added to Tunnus's `CLIENTS_FILE` (`first_party: true`, `always_include_groups: true`, redirect URI `https://<host>/auth/callback`, post-logout URI). Environment names follow the liturgos-servus convention (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, ...) so one mental model fits all parish apps.
- Session: server-side session in a signed httpOnly, SameSite=Lax cookie; session lifetime shorter than the refresh horizon (e.g. 14 days, sliding); CSRF protection by an origin check plus a per-session token for state-changing requests (done from the start, unlike the gap noted for liturgos-servus).
- Roles (stored in `memberships`, derived from groups when the group is mapped, otherwise assigned manually by an admin):

| Role | Can |
|---|---|
| `member` (signed-in user of the organization) | Everything public, plus the keeper inbox as read-only; useful for people who only follow reports |
| `keeper` | + create/edit items, places, storerooms, images and pins; print labels; acknowledge and resolve reports |
| `admin` | + manage memberships, group mapping, notification settings, retire codes, view audit log |

- Group mapping: `OIDC_GROUP_ROLE_MAP` (JSON), for example `{"/parish/riihimaki": "member", "/parish/riihimaki/tavaranpaikka-keeper": "keeper"}`. Only rows with `source='oidc'` are removed when a group goes away; manual rows stay (same rule as the Vuorot OIDC work).
- Break-glass: a short list of local admin emails/tokens usable when Tunnus is down (Tunnus's own docs ask clients to keep one). Off by default in production unless configured, and every use is audited.
- No Microsoft/Entra or M365 login; evl.fi addresses are verified by Tunnus's emailed code.
- A later phase can place the app behind the "Pyhä pakki" portal; nothing here prevents that, because the app only needs the Tunnus session.

## 8. Data protection

This app holds little personal data, which is the design goal. Because scanning and reporting are now public, the design avoids identifying the reporter at all unless they choose to give a name. Based on the church data-protection guidance for our applications:

| Data | Why | Basis (to be confirmed with the parish's data protection officer) | Retention |
|---|---|---|---|
| Tunnus `sub`, display name, email, group list (keepers/admins only) | Sign in, handle reports, route notifications | Legitimate interests / performance of the volunteer or staff role | While the account exists; removed when the account is deleted or has been inactive (see below) |
| Report text, photos, optional free-text reporter name (public reports store no IP address, only a daily-rotating hash that cannot be reversed) | Do the work: restock and repair | Legitimate interests | Reporter name removed 12 months after the report is resolved, report text and photos deleted after 24 months; the rotating hash is dropped after 7 days |
| Item data, storeroom images | Operation of the service | Not personal data in itself | Kept while in use; archived items removed after 24 months |
| Audit events | Security and accountability | Legitimate interests | 365 days, IP removed after 30 days (same as Tunnus/Vuorot) |

Principles applied

- **Not special-category data by design.** The app has no member register, no baptism, confirmation or pastoral data, and nothing that reveals religious affiliation. Item names and notes are free text, so the entry form says "do not write about people here" and the report note is for the item only. Being a volunteer in a parish is itself sensitive-adjacent, so the user list is only visible to admins, and group names stay out of public pages.
- **Minimisation.** No phone numbers, no addresses, no birth dates, no location tracking of users. The scan page does not ask for the device location. Only `sub`, name and email are cached; email is used only to send notifications the user is entitled to receive.
- **Images are public.** EXIF is stripped on upload (it can contain GPS and device data). The keeper upload form requires a checkbox "the image shows no people", and the privacy notice says so. Report photos from the public are shown only to keepers, never on the scan page, and are deleted with the report; the report form warns not to photograph people. A DPIA is not expected to be needed for this scope; if photos of people or events are ever accepted, reassess first.
- **Transparency.** A short privacy line on the report form ("your note is sent to the people who look after this storage place"), and a `/privacy` page (controller: Riihimäen seurakunta, contact, processors, retention table above), with the same structure as Tunnus's privacy notice; linked in the footer and on the first sign-in.
- **Rights.** An admin tool and CLI action to export everything about one `sub` (keepers: audit rows, memberships) and to erase it. A public reporter who gave a name can ask the parish to remove it; admins find reports by name and blank the field. The name is stored directly on the report on purpose, so that is a single update.
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
GET  /c/:code                         public scan landing (SPA route; /api/public/codes/:code resolves it)
POST /api/public/places/:id/reports   public report {entry_id|item_id, kind, note?, name?, photo?}
POST /api/public/reports/:id/vote     public "me too"
GET  /api/storerooms, /api/storerooms/:id
POST/PUT/DELETE /api/storerooms[/:id], POST /api/storerooms/:id/image
POST/PUT/DELETE /api/places[/:id]     (pin_x, pin_y, report_config)
POST/PUT/DELETE /api/places/:id/entries[/:eid]   (item-group entries such as pencils)
GET  /api/items?q=&place=&status=     POST/PUT/DELETE /api/items[/:id], POST /api/items/:id/move
GET  /api/reports?status=             POST /api/reports/:id/ack|resolve|dismiss|vote
POST /api/labels/pdf                  {ids|filter, layout}  -> application/pdf
GET  /api/me, /api/memberships, /api/settings/notifications
GET  /health  /metrics (bearer)  /privacy
```

- Internationalisation: all UI text and notification text live in message catalogues (`fi.json` now; `sv.json`, `en.json` later) with ICU-style plurals; dates and numbers by `Intl`. The public page chooses the language from the `?lang=` parameter, then a cookie, then `Accept-Language`, then the organization's default (`fi`). Free text entered by keepers (item names, descriptions) is single-language in the MVP; translated fields are a later addition.
- Multi-tenancy readiness: a request context (`organizationId`, `locale`) is resolved once in middleware and every repository function takes it as a required argument, so a forgotten filter is a type error, not a data leak. PostgreSQL row-level security is a possible later hardening (as in ptv-mcp). Resolution in the MVP is the single configured organization.
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
7. **Repositories**: the app (code, Dockerfile, image build) stays in `jsilvanus/tavaranpaikka`. If the compose stack and env live in a separate deploy repo under `riksunsrk`, it only references the published image; development never happens there.
8. **Host name**: to be chosen (see questions). Start on the dev domain, like Tunnus at `kehitys.riihimaenseurakunta.fi`, and move later.
9. **Verify** with infra's checklist: `curl -I` routing and TLS, database exists, Prometheus target up, a real label scanned with a real phone.

Key settings (all in `.env.example`): `BASE_URL`, `DATABASE_URL`, `SESSION_SECRET`, `OIDC_*`, `OIDC_GROUP_ROLE_MAP`, `STORAGE_DRIVER`, `S3_*`, `MAIL_PROVIDER`, `MAIL_FROM`, `BREVO_API_KEY`, `BREVO_TEMPLATE_REPORT_ID[_FI|_SV|_EN]`, `DEFAULT_ORGANIZATION_SLUG`, `DEFAULT_LOCALE`, `ENABLED_LOCALES` (MVP: `fi`), `REPORTER_HASH_SECRET`, `CONTROLLER_NAME`, `CONTROLLER_CONTACT`, `PROCESSORS`, `METRICS_BEARER_TOKEN`, `CLEANUP_*`, `REPORT_RETENTION_DAYS`, `BREAK_GLASS_ADMINS`.

## 11. Phases (for Haiku implementation, reviewed by Opus)

Each phase ends with passing tests, `typecheck` and lint, and is one PR. A phase lists what must be true afterwards; implementation detail stays in the PR.

| Phase | Result | Can run in parallel with |
|---|---|---|
| **0. Scaffold** | Repo layout, `package.json` (ESM, Node 24), Express app with `/health`, config validation, Pino, Vitest, ESLint, `tsc`, Dockerfile, GitHub Actions CI, `.env.example`, migrations runner, request context (organization, locale), message-catalogue loader with `fi.json` | none |
| **1. Core data + auth** | Migrations (organizations, storerooms, places, items, place_entries, codes, memberships, users); Tunnus OIDC sign-in for keepers/admins; sessions, CSRF, roles; group mapping; keeper CRUD APIs with authorization and tenant-isolation tests; `openapi.yaml` | UI shell (SPA, routing, sign-in page, Finnish texts) |
| **2. Codes, QR, labels** | Code generator with check char and collision handling; public `/c/:code` resolution; QR SVG; A4 sticker-sheet PDF layouts with start position; `printed_at`; void/reissue | Phase 3 |
| **3. Images and pins** | Storage abstraction (local + S3); upload pipeline; pin placement UI; pinch-zoom display; **public item page and public place page** with the pointer and the "should be here" list | Phase 2 |
| **4. Reports and notifications** | Per-place `report_config`; public report form and "me too"; abuse controls (rate limit, honeypot, rotating hash); keeper inbox and status flow; outbox worker; mail providers (console, SMTP, Brevo + templates); digest; retries | none (needs 1 and 3) |
| **5. Privacy, ops, hardening** | `/privacy`, retention cleanup job, export/erase tools, audit with scrubbing, metrics, break-glass, PWA manifest, Playwright E2E (scan > report > acknowledge, tenant isolation), accessibility pass, load check with a few thousand items | none |
| **6. Deploy and pilot** | infra provisioning (DB, bucket, metrics token), compose + Traefik labels, Tunnus client entry, dev-domain rollout, label pilot in one real storeroom of the one pilot parish | none |
| **Later** | Swedish and English (`sv.json`, `en.json`, template locales), label-printer layouts, second parish (tenant resolution by host/path and an admin screen), CSV import of existing item lists, quantities and low-stock thresholds, item history view, web push, webhook channel, connecting to Pyhä pakki | |

Estimate: phases 0-4 are the usable core; the pilot can start after phase 4 on the dev domain while phases 5-6 harden it.

## 12. Risks

- **Labels peel or fade**: choose polyester/laminated labels for damp or cold storerooms; reissue flow is cheap, codes stay valid after reprint because they are looked up, not computed.
- **Stale pins** after moving shelves: the keeper inbox shows items "not verified in 12 months"; a keeper can mark "verified" when passing.
- **Nobody receives the notification**: `responsible_group` empty or all recipients inactive. Admins get a fallback copy, and the settings page warns about storerooms without a recipient.
- **Tunnus outage** blocks reporting: break-glass for admins only; reporters just try again later. The outbox keeps a report even if mail fails.
- **Photos of people** end up in storeroom images: upload checkbox and guidance, keeper-only report photos, and removal on request.
- **Scope creep into inventory management**: keep `quantity_note` as free text until real use shows a need for counts.
- **Public reporting abuse or noise**: rate limits, honeypot, "me too" merging, spam dismissal, and `require_signin` per place as an escape hatch.
- **A tenant filter forgotten later** when the second parish arrives: repositories require the request context, and a tenant-isolation test runs in CI from phase 1.

## 13. Open questions for Juha

Answered 2026-11-19 and folded into the plan (section 0): public scan and reporting, item vs. place QR behaviour, per-place report configuration, tracked items vs. item groups, one parish for the MVP with a multi-tenant-ready design, Finnish MVP with sv/en later, A4 sticker sheets for the MVP, repository stays in `jsilvanus`.

Still open:

1. **Recipients for the pilot**: a Tunnus group per storeroom, or a short email list per place at first? (The plan supports both; the pilot needs one decision.)
2. **Host name**: for example `tavaranpaikka.riihimaenseurakunta.fi`, a path under the Pyhä pakki portal, or the dev domain at first (church DNS changes are slow).
3. **Public reporting default**: should a place without its own setting accept anonymous reports (plan default: yes, notes allowed, photos off), or should only places you switch on do so?
4. **Group entries and quantity**: is "should be here" just a list of names (plan default), or do you want a target amount per entry ("10 pencils") from the start?
5. **Data protection officer review** of the privacy notice and the retention table before go-live.
