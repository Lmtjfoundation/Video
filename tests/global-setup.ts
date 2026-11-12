import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Every test run gets one temp folder (TMPDIR points at it, so each test's mkdtemp lands inside), and the whole folder
 * is deleted when the run ends. Test data, renders and fake uploads never pile up on the machine.
 */
export default function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-tests-"));
  const before = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  return () => {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    rmSync(dir, { recursive: true, force: true });
  };
}
