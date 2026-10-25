import { authed, body, fail, ok } from "@/lib/http-api";
import { createKey, listKeys, revokeKey } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

export const GET = authed(async () => ok({ keys: (await listKeys()).map(({ hash: _h, ...k }) => k) }));

/** Make a key (shown once) or revoke one. */
export const POST = authed(async (req, user) => {
  const b = await body<{ action?: string; name?: string; id?: string }>(req);
  if (b.action === "create") {
    const { key, record } = await createKey(user.id, String(b.name ?? ""));
    const { hash: _h, ...k } = record;
    return ok({ key, record: k });
  }
  if (b.action === "revoke") {
    await revokeKey(String(b.id ?? ""));
    return ok({ ok: true });
  }
  return fail("Unknown action.");
});
