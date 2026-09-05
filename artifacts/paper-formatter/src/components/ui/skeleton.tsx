import { cn } from '@/lib/utils';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // bg-muted, not primary/10 — primary is near-black ink now, so a 10%
      // tint of it reads as a grey smudge rather than a placeholder.
      className={cn('animate-pulse rounded bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
