import { cn } from "@/lib/utils";

export function EvangelineMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8", className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" className="fill-surface-2" />
      {/* A page with the sentence being read highlighted, and the voice coming from it. */}
      <rect x="5.5" y="6" width="13" height="20" rx="1.8" className="fill-paper" />
      <rect x="7.75" y="9.6" width="8.5" height="1.9" rx="0.95" className="fill-ink opacity-15" />
      <rect x="7" y="14.1" width="10" height="3.8" rx="1.2" className="fill-accent" />
      <rect x="7.75" y="15.05" width="8.5" height="1.9" rx="0.95" className="fill-ink" />
      <rect x="7.75" y="20.5" width="6.2" height="1.9" rx="0.95" className="fill-ink opacity-15" />
      <path
        d="M20.8 12.6C22.6 13.8 23.3 14.9 23.3 16S22.6 18.2 20.8 19.4"
        fill="none"
        className="stroke-accent"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M23.9 9.8C26.6 11.6 27.5 13.8 27.5 16S26.6 20.4 23.9 22.2"
        fill="none"
        className="stroke-muted"
        strokeWidth="1.7"
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
