import { fail, authed } from "@/lib/http-api";
import { getSettings, listLogs, listPosts, listReplies } from "@/lib/repo";
import { logRows, logsMarkdown, postRows, postsMarkdown, replyRows, repliesMarkdown, toCsv } from "@/lib/export";

export const dynamic = "force-dynamic";

export const GET = authed(async (req: Request) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "posts";
  const format = url.searchParams.get("format") ?? "csv";
  if (!["posts", "replies", "logs"].includes(type) || !["csv", "md", "json"].includes(format)) return fail("Bad export type/format");

  const s = await getSettings();
  let content = "";
  if (type === "posts") {
    const posts = await listPosts();
    content = format === "csv" ? toCsv(postRows(posts, s)) : format === "md" ? postsMarkdown(posts, s) : JSON.stringify(posts, null, 2);
  } else if (type === "replies") {
    const rs = await listReplies();
    content = format === "csv" ? toCsv(replyRows(rs)) : format === "md" ? repliesMarkdown(rs) : JSON.stringify(rs, null, 2);
  } else {
    const ls = await listLogs(5000);
    content = format === "csv" ? toCsv(logRows(ls)) : format === "md" ? logsMarkdown(ls) : JSON.stringify(ls, null, 2);
  }

  const mime = format === "csv" ? "text/csv" : format === "md" ? "text/markdown" : "application/json";
  const name = `nexus-${type}-${new Date().toISOString().slice(0, 10)}.${format}`;
  return new Response(content, {
    headers: { "Content-Type": `${mime}; charset=utf-8`, "Content-Disposition": `attachment; filename="${name}"` },
  });
});
