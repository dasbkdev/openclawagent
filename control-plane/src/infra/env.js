import fs from "node:fs";
import path from "node:path";

export function loadEnvFile({ projectRoot, env = process.env } = {}) {
  const candidates = [
    env.CONTROL_PLANE_ENV_FILE,
    defaultProgramDataEnvPath(),
    projectRoot ? path.join(projectRoot, ".env") : undefined,
  ].filter(Boolean);

  const loaded = [];
  for (const filePath of candidates) {
    if (!filePath || !fs.existsSync(filePath)) {
      continue;
    }
    const values = parseEnvFile(fs.readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(values)) {
      if (env[key] === undefined) {
        env[key] = value;
      }
    }
    loaded.push(filePath);
  }
  return loaded;
}

export function parseEnvFile(raw) {
  const values = {};
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = unquoteEnvValue(trimmed.slice(separator + 1).trim());
    if (/^[A-Z_][A-Z0-9_]*$/u.test(key)) {
      values[key] = value;
    }
  }
  return values;
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function defaultProgramDataEnvPath() {
  const programData = process.env.ProgramData;
  return programData ? path.join(programData, "CompanyControlPlane", ".env") : undefined;
}
