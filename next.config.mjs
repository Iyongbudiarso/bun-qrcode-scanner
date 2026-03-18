/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep tesseract packages out of the Next.js bundle so they resolve
    // their own __dirname-based paths at runtime.
    serverComponentsExternalPackages: [
      "tesseract.js",
      "tesseract.js-core",
    ],
    // Force Vercel to include the WASM binaries and worker script
    // in the serverless function bundle.
    outputFileTracingIncludes: {
      "/api/ocr": [
        "./node_modules/tesseract.js-core/**/*",
        "./node_modules/tesseract.js/dist/**/*",
      ],
    },
  },
};

export default nextConfig;
