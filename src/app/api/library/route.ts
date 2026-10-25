import { authed, body, fail, ok } from "@/lib/http-api";
import { GLOBAL } from "@/lib/db";
import { assetUrls, boards, canDownload, createBoard, deleteAsset, favorites, publishToCatalog, searchLibrary, toggleFavorite, updateBoard, type LibraryAsset, type LibraryQuery } from "@/lib/library";
import { ASSET_KINDS, type AssetKind, type SortId } from "@/lib/library-tags";
import { ownEngineReady } from "@/lib/own-video";
import { CREDIT_COST } from "@/lib/plans";

export const dynamic = "force-dynamic";

const list = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20) : undefined);

/** Browse and search the Library: the catalog, the person's own creations, favorites and boards. */
export const GET = authed(async (req, user) => {
  const p = new URL(req.url).searchParams;
  const kind = (ASSET_KINDS.includes(p.get("kind") as AssetKind) ? p.get("kind") : "music") as AssetKind;
  const q: LibraryQuery = {
    kind,
    shelf: (["all", "catalog", "mine", "favorites", "board"].includes(p.get("shelf") ?? "") ? p.get("shelf") : "all") as LibraryQuery["shelf"],
    boardId: p.get("board") ?? undefined,
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
    limit: Number(p.get("limit")) || 60,
  };
  const [{ items, total }, favs, myBoards, engine] = await Promise.all([searchLibrary(q), favorites(), boards(), ownEngineReady()]);
  return ok({
    items: items.map((a) => view(a, favs)),
    total,
    boards: myBoards.map((b) => ({ id: b.id, name: b.name, count: b.assetIds.length })),
    canDownload: canDownload(user.plan, user.role),
    isAdmin: user.role === "admin",
    engine,
    credits: { music: CREDIT_COST.aiMusic, sfx: CREDIT_COST.aiSfx, footageSecond: CREDIT_COST.ownSecond, autoPrompt: CREDIT_COST.autoPrompt },
  });
});

function view(a: LibraryAsset, favs: string[]) {
  const { mediaId: _m, previewId: _p, posterId: _s, owner, ...rest } = a;
  return { ...rest, ...assetUrls(a), mine: owner !== GLOBAL, favorite: favs.includes(a.id) };
}

/** Favorites, boards, and (admins) publishing to the catalog. */
export const POST = authed(async (req, user) => {
  const b = await body<{ action?: string; id?: string; boardId?: string; name?: string }>(req);
  const id = String(b.id ?? "");
  switch (b.action) {
    case "favorite":
      return ok({ favorite: await toggleFavorite(id) });
    case "board-create":
      return ok({ board: await createBoard(String(b.name ?? "")) });
    case "board-add":
      await updateBoard(String(b.boardId), { add: id });
      return ok({ ok: true });
    case "board-remove":
      await updateBoard(String(b.boardId), { remove: id });
      return ok({ ok: true });
    case "board-rename":
      await updateBoard(String(b.boardId), { name: String(b.name ?? "") });
      return ok({ ok: true });
    case "board-delete":
      await updateBoard(String(b.boardId), { delete: true });
      return ok({ ok: true });
    case "publish":
      if (user.role !== "admin") return fail("Only the app's admins can add to the catalog.", 403);
      return ok({ item: (await publishToCatalog(id)).id });
    case "delete":
      await deleteAsset(id, user.role === "admin");
      return ok({ ok: true });
    default:
      return fail("Unknown action.");
  }
});
