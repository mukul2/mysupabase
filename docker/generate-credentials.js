#!/usr/bin/env node

/**
 * Supabase Credentials Generator
 *
 * Generates all required secrets for your Supabase deployment.
 *
 * Usage:
 *   node generate-credentials.js
 *   node generate-credentials.js > .env
 */

const crypto = require('crypto');

// Generate random string
function randomString(length) {
  return crypto.randomBytes(length).toString('base64').replace(/[/+=]/g, '').slice(0, length);
}

// Generate JWT token
function createJWT(payload, secret) {
  const base64url = (str) => Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${headerB64}.${payloadB64}.${signature}`;
}

// Generate all credentials
const POSTGRES_PASSWORD = randomString(40);
const JWT_SECRET = randomString(64);
const SECRET_KEY_BASE = randomString(64);
const VAULT_ENC_KEY = randomString(32);
const PG_META_CRYPTO_KEY = randomString(32);
const LOGFLARE_PUBLIC = randomString(40);
const LOGFLARE_PRIVATE = randomString(40);

// JWT tokens expire in 2027
const jwtPayloadAnon = { role: 'anon', iss: 'supabase', iat: 1641769200, exp: 1799535600 };
const jwtPayloadService = { role: 'service_role', iss: 'supabase', iat: 1641769200, exp: 1799535600 };

const ANON_KEY = createJWT(jwtPayloadAnon, JWT_SECRET);
const SERVICE_ROLE_KEY = createJWT(jwtPayloadService, JWT_SECRET);

// Output .env format
console.log(`############
# Secrets
# Generated on ${new Date().toISOString()}
############

POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
SECRET_KEY_BASE=${SECRET_KEY_BASE}
VAULT_ENC_KEY=${VAULT_ENC_KEY}
PG_META_CRYPTO_KEY=${PG_META_CRYPTO_KEY}


############
# Database
############

POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432


############
# API Proxy - Configuration for the Kong Reverse proxy.
############

KONG_HTTP_PORT=8000
KONG_HTTPS_PORT=8443


############
# API - Configuration for PostgREST.
############

PGRST_DB_SCHEMAS=public,storage,graphql_public


############
# Auth - Configuration for the GoTrue authentication server.
############

## General
SITE_URL=http://localhost:3000
ADDITIONAL_REDIRECT_URLS=
JWT_EXPIRY=3600
DISABLE_SIGNUP=false
API_EXTERNAL_URL=http://localhost:8000

## Mailer Config
MAILER_URLPATHS_CONFIRMATION="/auth/v1/verify"
MAILER_URLPATHS_INVITE="/auth/v1/verify"
MAILER_URLPATHS_RECOVERY="/auth/v1/verify"
MAILER_URLPATHS_EMAIL_CHANGE="/auth/v1/verify"

## Email auth
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
SMTP_ADMIN_EMAIL=admin@example.com
SMTP_HOST=supabase-mail
SMTP_PORT=2500
SMTP_USER=fake_mail_user
SMTP_PASS=fake_mail_password
SMTP_SENDER_NAME=fake_sender
ENABLE_ANONYMOUS_USERS=false

## Phone auth
ENABLE_PHONE_SIGNUP=true
ENABLE_PHONE_AUTOCONFIRM=true


############
# Studio - Configuration for the Dashboard
############

STUDIO_PORT=3000
STUDIO_DEFAULT_ORGANIZATION=Default Organization
STUDIO_DEFAULT_PROJECT=Default Project

# Replace with your VPS IP or domain
SUPABASE_PUBLIC_URL=http://localhost:8000


############
# PgBouncer - Connection Pooling
############

PGBOUNCER_PORT=6543


############
# Functions - Configuration for Edge Functions
############

FUNCTIONS_VERIFY_JWT=false


############
# Logs - Configuration for Analytics (not used in minimal setup)
############

LOGFLARE_PUBLIC_ACCESS_TOKEN=${LOGFLARE_PUBLIC}
LOGFLARE_PRIVATE_ACCESS_TOKEN=${LOGFLARE_PRIVATE}

# Docker socket location - this value will differ depending on your OS
DOCKER_SOCKET_LOCATION=/var/run/docker.sock
`);
