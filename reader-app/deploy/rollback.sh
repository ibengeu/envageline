#!/bin/sh
# Puts evangeline.heraldsqr.com back on the configuration it had before the
# last reader release: restores the nginx site file saved by the deploy and
# stops the reader process. Kokoro (evangeline.service) is left running.
set -eu
CONF=/opt/bitnami/nginx/conf/server_blocks/evangeline.conf
BACKUP=$(ls -t "$CONF".bak-* 2>/dev/null | head -1)
[ -n "$BACKUP" ] || { echo "no nginx backup found next to $CONF" >&2; exit 1; }
sudo cp "$BACKUP" "$CONF"
sudo /opt/bitnami/nginx/sbin/nginx -t
sudo /opt/bitnami/ctlscript.sh reload nginx 2>/dev/null || sudo /opt/bitnami/nginx/sbin/nginx -s reload
pm2 stop evangeline-reader || true
echo "restored $BACKUP"
