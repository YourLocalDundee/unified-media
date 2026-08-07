// Root route-segment loading fallback (A16/A17-1, A17-8). Streamed while a server
// segment's data is pending and no closer loading.tsx exists. Server component.
export default function Loading() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary"
        aria-hidden="true"
      />
    </div>
  )
}
