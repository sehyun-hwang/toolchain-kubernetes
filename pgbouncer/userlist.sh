# shellcheck shell=bash

set -eu

cat /etc/hosts

DB_HOST="${1:-default-postgres.cwggjv4mxugb.us-west-2.rds.amazonaws.com}"
if [[ $DB_HOST =~ \.([a-z0-9-]+)\.rds\.amazonaws\.com$ ]]; then
  REGION="${BASH_REMATCH[1]}"
else
  echo "No match"
  exit 1
fi

export PGPASSWORD="$(aws rds generate-db-auth-token --hostname $DB_HOST --port 5432 --region $REGION --username $PGUSER)"
psql -h $DB_HOST -c "SELECT 1"

echo "\"$PGUSER\" \"$PGPASSWORD\"" | tee userlist.txt

VOLUME=$(docker volume ls -q -f label=com.docker.compose.volume=pgbouncer-cert)
nerdctl run -it --rm -v $VOLUME:/mnt alpine wget -nc https://truststore.pki.rds.amazonaws.com/$REGION/$REGION-bundle.pem -O /mnt/bundle.pem
nerdctl compose down
nerdctl compose run -i=false -d \
  -e DB_HOST=$DB_HOST -e DB_USER=$PGUSER -e DB_NAME=$PGDATABASE \
  pgbouncer
sleep 5
CONTAINER_ID=$(nerdctl ps -aqf label=com.docker.compose.service=pgbouncer)
nerdctl logs $CONTAINER_ID

nerdctl exec -e PGPORT=6432 -e PGDATABASE -e PGUSER $CONTAINER_ID \
  psql -h localhost -c "SELECT 1" || (
  nerdctl logs $CONTAINER_ID
  false
)
