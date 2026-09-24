# Deploying Evangeline to evangeline.heraldsqr.com

The site runs on the Lightsail instance `bitnami@34.196.139.243` (key:
`~/Documents/heraldsqr/lightsail.pem`), behind Cloudflare.

| Piece | Where | How it runs |
|---|---|---|
| Reader (this app, Nitro `node-server` build) | `~/projects/evangeline-reader/current` → `releases/<timestamp>` | pm2 process `evangeline-reader` on `127.0.0.1:3002` |
| Narration (Kokoro TTS) | `~/projects/evangeline` | systemd `evangeline.service` on `127.0.0.1:8880` |
| nginx site | `/opt/bitnami/nginx/conf/server_blocks/evangeline.conf` (source: `deploy/evangeline.nginx.conf`) | `/v1/audio/*` → Kokoro (rate-limited), everything else → reader |

The hosted build narrates through its own site (`VITE_NARRATION_BASE=same-origin`),
so each sentence being read is sent to the server's Kokoro. The landing copy says so.
A local build (no flag) keeps talking only to Kokoro on the listener's machine.

## Release

```sh
# 1. Build (from reader-app/)
NITRO_PRESET=node-server VITE_NARRATION_BASE=same-origin npm run build
TS=$(date +%Y%m%d%H%M%S)
COPYFILE_DISABLE=1 tar -czf /tmp/evangeline-reader-$TS.tgz -C .output .

# 2. Upload and unpack next to the previous releases
K=~/Documents/heraldsqr/lightsail.pem; H=bitnami@34.196.139.243
ssh -i $K $H "mkdir -p ~/projects/evangeline-reader/releases/$TS"
scp -i $K /tmp/evangeline-reader-$TS.tgz $H:projects/evangeline-reader/
ssh -i $K $H "cd ~/projects/evangeline-reader && tar -xzf evangeline-reader-$TS.tgz -C releases/$TS && rm evangeline-reader-$TS.tgz"

# 3. Switch and reload (zero config change; pm2 follows the symlink)
ssh -i $K $H "cd ~/projects/evangeline-reader && ln -sfn releases/$TS current && pm2 reload evangeline-reader && pm2 save"
```

First-time setup only (already done on 2026-09-24):

```sh
PORT=3002 HOST=127.0.0.1 NODE_ENV=production \
  pm2 start /home/bitnami/projects/evangeline-reader/current/server/index.mjs --name evangeline-reader
pm2 save
```

## Changing the nginx site

```sh
scp -i $K deploy/evangeline.nginx.conf deploy/rollback.sh $H:projects/evangeline-reader/
ssh -i $K $H 'C=/opt/bitnami/nginx/conf/server_blocks/evangeline.conf
  sudo cp $C $C.bak-$(date +%Y%m%d%H%M%S)
  sudo cp ~/projects/evangeline-reader/evangeline.nginx.conf $C
  sudo /opt/bitnami/nginx/sbin/nginx -t && sudo /opt/bitnami/nginx/sbin/nginx -s reload'
```

The config trusts `CF-Connecting-IP` only from Cloudflare's published ranges
(https://www.cloudflare.com/ips/). Refresh that list if Cloudflare changes it.

## Kokoro memory cap

`deploy/kokoro-memory.conf` is installed as
`/etc/systemd/system/evangeline.service.d/memory.conf`:
- `MemoryHigh=1200M`: reclaim and slow down above this.
- `MemoryMax=1600M`: above this, systemd kills Kokoro alone and restarts it in 5 s.
- `MemorySwapMax=0`: Kokoro can't use swap.

Normal use is about 1.0 GB (0.7 GB of its own memory plus 0.3 GB of model cache).

```sh
ssh -i $K $H 'sudo install -m 644 /dev/stdin /etc/systemd/system/evangeline.service.d/memory.conf' < deploy/kokoro-memory.conf
ssh -i $K $H 'sudo systemctl daemon-reload'        # applies to the running service, no restart

# Watching it
ssh -i $K $H 'echo $(( $(cat /sys/fs/cgroup/system.slice/evangeline.service/memory.current) / 1048576 )) MB; \
  systemctl show evangeline -p NRestarts; journalctl -u evangeline --since -1d | grep -i oom'
```

A non-zero `NRestarts` or an `oom` line means Kokoro hit the ceiling and was restarted.

## Checks after a release

```sh
U=https://evangeline.heraldsqr.com
curl -s -o /dev/null -w "%{http_code}\n" $U/                  # 200, <title>Evangeline
curl -s -o /dev/null -w "%{http_code}\n" $U/v1/audio/voices   # 200
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" -X POST -H 'Content-Type: application/json' \
  -d '{"input":"Check.","voice":"af_heart"}' $U/v1/audio/speech  # 200 audio/wav
ssh -i $K $H 'pm2 describe evangeline-reader | grep -E " status | restarts "'
```

## Rolling back

- **A bad reader release:** point `current` at the previous `releases/<timestamp>`, then `pm2 reload evangeline-reader`.
- **Back to the old pdf-reader site:** run `~/projects/evangeline-reader/rollback.sh`. It restores the newest `evangeline.conf.bak-*`, reloads nginx and stops the reader. The first backup, `evangeline.conf.bak-20260924022704`, is the old pdf-reader configuration.
