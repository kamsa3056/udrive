# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UDrive is a unified Google Drive manager that pools multiple free Google Drive accounts (15GB each) into one seamless storage interface. It uses a shared folder concept where one primary account shares a folder with all other accounts, and uploads are automatically distributed to accounts with available space.

Single codebase that deploys to both Node.js (local/Docker) and Cloudflare Pages.

## Commands

```bash
npm run dev      # Hono server (port 3000) + Vite dev server (port 5173, hot reload)
npm run build    # Build frontend to dist/ + bundle _worker.js for CF Pages
npm start        # Production server (Hono on Node.js, serves dist/)
```

Development: access via `localhost:5173` (Vite proxies /api/, /auth/, /dlink/ to :3000).
Production: access via `localhost:3000`.

## Architecture

**Unified Backend** (`src/`): Hono framework, runs on Node.js and Cloudflare Workers.

- `src/app.js` — Hono app factory, accepts DB getter and env vars, mounts all routes
- `src/local.js` — Node.js entry point (dev/Docker), uses @hono/node-server + better-sqlite3
- `src/cf.js` — Cloudflare Pages entry point, uses D1 + ASSETS binding, auto-migrates schema
- `src/db/index.js` — DB factory + initDB (creates tables, runs migrations, migrates old permissions)
- `src/db/local.js` — better-sqlite3 wrapper that mimics D1 async API (prepare/bind/first/all/run)
- `src/middleware/auth.js` — Session auth: authenticate, requireAuth, requireMaster, requirePermission, hasPageAccess, createSession, deleteSession. Exports ALL_PERMISSIONS and PERMISSION_GROUPS
- `src/middleware/api-auth.js` — API key auth: authenticateApiKey, checkRateLimit, requireApiPermission, generateApiKey
- `src/services/google-drive.js` — All Drive operations via direct REST fetch (no googleapis package)
- `src/services/token-manager.js` — OAuth2 token refresh via fetch
- `src/services/password.js` — PBKDF2 password hashing (Web Crypto API, works in Node.js + Workers)
- `src/services/account-selector.js` — Picks non-primary account with most available space
- `src/services/keep-alive.js` — Upload+delete temp file per account to maintain activity
- `src/services/logger.js` — logActivity() and logSystem() with enable/disable check from settings
- `src/routes/auth.js` — Google OAuth2 flow + callback, auto-shares folder, assigns card colors
- `src/routes/files.js` — File CRUD with per-action permission checks, trash/restore, thumbnail proxy, video range requests, transfer ownership, download tokens
- `src/routes/accounts.js` — Account management, card colors, rclone import/export
- `src/routes/settings.js` — Key-value settings, keep-alive trigger, database export/import
- `src/routes/users.js` — User CRUD, login/logout, permissions, session timeout, password change
- `src/routes/activity.js` — Activity log listing with filters
- `src/routes/logs.js` — System log listing with filters
- `src/routes/api-keys.js` — API key management (CRUD, settings)
- `src/routes/api-v1.js` — Public API endpoints (auth via API key, rate limited)

**Frontend** (`client/`): Vanilla JS SPA built with Vite + TailwindCSS v4.

- Hash-based routing (`#/`, `#/accounts`, `#/settings`, `#/trash`, `#/users`, `#/activity`, `#/logs`, `#/transfer`, `#/api-access`, `#/login`)
- `client/main.js` — Auth flow (check setup → login → init app), route guards using hasPageAccess()
- `client/auth-state.js` — Shared auth state: currentUser, hasPermission, hasPageAccess, PERMISSION_GROUPS
- `client/time-utils.js` — Shared time formatting (timezone + 12/24h from settings)
- `client/pages/files.js` — File manager: grid/list, multi-select (Ctrl/Shift/long-press), copy/cut/paste, file info, preview, lazy thumbnails, transfer ownership modal
- `client/pages/accounts.js` — Account cards (colored grid), rclone import/export, color picker
- `client/pages/settings.js` — Shared folder ID, theme, timezone, time format, keep-alive, logging toggles, download speed, database download/upload, logout
- `client/pages/trash.js` — Trashed files from all accounts
- `client/pages/users.js` — User management (master only): collapsible permission groups per page
- `client/pages/activity.js` — Activity log viewer with filters
- `client/pages/logs.js` — System log viewer with filters
- `client/pages/transfer.js` — Transfer page: full list of uploads/downloads/transfers with controls
- `client/pages/api-access.js` — API key management: keys tab + settings tab
- `client/pages/login.js` — Login form
- `client/pages/setup.js` — First-run wizard
- `client/components/sidebar.js` — Nav filtered by hasPageAccess, storage bar/donut, transfer summary, collapsed mode
- `client/components/transfer-panel.js` — Unified floating panel for uploads/downloads/transfers with pause/cancel, floating button when hidden
- `client/components/logout-modal.js` — Confirmation modal
- `client/components/context-menu.js` — Right-click menu with viewport boundary detection
- `client/components/breadcrumb.js` — Folder navigation breadcrumb

