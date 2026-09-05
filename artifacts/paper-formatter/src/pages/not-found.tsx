import { Link } from 'wouter';
import { Button } from '@/components/ui/button';

/**
 * Rewritten out of hardcoded Tailwind greys.
 *
 * This page used `bg-gray-50` / `text-gray-900` / `text-red-500`, which sit
 * outside the token system, so it rendered as a white card in dark mode. Its
 * copy also addressed the developer ("Did you forget to add the page to the
 * router?") rather than the person who actually hit the URL.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-20">
      <div className="max-w-sm text-center">
        <p className="type-eyebrow">Error 404</p>
        <h1 className="type-display mt-3 text-foreground">
          There's nothing at this address
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The link may be out of date, or the manuscript it pointed to has been
          deleted.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Back to workspace</Link>
        </Button>
      </div>
    </div>
  );
}
