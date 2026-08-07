// Root 404 boundary (A16/A17-1). Rendered when a page calls notFound() or a route
// does not match. Server component — no client interactivity needed.
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="max-w-md space-y-4">
        <p className="text-5xl font-bold text-muted-foreground">404</p>
        <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you are looking for does not exist or may have been moved.
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-block rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  )
}
