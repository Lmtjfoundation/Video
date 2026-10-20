/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  // The Media Library takes files up to 2 GB (MAX_UPLOAD_MB); Next.js cuts request bodies passing through middleware at 10 MB by default.
  experimental: { middlewareClientMaxBodySize: `${(Number(process.env.MAX_UPLOAD_MB) || 2048) + 16}mb` },
  // The free voice (Kokoro) runs onnxruntime's native binary: load these from node_modules instead of bundling them.
  serverExternalPackages: ["kokoro-js", "@huggingface/transformers", "onnxruntime-node", "phonemizer"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
