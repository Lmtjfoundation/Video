import { authed, body, fail, ok } from "@/lib/http-api";
import { signedUrl } from "@/lib/media";
import { CONSENT_SENTENCE, createVoice, deleteVoice, listVoices } from "@/lib/voices";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** My Voices: voices cloned from the person's own recordings, with spoken consent. */
export const GET = authed(async (_req, user) =>
  ok({
    consentSentence: CONSENT_SENTENCE,
    voices: (await listVoices()).map((v) => ({ id: v.id, name: v.name, createdAt: v.createdAt, consentBy: v.consent?.by ?? "", designed: v.designed, sampleUrl: signedUrl(user.id, v.sampleId, 6 * 3600) })),
  }),
);

export const POST = authed(async (req, user) => {
  const b = await body<{ name?: string; mediaId?: string; consentBy?: string; agreed?: boolean }>(req);
  const v = await createVoice(user.id, { name: String(b.name ?? ""), mediaId: String(b.mediaId ?? ""), consentBy: String(b.consentBy ?? ""), agreed: b.agreed === true });
  return ok({ id: v.id, name: v.name });
});

export const DELETE = authed(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Which voice?");
  await deleteVoice(id);
  return ok({ ok: true });
});
