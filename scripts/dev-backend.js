const { spawnSync } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

const isWin = os.platform() === "win32";
const pyExec = isWin ? "python.exe" : "python";
const venvPath = isWin
  ? path.join(__dirname, "..", ".venv", "Scripts")
  : path.join(__dirname, "..", ".venv", "bin");
let pyPath = path.join(venvPath, pyExec);

if (!fs.existsSync(pyPath)) {
  console.log(
    `[API] .venv not found at ${pyPath}, falling back to global python...`,
  );
  pyPath = isWin ? "python" : "python3";
}

console.log(`[API] Starting uvicorn using ${pyPath}...`);

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
    cwd: "backend",
    stdio: "inherit",
    shell: isWin, // shell true on windows helps resolve paths sometimes
  },
);

process.exit(result.status || 0);
