# Agent Context — Data Annotation Tool

> **Audience:** AI coding agents working in this repo. Humans can skim for onboarding.
>
> **Keep this file current.** See [Agent Maintenance Rules](#agent-maintenance-rules) below.

---

## Agent Maintenance Rules

**You MUST update this file in the same PR/commit** when your changes touch any of the following:

| Trigger | What to update |
|---------|----------------|
| New route group or major route restructure | [Route map](#route-map) |
| New top-level folder or `lib/` subdirectory | [Folder structure](#folder-structure) |
| Auth, session, or `proxy.ts` changes | [Auth flow](#auth-flow) |
| DB schema, RLS, or migration changes | [Database](#database) |
| New external service or env var | [Environment variables](#environment-variables) |
| Convention change (naming, server/client patterns) | [Conventions](#conventions) |
| Mock → real data for a feature | [Mocked vs real matrix](#mocked-vs-real-matrix) |
| New shadcn component or design-token change | [UI stack](#ui-stack) |
| New server action domain | [Server actions](#server-actions) + folder structure |

**How to update:** Edit the relevant section in place. Do not append changelog dumps. Remove stale information. If a section no longer applies, delete it.

**Do not update** for: bug fixes, styling tweaks, copy changes, or refactors that preserve existing structure and conventions.

---

## Product overview

Image annotation workspace for managing projects and annotating image datasets.

**Known branding inconsistency (do not silently "fix" unless asked):**
- Root layout metadata title: **"Annotate"**
- Sidebar brand label: **"SmartAnnoTool"** (SAT logo)

**Product status:** UI is ahead of backend integration. Projects, auth, image metadata, direct S3 image uploads, image-count metrics, per-project labels, durable bounding-box saves, single-image AI Annotate, bulk AI Annotate jobs with a review flow, the cross-project Recent Annotations hub, and the Recycle Bin (soft delete, 30-day retention) are real; several nav items are still placeholder.

---

## Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Next.js 16 (App Router) | `cacheComponents: true` in `next.config.ts` |
| Runtime | React 19, TypeScript 5 | Strict mode, `@/*` path alias |
| Auth + DB | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) | Cookie-based sessions |
| Annotation canvas | `konva` + `react-konva` | Bounding boxes; canvas is client-only (`dynamic(..., { ssr: false })`) |
| Styling | Tailwind CSS v4 | CSS-first config in `app/globals.css` — **no `tailwind.config.*`** |
| Components | shadcn/ui (New York style) | Radix primitives, `lucide-react` icons |
| Theming | `next-themes` | Light / dark / system via `ThemeProvider` in root layout |
| Linting | ESLint 9 flat config | `eslint.config.mjs` |

**Origin:** Forked from the [Next.js + Supabase starter](https://github.com/vercel/next.js/tree/canary/examples/with-supabase). `README.md` is still the upstream starter template and is **not** the source of truth for this app.

---

## Folder structure

```
data_annotation_tool/
├── app/                    # Next.js App Router
│   ├── (app)/              # Authenticated shell (sidebar layout) — does NOT affect URLs
│   │   ├── annotate/       # Recent Annotations hub (sidebar "Annotate")
│   │   ├── dashboard/
│   │   ├── projects/
│   │   │   └── [id]/
│   │   │       └── annotate/[imageId]/
│   │   ├── recycle-bin/    # Recycle Bin (restore / delete permanently)
│   │   └── layout.tsx
│   ├── auth/               # Auth pages + route handlers
│   ├── api/uploads/        # Authenticated S3 multipart orchestration routes
│   ├── api/annotations/    # AI auto-label (single image) + bulk AI job routes
│   ├── globals.css         # Tailwind v4 + design tokens
│   ├── layout.tsx          # Root layout (font, theme)
│   └── page.tsx            # Public landing page
├── components/
│   ├── ui/                 # shadcn primitives — do not put feature logic here
│   ├── app-shell/          # Sidebar, header
│   ├── annotate/           # Annotation workspace (toolbar, Konva canvas, side panel, export sheet, AI Annotate dialog, suggestion review card)
│   ├── auth/               # Auth-specific shared UI
│   ├── dashboard/          # Dashboard widgets
│   ├── projects/           # Project browser, detail, upload, bulk AI dialog + job banner, etc.
│   ├── recent-annotations/ # Cross-project Recent Annotations grid, card, and bulk actions
│   └── recycle-bin/        # Recycle Bin tabs, project rows, image cards, selection bar, setup notice
├── hooks/                  # Shared React hooks (use-mobile, use-now, use-upload-queue, use-annotation-job, use-dataset-import)
├── lib/
│   ├── actions/            # Server actions ("use server")
│   ├── annotations/        # Client annotation draft backup (sessionStorage), COCO/YOLO/VOC conversion, shared detection (auto-label.ts), bulk job queue + worker (jobs.ts, server-only)
│   ├── roboflow/           # Roboflow HTTP client (zero-shot gateway workflow) — deep module, mirrors lib/uploads/
│   ├── supabase/           # client.ts, server.ts, proxy.ts
│   ├── types/              # Manual TypeScript types (not Supabase codegen)
│   ├── uploads/            # Direct-to-S3 multipart upload provider
│   ├── format.ts           # Formatting helpers
│   ├── images.ts           # Supabase image queries + signed S3 read URLs
│   ├── labels.ts           # Supabase project_labels queries
│   ├── nav.ts              # Sidebar navigation config
│   ├── recycle-bin.ts      # Recycle Bin listing, lazy purge, permanent deletion (server-only)
│   └── utils.ts            # cn() — clsx + tailwind-merge
├── supabase/               # Local Supabase CLI config + migrations (GITIGNORED — see below)
├── proxy.ts                # Auth session proxy entry (replaces middleware.ts)
├── components.json         # shadcn/ui config
└── AGENTS.md               # This file
```

### Where to put new code

| What you're adding | Where it goes |
|--------------------|---------------|
| New authenticated page | `app/(app)/<feature>/page.tsx` |
| New public/auth page | `app/auth/<name>/page.tsx` |
| Feature UI (interactive) | `components/<feature>/` with `"use client"` |
| Feature UI (static layout) | `components/<feature>/` (no directive) |
| Reusable primitive | `components/ui/` via `npx shadcn@latest add <component>` |
| Server mutation / form handler | `lib/actions/<domain>.ts` |
| Shared types | `lib/types/<domain>.ts` |
| Placeholder data | `lib/mock/<name>.ts` — remove when wired to real data |
| Upload provider / chunking | `lib/uploads/` — keep UI on `UploadProvider` interface |
| External AI provider client | `lib/roboflow/` — deep module hiding HTTP/auth/validation, mirrors `lib/uploads/` |
| Supabase client usage (browser) | `createClient()` from `lib/supabase/client.ts` |
| Supabase client usage (server) | `createClient()` from `lib/supabase/server.ts` |
| Sidebar nav item | `lib/nav.ts` |

---

## Route map

| URL | File | Auth required |
|-----|------|---------------|
| `/` | `app/page.tsx` | No |
| `/dashboard` | `app/(app)/dashboard/page.tsx` | Yes |
| `/projects` | `app/(app)/projects/page.tsx` | Yes |
| `/projects/[id]` | `app/(app)/projects/[id]/page.tsx` | Yes |
| `/projects/[id]/annotate/[imageId]` | `app/(app)/projects/[id]/annotate/[imageId]/page.tsx` | Yes |
| `/annotate` | `app/(app)/annotate/page.tsx` | Yes |
| `/recycle-bin` | `app/(app)/recycle-bin/page.tsx` | Yes |
| `/auth/login` | `app/auth/login/page.tsx` | No |
| `/auth/sign-up` | `app/auth/sign-up/page.tsx` | No |
| `/auth/sign-up-success` | `app/auth/sign-up-success/page.tsx` | No |
| `/auth/forgot-password` | `app/auth/forgot-password/page.tsx` | No |
| `/auth/update-password` | `app/auth/update-password/page.tsx` | No |
| `/auth/error` | `app/auth/error/page.tsx` | No |
| `/auth/confirm` | `app/auth/confirm/route.ts` | Route handler (OTP verify) |
| `/auth/oauth` | `app/auth/oauth/route.ts` | Route handler (OAuth exchange) |
| `/api/uploads/create` | `app/api/uploads/create/route.ts` | Route handler (start S3 multipart upload) |
| `/api/uploads/presign-parts` | `app/api/uploads/presign-parts/route.ts` | Route handler (issue presigned S3 part URLs) |
| `/api/uploads/complete` | `app/api/uploads/complete/route.ts` | Route handler (complete S3 multipart upload) |
| `/api/uploads/abort` | `app/api/uploads/abort/route.ts` | Route handler (abort S3 multipart upload) |
| `/api/annotations/auto-label` | `app/api/annotations/auto-label/route.ts` | Route handler (zero-shot AI annotate one image) |
| `/api/annotations/jobs` | `app/api/annotations/jobs/route.ts` | Route handler (POST: queue a bulk AI run, starts worker via `after()`) |
| `/api/annotations/jobs/[jobId]` | `app/api/annotations/jobs/[jobId]/route.ts` | Route handler (GET: progress + per-image updates; restarts an idle worker) |
| `/api/annotations/jobs/[jobId]/cancel` | `app/api/annotations/jobs/[jobId]/cancel/route.ts` | Route handler (POST: cancel an active run) |

**Route group `(app)`:** Wraps dashboard, projects, annotate, and the Recycle Bin in the sidebar shell (`app/(app)/layout.tsx`). URLs are `/dashboard`, `/projects`, `/annotate`, `/recycle-bin` — the group name is omitted from the path.

---

## Auth flow

There is **no `middleware.ts`**. Session handling uses Next.js 16's **proxy** pattern:

```
Request → proxy.ts → lib/supabase/proxy.ts (updateSession)
  ├── Refreshes session via supabase.auth.getClaims()
  └── Redirects unauthenticated users to /auth/login
      (except /, /auth/*, /login)
  └── Redirects authenticated users from / and /auth/login to /dashboard
```

| Flow | Entry point | Result |
|------|-------------|--------|
| Sign up | `components/sign-up-form.tsx` | Email confirm or immediate `/dashboard` |
| Email confirm | `app/auth/confirm/route.ts` | `verifyOtp()` → redirect |
| Login (password) | `components/login-form.tsx` | `/dashboard` |
| Login (OAuth) | `components/auth/social-auth-buttons.tsx` → `/auth/oauth` | `/dashboard` |
| Password reset | `forgot-password-form.tsx` → email → `update-password-form.tsx` | `/dashboard` |
| Logout | `components/logout-button.tsx` | `/auth/login` |

**Social providers:** Google is enabled. Apple and Facebook are commented out in `social-auth-buttons.tsx`.

**Env var naming:** Uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not legacy `ANON_KEY`).

---

## Database

### Schema (inferred from app code + local migrations)

**`projects` table:**
- `id` UUID (PK)
- `name` text (NOT NULL)
- `description` text (nullable)
- `starred` boolean (default false)
- `created_at`, `updated_at` timestamptz
- `user_id` UUID (NOT NULL) → `auth.users(id)` — canonical ownership field
- Legacy `owner_id` remains populated on older rows but is not used by app queries or RLS.

**`images` table:**
- `id` UUID (PK)
- `project_id` UUID → `projects(id)` (ON DELETE CASCADE)
- `name` text (NOT NULL)
- `object_key` text (NOT NULL, UNIQUE) — private S3 key, never an expiring URL
- `content_type` text (`image/jpeg` or `image/png`)
- `size_bytes` bigint (> 0)
- `created_at`, `modified_at` timestamptz — `saveImageAnnotations` sets `modified_at`, so it is the "last annotated" time on `/annotate`; app inserts (upload, copy/move) leave the column default
- `annotation` jsonb (durable bounding-box array; sessionStorage remains a client draft backup)
- Legacy nullable `notes` and `url` columns remain but are not used by the app.

**`project_labels` table:**
- `id` UUID (PK)
- `project_id` UUID → `projects(id)` (ON DELETE CASCADE)
- `name` text (NOT NULL), unique per project (case-insensitive)
- `color` text (NOT NULL) — hex color, auto-assigned from a fixed palette (`lib/annotations/label-colors.ts`) on create
- `created_at` timestamptz
- Per-project custom classes for the annotation workspace and AI Annotate — replaces the old hardcoded frontend label list.

**`annotation_jobs` table** (one bulk AI run):
- `id`, `project_id` → `projects(id)` (CASCADE), `user_id` (default `auth.uid()`)
- `status`: `queued` | `running` | `completed` | `cancelled`; partial unique index allows **one active job per project**
- `labels` jsonb — snapshot of requested `[{ id, name }]`; `confidence` real; `total_items`
- `created_at`, `updated_at`, `finished_at`

**`annotation_job_items` table** (one image in a run — this table *is* the work queue):
- `job_id` + `project_id` → `annotation_jobs(id, project_id)` (CASCADE), `image_id` → `images(id)` (CASCADE), `position` (processing order)
- `status`: `queued` | `running` | `succeeded` | `failed` | `cancelled`; `attempts` (max 3); `locked_until` (lease while running, retry-not-before while queued); `error`
- `suggestions` jsonb — pending AI boxes (`BoundingBox` + `confidence`) awaiting review; shrinks as the user accepts/rejects; `suggestion_count` is a generated column. Accepted boxes move into `images.annotation`.
- A newer successful run clears older unreviewed suggestions for the same image.

**`recycle_bin_items` table** (one deleted project or image; migration `20261004120000_add_recycle_bin.sql`, **not live until someone runs `npx supabase db push`**. Until then the bin page shows a setup notice and every delete fails with a setup message without changing anything):
- `id`, `user_id` (default `auth.uid()`, → `auth.users` CASCADE), `kind`: `project` | `image`
- `project_id` (original id, no FK), `image_id` (kind = image only), `name`, `project_name`, `description`, `image_count`, `size_bytes`
- `object_keys` text[]: S3 keys removed on permanent deletion (kind = project: every image key, oldest first); `cover_object_key` is generated (first key, used as the list thumbnail)
- `snapshot` jsonb: kind = project → `{ project, labels, images }` full rows; kind = image → `{ image, labels: [{ id, name, color }] }` (the labels its boxes use)
- `deleted_at`; `expires_at` is generated (`deleted_at` + 30 days, UTC). Partial unique indexes: a project or image is in the bin at most once
- `purge_started_at` timestamptz: set when permanent deletion claims the row, **before** any S3 object is removed. A marked row is never restorable (its files may be partly gone); deleting it permanently again retries. The UI shows such items as "Deletion didn't finish" (`deletionPending`)
- Moving to the bin deletes the live rows (annotation jobs and pending AI suggestions cascade away and are not restored) but **keeps S3 objects** (including `projects/{id}/thumbnail`), so every existing query ignores binned data
- Retention is lazy: `/recycle-bin` hides expired rows and purges them in `after()` on page load (`purgeExpiredRecycleBinItems`, same claim path as permanent deletion); there is no cron. Expired rows cannot be restored even before the purge

**SQL functions (SECURITY INVOKER, `authenticated` only):** `claim_annotation_job_items(project, limit, lock_seconds)` leases items with `FOR UPDATE SKIP LOCKED`; `finalize_annotation_jobs(project)`; `annotation_image_states(project)` (latest status + pending suggestion count per image); `annotation_job_counts(job)`. Recycle Bin: `move_project_to_recycle_bin(project) → uuid` and `move_images_to_recycle_bin(project, image_ids[]) → uuid[]` (all-or-nothing; they lock rows so concurrent uploads/saves are not silently lost); `restore_recycle_bin_item(item) → jsonb` (claims the item with a `DELETE ... WHERE purge_started_at IS NULL AND expires_at > now()`, so a concurrent deletion mark and a restore serialise on the row lock; then re-inserts snapshot rows with the same ids and timestamps; an image restore remaps labels by id, then trimmed case-insensitive name, else recreates them). They raise SQLSTATEs `RB001`–`RB009` (listed in the migration header; `RB008` = deletion started, `RB009` = expired) that `lib/actions/recycle-bin.ts` maps to user-facing messages. Permanent deletion lives in TypeScript (`lib/recycle-bin.ts`, `permanentlyDeleteRecycleBinItems`) because it needs S3: claim rows (`purge_started_at`, keeping only rows actually returned), delete their objects with `Promise.allSettled` tracking success per row (plus the thumbnail for projects), then delete only the rows whose objects all went.

**RLS:** Users can only SELECT/INSERT/UPDATE/DELETE their own projects (`auth.uid() = user_id`). Image, `project_labels`, `annotation_jobs`, and `annotation_job_items` policies grant the same operations only when the parent project belongs to the current user. `recycle_bin_items` allows SELECT/DELETE of own rows. UPDATE is limited to the `purge_started_at` column (column-level grant) and its policy's check requires it to stay non-null, so a client can mark a row for deletion but never clear the mark or change anything else. INSERT also requires `current_setting('app.recycle_bin_writer') = 'on'`, which only the two `move_*` functions set (function-level `SET`), so clients cannot forge rows that would point permanent deletion at arbitrary S3 keys.

### Types

Manual types in `lib/types/projects.ts`, `lib/types/annotations.ts` (`BoundingBox`, `AnnotationLabel` — the latter also shapes `project_labels` rows), and `lib/types/recycle-bin.ts`. **No Supabase codegen** (`database.types.ts` does not exist). When schema stabilizes, consider adding `supabase gen types`.

### Supabase folder is gitignored

`/supabase` is listed in `.gitignore`. Migrations and `config.toml` exist locally for `supabase` CLI dev but are **not committed**. When adding migrations:
1. Create migration locally via Supabase CLI
2. Document schema changes here in the [Database](#database) section
3. Coordinate with team on how migrations are shared (not currently in repo)

---

## Mocked vs real matrix

> **Update this table** when wiring a feature to real data or adding a new mock.

| Feature | Status | Source |
|---------|--------|--------|
| User auth (sign up, login, OAuth, reset) | **Real** | Supabase Auth |
| Projects list / create / star / delete | **Real** | Supabase `projects` table + `lib/actions/projects.ts`; Delete (project cards and dashboard table, `DeleteProjectDialog`) moves the project to the Recycle Bin |
| Project detail — metadata | **Real** | Supabase `projects` |
| Project detail — images | **Real** | Supabase `images` metadata + private S3 objects loaded with short-lived signed GET URLs from `lib/images.ts`; card and multi-select actions support rename, copy/add, move, export, and delete (moves to the Recycle Bin via `moveImagesToRecycleBin`) |
| Annotation workspace UI + bbox editor | **Real images, labels, and durable saves** | Images come from Supabase + S3; labels come from Supabase `project_labels`; changes are debounced for 1.5 seconds and auto-saved to `images.annotation`, the Save button persists immediately through the same serialized save queue, and `sessionStorage` remains a local draft backup. Toolbar: zoom with RESET (fit), full screen (document Fullscreen API + fixed overlay, so Radix portals stay visible), AI Annotate split button. Side panel: labels with inline rename/delete and a "New label" toggle; layers with inline rename (relabel), z-order menu, duplicate (clamped to the image), drag-and-drop reorder; Properties always visible. Footer: auto-save status, last saved, Shortcuts dialog. Each image page is its own workspace instance (Next keeps recent pages alive); a same-image server refresh merges new server suggestions into local state instead of resetting boxes/undo history |
| AI Annotate | **Real (zero-shot; saved after review)** | Toolbar split button ("Annotate this image" / "Annotate multiple images…") opens `components/annotate/ai-annotate-dialog.tsx` with that scope; user picks labels (can create one inline) + confidence. Current image: `POST /api/annotations/auto-label` calls the shared Roboflow zero-shot workflow (`lib/roboflow/`) with a short-lived signed image URL, converts center-pixel predictions to top-left boxes (`lib/annotations/formats.ts`), and returns them to the canvas as dashed, numbered suggestions. Range: the dialog queues a bulk run (`POST /api/annotations/jobs`); the workspace tracks it per project (in-memory + `sessionStorage`, so it survives image navigation and reload) with a footer chip driven by `hooks/use-annotation-job.ts` (progress, Cancel), loads the open image's results as soon as they land, and flushes + `router.refresh()`es when the run ends. Suggestions are reviewed in `components/annotate/suggestion-review-card.tsx` (floats over the right column from `xl`): detection stepper, relabel (stays a pending suggestion), delete (= reject), Add all, Add & review next, Discard. Suggestions are excluded from auto-save until accepted (card, move/resize, canvas/side-panel relabel, `A`/`Shift+A`) |
| Bulk AI Annotate (many images / whole project) | **Real** | Project page "AI Annotate" button or selection bar opens `components/projects/batch-ai-annotate-dialog.tsx` (scope: selected / not yet AI-annotated / entire project, max 2000). `POST /api/annotations/jobs` inserts `annotation_jobs` + items, then drains the queue in `after()` (`lib/annotations/jobs.ts`: 4 parallel Roboflow calls, 240s budget, retry with backoff). The drain runs as the signed-in user (RLS, no service-role key); `hooks/use-annotation-job.ts` polls every 2.5s and each poll restarts the drain if no worker holds a live lease, so runs progress while the project page is open. Runs can also be queued from the workspace AI Annotate dialog (see above). Results show as card badges + an "AI suggestions" filter, and as dashed suggestions in the workspace with the review card. The workspace auto-save persists accepted boxes to `images.annotation` and remaining suggestions via `resolveSuggestions` through the same serialized save queue |
| Upload images dialog | **Real** | UI + queue in `components/projects/upload-images-dialog.tsx` + `hooks/use-upload-queue.ts`; `createS3Uploader()` uploads directly to S3, and successful completion persists an `images` row before refreshing the project grid. |
| Annotated dataset import | **Parser, label resolution, and orchestration hook; no import UI** | `lib/annotations/coco-import.ts` validates COCO bounding boxes into format-independent types in `lib/types/dataset-import.ts`. `lib/uploads/dataset-zip.ts` matches ZIP paths and verifies decoded JPEG/PNG dimensions; parsing performs no writes. `hooks/use-dataset-import.ts` accepts a validated plan, resolves all labels once, then runs up to three image upload/save pipelines through the existing S3 provider and `saveImageAnnotations`. Success requires the annotation save; failures retain prior uploads and report the failed stage. The hook prevents overlapping runs per instance, exposes per-image outcomes and aggregate counts/progress, and has no persistent jobs or automatic image retries. Keep its owner mounted during a run. Ordinary ZIP image uploads remain separate. Tests: see [Scripts](#scripts). |
| Dashboard metrics (total/annotated/unannotated) | **Real** | RLS-filtered Supabase `images` rows aggregated by `lib/images.ts` |
| Sidebar storage widget ("Storage used") | **Real (S3, with DB fallback)** | `app/(app)/layout.tsx` passes `components/app-shell/storage-usage-widget.tsx` (server component, own Suspense + skeleton) into `AppSidebar` as `storageSlot`. `getStorageUsage()` in `lib/storage-usage.ts` (React `cache()`, per request) lists every RLS-visible project's `projects/{id}/` prefix with `measureProjectStorage()` in `lib/uploads/s3-server.ts` (paginated ListObjectsV2, 4 prefixes at a time, 10s budget; needs `s3:ListBucket` on the `projects/` prefix) plus `extraProjectIds`: the widget passes `fetchRecycleBinProjectIds()` (projects of binned items, whose S3 objects still exist; none if the migration is missing). Any S3 failure logs one `console.warn` per error type and falls back to summing the user's `images.size_bytes` plus `recycle_bin_items.size_bytes` (binned files are still stored; ignored if the table is missing; excludes thumbnails); a Supabase failure renders "Storage unavailable". Quota is `STORAGE_QUOTA_GB` (default 100); the card's `title` says "Measured from S3" or "Estimated from uploaded files" |
| Nav: Datasets, Recent Files, Starred, Settings, Get Help | **Placeholder** | `disabled: true` in `lib/nav.ts` |
| Recent Annotations (`/annotate`) | **Real** | `fetchRecentlyAnnotatedImages()` in `lib/images.ts` loads the user's images with a non-null `annotation` (RLS-filtered, project name embedded), newest `modified_at` first, capped at 200, with signed thumbnails. `components/recent-annotations/` filters, searches, and sorts client-side; a card opens the workspace. Move/Add use `ImageTransferDialog` with its `sources` prop (one `transferProjectImages` call per source project; a move skips images already in the target). Export loads `getProjectExportData` and needs a single-project selection. Delete calls `moveImagesToRecycleBin` per project (restorable for 30 days) |
| Nav: Annotate | **Enabled** | Links to `/annotate`; the sidebar highlights it there and in `/projects/[id]/annotate/[imageId]` |
| Recycle Bin (`/recycle-bin`) | **Real (needs the migration applied)** | `fetchRecycleBin()` in `lib/recycle-bin.ts` loads unexpired `recycle_bin_items` with signed thumbnails (project thumbnail, else first image) and each image's `projectState` (`active` / `in_bin` / `gone`). `components/recycle-bin/` has Projects and Images tabs with search, sort (Deleted Date / Name + direction), a project filter for images, per-item Restore / Delete Permanently, and a bulk selection bar. Images whose project is in the bin or gone show that state and cannot be restored; items with `deletionPending` show "Deletion didn't finish — delete permanently again" with Restore disabled. Delete Permanently always confirms; per-item failures from `restoreRecycleBinItems` / `deleteRecycleBinItemsPermanently` show inline, and ids that were no longer in the bin are reported in the notice. Missing migration → `RecycleBinUnavailableError` → setup notice |
| Nav: Recycle Bin | **Enabled** | Links to `/recycle-bin` (sidebar "Pages" section) |

---

## Conventions

### Naming

- **Files:** kebab-case (`project-detail-client.tsx`)
- **Components:** PascalCase exports (`ProjectBrowser`)
- **Types:** PascalCase in `lib/types/`
- **Server actions:** camelCase in `lib/actions/`

### Server vs client components

| Pattern | Directive | Examples |
|---------|-----------|----------|
| Pages (data fetching) | None (server default) | All `app/**/page.tsx` |
| Interactive UI | `"use client"` | Forms, dialogs, sidebar, project browser |
| Server actions file | `"use server"` | `lib/actions/*.ts` |

**Data flow pattern:** Server page fetches data → passes props to client component.

```tsx
// app/(app)/projects/page.tsx (server)
const projects = await fetchProjects();
return <ProjectBrowser projects={projects} />;

// components/projects/project-browser.tsx (client)
"use client";
export function ProjectBrowser({ projects }: { projects: Project[] }) { ... }
```

### Next.js 16 patterns in use

- `await connection()` from `next/server` before dynamic data in server components
- `params: Promise<{ id: string }>` for dynamic route params
- `Suspense` boundaries around async server children
- `revalidatePath()` in server actions after mutations
- `proxy.ts` instead of `middleware.ts` for auth

### Styling

- Use `cn()` from `lib/utils.ts` for conditional classes
- Design tokens are CSS variables in `app/globals.css` (`:root`, `.dark`, `@theme inline`)
- Primary color: purple/indigo tones
- Do not create a `tailwind.config.*` — Tailwind v4 is configured in CSS

---

## UI stack

### shadcn/ui

Config: `components.json` — style **new-york**, base color **neutral**, RSC enabled.

**Installed components** (`components/ui/`):
`avatar`, `badge`, `breadcrumb`, `button`, `card`, `checkbox`, `dialog`, `dropdown-menu`, `input`, `label`, `progress`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `table`, `tabs`, `textarea`, `tooltip`

**Add a new component:**
```bash
npx shadcn@latest add <component-name>
```
Update the installed list above after adding.

### Icons

`lucide-react` — import from `lucide-react` directly.

---

## Server actions

Current actions: `lib/actions/projects.ts`, `lib/actions/images.ts`, `lib/actions/labels.ts`, `lib/actions/annotations.ts`, `lib/actions/suggestions.ts`, `lib/actions/recycle-bin.ts`

There is no hard-delete action for projects or images (`deleteProject`, `deleteProjectImage`, and `deleteProjectImages` were removed). Deleting moves items to the Recycle Bin; only `deleteRecycleBinItemsPermanently` or the lazy purge removes their S3 objects.

| Action | What it does |
|--------|--------------|
| `createProject(formData)` | Insert project, revalidate, redirect to `/projects/[id]` |
| `toggleProjectStar(projectId, starred)` | Update `starred`, revalidate paths |
| `updateProject(projectId, name, description)` | Update an owned project's name and description |
| `duplicateProject(sourceProjectId, name, description)` | Duplicate an owned project together with its labels, S3 images, and saved annotations |
| `copyProjectImages(sourceProjectId, targetProjectId, keepAnnotations)` | Copy every image into another owned project; optionally copy required labels and saved annotations |
| `transferProjectImages(sourceProjectId, targetProjectId, imageIds, mode, keepAnnotations)` | Copy/add or move selected S3 images to an owned project, optionally remapping labels and annotations; copy-to-current duplicates images while move-to-current is rejected |
| `getProjectExportData(projectId)` | Load an owned project, its signed image URLs, labels, and annotations for the shared export sheet |
| `renameProjectImage(imageId, projectId, fileName)` | Rename an owned image's display/export file name |
| `createLabel(projectId, name)` | Insert a `project_labels` row with an auto-assigned palette color, revalidate |
| `resolveDatasetLabels(projectId, categories)` | Validate project ownership and source categories, reuse labels by trimmed case-insensitive name, create missing palette-colored labels, and return `{ categoryId, labelId }` mappings; no image uploads |
| `renameLabel(projectId, labelId, name)` | Rename a project label, updating its name everywhere that label is used |
| `deleteLabel(projectId, labelId)` | Delete a `project_labels` row and revalidate. Returns `{ ok: false, error }` (instead of throwing) while any saved annotation in the project still uses the label |
| `saveImageAnnotations(projectId, imageId, boxes)` | Validate ownership, bounding boxes, and every label's membership in the target project before persisting the current annotation array to `images.annotation` and setting `images.modified_at` to the save time |
| `moveProjectToRecycleBin(projectId)` | RPC `move_project_to_recycle_bin`: snapshot an owned project with its labels and images into the bin and delete the live rows (S3 objects kept). Returns `{ ok: true, itemId }` or `{ ok: false, error }` for expected failures (signed out, not found, migration missing, database errors), because production builds mask thrown server-action messages |
| `moveImagesToRecycleBin(projectId, imageIds)` | RPC `move_images_to_recycle_bin`: one bin item per image of one owned project, all-or-nothing. Returns `{ ok: true, itemIds }` or `{ ok: false, error }` |
| `restoreRecycleBinItems(itemIds)` | Restores projects first (one at a time), then images (4 at a time) via `restore_recycle_bin_item`; returns `{ id, ok, error?, kind?, projectId?, imageId? }[]` in input order with friendly errors (e.g. "Restore the project “X” first") |
| `deleteRecycleBinItemsPermanently(itemIds)` | Claims the rows (`purge_started_at`), deletes their S3 objects (only keys under the item's own project prefix), then the rows whose objects all went; a project also takes its binned images and thumbnail. Returns `{ deleted, failed: { id, error }[], skipped: string[] }`: failed items stay in the bin, marked and unrestorable, until deleted again; `skipped` ids were no longer in the bin (restored or deleted elsewhere) |
| `resolveSuggestions(projectId, resolutions)` | After reviewing AI suggestions, set each job item's still-pending `suggestions` (empty clears it from review). Writes are narrowed to suggestion IDs still pending server-side (compare-and-swap on `updated_at`), so a stale client can only shrink the list. No `revalidatePath` — it runs inside workspace auto-save |

**Pattern for new actions:**
1. Create `lib/actions/<domain>.ts` with `"use server"` at top
2. Use `createClient()` from `lib/supabase/server`
3. Check `getUser()` for auth
4. Call `revalidatePath()` for affected routes
5. Use `redirect()` or return data — throw `Error` on failure
6. Document the action in this section

---

## Uploads (chunked / S3 handoff)

Bulk image upload is designed for **direct-to-S3 multipart**, not proxying bytes through Next.js.

| Piece | Role |
|-------|------|
| `components/projects/upload-images-dialog.tsx` | Figma-aligned modal UI |
| `hooks/use-upload-queue.ts` | Queue, concurrency, pause/retry/cancel |
| `lib/uploads/types.ts` | `UploadProvider` + queue item fields (`uploadId`, `key`, `completedParts`) |
| `lib/uploads/chunk.ts` | Byte-range splitting (`splitFileIntoChunks`, `sliceChunk`) |
| `lib/uploads/s3-uploader.ts` | Browser-side multipart client: chunking, presigned PUTs, retry, progress, pause/resume, complete and abort |
| `lib/uploads/s3-server.ts` | Server-only S3 client, request validation, ownership checks, multipart lifecycle helpers, project image copy/delete helpers, and deterministic optional project thumbnails at `projects/{projectId}/thumbnail` |
| `lib/uploads/uploader.ts` | `createUploadProvider()` — returns the active S3 provider |

**S3 API:** `POST /api/uploads/create`, `/presign-parts`, `/complete`, and `/abort` authenticate the user and verify project ownership before operating on keys constrained to `projects/{projectId}/images/{uuid}/...`. `POST /api/projects/[id]/thumbnail` verifies ownership and replaces the project's deterministic JPG/PNG thumbnail (maximum 5 MB). The multipart endpoints use `@aws-sdk/client-s3` with short-lived presigned part URLs. `createS3Uploader()` sends browser chunks directly to S3, retries failed part PUTs up to three times, and preserves `uploadId`, key, part numbers, and ETags in queue state for same-page pause/resume. Never proxy dataset image bytes through Next.js. Completion persists image metadata in Supabase; if that insert fails, the completed S3 object is deleted to avoid an orphan. Project reads generate one-hour signed GET URLs from stored object keys, but only for keys under the row's own `projects/{projectId}/` prefix (`objectKeyBelongsToProject`), because RLS does not constrain `images.object_key`; the AI auto-label path applies the same check before signing a URL for Roboflow. The bucket CORS policy must allow GET and PUT from the app origin and expose `ETag`. Cross-refresh multipart resume is not yet implemented.

---

## Environment variables

From `.env.example`:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key |
| `AWS_REGION` | AWS region for server-side S3 multipart orchestration |
| `AWS_S3_BUCKET` | S3 bucket for project image objects |
| `STORAGE_QUOTA_GB` | Server-only per-user storage quota for the sidebar widget, in binary GB (default 100 when unset/invalid) |
| `ROBOFLOW_API_KEY` | Server-only Roboflow workspace API key (never `NEXT_PUBLIC_`) |
| `ROBOFLOW_API_URL` | Roboflow serverless inference host (`https://serverless.roboflow.com`) |
| `ROBOFLOW_WORKSPACE` | Roboflow workspace slug that owns the shared gateway workflow |
| `ROBOFLOW_WORKFLOW_ID` | Shared zero-shot workflow ID (`gateway-zero-shot-detect`) — one workflow serves every project's own class list, no per-project Roboflow project |
| `ROBOFLOW_CONFIDENCE` | Default confidence threshold (0-1) for AI Annotate |

Copy `.env.example` → `.env` for local development. Never commit `.env`.

---

## Feature-addition playbooks

### Add an authenticated page

1. Create `app/(app)/<feature>/page.tsx` (server component)
2. Fetch data with `createClient()` from `lib/supabase/server`
3. Add `await connection()` if the page is dynamic
4. Create client components in `components/<feature>/` if interactivity is needed
5. Add nav item in `lib/nav.ts` (set `disabled: false`)
6. Update [Route map](#route-map) in this file

### Add a server action

1. Add function to `lib/actions/<domain>.ts` (or create new file with `"use server"`)
2. Authenticate via `supabase.auth.getUser()`
3. Perform DB operation
4. `revalidatePath()` for affected routes
5. Update [Server actions](#server-actions) in this file

### Add a Supabase table

1. Create migration locally: `npx supabase migration new <name>`
2. Add RLS policies (follow `projects` pattern: `auth.uid() = user_id`)
3. Add types to `lib/types/<domain>.ts`
4. Update [Database](#database) and [Mocked vs real matrix](#mocked-vs-real-matrix) in this file
5. Coordinate migration sharing (folder is gitignored)

### Wire mock data to real backend

1. Replace imports from `lib/mock/` with Supabase queries
2. Add server actions if mutations are needed
3. Update [Mocked vs real matrix](#mocked-vs-real-matrix) — change status from Mock to Real
4. Delete unused mock file if fully replaced

### Add a shadcn component

```bash
npx shadcn@latest add <component-name>
```
Component lands in `components/ui/`. Update the installed list in [UI stack](#ui-stack).

---

## Scripts

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # ESLint
node --test lib/annotations/coco-import.test.mjs lib/actions/dataset-labels.test.mjs hooks/use-dataset-import.test.mjs lib/actions/projects.test.mjs lib/actions/suggestions.test.mjs lib/recycle-bin.test.mjs   # Unit tests (no DB/S3 needed)
```

---

## What NOT to do

- Do not add `middleware.ts` — auth uses `proxy.ts`
- Do not add `tailwind.config.*` — Tailwind v4 is CSS-first
- Do not put feature logic in `components/ui/` — that's for shadcn primitives only
- Do not create global Supabase clients — always use `lib/supabase/client.ts` or `server.ts`
- Do not skip updating this file when making structural changes (see [Agent Maintenance Rules](#agent-maintenance-rules))
- Do not assume `supabase/migrations/` is in git — it is gitignored
