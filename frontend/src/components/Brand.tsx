/** Shared brand mark; adjacent headings provide the accessible name. */
export default function Brand({ className = 'h-9 w-9' }: { className?: string }) {
  return <img src="/icon.svg" alt="" aria-hidden="true" width="64" height="64" className={`shrink-0 ${className}`} />
}