**Key design decisions:**
- DB abstraction: `src/db/local.js` wraps better-sqlite3 to match D1's API (prepare().bind().first/all/run returns Promises)
- All routes use `c.get('db')` for database and `c.env` for Google credentials
- `createApp(getDB, envVars)` factory allows different DB/env injection per deploy target
- Google Drive API uses direct REST fetch, not googleapis package (works in both Node.js and Workers)
- TailwindCSS v4 dark mode: `@custom-variant dark (&:where(.dark, .dark *))` for class-based toggle
- Vite proxy uses trailing slash (`/api/`, `/auth/`, `/dlink/`) to avoid matching files like `api.js`
- Transfer panel is global (persists across page navigation)
- Multi-select: Ctrl+Click (toggle), Shift+Click (range), long-press (mobile)
- `.btn-secondary` uses `@apply flex` which overrides `hidden` — use element replacement instead of class toggle

## Database

SQLite at `data/udrive.db` (local, gitignored). Tables:
- `accounts` — OAuth tokens, storage quota, is_primary, card_color, file_count
- `settings` — Key-value pairs (shared_folder_id, theme, timezone, time_format, keepalive_interval_days, activity_enabled, logs_enabled, download_speed_mbps, api_enabled, api_default_rate_limit, api_cors_origins, api_max_upload_size)
- `file_owners` — Maps file_id to account_id
- `users` — Username, password_hash, role (master/slave), session_timeout_hours
- `user_permissions` — Per-user permission grants
- `sessions` — Session tokens with expiry
- `activity_log` — User action tracking
- `system_log` — System event tracking
- `api_keys` — API key management (name, hash, prefix, permissions, rate_limit, expires_at)
- `api_rate_limits` — Rate limit tracking per key per minute window

## Permission System

Hierarchical, grouped per page. Page is visible if user has at least 1 permission in that group.

```
drive: drive:view, drive:upload, drive:download_browser, drive:download_background, drive:delete, drive:rename, drive:create_folder, drive:move, drive:copy, drive:preview, drive:view_uploader, drive:transfer_owner
trash: trash:view, trash:restore, trash:permanent_delete, trash:empty
accounts: accounts:view, accounts:view_email, accounts:add, accounts:remove, accounts:set_primary, accounts:refresh, accounts:import_export, accounts:color
settings: settings:view, settings:edit, settings:keepalive, settings:database
```

Master has all permissions implicitly. Old permission format (page:*, action:*) is auto-migrated on startup.

## API System

Public API at `/api/v1/*` authenticated via Bearer token (API key format: `udrive_` + 64 hex).
Per-key permissions: `api:files:read`, `api:files:download`, `api:files:upload`, `api:files:write`, `api:files:transfer`, `api:accounts:read`.
Rate limiting per key (requests/minute), configurable.

## Deploy Targets

- **Local/Docker:** `npm start` → `src/local.js` → Hono on @hono/node-server + better-sqlite3
- **Cloudflare Pages:** `npm run build` → upload `dist/` → `_worker.js` (bundled from `src/cf.js`) + D1 database

## Docker

Multi-stage Dockerfile. Volume at `/app/data/` for DB persistence. Reads `.env` if present.

## CF Pages

Build output `dist/` contains frontend + `_worker.js` + `_worker.js.map`. Requires D1 binding `DB`, env vars for Google credentials, and `nodejs_compat` compatibility flag. Schema auto-migrates on first request.
