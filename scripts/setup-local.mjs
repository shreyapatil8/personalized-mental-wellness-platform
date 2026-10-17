import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
const backend = fileURLToPath(new URL("../backend/.env", import.meta.url));
const example = fileURLToPath(new URL("../backend/.env.example", import.meta.url));
let content = readFileSync(existsSync(backend) ? backend : example, "utf8");
if (existsSync(backend) && !existsSync(`${backend}.pre-research`)) copyFileSync(backend, `${backend}.pre-research`);
const secret = /^JWT_SECRET=(.*)$/m.exec(content)?.[1]?.trim() || "";
let rotated = false;
if (secret.length < 32 || secret.includes("replace-with")) {
  const replacement = `JWT_SECRET=${randomBytes(48).toString("hex")}`;
  content = /^JWT_SECRET=/m.test(content) ? content.replace(/^JWT_SECRET=.*$/m, replacement) : `${content}\n${replacement}\n`;
  rotated = true;
}
// Remove only the retired prototype model and nonexistent developer-specific executable.
content = content.replace(/^ML_MODEL_PATH=.*wellness-risk-model\.joblib.*$/m, "ML_MODEL_PATH=");
content = content.replace(/^PYTHON_EXECUTABLE=.*Users[\\/]Asus[\\/].*$/m, "PYTHON_EXECUTABLE=");
writeFileSync(backend, content);
const frontend = fileURLToPath(new URL("../frontend/.env", import.meta.url));
if (!existsSync(frontend)) copyFileSync(fileURLToPath(new URL("../frontend/.env.example", import.meta.url)), frontend);
console.log(`Local configuration ready. Existing database/provider settings preserved. JWT secret ${rotated ? "replaced; sign in again" : "preserved"}.`);
