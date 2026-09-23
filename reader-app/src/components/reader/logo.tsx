import { cn } from "@/lib/utils";

export function EvangelineMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8", className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" className="fill-surface-2" />
      <rect x="7" y="8" width="11" height="16" rx="1.4" className="fill-paper" />
      <path
        d="M21.2 11.2c2.2 1.4 3.4 3.4 3.4 4.8s-1.2 3.4-3.4 4.8"
        fill="none"
        className="stroke-accent"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M23.6 8.8c3.2 2 5 4.8 5 7.2s-1.8 5.2-5 7.2"
        fill="none"
        className="stroke-muted"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EvangelineWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <EvangelineMark />
      <span className="font-display text-lg tracking-tight text-fg">Evangeline</span>
    </span>
  );
}
