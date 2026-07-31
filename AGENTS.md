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

**Product status:** UI is ahead of backend integration. Projects and auth are wired to Supabase; images, uploads, dashboard metrics, and several nav items are still mocked or placeholder.

---

## Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Next.js 16 (App Router) | `cacheComponents: true` in `next.config.ts` |
| Runtime | React 19, TypeScript 5 | Strict mode, `@/*` path alias |
| Auth + DB | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) | Cookie-based sessions |
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
│   │   ├── dashboard/
│   │   ├── projects/
│   │   │   └── [id]/
│   │   └── layout.tsx
│   ├── auth/               # Auth pages + route handlers
│   ├── globals.css         # Tailwind v4 + design tokens
│   ├── layout.tsx          # Root layout (font, theme)
│   └── page.tsx            # Public landing page
├── components/
│   ├── ui/                 # shadcn primitives — do not put feature logic here
│   ├── app-shell/          # Sidebar, header
│   ├── auth/               # Auth-specific shared UI
│   ├── dashboard/          # Dashboard widgets
│   └── projects/           # Project browser, detail, upload, etc.
├── hooks/                  # Shared React hooks (e.g. use-mobile)
├── lib/
│   ├── actions/            # Server actions ("use server")
│   ├── mock/               # Hardcoded / placeholder data
│   ├── supabase/           # client.ts, server.ts, proxy.ts
│   ├── types/              # Manual TypeScript types (not Supabase codegen)
│   ├── format.ts           # Formatting helpers
│   ├── nav.ts              # Sidebar navigation config
│   ├── unsplash.ts         # Unsplash API for sample images
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
| `/auth/login` | `app/auth/login/page.tsx` | No |
| `/auth/sign-up` | `app/auth/sign-up/page.tsx` | No |
| `/auth/sign-up-success` | `app/auth/sign-up-success/page.tsx` | No |
| `/auth/forgot-password` | `app/auth/forgot-password/page.tsx` | No |
| `/auth/update-password` | `app/auth/update-password/page.tsx` | No |
| `/auth/error` | `app/auth/error/page.tsx` | No |
| `/auth/confirm` | `app/auth/confirm/route.ts` | Route handler (OTP verify) |
| `/auth/oauth` | `app/auth/oauth/route.ts` | Route handler (OAuth exchange) |

**Route group `(app)`:** Wraps dashboard and projects in the sidebar shell (`app/(app)/layout.tsx`). URLs are `/dashboard`, `/projects` — the group name is omitted from the path.

---

## Auth flow

There is **no `middleware.ts`**. Session handling uses Next.js 16's **proxy** pattern:

```
Request → proxy.ts → lib/supabase/proxy.ts (updateSession)
  ├── Refreshes session via supabase.auth.getClaims()
  └── Redirects unauthenticated users to /auth/login
      (except /, /auth/*, /login)
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
- `user_id` UUID → `auth.users(id)`

**`images` table:** Referenced in migrations (UUID PK) but **not used by app code yet**.

**RLS:** Users can only SELECT/INSERT/UPDATE/DELETE their own projects (`auth.uid() = user_id`).

### Types

Manual types in `lib/types/projects.ts`. **No Supabase codegen** (`database.types.ts` does not exist). When schema stabilizes, consider adding `supabase gen types`.

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
| Projects list / create / star | **Real** | Supabase `projects` table + `lib/actions/projects.ts` |
| Project detail — metadata | **Real** | Supabase `projects` |
| Project detail — images | **Mock** | Unsplash API (`lib/unsplash.ts`) + `lib/mock/image-metadata.ts` |
| Upload images dialog | **Mock** | `lib/mock/image-metadata.ts` (`MOCK_UPLOAD_FILES`) |
| Dashboard metrics (total/annotated/unannotated) | **Mock** | `lib/mock/dashboard-metrics.ts` |
| Sidebar storage widget ("10 GB / 100 GB") | **Mock** | Hardcoded in `app-sidebar.tsx` |
| Nav: Datasets, Annotate, Recent Files, Starred, Recycle Bin, Settings, Get Help | **Placeholder** | `disabled: true` in `lib/nav.ts` |

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

Current actions: `lib/actions/projects.ts`

| Action | What it does |
|--------|--------------|
| `createProject(formData)` | Insert project, revalidate, redirect to `/projects/[id]` |
| `toggleProjectStar(projectId, starred)` | Update `starred`, revalidate paths |

**Pattern for new actions:**
1. Create `lib/actions/<domain>.ts` with `"use server"` at top
2. Use `createClient()` from `lib/supabase/server`
3. Check `getUser()` for auth
4. Call `revalidatePath()` for affected routes
5. Use `redirect()` or return data — throw `Error` on failure
6. Document the action in this section

---

## Environment variables

From `.env.example`:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key |
| `UNSPLASH_ACCESS_KEY` | Sample images for project detail (mock) |
| `UNSPLASH_SECRET_KEY` | Unsplash API secret |

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
```

---

## What NOT to do

- Do not add `middleware.ts` — auth uses `proxy.ts`
- Do not add `tailwind.config.*` — Tailwind v4 is CSS-first
- Do not put feature logic in `components/ui/` — that's for shadcn primitives only
- Do not create global Supabase clients — always use `lib/supabase/client.ts` or `server.ts`
- Do not skip updating this file when making structural changes (see [Agent Maintenance Rules](#agent-maintenance-rules))
- Do not assume `supabase/migrations/` is in git — it is gitignored
