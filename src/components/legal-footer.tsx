import Link from "next/link";

/** Footer with the public policy links (safe to use from client and server components). */
export function LegalFooter({ className = "mt-14" }: { className?: string }) {
  return (
    <footer className={`${className} flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.06] pt-6 text-xs text-white/40`}>
      <span>© {new Date().getFullYear()} Nexus Pulse</span>
      <Link href="/terms" className="hover:text-white/70">Terms</Link>
      <Link href="/privacy" className="hover:text-white/70">Privacy</Link>
      <Link href="/terms#refunds" className="hover:text-white/70">Refunds</Link>
      <Link href="/data-deletion" className="hover:text-white/70">Data deletion</Link>
      <Link href="/pricing" className="hover:text-white/70">Pricing</Link>
      <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="ml-auto hover:text-white/70">Stock footage by Pexels</a>
    </footer>
  );
}
