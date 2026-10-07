# Plan view (calendar, history)

Status: **Built** (TASK-013). Builds on ADR-041 (posts have `scheduled_on` / `scheduled_time`).

- `/app/plan` — all brands of the org. Tabs: **Koledar** (month grid Mon–Sun in whole weeks, week, day table),
  **Brez termina** (not published or skipped, no day), **Zgodovina** (published, newest publication first, 50 per page).
  Filters brand + platform; everything in the URL (`view`, `d`, `tab`, `brand`, `platform`, `page`). Month cells show
  up to 4 chips (time · platform · first line, left bar in the status colour) and "+N več" → day view; the day number
  opens the day. Phones get an agenda list instead of the grid. **"Prikaži"** (calendar tab): checkboxes per status,
  `s=` in the URL (repeated); default `CALENDAR_DEFAULT_STATUSES` = everything still to do — published and skipped hidden
  (owner, 2026-10-07); "generating" goes with "planned"; "Privzeto" link resets. Dashboard "Danes" shows all.
- Post page: "Iz plana" has a slot form (day + time; empty day = off the plan). Published posts keep their slot.
- Dashboard: "Danes" lists today's posts of every brand.
- Dates: `src/lib/dates` — local days in `Europe/Ljubljana` (`todayIn` uses the zone, not the server), week starts
  Monday, view ranges, navigation steps. Unit tested incl. New Year and summer-time edges.
- Server: `src/server/posts/calendar.ts` — `calendarPosts(from, to)` (≤ 2,000 rows, day/time order, no time last),
  `unscheduledPosts`, `historyPosts`, `reschedulePost` (zod: real dates, `HH:MM`, no time without a day; any member;
  not published). All bounded by `ctx.orgId`; `calendar.int.test.ts` covers order, filters, other org, bad ranges.
- E2E `tests/e2e/plan.spec.ts`: import with today/tomorrow/past rows, month cells in time order, day and week views,
  moving a post, no-slot and history tabs, "Danes", phone agenda; axe.
