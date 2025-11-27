#!/bin/bash

# ============================================================
# Supabase Cloud → Self-Hosted Migration Script
# ============================================================
#
# This script migrates:
# - Database schema (tables, views, functions, RLS policies)
# - All table data
# - Auth users (with password hashes - passwords will work!)
#
# Prerequisites:
# - pg_dump and psql installed (sudo apt install postgresql-client)
#
# Usage:
#   chmod +x migrate.sh
#   ./migrate.sh
# ============================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     Supabase Cloud → Self-Hosted Migration Script             ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check prerequisites
echo -e "${CYAN}[1/6]${NC} Checking prerequisites..."
if ! command -v pg_dump &> /dev/null; then
    echo -e "${RED}✗ pg_dump not found. Install with: sudo apt install postgresql-client${NC}"
    exit 1
fi
if ! command -v psql &> /dev/null; then
    echo -e "${RED}✗ psql not found. Install with: sudo apt install postgresql-client${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} pg_dump and psql found"

# Source (Cloud) credentials
echo -e "\n${CYAN}[2/6]${NC} Enter SOURCE (Supabase Cloud) credentials"
echo -e "${YELLOW}Find these at: Dashboard → Settings → Database → Connection string${NC}\n"

read -p "Cloud DB Host (e.g., db.xxxxx.supabase.co): " SOURCE_HOST
read -p "Cloud DB Port [6543]: " SOURCE_PORT
SOURCE_PORT=${SOURCE_PORT:-6543}
read -p "Cloud DB User [postgres]: " SOURCE_USER
SOURCE_USER=${SOURCE_USER:-postgres}
read -sp "Cloud DB Password: " SOURCE_PASSWORD
echo ""
read -p "Cloud DB Name [postgres]: " SOURCE_DB
SOURCE_DB=${SOURCE_DB:-postgres}

# Target (Self-hosted) credentials
echo -e "\n${CYAN}[3/6]${NC} Enter TARGET (Self-Hosted) credentials"

# Try to read from .env
if [ -f .env ]; then
    TARGET_PASSWORD=$(grep "^POSTGRES_PASSWORD=" .env | cut -d'=' -f2)
    if [ -n "$TARGET_PASSWORD" ]; then
        echo -e "${GREEN}Found password in .env file${NC}"
        read -p "Use password from .env? [Y/n]: " USE_ENV
        if [ "$USE_ENV" = "n" ] || [ "$USE_ENV" = "N" ]; then
            read -sp "Self-Hosted DB Password: " TARGET_PASSWORD
            echo ""
        fi
    fi
else
    read -sp "Self-Hosted DB Password: " TARGET_PASSWORD
    echo ""
fi

read -p "Self-Hosted DB Host [localhost]: " TARGET_HOST
TARGET_HOST=${TARGET_HOST:-localhost}
read -p "Self-Hosted DB Port [5432]: " TARGET_PORT
TARGET_PORT=${TARGET_PORT:-5432}

# Create backup directory
BACKUP_DIR="./migration_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
echo -e "${GREEN}✓${NC} Created backup directory: $BACKUP_DIR"

# Test connections
echo -e "\n${CYAN}[4/6]${NC} Testing connections..."

if PGPASSWORD="$SOURCE_PASSWORD" psql -h "$SOURCE_HOST" -p "$SOURCE_PORT" -U "$SOURCE_USER" -d "$SOURCE_DB" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Connected to Cloud database"
else
    echo -e "${RED}✗ Cannot connect to Cloud database${NC}"
    exit 1
fi

if PGPASSWORD="$TARGET_PASSWORD" psql -h "$TARGET_HOST" -p "$TARGET_PORT" -U postgres -d postgres -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Connected to Self-Hosted database"
else
    echo -e "${RED}✗ Cannot connect to Self-Hosted database. Is it running?${NC}"
    exit 1
fi

# Export from Cloud
echo -e "\n${CYAN}[5/6]${NC} Exporting from Cloud Supabase..."

