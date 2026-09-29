// electron-builder's extraResources copy drops every node_modules directory, but the
// standalone Next server needs the ones Next traced. Copy the tree in after packing.
import fs from "node:fs";
import path from "node:path";

export default async function afterPack(context) {
  const resources = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    "Contents",
    "Resources"
  );
  const from = path.join(context.packager.projectDir, ".next", "standalone", "node_modules");
  const to = path.join(resources, "standalone", "node_modules");
  if (!fs.existsSync(from)) throw new Error(`after-pack: ${from} is missing; run npm run desktop:build`);
  fs.cpSync(from, to, { recursive: true });
  console.log(`  • after-pack: copied standalone node_modules -> ${path.relative(context.appOutDir, to)}`);
}
