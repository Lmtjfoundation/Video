import Link from "next/link";

/** Footer with the public policy links (safe to use from client and server components). */
export function LegalFooter({ className = "mt-14" }: { className?: string }) {
  return (
    <footer className={`${className} flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.06] pt-6 text-xs text-white/50`}>
      <span>© {new Date().getFullYear()} Ghost Post</span>
      <Link href="/terms" className="inline-block py-1 hover:text-white/70">Terms</Link>
      <Link href="/privacy" className="inline-block py-1 hover:text-white/70">Privacy</Link>
      <Link href="/terms#refunds" className="inline-block py-1 hover:text-white/70">Refunds</Link>
      <Link href="/data-deletion" className="inline-block py-1 hover:text-white/70">Data deletion</Link>
      <Link href="/pricing" className="inline-block py-1 hover:text-white/70">Pricing</Link>
      <span className="ml-auto">
        Stock footage:{" "}
        <a href="https://pixabay.com" target="_blank" rel="noreferrer" className="inline-block py-1 hover:text-white/70">Pixabay</a>
        {" · "}
        <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="inline-block py-1 hover:text-white/70">Pexels</a>
      </span>
    </footer>
  );
}
