import "server-only";
import { registerResumer } from "./jobs";
import { movieJob, type RenderInput } from "./movie-maker-render";

/** Jobs that carry on after a server restart. Imported by /api/cron/resume, which the server calls when it starts. */
registerResumer("movie-maker", (userId, input) => movieJob(userId, input as RenderInput & { credits: number }));
