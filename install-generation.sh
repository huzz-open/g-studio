#!/usr/bin/env bash
# External installer. Keep environment/model preparation in start-generation.sh.
set -eu
set -o pipefail
site=${G_STUDIO_SITE:-}
install_dir=${G_STUDIO_INSTALL_DIR:-"$HOME/.g-studio/backend"}
host=127.0.0.1
port=8765
origins=
device=auto
mirror=cn
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      printf '%s\n' 'Usage: bash install-generation.sh --site https://your-site/base/ [--host 0.0.0.0] [--port 8765] [--dir PATH] [--origin ORIGIN] [--cpu|--cuda|--mps] [--mirror cn|default]'
      exit 0 ;;
    --site|--dir|--host|--port|--origin|--mirror)
      [ "$#" -ge 2 ] && [ -n "$2" ] || { echo "Missing value for $1" >&2; exit 1; }
      case "$1" in
        --site) site=$2 ;; --dir) install_dir=$2 ;; --host) host=$2 ;; --port) port=$2 ;;
        --origin) origins="${origins:+$origins,}$2" ;; --mirror) mirror=$2 ;;
      esac
      shift 2 ;;
    --cpu|--cuda|--mps)
      [ "$device" = auto ] || { echo 'Choose only one compute device.' >&2; exit 1; }
      device=${1#--}; shift ;;
    *) echo "Unknown installer option: $1" >&2; exit 1 ;;
  esac
