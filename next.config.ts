import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: the site is fully static, so Netlify can host the plain files.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
