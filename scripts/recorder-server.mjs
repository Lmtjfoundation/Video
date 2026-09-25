// Serves the voice recorder at http://localhost:3100 and saves takes into
// recordings/. Microphone access needs localhost or https, so open the
// page through this server rather than as a file.
//
// Usage: npm run record

import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECORDINGS = join(ROOT, "recordings");
const PORT = Number(process.env.PORT ?? 3100);
const MAX_BYTES = 200 * 1024 * 1024;

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      const html = await readFile(join(ROOT, "recorder", "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    if (req.method === "GET" && req.url === "/api/script") {
      const captions = JSON.parse(await readFile(join(ROOT, "public", "captions.json"), "utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ lines: captions.map((c) => c.text) }));
    }

    if (req.method === "POST" && req.url === "/api/takes") {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BYTES) throw new Error("Take is larger than 200 MB");
        chunks.push(chunk);
      }
      await mkdir(RECORDINGS, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const name = `take-${stamp}.wav`;
      await writeFile(join(RECORDINGS, name), Buffer.concat(chunks));
      console.log(`Saved recordings/${name}`);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ path: `recordings/${name}` }));
    }

    res.writeHead(404).end("Not found");
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" }).end(String(err.message ?? err));
  }
});

server.listen(PORT, () => {
  console.log(`Voice recorder: http://localhost:${PORT}`);
});
