import { authed, body, fail, ok } from "@/lib/http-api";
import { getSettings, saveSettings } from "@/lib/repo";
import { getAutopilotState, runTrendAutopilot } from "@/lib/trend-autopilot";
import { genreById } from "@/lib/genres";
import { VIDEO_LENGTHS } from "@/lib/video-spec";
import type { Settings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const view = async () => {
  const s = await getSettings();
  const st = await getAutopilotState();
  return { trendAutopilot: s.trendAutopilot, genres: s.genres, faceless: s.faceless, autopilot: s.autopilot, lastRunAt: st.lastRunAt ?? null, lastResult: st.lastResult ?? null };
};

export const GET = authed(async () => ok(await view()));

/** Save Trend Autopilot settings, genres and the faceless default. */
export const PUT = authed(async (req) => {
  const b = await body<{ trendAutopilot?: Partial<Settings["trendAutopilot"]>; genres?: string[]; faceless?: boolean }>(req);
  const cur = await getSettings();
  const patch: Partial<Settings> = {};
  if (b.genres) {
    const genres = [...new Set(b.genres.filter((g) => genreById(g)))].slice(0, 12);
    if (!genres.length) return fail("Pick at least one genre.");
    patch.genres = genres;
  }
  if (typeof b.faceless === "boolean") patch.faceless = b.faceless;
  if (b.trendAutopilot) {
    const t = b.trendAutopilot;
    patch.trendAutopilot = {
      ...cur.trendAutopilot,
      ...(typeof t.enabled === "boolean" ? { enabled: t.enabled } : {}),
      ...(t.mode === "schedule" || t.mode === "drafts" ? { mode: t.mode } : {}),
      ...(typeof t.videos === "boolean" ? { videos: t.videos } : {}),
      ...(typeof t.autoRender === "boolean" ? { autoRender: t.autoRender } : {}),
      ...(t.videoLength && t.videoLength in VIDEO_LENGTHS ? { videoLength: t.videoLength } : {}),
    };
  }
  await saveSettings(patch);
  return ok(await view());
});

/** Run it now. */
export const POST = authed(async (_req, user) => {
  const r = await runTrendAutopilot(user, { force: true });
  return ok({ ...(await view()), result: r });
});
