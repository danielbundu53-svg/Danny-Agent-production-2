# Deployment & Operations Guide

This guide covers production deployment of the Danny Agent Real Estate Platform on **Render** (recommended) or any modern **Linux VPS / Docker** environment.

---

## Architecture Summary for Hosting

- **Runtime:** Node.js 20.12+ (LTS).
- **Process Model:** Single-process Express application.
- **Database:** Single SQLite database file (`data/danny-angel.sqlite`) with Write-Ahead Logging (`WAL`).
- **Disk Requirement:** Must be deployed on a host with a **persistent disk** (or mounted volume) to retain property uploads and database records across container restarts. Do not use stateless ephemeral dynos without persistent volume mounts.
- **Scaling:** Exactly 1 web instance (SQLite does not support multi-server write concurrency across distinct nodes).

---

## Option A: Deploying to Render (Recommended Blueprint)

Estimated setup time: 20–30 minutes.
Estimated hosting cost: ~$7/month (Render Starter Web Service + 1 GB Persistent Disk).

### Step 1: Push Code to GitHub

1. Create a **private** repository on GitHub named `danny-agent`.
2. Push your project code to the repository. Ensure `.env` and `node_modules/` are ignored (handled by `.gitignore`).
3. Verify that `public/css/site.css` and `public/js/icons.js` are committed.

### Step 2: Create Render Service via Blueprint

1. Log into your Render account at [render.com](https://render.com).
2. Click **New +** > **Blueprint**.
3. Select your `danny-agent` repository. Render detects `render.yaml` automatically.
4. Render will configure:
   - Web Service: Node environment with build command `npm install && npm run build`.
   - Start command: `npm start`.
   - Persistent Disk: 1 GB mounted at `/var/data` (mapped to `DATABASE_PATH=/var/data/danny-angel.sqlite` and `CACHE_DIR=/var/data/cache`).
5. When prompted for `SITE_URL`, enter your production domain (e.g., `https://www.dannyrealty.sl`).
6. Click **Apply**. Render will trigger the initial build and deploy.

### Step 3: Configure Production Environment Variables

In Render > Your Web Service > **Environment**, set the following:

| Key | Example Value | Description |
|---|---|---|
| `ADMIN_KEY` | *(Generate a 32+ character random string)* | Secret master key used for administrative authentication |
| `NODE_ENV` | `production` | Enables production security headers, HSTS, and error suppression |
| `SITE_URL` | `https://www.dannyrealty.sl` | Canonical URL used for SEO, OpenGraph previews, and sitemaps |
| `FORCE_HTTPS` | `true` | Redirects plain HTTP requests to HTTPS |
| `TRUST_PROXY` | `1` | Configures Express to trust Render's reverse proxy headers |
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` | *(Optional)* Claude API key for the AI assistant |
| `CHAT_DAILY_LIMIT` | `400` | Maximum Claude turns per day site-wide |
| `SMTP_HOST` | `smtp.resend.com` or `smtp.sendgrid.net` | Outbound email relay server |
| `SMTP_PORT` | `587` | Outbound mail port |
| `SMTP_USER` | `resend` or `apikey` | Outbound mail username |
| `SMTP_PASS` | `re_...` | Outbound mail password / API key |
| `SMTP_FROM` | `notifications@dannyrealty.sl` | Verified sender address |
| `ADMIN_NOTIFICATION_EMAIL`| `dannyagento1@gmail.com` | Email address where lead notifications are delivered |

Save changes; Render will redeploy automatically.

### Step 4: Connect Custom Domain & SSL

1. In Render > Service Settings > **Custom Domains**, add `www.dannyrealty.sl` and `dannyrealty.sl`.
2. Configure DNS records at your domain registrar:
   - CNAME record for `www` pointing to your Render service address (e.g., `danny-agent.onrender.com`).
   - ALIAS or A record for the root domain as specified by Render.
3. Render automatically issues and renews free Let's Encrypt TLS/SSL certificates.

---

## Option B: Deploying on a Linux VPS (Ubuntu / Debian + PM2 + Nginx)

### 1. Server Setup

```bash
# Update and install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx

# Install PM2 process manager
sudo npm install -g pm2
```

### 2. Application Setup

```bash
# Clone repository
git clone https://github.com/your-org/danny-agent.git /var/www/danny-agent
cd /var/www/danny-agent

# Install dependencies and build assets
npm install --omit=dev
npm run build

# Configure environment variables
cp .env.example .env
nano .env   # Fill in ADMIN_KEY, SITE_URL, NODE_ENV=production
```

### 3. Start with PM2

```bash
# Start application
pm2 start server/server.js --name "danny-agent"

# Save process list and enable on reboot
pm2 save
pm2 startup
```

### 4. Nginx Configuration

```nginx
server {
    server_name dannyrealty.sl www.dannyrealty.sl;

    client_max_body_size 12M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable SSL via Certbot:
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d dannyrealty.sl -d www.dannyrealty.sl
```

---

## Database Backup Schedule (Cron)

Set up a daily cron job to create defragmented backups:

```bash
# Open crontab
crontab -e

# Add daily backup at 2:00 AM
0 2 * * * cd /var/www/danny-agent && /usr/bin/npm run backup >> /var/log/danny-backup.log 2>&1
```

---

## Checklist: Decisions & External Credentials Required from the Owner

Before public launch, the business owner must provide or confirm the following:

1. **Domain Name & DNS Access:**
   - Ownership and DNS management access for the chosen public domain (e.g. `dannyrealty.sl` or `dannyagent.com`).
2. **Anthropic Claude API Key:**
   - If the AI Assistant feature is to be activated on the public site:
     - Account at [console.anthropic.com](https://console.anthropic.com).
     - Funded API credit with a hard monthly spend limit configured (e.g. $10 - $25/month).
3. **Transactional Email Service (SMTP):**
   - For automatic email alerts whenever a new enquiry is received:
     - Account at Resend, SendGrid, Amazon SES, or Mailgun.
     - Verified sending domain (SPF, DKIM, DMARC records).
     - SMTP credentials entered into `.env`.
4. **Official Contact Information Verification:**
   - Ensure the WhatsApp number (`23276683667`), phone number (`+232 76 683667`), and official office address match legal business registration.
5. **Initial Property Pricing & Photography Review:**
   - Confirm all 9 initial property listings, prices, and locations are up-to-date in the Admin Portal prior to announcement.
6. **Administrator Passwords:**
   - Update default seeded passwords in the Admin Portal > Team & Access tab upon first login.
