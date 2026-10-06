# App frame and UI kit

Status: **Built** (TASK-011). Decision: ADR-040. Brand: docs/brand/BRAND.md.

## Frame (`src/components/shell/`)
- `AppShell` (server): fixed sidebar (w-60, `lg+`) with sections — *Nadzorna plošča* · VSEBINA (Objave, Brandi) ·
  POVEZAVE (Claude) · ADMINISTRACIJA (super admins only: Organizacije, Platforme, Revizijska sled). Only real pages
  are listed. Top bar: organization name, language (SL/EN, `NEXT_LOCALE` cookie), theme, account menu (email, sign out).
  Below `lg` the sidebar is a drawer (`MobileNav`). Used by `/app/*` and `/admin/*` layouts; pages render inside one `<main>`.
- `SidebarNav` (client) marks the current page (`aria-current`, signal bar); `nav.ts` holds the structure and `isActive`.

## Theme
Dark by default, light on request: cookie `postaja-theme` (`dark`/`light`, `src/lib/theme.ts`) → `data-theme` on
`<html>` from the root layout; the toggle sets the cookie and the attribute (no reload). Tailwind's `dark:` variant
follows the attribute (`@custom-variant` in `globals.css`), not the OS.

Tokens (`globals.css`, both themes): `bg` page · `sidebar` · `surface` cards/tables · `raised` inputs, table head,
hover · `line` borders · `fg` · `muted` · `signal` (#FF5A1F, primary action) · `on-signal` (ink text on signal) ·
`accent-text` (signal as text, AA in both themes) · `ok` / `warn` / `danger` (BRAND.md status colours).

## UI kit (`src/components/ui/`)
`PageHeader` (eyebrow, title, description, actions) · `Card` · `Section` · `DataTable` (card, uppercase muted head,
hairline rows, focusable horizontal scroll) + `td` · `EmptyState` · `Badge` + `STATUS_TONE` (ready = signal,
approved/published = ok, needs review = warn, failed = danger) · `Stat` · `Tabs` (client; links driven by `?tab=`) ·
`buttonClass` / `Button` / `LinkButton` (primary, secondary, ghost, danger; sm/md) · `inputClass`, `selectClass`,
`textareaClass`. Icons: `lucide-react` (ISC).

## Pages
| Route | What |
|---|---|
| `/app` | Dashboard: posts by status (links to filtered list), published this month, AI spend vs cap, recent posts, brands. Empty org → first step. |
| `/app/posts` | All posts of the org: search (caption + brief), brand, status, platform; GET form → shareable URL; 50 per page. `listOrgPosts` in `src/server/posts/overview.ts`. |
| `/app/brands` | Brands table: languages, channels, posts, waiting (ready + needs review), last post (`brandStats`). |
| `/app/brands/[id]?tab=` | Tabs: posts (new post + table) · files · profile (CGP) · channels · versions. A pending Claude CGP shows a notice on every tab. |

## Tests
`src/server/posts/overview.int.test.ts` (filters, escaping, paging, counts, other org never counted — deliberate break:
dropping the org filter fails it). `tests/e2e/shell.spec.ts` (desktop + mobile drawer: dashboard, filters in the URL,
brands counts, axe in dark and light, theme and language switch). Existing specs navigate brand tabs.
