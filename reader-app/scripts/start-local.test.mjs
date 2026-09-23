import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const readerAppDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(readerAppDir, "../..");
const startScript = path.resolve(readerAppDir, "../../start-local.sh");

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function waitForFile(filePath, timeoutMs = 3000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (existsSync(filePath)) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${filePath}`));
        return;
      }
      setTimeout(check, 25);
    };
    check();
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

function isAlive(pid) {
  try {
    const status = execFileSync("ps", ["-p", String(pid), "-o", "stat="], {
      encoding: "utf8",
    }).trim();
    return status.length > 0 && !status.startsWith("Z");
  } catch {
    return false;
  }
}

function processDescription(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "pid=,ppid=,stat=,command="], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "not found";
  }
}

async function waitForDead(pid, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (isAlive(pid)) {
    if (Date.now() - startedAt >= timeoutMs) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

test("local startup check describes the loopback app and Kokoro services", () => {
  const output = execFileSync("sh", [startScript, "--check"], {
    encoding: "utf8",
  });

  assert.match(output, /Kokoro URL: http:\/\/127\.0\.0\.1:8880/);
  assert.match(output, /Reader URL: http:\/\/127\.0\.0\.1:4173/);
  assert.match(output, /Reader fallback URL: http:\/\/127\.0\.0\.1:4175/);
  assert.match(output, /npm run dev/);
  assert.doesNotMatch(output, /docker/i);
});

test("shutdown stops child process trees started by the local launcher", async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "evangeline-start-local-"));
  const fakeBin = path.join(tempDir, "bin");
  const venvBin = path.join(tempDir, "venv", "bin");
  const kokoroReady = path.join(tempDir, "kokoro-ready");
  const readerReady = path.join(tempDir, "reader-ready");
  const kokoroChildPid = path.join(tempDir, "kokoro-child.pid");
  const readerChildPid = path.join(tempDir, "reader-child.pid");
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(venvBin, { recursive: true });

  writeExecutable(
    path.join(fakeBin, "curl"),
    `#!/bin/sh
url=""
for argument in "$@"; do url="$argument"; done
case "$url" in
  *8880/health) test -f "$FAKE_KOKORO_READY" ;;
  *4173/)
    test -f "$FAKE_READER_READY" && printf 'Auralis'
    ;;
  *) exit 1 ;;
esac
`,
  );
  writeExecutable(
    path.join(venvBin, "python"),
    `#!/bin/sh
if [ "$1" = "-c" ]; then exit 0; fi
touch "$FAKE_KOKORO_READY"
sleep 60 &
child_pid=$!
echo "$child_pid" > "$FAKE_KOKORO_CHILD_PID"
wait "$child_pid"
`,
  );
  writeExecutable(
    path.join(fakeBin, "npm"),
    `#!/bin/sh
touch "$FAKE_READER_READY"
sleep 60 &
child_pid=$!
echo "$child_pid" > "$FAKE_READER_CHILD_PID"
wait "$child_pid"
`,
  );

  const launcher = spawn(startScript, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      KOKORO_VENV: path.join(tempDir, "venv"),
      KOKORO_MODEL_DIR: path.join(tempDir, "models"),
      EVANGELINE_LOG_DIR: path.join(tempDir, "logs"),
      FAKE_KOKORO_READY: kokoroReady,
      FAKE_READER_READY: readerReady,
      FAKE_KOKORO_CHILD_PID: kokoroChildPid,
      FAKE_READER_CHILD_PID: readerChildPid,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let launcherOutput = "";
  launcher.stdout.on("data", (chunk) => {
    launcherOutput += chunk.toString();
  });
  launcher.stderr.on("data", (chunk) => {
    launcherOutput += chunk.toString();
  });

  t.after(async () => {
    if (launcher.exitCode === null) {
      launcher.kill("SIGKILL");
      await waitForExit(launcher);
    }
    for (const pidFile of [kokoroChildPid, readerChildPid]) {
      if (existsSync(pidFile)) {
        const pid = readFileSync(pidFile, "utf8").trim();
        if (isAlive(pid)) process.kill(Number(pid), "SIGKILL");
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  try {
    await waitForFile(readerReady);
  } catch (error) {
    error.message += `\nLauncher output:\n${launcherOutput}`;
    const kokoroLog = path.join(tempDir, "logs", "evangeline-kokoro.log");
    if (existsSync(kokoroLog)) {
      error.message += `\nKokoro log:\n${readFileSync(kokoroLog, "utf8")}`;
    }
    const readerLog = path.join(tempDir, "logs", "evangeline-reader.log");
    if (existsSync(readerLog)) {
      error.message += `\nReader log:\n${readFileSync(readerLog, "utf8")}`;
    }
    throw error;
  }
  const kokoroPid = readFileSync(kokoroChildPid, "utf8").trim();
  const readerPid = readFileSync(readerChildPid, "utf8").trim();
  launcher.kill("SIGTERM");

  const result = await waitForExit(launcher);
  assert.equal(result.code, 143);
  assert.equal(result.signal, null);
  assert.equal(await waitForDead(kokoroPid), true, processDescription(kokoroPid));
  assert.equal(await waitForDead(readerPid), true, processDescription(readerPid));
});
