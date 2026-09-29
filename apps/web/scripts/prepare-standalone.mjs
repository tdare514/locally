// Run after `LOCALLY_DESKTOP_BUILD=1 next build`: Next's standalone output leaves out
// `public` and `.next/static`, so copy them next to server.js.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error(
    "prepare-standalone: .next/standalone/server.js is missing. Run `LOCALLY_DESKTOP_BUILD=1 next build` first (or use `npm run desktop:build`)."
  );
  process.exit(1);
}

const copies = [
  [path.join(root, "public"), path.join(standalone, "public")],
  [path.join(root, ".next", "static"), path.join(standalone, ".next", "static")],
];
for (const [from, to] of copies) {
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, to, { recursive: true });
  console.log(`prepare-standalone: copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}
