/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // The rest of this package uses explicit .js extensions on relative
    // imports (required by Node's native ESM resolver when scripts are run
    // directly via tsx/node, e.g. the seed scripts and engine CLIs).
    // Webpack, unlike tsc/tsx, treats an explicit ".js" extension as literal
    // and won't fall back to resolving the actual ".ts"/".tsx" file unless
    // told to — this tells it to.
    config.resolve.extensionAlias = {
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

export default nextConfig;
