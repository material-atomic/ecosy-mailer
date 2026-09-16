/**
 * Fails the build when dist/ reaches for tslib.
 *
 * @rollup/plugin-typescript turns on `importHelpers`, and tslib is a
 * devDependency here. A helper import then becomes dist/node_modules/tslib/… —
 * a path that exists on the machine that built it and in no consumer's install.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const problems = [];

if (existsSync(join(dist, "node_modules"))) problems.push("dist/node_modules exists");

const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(m?js|cjs)$/.test(name) && /["']tslib["']|\/tslib\//.test(readFileSync(path, "utf8"))) {
      problems.push(`${path.slice(dist.length)} imports tslib`);
    }
  }
};
walk(dist);

if (problems.length) {
  console.error(`[check-dist] ${problems.join("; ")}. Raise "target" in tsconfig.json, or ship tslib as a dependency.`);
  process.exit(1);
}
console.log("[check-dist] no tslib, no nested node_modules");
