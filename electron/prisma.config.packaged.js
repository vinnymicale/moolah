// Plain-JS Prisma config used only inside the packaged desktop app, so the
// bundled `prisma db push` doesn't need a TypeScript loader. It's copied to
// resources/prisma-cli/prisma.config.js by electron-builder. DATABASE_URL is
// injected by the Electron main process.
const { defineConfig } = require("prisma/config");

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL },
});
