#!/bin/bash

# ============================================================
# Setup PgBouncer userlist.txt
# Run this after docker compose up to generate proper auth
# ============================================================

set -e

GREEN='\033[0;32m'
NC='\033[0m'

echo "Setting up PgBouncer authentication..."

# Load password from .env
if [ -f .env ]; then
    source .env
else
    echo "Error: .env file not found"
    exit 1
fi

# Create pgbouncer directory
mkdir -p volumes/pgbouncer

# Get password hashes from the running database
echo "Getting password hashes from database..."

docker exec supabase-db psql -U postgres -t -c "
SELECT '\"' || usename || '\" \"' || passwd || '\"'
FROM pg_shadow
WHERE usename IN ('postgres', 'authenticator', 'supabase_auth_admin', 'supabase_storage_admin', 'supabase_admin', 'anon', 'authenticated', 'service_role')
ORDER BY usename;
" > volumes/pgbouncer/userlist.txt

echo -e "${GREEN}✓${NC} PgBouncer userlist.txt created"
echo ""
echo "Restart PgBouncer to apply changes:"
echo "  docker compose restart pgbouncer"