done
case "$site" in http://*|https://*) ;; *) echo '--site must be the frontend site URL, including its deployment subpath.' >&2; exit 1 ;; esac
case "$site" in *\?*|*\#*|*\@*|*\ *|*\'*) echo 'Invalid site URL.' >&2; exit 1 ;; esac
case "$host" in 127.0.0.1|0.0.0.0|localhost) ;; *) echo '--host must be 127.0.0.1 or 0.0.0.0.' >&2; exit 1 ;; esac
case "$port" in ''|*[!0-9]*) echo 'Invalid port.' >&2; exit 1 ;; esac
[ "${#port}" -le 5 ] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || { echo 'Port must be between 1 and 65535.' >&2; exit 1; }
case "$mirror" in cn|default) ;; *) echo '--mirror must be cn or default.' >&2; exit 1 ;; esac
case "$(uname -s)" in Darwin|Linux|MINGW*|MSYS*|CYGWIN*) ;; *) echo 'Use macOS/Linux Terminal or Windows Git Bash.' >&2; exit 1 ;; esac
for tool in curl tar awk sed mktemp; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Required tool is missing: $tool" >&2; exit 1; }
done
if command -v sha256sum >/dev/null 2>&1; then hash_file() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }
else echo 'sha256sum or shasum is required.' >&2; exit 1; fi
site=${site%/}
site_origin=$(printf '%s' "$site" | sed -E 's#^(https?://[^/]+).*#\1#')
origins="http://localhost:5173,http://127.0.0.1:5173,$site_origin${origins:+,$origins}"
# Refuse relative paths so reruns and generated start commands use one location.
case "$install_dir" in /*|[A-Za-z]:/*|[A-Za-z]:\\*) ;; *) echo '--dir must be an absolute path.' >&2; exit 1 ;; esac
mkdir -p "$install_dir"
install_dir=$(CDPATH= cd -- "$install_dir" && pwd)
download() {
  destination=$2
  if command -v cygpath >/dev/null 2>&1; then destination=$(cygpath -m "$destination"); fi
  curl --fail --location --retry 3 --connect-timeout 20 --max-time 180 "$1" -o "$destination"
}
staging=$(mktemp -d "$install_dir/.install.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT
echo '[generation] Checking the source distribution'
download "$site/generation-source.sha256" "$staging/source.sha256"
expected=$(awk 'NR==1 {print $1}' "$staging/source.sha256")
case "$expected" in ''|*[!a-f0-9]*) echo 'Invalid source checksum manifest.' >&2; exit 1 ;; esac
[ "${#expected}" -eq 64 ] || { echo 'Invalid source checksum length.' >&2; exit 1; }
source_dir="$install_dir/versions/$expected"
if [ ! -f "$source_dir/.installed-source" ] || [ "$(cat "$source_dir/.installed-source")" != "$expected" ]; then
  [ ! -e "$source_dir" ] || { echo "Incomplete source directory: $source_dir. It has not been overwritten." >&2; exit 1; }
  download "$site/generation-source-$expected.tar.gz" "$staging/source.tar.gz"
  [ "$(hash_file "$staging/source.tar.gz")" = "$expected" ] || { echo 'Source checksum mismatch; existing installation was not changed.' >&2; exit 1; }
  tar -tzf "$staging/source.tar.gz" > "$staging/entries"
  # Accept only our source tree, never absolute paths or parent traversal.
  while IFS= read -r entry; do
    case "$entry" in /*|../*|*/../*|*/..) echo 'Invalid source archive path.' >&2; exit 1 ;; esac
    case "$entry" in start-generation.sh|scripts/generation|scripts/generation/*|services/generation-python|services/generation-python/*) ;; *) echo "Unexpected source archive entry: $entry" >&2; exit 1 ;; esac
  done < "$staging/entries"
  mkdir "$staging/source"
  tar -xzf "$staging/source.tar.gz" -C "$staging/source"
  for required in start-generation.sh scripts/generation/start.mjs scripts/generation/bootstrap.mjs services/generation-python/server.py services/generation-python/requirements-base.lock services/generation-python/requirements-model.lock; do
    [ -f "$staging/source/$required" ] || { echo "Incomplete source archive: $required" >&2; exit 1; }
  done
  printf '%s\n' "$expected" > "$staging/source/.installed-source"
  mkdir -p "$install_dir/versions"
  mv "$staging/source" "$source_dir"
fi
if [ "$mirror" = cn ]; then
  printf '%s\n' '{"version":1,"profile":"cn"}' > "$source_dir/.generation-mirrors.local.json"
else
  printf '%s\n' '{"version":1,"profile":"default"}' > "$source_dir/.generation-mirrors.local.json"
fi
quote() { printf "'"; printf '%s' "$1" | sed "s/'/'\\\\''/g"; printf "'"; }
resource_home="$install_dir/resources"
data_home="$install_dir/data"
if command -v cygpath >/dev/null 2>&1; then
  resource_home=$(cygpath -m "$resource_home")
  data_home=$(cygpath -m "$data_home")
fi
# Keep cache and credentials outside the versioned sources. Never source a
# remote config or overwrite a user's checkout. No sudo/global installs.
{
  printf '#!/usr/bin/env sh\nset -eu\n'
  for name in GEN_HOME GEN_DATA_HOME GEN_HOST GEN_PORT GEN_ORIGINS GEN_DEVICE GEN_RESTART_COMMAND; do
    case "$name" in
      GEN_HOME) value=$resource_home ;; GEN_DATA_HOME) value=$data_home ;;
      GEN_HOST) value=$host ;; GEN_PORT) value=$port ;; GEN_ORIGINS) value=$origins ;; GEN_DEVICE) value=$device ;;
      GEN_RESTART_COMMAND) value="sh $(quote "$install_dir/start.sh")" ;;
    esac
    printf 'export %s=' "$name"; quote "$value"; printf '\n'
  done
  printf 'exec sh '; quote "$source_dir/start-generation.sh"; printf ' "$@"\n'
} > "$staging/start.sh"
chmod +x "$staging/start.sh"
mv "$staging/start.sh" "$install_dir/start.sh"
echo "[generation] Installation: $install_dir"
echo "[generation] Start again: sh $(quote "$install_dir/start.sh")"
echo '[generation] Preparing the backend; keep this terminal open. Ctrl+C stops it.'
sh "$install_dir/start.sh"
