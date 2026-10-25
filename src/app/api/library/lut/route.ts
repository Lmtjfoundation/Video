import { authed, fail } from "@/lib/http-api";
import { canDownload } from "@/lib/library";
import { cubeFile, gradeById } from "@/lib/luts";

export const dynamic = "force-dynamic";

/** One Ghost Post LUT as a .cube file (paid plans, like every Library download). */
export const GET = authed(async (req, user) => {
  const g = gradeById(new URL(req.url).searchParams.get("id") ?? "");
  if (!g) return fail("That LUT wasn't found.", 404);
  if (!canDownload(user.plan, user.role)) return fail("LUT downloads come with every paid plan. On Free you can preview every grade.", 402);
  const license = `# Licensed to ${user.email}: use it on any personal or commercial project. Don't resell or share the file itself.\n`;
  return new Response(cubeFile(g).replace("LUT_3D_SIZE", `${license}LUT_3D_SIZE`), {
    headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="GhostPost-${g.id}.cube"` },
  });
});
