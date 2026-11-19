# Danny Agent Real Estate Platform

A modern, production-grade real estate web application and management platform for Freetown, Sierra Leone. Built with Node.js, Express, Tailwind CSS, Lucide icons, SQLite with WAL mode, and Claude AI assistant.

---

## System Overview & Architecture

- **Public Website:**
  - Modern, responsive homepage with hero section, property search, and featured listings.
  - Dynamic listings catalog (`properties.html`) with multi-criteria filtering: Purpose (Buy/Rent), Type (House/Apartment/Land/Commercial), Location, Minimum Bedrooms, Availability Status (Available/Under Offer/Sold/Rented), and Price Budget.
  - Interactive property details page (`property-detail.html`) with responsive photo galleries, feature cards, color-coded availability badges, enquiry forms, and WhatsApp prefilled direct contact.
  - Client-side saved Favorites (`favorites.html`) with one-click WhatsApp portfolio export.
  - Integrated contact form with validation, CSRF/bot honey-potting, and instant agent linking.
  - Live announcement banner dynamically managed from the admin panel.

- **Admin Operations Dashboard (`admin.html`):**
  - **Overview & Analytics:** Real-time KPI metrics (total properties, active listings, deals closed, customer count), status breakdown bars, property category distribution, and system activity feed.
  - **Property Catalog Management:** Create, edit, delete, publish/unpublish, and archive listings.
  - **Photo Gallery Manager:** Upload high-resolution property photos (auto-optimized via Sharp for mobile and desktop), set cover photo, reorder images, and delete photos.
  - **Enquiries & Lead Workflow:** Status pipeline (`new` → `contacted` → `qualified` → `closed`), assign enquiries to team agents, add internal agent notes, and one-click WhatsApp/phone call links.
  - **Customers CRM:** Centralized customer database tracking lead history, contact info, total enquiries, and assigned agent.
  - **Team & RBAC Access:** Role-based access control (`admin` vs `agent`), create team accounts, activate/deactivate agents.
  - **Site Settings & Banner:** Configure business profile (NAP), update announcement banner text and active status, configure Claude AI turn limits.
  - **System & Notification Logs:** Audit trail of user actions and email/WhatsApp dispatch history with real delivery and simulation verification.

- **AI Assistant:**
  - Powered by Anthropic Claude with tool-calling capabilities.
  - Database-grounded real estate knowledge with property discovery and enquiry collection.
  - Graceful fallback when API key is unconfigured.
  - Strict daily bill protection and IP rate limits.

---

## Quick Start (Development)

Requires Node.js 20.12 or newer.

```bash
# 1. Install dependencies
npm install

# 2. Setup environment configuration
cp .env.example .env
# Edit .env and set ADMIN_KEY (minimum 24 characters)

# 3. Build CSS and icon assets
npm run build

# 4. Start the application
npm start
```

Visit the website at `http://localhost:5000`.
Access the Admin Operations Portal at `http://localhost:5000/admin.html`.

### Default Seeded Credentials

When starting with a fresh database, the system automatically creates:

| Role | Username | Default Password | Permissions |
|---|---|---|---|
| **Administrator** | `admin` | Value of `ADMIN_KEY` in `.env` (or `AdminDanny2026!SecureKey`) | Full platform access (All tabs) |
| **Agent** | `danny.agent` | `AgentDanny2026!` | Listings, Inquiries, CRM |

*Note: You can also log into the Admin Portal directly by entering your `ADMIN_KEY` into the admin key input field.*

---

## Environment Configuration (`.env`)

