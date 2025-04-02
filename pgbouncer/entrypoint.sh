#!/bin/sh

set -eux

env
/upstream-entrypoint.sh
echo '%include daemon.ini' >>pgbouncer.ini

"$@"
pgbouncer pgbouncer.ini -d
while sleep 895; do
  date
  "$@"
done
