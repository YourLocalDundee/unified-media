# Two-Mode Request System (v0.9.0+)

Every request is **Quick** or **Long-term** (`media_requests.request_type`).

**Quick:** only for content `year < currentYear`; auto-approved on creation (system `auto-pick` only —
an interactive hand-picked release stays `request_method='interactive'` and goes to the admin queue);
added to `monitored_items`; slot-limited **1 movie / 2 TV** per user (`status IN approved,available`);
on availability `auto_delete_at = now + 48h`; the hourly cron deletes files + marks `expired`, freeing
the slot; a full slot at submit → row deleted, API returns `429`.

**Long-term:** any content; manual admin approval (`pending` until approve/decline); never auto-deleted;
no slot limit.

**UI** (`src/components/media/RequestOptions.tsx`): old content → "Quick (48h)" + "Long-term"; new
content → single "Request" (long-term only); status badge carries the type label.

Key files: `requests/types.ts`, `requests/auto-approve.ts` (`tryAutoApprove()` gates on quick +
auto-pick + year + slot), `automation/availability.ts`, `automation/auto-delete.ts`,
`api/requests/route.ts`.
