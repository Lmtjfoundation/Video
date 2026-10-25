import { apiKeyed, ok } from "@/lib/http-api";
import { assetUrls, searchLibrary, type LibraryQuery } from "@/lib/library";
import { ASSET_KINDS, type AssetKind, type SortId } from "@/lib/library-tags";

export const dynamic = "force-dynamic";

const list = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20) : undefined);

/** GET /api/v1/library?kind=music&q=…&genres=…&moods=…&tempo=…&length=…&shelf=catalog|mine&sort=…&limit=… */
export const GET = apiKeyed(async (req) => {
  const p = new URL(req.url).searchParams;
  const kind = (ASSET_KINDS.includes(p.get("kind") as AssetKind) ? p.get("kind") : "music") as AssetKind;
  const { items, total } = await searchLibrary({
    kind,
    shelf: (["all", "catalog", "mine"].includes(p.get("shelf") ?? "") ? p.get("shelf") : "all") as LibraryQuery["shelf"],
    q: p.get("q")?.slice(0, 120) ?? undefined,
    genres: list(p.get("genres")),
    moods: list(p.get("moods")),
    themes: list(p.get("themes")),
    instruments: list(p.get("instruments")),
    categories: list(p.get("categories")),
    vocals: (["instrumental", "vocals"].includes(p.get("vocals") ?? "") ? p.get("vocals") : undefined) as LibraryQuery["vocals"],
    tempo: p.get("tempo") ?? undefined,
    length: p.get("length") ?? undefined,
    sort: (p.get("sort") as SortId) || "new",
    similarTo: p.get("similar") ?? undefined,
    limit: Math.min(100, Number(p.get("limit")) || 30),
  });
  return ok({
    total,
    items: items.map((a) => ({
      id: a.id, kind: a.kind, title: a.title, description: a.description, seconds: a.seconds, bpm: a.bpm ?? null, key: a.key ?? null,
      vocals: a.vocals ?? null, genres: a.genres, moods: a.moods, themes: a.themes, instruments: a.instruments, category: a.category ?? null,
      peaks: a.peaks, created_at: a.createdAt, preview_url: assetUrls(a).previewUrl, poster_url: assetUrls(a).posterUrl ?? null,
    })),
  });
});
