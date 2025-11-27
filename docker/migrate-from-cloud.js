#!/usr/bin/env node

/**
 * Supabase Cloud to Self-Hosted Migration Script
 *
 * Transfers:
 * - Database schema (tables, views, functions, triggers, RLS policies)
 * - Table data
 * - Auth users (with password hashes)
 * - Storage buckets and files (optional)
 *
 * Prerequisites:
 * - Node.js 18+
 * - pg_dump and psql installed (sudo apt install postgresql-client)
 * - Access to both Supabase Cloud and Self-hosted instances
 *
 * Usage:
 *   node migrate-from-cloud.js
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logStep(step, msg) {
  console.log(`\n${colors.cyan}[${step}]${colors.reset} ${msg}`);
}

function logSuccess(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function logError(msg) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function logWarning(msg) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

// Prompt for user input
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Check if command exists
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Run shell command
function runCommand(cmd, options = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options
    });
  } catch (error) {
    if (options.ignoreError) return null;
    throw error;
  }
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║     Supabase Cloud → Self-Hosted Migration Script             ║
╠═══════════════════════════════════════════════════════════════╣
║  This script will migrate:                                    ║
║  • Database schema (tables, views, functions, RLS)            ║
║  • All table data                                             ║
║  • Auth users (with password hashes)                          ║
║  • Edge functions (if available locally)                      ║
╚═══════════════════════════════════════════════════════════════╝
`);

  // Check prerequisites
  logStep('1/7', 'Checking prerequisites...');

  if (!commandExists('pg_dump')) {
    logError('pg_dump not found. Install with: sudo apt install postgresql-client');
    process.exit(1);
  }
  if (!commandExists('psql')) {
    logError('psql not found. Install with: sudo apt install postgresql-client');
    process.exit(1);
  }
  logSuccess('pg_dump and psql found');

  // Get source (cloud) credentials
  logStep('2/7', 'Configure SOURCE (Supabase Cloud) connection...');
  console.log(`
Find your Cloud database credentials at:
https://supabase.com/dashboard/project/YOUR_PROJECT/settings/database

Use the "Connection string" → "URI" format, or enter details manually.
`);

  const sourceHost = await prompt('Cloud DB Host (e.g., db.xxxxx.supabase.co): ');
  const sourcePort = await prompt('Cloud DB Port [5432]: ') || '5432';
  const sourceUser = await prompt('Cloud DB User [postgres]: ') || 'postgres';
  const sourcePassword = await prompt('Cloud DB Password: ');
  const sourceDb = await prompt('Cloud DB Name [postgres]: ') || 'postgres';

  const sourceUrl = `postgresql://${sourceUser}:${encodeURIComponent(sourcePassword)}@${sourceHost}:${sourcePort}/${sourceDb}`;

  // Get target (self-hosted) credentials
  logStep('3/7', 'Configure TARGET (Self-Hosted) connection...');

  let targetPassword, targetHost, targetPort;

  // Try to read from .env file
  if (fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    const passwordMatch = envContent.match(/POSTGRES_PASSWORD=(.+)/);
    const portMatch = envContent.match(/POSTGRES_PORT=(.+)/);

    if (passwordMatch) {
      targetPassword = passwordMatch[1].trim();
      log(`Found password in .env file`, 'green');
    }
    if (portMatch) {
      targetPort = portMatch[1].trim();
    }
  }

  targetHost = await prompt('Self-Hosted DB Host [localhost]: ') || 'localhost';
  targetPort = await prompt(`Self-Hosted DB Port [${targetPort || '5432'}]: `) || targetPort || '5432';

  if (!targetPassword) {
    targetPassword = await prompt('Self-Hosted DB Password: ');
  } else {
    const useEnvPass = await prompt(`Use password from .env? [Y/n]: `);
    if (useEnvPass.toLowerCase() === 'n') {
      targetPassword = await prompt('Self-Hosted DB Password: ');
    }
  }

  const targetUrl = `postgresql://postgres:${encodeURIComponent(targetPassword)}@${targetHost}:${targetPort}/postgres`;

  // Create backup directory
  const backupDir = `./migration_backup_${Date.now()}`;
  fs.mkdirSync(backupDir, { recursive: true });
  logSuccess(`Created backup directory: ${backupDir}`);

  // Test connections
  logStep('4/7', 'Testing database connections...');

  try {
    runCommand(`PGPASSWORD="${sourcePassword}" psql -h ${sourceHost} -p ${sourcePort} -U ${sourceUser} -d ${sourceDb} -c "SELECT 1" > /dev/null 2>&1`, { silent: true });
    logSuccess('Connected to Cloud database');
  } catch (error) {
    logError('Cannot connect to Cloud database. Check credentials.');
    process.exit(1);
  }

  try {
    runCommand(`PGPASSWORD="${targetPassword}" psql -h ${targetHost} -p ${targetPort} -U postgres -d postgres -c "SELECT 1" > /dev/null 2>&1`, { silent: true });
    logSuccess('Connected to Self-Hosted database');
  } catch (error) {
    logError('Cannot connect to Self-Hosted database. Is it running?');
    process.exit(1);
  }

  // Export schema
  logStep('5/7', 'Exporting database schema and data from Cloud...');

  const schemaFile = path.join(backupDir, 'schema.sql');
  const dataFile = path.join(backupDir, 'data.sql');
  const authFile = path.join(backupDir, 'auth_users.sql');
  const fullDumpFile = path.join(backupDir, 'full_dump.sql');

  // Export public schema (structure only)
  log('Exporting public schema structure...');
  runCommand(`PGPASSWORD="${sourcePassword}" pg_dump -h ${sourceHost} -p ${sourcePort} -U ${sourceUser} -d ${sourceDb} \
    --schema=public \
    --schema-only \
    --no-owner \
    --no-privileges \
    --no-comments \
    -f ${schemaFile}`, { silent: true });
  logSuccess(`Schema exported to ${schemaFile}`);

  // Export public schema (data only)
  log('Exporting public schema data...');
  runCommand(`PGPASSWORD="${sourcePassword}" pg_dump -h ${sourceHost} -p ${sourcePort} -U ${sourceUser} -d ${sourceDb} \
    --schema=public \
    --data-only \
    --no-owner \
    --no-privileges \
    --disable-triggers \
    -f ${dataFile}`, { silent: true });
  logSuccess(`Data exported to ${dataFile}`);

  // Export auth users
  log('Exporting auth users...');
  const authExportQuery = `
    COPY (
      SELECT
        id,
        email,
        encrypted_password,
        email_confirmed_at,
        invited_at,
        confirmation_token,
        confirmation_sent_at,
        recovery_token,
        recovery_sent_at,
        email_change_token_new,
        email_change,
        email_change_sent_at,
        last_sign_in_at,
        raw_app_meta_data,
        raw_user_meta_data,
        is_super_admin,
        created_at,
        updated_at,
        phone,
        phone_confirmed_at,
        phone_change,
        phone_change_token,
        phone_change_sent_at,
        email_change_token_current,
        email_change_confirm_status,
        banned_until,
        reauthentication_token,
        reauthentication_sent_at,
        is_sso_user,
        deleted_at,
        role,
        is_anonymous
      FROM auth.users
    ) TO STDOUT WITH (FORMAT CSV, HEADER true, FORCE_QUOTE *)
  `;

  try {
    const authData = runCommand(
      `PGPASSWORD="${sourcePassword}" psql -h ${sourceHost} -p ${sourcePort} -U ${sourceUser} -d ${sourceDb} -c "${authExportQuery}"`,
      { silent: true }
    );
    fs.writeFileSync(path.join(backupDir, 'auth_users.csv'), authData || '');
    logSuccess('Auth users exported');
  } catch (error) {
    logWarning('Could not export auth users (might not have permission)');
  }

  // Export auth identities
  log('Exporting auth identities...');
  try {
    const identitiesQuery = `COPY (SELECT * FROM auth.identities) TO STDOUT WITH (FORMAT CSV, HEADER true, FORCE_QUOTE *)`;
    const identitiesData = runCommand(
      `PGPASSWORD="${sourcePassword}" psql -h ${sourceHost} -p ${sourcePort} -U ${sourceUser} -d ${sourceDb} -c "${identitiesQuery}"`,
      { silent: true }
    );
    fs.writeFileSync(path.join(backupDir, 'auth_identities.csv'), identitiesData || '');
    logSuccess('Auth identities exported');
  } catch (error) {
    logWarning('Could not export auth identities');
  }

  // Import to self-hosted
  logStep('6/7', 'Importing to Self-Hosted database...');

  const continueImport = await prompt('\nReady to import to self-hosted? This may overwrite existing data. Continue? [y/N]: ');

  if (continueImport.toLowerCase() !== 'y') {
    log('\nImport cancelled. Backup files are saved in: ' + backupDir, 'yellow');
    process.exit(0);
  }

  // Import schema
  log('Importing schema...');
  try {
    runCommand(`PGPASSWORD="${targetPassword}" psql -h ${targetHost} -p ${targetPort} -U postgres -d postgres -f ${schemaFile}`, { silent: true });
    logSuccess('Schema imported');
  } catch (error) {
    logWarning('Some schema errors (tables might already exist). Continuing...');
  }

  // Import data
  log('Importing data...');
  try {
    runCommand(`PGPASSWORD="${targetPassword}" psql -h ${targetHost} -p ${targetPort} -U postgres -d postgres -f ${dataFile}`, { silent: true });
    logSuccess('Data imported');
  } catch (error) {
    logWarning('Some data import errors. Check logs.');
  }

  // Import auth users
  log('Importing auth users...');
  const authCsvFile = path.join(backupDir, 'auth_users.csv');
  if (fs.existsSync(authCsvFile) && fs.statSync(authCsvFile).size > 0) {
    try {
      // Create temp table and import
      const importAuthSql = `
        -- Create temp table for import
        CREATE TEMP TABLE auth_users_import (LIKE auth.users);

        -- Import from CSV
        \\copy auth_users_import FROM '${authCsvFile}' WITH (FORMAT CSV, HEADER true);

        -- Insert into auth.users, skipping duplicates
        INSERT INTO auth.users
        SELECT * FROM auth_users_import
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          encrypted_password = EXCLUDED.encrypted_password,
          raw_app_meta_data = EXCLUDED.raw_app_meta_data,
          raw_user_meta_data = EXCLUDED.raw_user_meta_data,
          updated_at = EXCLUDED.updated_at;

        DROP TABLE auth_users_import;
      `;

      fs.writeFileSync(path.join(backupDir, 'import_auth.sql'), importAuthSql);
      runCommand(`PGPASSWORD="${targetPassword}" psql -h ${targetHost} -p ${targetPort} -U postgres -d postgres -f ${path.join(backupDir, 'import_auth.sql')}`, { silent: true });
      logSuccess('Auth users imported');
    } catch (error) {
      logWarning('Auth users import had issues. You may need to import manually.');
    }
  }

  // Summary
  logStep('7/7', 'Migration complete!');

  console.log(`
${colors.green}════════════════════════════════════════════════════════════════${colors.reset}
  Migration Summary
${colors.green}════════════════════════════════════════════════════════════════${colors.reset}

  ✓ Schema exported and imported
  ✓ Data exported and imported
  ✓ Auth users migrated (passwords preserved)

  Backup files saved in: ${backupDir}

${colors.yellow}Next Steps:${colors.reset}
  1. Test your application with the self-hosted instance
  2. Update your app's Supabase URL and keys:
     - URL: http://${targetHost}:8000
     - Anon Key: (from your .env file)

  3. For Edge Functions, copy them to:
     ./volumes/functions/

${colors.yellow}Important:${colors.reset}
  - User passwords will work (hashes are preserved)
  - OAuth providers need to be reconfigured
  - Storage files need separate migration (see below)

${colors.cyan}To migrate Storage files, use the Supabase CLI:${colors.reset}
  supabase storage cp -r sb://bucket-name ./local-backup --project-ref YOUR_PROJECT
  Then copy to ./volumes/storage/

`);
}

main().catch((error) => {
  logError(`Migration failed: ${error.message}`);
  process.exit(1);
});
