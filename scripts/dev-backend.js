const { spawnSync } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

const isWin = os.platform() === "win32";
const rootDir = path.join(__dirname, "..");
const backendDir = path.join(rootDir, "backend");

const venvCandidates = isWin
  ? [
      path.join(rootDir, ".venv", "Scripts", "python.exe"),
      path.join(rootDir, ".venv", "Scripts", "python"),
      path.join(rootDir, ".venv", "bin", "python"),
      path.join(rootDir, ".venv_linux", "Scripts", "python.exe"),
      path.join(rootDir, ".venv_linux", "bin", "python"),
    ]
  : [
      path.join(rootDir, ".venv_linux", "bin", "python"),
      path.join(rootDir, ".venv", "bin", "python"),
      path.join(rootDir, ".venv", "bin", "python3"),
      path.join(rootDir, ".venv", "Scripts", "python.exe"),
      path.join(rootDir, ".venv", "Scripts", "python"),
    ];

const fallbackCandidates = isWin ? ["python"] : ["python3", "python"];

const unique = [];
for (const candidate of [...venvCandidates, ...fallbackCandidates]) {
  if (!unique.includes(candidate)) unique.push(candidate);
}

function looksLikePath(candidate) {
  return candidate.includes(path.sep) || candidate.includes("/");
}

function hasUvicorn(candidate) {
  const probe = spawnSync(candidate, ["-c", "import uvicorn"], {
    cwd: backendDir,
    stdio: "ignore",
    shell: isWin,
  });
  return probe.status === 0;
}

let pyPath = null;
for (const candidate of unique) {
  if (looksLikePath(candidate) && !fs.existsSync(candidate)) continue;
  if (hasUvicorn(candidate)) {
    pyPath = candidate;
    break;
  }
  console.log(`[API] Skipping ${candidate} (uvicorn not available).`);
}

if (!pyPath) {
  const installHint = isWin
    ? "py -m venv .venv && .venv\\Scripts\\pip install -r backend/requirements.txt"
    : "python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt";
  console.error("[API] No Python interpreter with uvicorn was found.");
  console.error(`[API] Install backend deps with: ${installHint}`);
  process.exit(1);
}

console.log(`[API] Starting uvicorn using ${pyPath}...`);

const backendEnv = { ...process.env };
if (backendEnv.TRANSFORMERS_CACHE && !backendEnv.HF_HOME) {
  // Transformers deprecates TRANSFORMERS_CACHE in favor of HF_HOME.
  backendEnv.HF_HOME = backendEnv.TRANSFORMERS_CACHE;
}

// Spawn the backend server
const result = spawnSync(
  pyPath,
  [
    "-m",
    "uvicorn",
    "main:app",
    "--reload",
    "--reload-exclude",
    "data",
    "--reload-exclude",
    ".models",
    "--reload-exclude",
    "venv",
    "--reload-exclude",
    ".ingest",
    "--port",
    "5000",
    "--host",
    "0.0.0.0",
  ],
  {
    cwd: backendDir,
    stdio: "inherit",
    env: backendEnv,
    shell: isWin, // shell true on windows helps resolve paths sometimes
  },
);

process.exit(result.status || 0);