echo "  Exporting public schema (structure)..."
PGPASSWORD="$SOURCE_PASSWORD" pg_dump \
    -h "$SOURCE_HOST" \
    -p "$SOURCE_PORT" \
    -U "$SOURCE_USER" \
    -d "$SOURCE_DB" \
    --schema=public \
    --schema-only \
    --no-owner \
    --no-privileges \
    --no-comments \
    -f "$BACKUP_DIR/schema.sql" 2>/dev/null
echo -e "${GREEN}✓${NC} Schema exported"

echo "  Exporting public schema (data)..."
PGPASSWORD="$SOURCE_PASSWORD" pg_dump \
    -h "$SOURCE_HOST" \
    -p "$SOURCE_PORT" \
    -U "$SOURCE_USER" \
    -d "$SOURCE_DB" \
    --schema=public \
    --data-only \
    --no-owner \
    --no-privileges \
    --disable-triggers \
    -f "$BACKUP_DIR/data.sql" 2>/dev/null
echo -e "${GREEN}✓${NC} Data exported"

echo "  Exporting auth.users..."
PGPASSWORD="$SOURCE_PASSWORD" psql \
    -h "$SOURCE_HOST" \
    -p "$SOURCE_PORT" \
    -U "$SOURCE_USER" \
    -d "$SOURCE_DB" \
    -c "\copy (SELECT * FROM auth.users) TO '$BACKUP_DIR/auth_users.csv' WITH CSV HEADER" 2>/dev/null || echo -e "${YELLOW}⚠${NC} Could not export auth.users (permission issue)"

echo "  Exporting auth.identities..."
PGPASSWORD="$SOURCE_PASSWORD" psql \
    -h "$SOURCE_HOST" \
    -p "$SOURCE_PORT" \
    -U "$SOURCE_USER" \
    -d "$SOURCE_DB" \
    -c "\copy (SELECT * FROM auth.identities) TO '$BACKUP_DIR/auth_identities.csv' WITH CSV HEADER" 2>/dev/null || echo -e "${YELLOW}⚠${NC} Could not export auth.identities"

# Import to Self-Hosted
echo -e "\n${CYAN}[6/6]${NC} Importing to Self-Hosted..."

read -p "Ready to import? This may affect existing data. Continue? [y/N]: " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo -e "${YELLOW}Cancelled. Backup saved in: $BACKUP_DIR${NC}"
    exit 0
fi

echo "  Importing schema..."
PGPASSWORD="$TARGET_PASSWORD" psql \
    -h "$TARGET_HOST" \
    -p "$TARGET_PORT" \
    -U postgres \
    -d postgres \
    -f "$BACKUP_DIR/schema.sql" 2>/dev/null || echo -e "${YELLOW}⚠${NC} Some schema errors (tables may exist)"

echo "  Importing data..."
PGPASSWORD="$TARGET_PASSWORD" psql \
    -h "$TARGET_HOST" \
    -p "$TARGET_PORT" \
    -U postgres \
    -d postgres \
    -f "$BACKUP_DIR/data.sql" 2>/dev/null || echo -e "${YELLOW}⚠${NC} Some data errors"

# Import auth users
if [ -f "$BACKUP_DIR/auth_users.csv" ] && [ -s "$BACKUP_DIR/auth_users.csv" ]; then
    echo "  Importing auth users..."

    # Get column names from CSV header
    COLUMNS=$(head -1 "$BACKUP_DIR/auth_users.csv")

    PGPASSWORD="$TARGET_PASSWORD" psql \
        -h "$TARGET_HOST" \
        -p "$TARGET_PORT" \
        -U postgres \
        -d postgres \
        -c "\copy auth.users($COLUMNS) FROM '$BACKUP_DIR/auth_users.csv' WITH CSV HEADER" 2>/dev/null \
        && echo -e "${GREEN}✓${NC} Auth users imported" \
        || echo -e "${YELLOW}⚠${NC} Auth users import had issues (duplicates?)"
fi

# Done!
echo -e "\n${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Migration Complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Backup files: $BACKUP_DIR"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Update your app's Supabase configuration:"
echo "     URL: http://$TARGET_HOST:8000"
echo "     Anon Key: (from your .env file)"
echo ""
echo "  2. For Edge Functions, copy them to:"
echo "     ./volumes/functions/"
echo ""
echo "  3. Test your application!"
echo ""