| Variable | Description | Default / Production Guidance |
|---|---|---|
| `PORT` | Listening port for the HTTP server | `5000` (Render/cloud hosts set automatically) |
| `NODE_ENV` | Application environment mode | `development` (set to `production` in live deployment) |
| `SITE_URL` | Canonical public URL of the website | e.g. `https://www.dannyrealty.sl` |
| `ADMIN_KEY` | Secret master administrative key (24+ characters) | Required in production; verified in constant time |
| `DATABASE_PATH` | Path to persistent SQLite database | `data/danny-angel.sqlite` |
| `CACHE_DIR` | Directory for Sharp-optimized image thumbnails | `data/cache` |
| `TRUST_PROXY` | Number of upstream proxy hops | `1` on Render, Heroku, AWS ALB, Cloudflare |
| `FORCE_HTTPS` | Redirect all insecure HTTP requests to HTTPS | `true` in production |
| `ANTHROPIC_API_KEY` | Anthropic Claude API Key for AI Assistant | Optional (chat button hides if omitted) |
| `CHAT_MODEL` | Claude model identifier | `claude-3-haiku-20240307` |
| `CHAT_DAILY_LIMIT` | Maximum Claude responses allowed per day across site | `400` |
| `SMTP_HOST` | Outbound mail server hostname | e.g. `smtp.sendgrid.net` or `smtp.resend.com` |
| `SMTP_PORT` | SMTP port | `587` or `465` |
| `SMTP_USER` | SMTP authentication username | Provided by your email service provider |
| `SMTP_PASS` | SMTP authentication password / API key | Provided by your email service provider |
| `SMTP_FROM` | Sender address for enquiry notifications | e.g. `notifications@dannyrealty.sl` |
| `ADMIN_NOTIFICATION_EMAIL`| Destination inbox for new lead alerts | e.g. `dannyagento1@gmail.com` |

---

## Database Management, Backups & Disaster Recovery

The application uses an embedded SQLite database running with Write-Ahead Logging (`PRAGMA journal_mode = WAL`) and foreign key enforcement.

### Online Zero-Downtime Backup

Run a clean database snapshot while the server is live:

```bash
npm run backup
```
- Performs a consistent, defragmented online backup using SQLite's native `VACUUM INTO` command.
- Stores backups in `data/backups/inquiries-YYYY-MM-DD-HH-MM-SS.sqlite`.
- Automatically keeps the 14 newest snapshots and prunes older ones.

### Safe Disaster Recovery / Database Restore

To restore the live database from a backup snapshot:

```bash
# Restore from the latest available backup in data/backups/:
npm run restore

# Or restore from a specific snapshot file:
node scripts/restore-db.js data/backups/inquiries-2026-11-19-14-28-16.sqlite
```
- Verifies backup integrity with `PRAGMA integrity_check`.
- Saves a safety snapshot of the existing live database before replacement (`pre-restore-<timestamp>.sqlite`).
- Replaces the live database and removes stale WAL/SHM sidecars.
- Automatically verifies and prints the count of properties, enquiries, and user accounts.

---

## Comprehensive Automated Test Suites

The project has a comprehensive 5-layer automated testing suite:

```bash
# 1. Server API, security, rate limiting, and Claude chat tests (50 tests)
npm test

# 2. End-to-end browser workflows in Chromium (17 tests)
npm run test:browser

# 3. AI assistant browser UI and responsive interaction tests (15 tests)
npm run test:chat

# 4. Multi-device responsive test suite across 11 screen sizes (99 combinations)
npm run test:responsive

# 5. Slow 3G / 4G bandwidth and asset weight simulation
npm run test:slow

# 6. Run all test suites
npm run test:all
```

*Status: All 50 API unit/integration tests, 17 browser tests, 15 chat tests, and 99 responsive viewport tests pass with 0 errors.*

---

## Security Protections

1. **Strict Content Security Policy (CSP):** Zero inline scripts (`'unsafe-inline'` disabled for scripts), strict source origins, presentation-safe SVGs.
2. **HTTP Hardening:** Complete security headers via Helmet (HSTS, X-Content-Type-Options, X-Frame-Options: DENY, Referrer-Policy).
3. **Authentication & Brute-Force Lockout:** Scrypt password hashing with unique salts, constant-time string comparisons, and IP-level account lockout (8 consecutive invalid attempts locks IP for 15 minutes).
4. **Rate Limiting:**
   - 120 API requests/minute.
   - 5 enquiries / 10 minutes per IP.
   - 30 chat turns / 10 minutes per IP.
5. **Enquiry Spam Defense:** Hidden honeypot fields, duplicate message suppression, 32 KB payload limits, strict JSON content-type enforcement.
6. **Integrity Enforcement:** Database-level triggers prevent invalid statuses or services even if application logic is bypassed.

---

## Deployment Instructions

Detailed deployment instructions for Render, VPS, or Docker are documented in [DEPLOY.md](file:///c:/Users/MOK/Downloads/Danny-Agent-production-2/DEPLOY.md).
