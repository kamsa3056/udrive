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

Development: access via `localhost:5173` (Vite proxies /api/ and /auth/ to :3000).
Production: access via `localhost:3000`.

## Architecture

**Unified Backend** (`src/`): Hono framework, runs on Node.js and Cloudflare Workers.

- `src/app.js` — Hono app factory, accepts DB getter and env vars, mounts all routes
- `src/local.js` — Node.js entry point (dev/Docker), uses @hono/node-server + better-sqlite3
- `src/cf.js` — Cloudflare Pages entry point, uses D1 + ASSETS binding, auto-migrates schema on first request
- `src/db/index.js` — DB factory + initDB (creates tables, runs migrations)
- `src/db/local.js` — better-sqlite3 wrapper that mimics D1 async API (prepare/bind/first/all/run)
- `src/middleware/auth.js` — Session auth: authenticate, requireAuth, requireMaster, requirePermission, hasPageAccess, createSession, deleteSession. Exports ALL_PERMISSIONS and PERMISSION_GROUPS
- `src/services/google-drive.js` — All Drive operations via direct REST fetch (no googleapis package)
- `src/services/token-manager.js` — OAuth2 token refresh via fetch
- `src/services/password.js` — crypto.scrypt password hashing (node:crypto)
- `src/services/account-selector.js` — Picks non-primary account with most available space
- `src/services/keep-alive.js` — Upload+delete temp file per account to maintain activity
- `src/services/logger.js` — logActivity() and logSystem() with enable/disable check from settings
- `src/routes/auth.js` — Google OAuth2 flow + callback, auto-shares folder, assigns card colors
- `src/routes/files.js` — File CRUD with per-action permission checks, trash/restore, thumbnail proxy, video range requests, activity logging
- `src/routes/accounts.js` — Account management, card colors, rclone import/export
- `src/routes/settings.js` — Key-value settings, keep-alive trigger, database export/import
- `src/routes/users.js` — User CRUD, login/logout, permissions, session timeout, password change
- `src/routes/activity.js` — Activity log listing with filters (user, action)
- `src/routes/logs.js` — System log listing with filters (level)

**Frontend** (`client/`): Vanilla JS SPA built with Vite + TailwindCSS v4.

- Hash-based routing (`#/`, `#/accounts`, `#/settings`, `#/trash`, `#/users`, `#/activity`, `#/logs`, `#/login`)
- `client/main.js` — Auth flow (check setup → login → init app), route guards using hasPageAccess()
- `client/auth-state.js` — Shared auth state: currentUser, hasPermission, hasPageAccess, PERMISSION_GROUPS
- `client/pages/files.js` — File manager: grid/list, multi-select, copy/cut/paste, upload queue, file info, preview, lazy thumbnails
- `client/pages/accounts.js` — Account cards (colored grid), rclone import/export, color picker
- `client/pages/settings.js` — Shared folder ID, theme, timezone, keep-alive, logging toggles, database download/upload, logout
- `client/pages/trash.js` — Trashed files from all accounts
- `client/pages/users.js` — User management (master only): collapsible permission groups per page
- `client/pages/activity.js` — Activity log viewer with filters
- `client/pages/logs.js` — System log viewer with filters
- `client/pages/login.js` — Login form
- `client/pages/setup.js` — First-run wizard
- `client/components/sidebar.js` — Nav filtered by hasPageAccess, storage bar/donut, collapsed mode
- `client/components/upload-queue.js` — Floating upload progress panel
- `client/components/logout-modal.js` — Confirmation modal

**Key design decisions:**
- DB abstraction: `src/db/local.js` wraps better-sqlite3 to match D1's API (prepare().bind().first/all/run returns Promises)
- All routes use `c.get('db')` for database and `c.env` for Google credentials
- `createApp(getDB, envVars)` factory allows different DB/env injection per deploy target
- Google Drive API uses direct REST fetch, not googleapis package (works in both Node.js and Workers)
- TailwindCSS v4 dark mode: `@custom-variant dark (&:where(.dark, .dark *))` for class-based toggle
- Vite proxy uses trailing slash (`/api/`, `/auth/`) to avoid matching files like `api.js`

## Database

SQLite at `data/udrive.db` (local, gitignored). Tables:
- `accounts` — OAuth tokens, storage quota, is_primary, card_color
- `settings` — Key-value pairs (shared_folder_id, theme, timezone, keepalive_interval_days, activity_enabled, logs_enabled)
- `file_owners` — Maps file_id to account_id
- `users` — Username, password_hash, role (master/slave), session_timeout_hours
- `user_permissions` — Per-user permission grants
- `sessions` — Session tokens with expiry
- `activity_log` — User action tracking (user_id, username, action, detail, timestamp)
- `system_log` — System event tracking (level, message, detail, timestamp)

## Permission System

Hierarchical, grouped per page. Page is visible if user has at least 1 permission in that group.

```
drive: drive:upload, drive:download, drive:delete, drive:rename, drive:create_folder, drive:move, drive:copy, drive:preview
trash: trash:view, trash:restore, trash:permanent_delete, trash:empty
accounts: accounts:view, accounts:add, accounts:remove, accounts:set_primary, accounts:refresh, accounts:import_export, accounts:color
settings: settings:view, settings:edit, settings:keepalive, settings:database
```

Master has all permissions implicitly. Slave only has explicitly assigned ones. Old permission format (page:*, action:*) is auto-migrated on startup.

## Deploy Targets

- **Local/Docker:** `npm start` → `src/local.js` → Hono on @hono/node-server + better-sqlite3
- **Cloudflare Pages:** `npm run build` → upload `dist/` → `_worker.js` (bundled from `src/cf.js`) + D1 database

## Docker

Multi-stage Dockerfile. Volume at `/app/data/` for DB persistence. Reads `.env` if present.

## CF Pages

Build output `dist/` contains frontend + `_worker.js` + `_worker.js.map`. Requires D1 binding `DB`, env vars for Google credentials, and `nodejs_compat` compatibility flag. Schema auto-migrates on first request.
