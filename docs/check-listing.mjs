// Verifies store-listing text fits each store's published limits. Run: node docs/check-listing.mjs
import { readFileSync } from "node:fs";
const md = readFileSync(new URL("./STORE_LISTING.md", import.meta.url), "utf8");
const grab = (label) => {
  const m = md.match(new RegExp(`\\*\\*${label}[^*]*\\*\\*:?\\s*([^\\n]+)`));
  return m ? m[1].replace(/`/g, "").trim() : null;
};
const limits = [
  ["Subtitle", 30],
  ["Promotional text", 170],
  ["Keywords", 100],
  ["Title", 30],
  ["Short description", 80],
];
let bad = 0;
for (const [label, max] of limits) {
  const v = grab(label);
  if (!v) { console.error(`✗ ${label}: not found`); bad++; continue; }
  const ok = v.length <= max;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${v.length}/${max}`);
}
const desc = md.split("**Description (max 4000):**")[1]?.split("**What's New")[0] ?? "";
console.log(`${desc.length <= 4000 ? "✓" : "✗"} Description: ${desc.trim().length}/4000`);
if (desc.length > 4000) bad++;
process.exit(bad ? 1 : 0);
