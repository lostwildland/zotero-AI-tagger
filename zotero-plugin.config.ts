import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  build: {
    assets: "addon/**/*.*",
    define: {
      ...pkg.config,
      buildVersion: pkg.version,
      buildTime: new Date().toLocaleString(),
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV || "production"}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: ".scaffold/build/addon/content/scripts/index.js",
      },
    ],
  },
});
