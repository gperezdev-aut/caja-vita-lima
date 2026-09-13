const path = require("path");

/** @type {import("next").NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@resvg/resvg-js"],
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(__dirname),
    };

    return config;
  },
};

module.exports = nextConfig;
