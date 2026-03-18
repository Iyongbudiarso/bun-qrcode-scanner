/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prevent Next.js from bundling tesseract.js so that __dirname-based
  // worker script path resolution works correctly at runtime.
  experimental: {
    serverComponentsExternalPackages: ["tesseract.js", "tesseract.js-core"],
  },
};

export default nextConfig;
