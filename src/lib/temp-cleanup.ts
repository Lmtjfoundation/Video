import { promises as fs } from "fs";
import os from "os";
import path from "path";

/** Folders the app makes in the system temp folder while it renders (each job deletes its own when it finishes). */
export const APP_TEMP = /^(ghost-post-[a-z0-9]+-|gp-movie-|film-|film-final-|line-)[A-Za-z0-9]{6}$/;
/** Two days: longer than any render, so only leftovers from a crash or a restart are removed. */
export const TEMP_MAX_AGE_MS = 48 * 3600_000;

/** Deletes the app's own temp folders that are older than `maxAgeMs`. Returns how many it removed. */
export async function sweepTemp(maxAgeMs = TEMP_MAX_AGE_MS, dir = os.tmpdir(), now = Date.now()): Promise<number> {
  let removed = 0;
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    if (!APP_TEMP.test(name)) continue;
    const full = path.join(dir, name);
    const st = await fs.stat(full).catch(() => null);
    if (!st?.isDirectory() || now - st.mtimeMs < maxAgeMs) continue;
    await fs.rm(full, { recursive: true, force: true }).then(() => removed++, () => {});
  }
  return removed;
}
