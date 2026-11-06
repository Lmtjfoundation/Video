/* Accessibility scan: axe-core (WCAG 2.2 A/AA) on every page, desktop and phone, plus a keyboard focus check. */
const { chromium, devices } = require("playwright");
const fs = require("fs");
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
// node scripts/a11y-scan.cjs <public base url> <signed-in base url> <out.json>  (the signed-in one needs SETUP_CODE=demo-setup-code
// and a fresh DATA_DIR: it signs up a throwaway owner). Exits 1 when any page has a critical or serious issue.
const [,, LIVE, LOCAL, OUT] = process.argv;
const PUBLIC = ["/welcome", "/login", "/signup", "/forgot", "/reset?token=x", "/pricing", "/privacy", "/terms", "/data-deletion", "/offline"];
const SIGNED = ["/", "/trends", "/platforms", "/niche", "/stories", "/studio", "/writers", "/movies", "/film-engine", "/movie-maker", "/director", "/series", "/images", "/create", "/story-video", "/voice-lab", "/video-tools", "/library", "/flows", "/explain", "/calendar", "/media", "/engage", "/logs", "/plans", "/settings", "/developers", "/admin", "/connect"];
async function scan(page, url) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags.filter((t) => /^wcag\d/.test(t)), nodes: v.nodes.slice(0, 8).map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 160), summary: (n.failureSummary || "").slice(0, 220) })), count: v.nodes.length }));
  });
  // Keyboard: tab through up to 40 stops; record ones with no visible focus indicator.
  const kb = await page.evaluate(() => ({ title: document.title, hasMain: !!document.querySelector("main"), lang: document.documentElement.lang }));
  const noFocus = [];
  await page.locator("body").click({ position: { x: 1, y: 1 } }).catch(() => {});
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(220); // let focus rings finish their fade-in
    const f = await page.evaluate(async () => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const look = () => { const c = getComputedStyle(el); return [c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0 ? c.outlineColor : "", c.boxShadow, c.borderColor].join("|"); };
      const focused = look();
      el.blur();
      await new Promise((r) => setTimeout(r, 220));
      const resting = look();
      el.focus();
      const cs = getComputedStyle(el);
      const visible = focused !== resting || (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0);
      return { visible, desc: el.tagName.toLowerCase() + (el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : "") + " " + (el.textContent || "").trim().slice(0, 40) };
    });
    if (f && !f.visible) noFocus.push(f.desc);
  }
  return { violations: r, ...kb, noFocus: [...new Set(noFocus)] };
}
(async () => {
  const b = await chromium.launch();
  const results = [];
  for (const [label, opts] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["phone", devices["iPhone 13"]]]) {
    const pub = await b.newContext(opts);
    const pp = await pub.newPage();
    for (const p of PUBLIC) results.push({ where: "live", view: label, path: p, ...(await scan(pp, LIVE + p)) });
    const ctx = await b.newContext(opts);
    const page = await ctx.newPage();
    if (label === "desktop") console.log("signup", (await page.request.post(LOCAL + "/api/auth/signup", { data: { email: "a11y@example.com", password: "A11y-pass-12345!", name: "Scan Owner", setupCode: "demo-setup-code" } })).status());
    else await page.request.post(LOCAL + "/api/auth/login", { data: { email: "a11y@example.com", password: "A11y-pass-12345!" } });
    for (const p of SIGNED) results.push({ where: "local", view: label, path: p, ...(await scan(page, LOCAL + p)) });
    console.log(label, "done");
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  await b.close();
  const bad = results.flatMap((r) => r.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => `${r.view} ${r.path}: ${v.id} (${v.count})`));
  console.log(bad.length ? `Accessibility: ${bad.length} critical/serious\n${bad.join("\n")}` : `Accessibility: ${results.length} page views, no critical or serious issues`);
  process.exit(bad.length ? 1 : 0);
})();
