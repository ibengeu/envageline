#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
server_dir="$repo_root/pdf-reader/kokoro-server"
reader_dir="$repo_root/reader-app"
python_bin=${PYTHON_BIN:-python3}
venv_dir=${KOKORO_VENV:-"$repo_root/pdf-reader/.venv-kokoro"}
model_dir=${KOKORO_MODEL_DIR:-"$server_dir/models"}
kokoro_host=${KOKORO_HOST:-127.0.0.1}
kokoro_port=${KOKORO_PORT:-8880}
reader_host=${READER_HOST:-127.0.0.1}
reader_port=${READER_PORT:-4173}
reader_fallback_port=${READER_FALLBACK_PORT:-4175}
requested_reader_port=$reader_port
log_dir=${EVANGELINE_LOG_DIR:-"${TMPDIR:-/tmp}"}
kokoro_url="http://$kokoro_host:$kokoro_port"
reader_url="http://$reader_host:$reader_port"
kokoro_log="$log_dir/evangeline-kokoro.log"
reader_log="$log_dir/evangeline-reader.log"

kokoro_pid=""
reader_pid=""
kokoro_started=0
reader_started=0

usage() {
  cat <<EOF
Usage: ./start-local.sh [--check|--help]

Starts the local Kokoro server and the reader app without Docker.

Services:
  Kokoro: $kokoro_url
  Reader: $reader_url
  Reader fallback: http://$reader_host:$reader_fallback_port

The script creates or reuses:
  Python environment: $venv_dir
  Model directory:    $model_dir

Press Ctrl-C to stop processes started by this script.
EOF
}

if [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "${1:-}" = "--check" ]; then
  printf '%s\n' "Kokoro URL: $kokoro_url"
  printf '%s\n' "Reader URL: $reader_url"
  printf '%s\n' "Reader fallback URL: http://$reader_host:$reader_fallback_port"
  printf '%s\n' "Kokoro Python: $venv_dir/bin/python"
  printf '%s\n' "Kokoro command: python -m uvicorn server:app"
  printf '%s\n' "Reader command: npm run dev"
  printf '%s\n' "Shutdown: terminate child process trees on exit"
  exit 0
fi

if [ "$#" -gt 0 ]; then
  echo "Unknown argument: $1" >&2
  usage >&2
  exit 2
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

require_command curl
require_command "$python_bin"
require_command npm

wait_for_url() {
  url=$1
  label=$2
  attempt=0
  max_attempts=180
  while [ "$attempt" -lt "$max_attempts" ]; do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      echo "$label is ready at $url"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "$label did not become ready: $url" >&2
  return 1
}

# OWASP A02:2025 Security Misconfiguration.
# Verify the expected Evangeline response before reusing a listening port.
# This prevents the launcher from silently selecting an unrelated service.
reader_app_is_ready() {
  response=$(curl -fsS --max-time 2 "$reader_url/" 2>/dev/null || true)
  case "$response" in
    *Evangeline*) return 0 ;;
    *) return 1 ;;
  esac
}

wait_for_reader_app() {
  attempt=0
  max_attempts=180
  while [ "$attempt" -lt "$max_attempts" ]; do
    if reader_app_is_ready; then
      echo "Reader app is ready at $reader_url"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "Reader app did not become ready: $reader_url" >&2
  return 1
}

terminate_tree() {
  pid=$1
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  if command -v pgrep >/dev/null 2>&1; then
    children=$(pgrep -P "$pid" 2>/dev/null || true)
    for child in $children; do
      terminate_tree "$child"
    done
  fi
  kill -TERM "$pid" 2>/dev/null || true
}

force_terminate_tree() {
  pid=$1
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  if command -v pgrep >/dev/null 2>&1; then
    children=$(pgrep -P "$pid" 2>/dev/null || true)
    for child in $children; do
      force_terminate_tree "$child"
    done
  fi
  kill -KILL "$pid" 2>/dev/null || true
}

# OWASP A04:2025 Insecure Design.
# Bound shutdown cleanup and stop owned descendants.
# This prevents orphaned local services from consuming resources.
stop_process_tree() {
  pid=$1
  [ -n "$pid" ] || return 0
  if ! kill -0 "$pid" 2>/dev/null; then
    wait "$pid" 2>/dev/null || true
    return 0
  fi
  terminate_tree "$pid"
  attempt=0
  while kill -0 "$pid" 2>/dev/null && [ "$attempt" -lt 30 ]; do
    attempt=$((attempt + 1))
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    force_terminate_tree "$pid"
  fi
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  exit_code=$?
  trap - EXIT INT TERM HUP
  if [ "$reader_started" -eq 1 ]; then
    stop_process_tree "$reader_pid" || true
  fi
  if [ "$kokoro_started" -eq 1 ]; then
    stop_process_tree "$kokoro_pid" || true
  fi
  exit "$exit_code"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

mkdir -p "$log_dir" "$model_dir"

if ! curl -fsS --max-time 2 "$kokoro_url/health" >/dev/null 2>&1; then
  if [ ! -x "$venv_dir/bin/python" ]; then
    echo "Creating Kokoro Python environment at $venv_dir"
    mkdir -p "$(dirname "$venv_dir")"
    "$python_bin" -m venv "$venv_dir"
  fi
  if ! "$venv_dir/bin/python" -c "import fastapi, kokoro_onnx, soundfile, uvicorn" >/dev/null 2>&1; then
    echo "Installing pinned Kokoro dependencies"
    "$venv_dir/bin/python" -m pip install --requirement "$server_dir/requirements.txt"
  fi
  echo "Starting Kokoro server. The first start can download model files."
  (
    cd "$server_dir"
    KOKORO_MODEL_DIR="$model_dir" \
      KOKORO_DEFAULT_VOICE="${KOKORO_DEFAULT_VOICE:-af_heart}" \
      "$venv_dir/bin/python" -m uvicorn server:app --host "$kokoro_host" --port "$kokoro_port"
  ) >>"$kokoro_log" 2>&1 &
  kokoro_pid=$!
  kokoro_started=1
  wait_for_url "$kokoro_url/health" "Kokoro server"
else
  echo "Using the existing Kokoro server at $kokoro_url"
fi

if ! reader_app_is_ready; then
  if curl -fsS --max-time 2 "$reader_url/" >/dev/null 2>&1; then
    reader_port=$reader_fallback_port
    reader_url="http://$reader_host:$reader_port"
    echo "Reader port $requested_reader_port is in use by another service; using $reader_url"
  fi
  echo "Starting reader app at $reader_url"
  (
    cd "$reader_dir"
    npm run dev -- --host "$reader_host" --port "$reader_port"
  ) >>"$reader_log" 2>&1 &
  reader_pid=$!
  reader_started=1
  wait_for_reader_app
else
  echo "Using the existing reader app at $reader_url"
fi

echo "Evangeline is ready at $reader_url"
echo "Logs: $kokoro_log and $reader_log"
if [ "$reader_started" -eq 1 ]; then
  wait "$reader_pid"
elif [ "$kokoro_started" -eq 1 ]; then
  wait "$kokoro_pid"
fi
