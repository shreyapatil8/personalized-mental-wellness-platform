import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = new URL("../backend/src/tests/", import.meta.url);
for (const file of readdirSync(directory).filter(name => name.endsWith(".browser.mjs")).sort()) {
  console.log(`\nBrowser suite: ${file}`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(file, directory))], {
    cwd: root, stdio: "inherit", windowsHide: true
  });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status || 1);
}
