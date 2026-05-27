import path from "node:path";
import url from "node:url";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import dotenv from "dotenv";

// Load secrets from .env.local (gitignored). In CI / release builds, the
// values come from real environment variables instead.
dotenv.config({ path: ".env.local", quiet: true });

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.ewels.deckcal.sdPlugin";

const requiredEnv = [
  "DECKCAL_GOOGLE_CLIENT_ID",
  "DECKCAL_GOOGLE_CLIENT_SECRET",
];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.warn(
      `[build] ${key} is not set. The packaged plugin will throw on sign-in. ` +
        `See README for setup.`,
    );
  }
}

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
  input: "src/plugin.ts",
  // googleapis and its transitive deps are massive and contain CommonJS that
  // resists bundling. Mark them external and resolve from node_modules at
  // runtime. The release workflow stages a package.json inside the sdPlugin
  // dir so npm installs them alongside bin/plugin.js.
  external: [/^googleapis/, /^google-auth-library/, /^gaxios/, /^gtoken/],
  output: {
    file: `${sdPlugin}/bin/plugin.js`,
    sourcemap: isWatching,
    sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
      return url.pathToFileURL(
        path.resolve(path.dirname(sourcemapPath), relativeSourcePath),
      ).href;
    },
  },
  plugins: [
    {
      name: "watch-externals",
      buildStart: function () {
        this.addWatchFile(`${sdPlugin}/manifest.json`);
      },
    },
    replace({
      preventAssignment: true,
      values: {
        "process.env.DECKCAL_GOOGLE_CLIENT_ID": JSON.stringify(
          process.env.DECKCAL_GOOGLE_CLIENT_ID ?? "",
        ),
        "process.env.DECKCAL_GOOGLE_CLIENT_SECRET": JSON.stringify(
          process.env.DECKCAL_GOOGLE_CLIENT_SECRET ?? "",
        ),
      },
    }),
    typescript({
      mapRoot: isWatching ? "./" : undefined,
    }),
    nodeResolve({
      browser: false,
      exportConditions: ["node"],
      preferBuiltins: true,
    }),
    commonjs(),
    !isWatching && terser(),
    {
      name: "emit-module-package-file",
      generateBundle() {
        this.emitFile({
          fileName: "package.json",
          source: `{ "type": "module" }`,
          type: "asset",
        });
      },
    },
  ],
};

export default config;
