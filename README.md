# Danny Agent website

Real estate website (buy, rent, land) for Freetown, Sierra Leone. Plain HTML pages, a small
Node server, and a SQLite file that stores enquiries. Deployment is not set up yet.

## First run

You need Node 20.12 or newer.

```
npm install
cp .env.example .env     # then open .env and set ADMIN_KEY
npm start
```

Open http://localhost:5000. The admin page is http://localhost:5000/admin.html (type your ADMIN_KEY).

Important: `package.json` and `.env` now live in the **project folder**, not in `server/`.
Run every command from the project folder.

## Changing content

| What | Where |
|---|---|
| Name, phone, WhatsApp, email, address, social links | `public/js/site-config.js` |
| Properties (title, price, photos, sections) | `public/js/properties.js` |
| Property photos | `public/images/` (any size; phones automatically get small copies) |
| Page text | the `.html` files in `public/` |
| Logo / favicon | `public/favicon.svg`, then `npm run icons` |

If you change page markup or add new Tailwind classes, run `npm run build` to rebuild
`public/css/site.css`. Changing text or `site-config.js` / `properties.js` needs no build.

Phone and WhatsApp numbers must be real before launch. The visitors' "call" and "WhatsApp"
buttons use them.

## Settings (.env)

| Name | Meaning |
|---|---|
| `ADMIN_KEY` | Password for the admin page. 24+ random characters. In production the server refuses to start without it. |
| `NODE_ENV` | `production` on the live server. |
| `SITE_URL` | Your public address, used for link previews, sitemap, robots.txt. |
| `PORT` | Port to listen on (hosts usually set it). |
| `TRUST_PROXY` | `1` behind a hosting proxy (default in production). |
| `FORCE_HTTPS` | `true` to redirect http to https, once https works. |
| `ANTHROPIC_API_KEY` | Switches on the chat assistant. Without it the chat window does not appear. |
| `CHAT_DAILY_LIMIT` | Most chat answers per day for the whole site (default 400). Caps the bill. |
| `CHAT_MODEL` | Which Claude model answers (default: small and cheap). |
| `DATABASE_PATH`, `CACHE_DIR` | Where the database and resized photos are kept. Point at a persistent disk on a host. |

## Chat assistant

A chat window on every page answers questions about the listings, can save a visitor's details as a normal
enquiry (it shows up in the admin page marked "Sent through the website chat assistant"), and can open WhatsApp
with a message for the team. It reads the current listings from `public/js/properties.js` on every question,
so nothing needs retraining when you add or change a listing.

- It only knows what is in `properties.js` and `site-config.js`. It is told never to invent prices, fees or availability, but an AI can still make mistakes, so the team confirms everything.
- To mark a listing as taken, add `status: "sold"` (or `"rented"`, `"under offer"`) to it. The assistant then stops offering it as available. The property cards on the website do not show the status yet.
- Limits: 30 messages per visitor per 10 minutes, 3 saved enquiries per visitor per 10 minutes, and `CHAT_DAILY_LIMIT` per day overall. Also set a monthly spend limit in your Anthropic account.
- Conversations are not stored on your server. Each message is sent to Anthropic to get the reply, and the chat window tells visitors not to share passwords or payment details. Mention the chat in your privacy notice.
- It does not send reminders. Contacting past visitors by email or WhatsApp needs their permission and a sending service, so it was left for later.

## What protects the site

- Browser security headers with a strict Content-Security-Policy (only this site's own scripts and styles run), HSTS in production, no framing, no sniffing.
- Admin key checked in constant time; 8 wrong keys locks that address out for 15 minutes.
- Rate limits: 5 enquiries per 10 minutes per visitor, 120 API calls per minute, 200 enquiries per hour overall.
- Enquiry form: server-side validation, hidden spam-trap field, duplicate suppression, 32 KB body limit, JSON only, same-origin only.
- Database refuses unknown statuses on its own (triggers). Files outside `public/` (code, `.env`, database) are never served.
- Every error has one JSON shape with a request id, and visitors see friendly 404/500 pages. Nothing internal is shown.

## Errors and logs

Each request writes one log line (JSON in production). A problem report from a visitor can be
matched with the `X-Request-Id` shown in the log. `/api/health` returns 503 if the database is unreachable.

## Backups

`npm run backup` copies the database safely to `data/backups/` (keeps the newest 14).
Schedule it daily on the host, and copy the files somewhere off the server.

## Tests

```
npm test               server and security tests (fast)
npm run test:browser   real Chromium walks through search, favorites, forms, admin, JavaScript-off
npm run test:responsive  every page at 11 screen sizes (320 px phones to 1920 px), screenshots in tests/shots
npm run test:slow      page weight and load time on slow 3G and 4G
npm run test:all       the first three
```

Honest limits: browser tests run in Chromium only (Chrome, Edge, Samsung Internet, Opera engines).
Safari/iPhone and Firefox were not tested in a real browser here. Test on a real iPhone and an
older Android phone before launch. Browsers with JavaScript turned off (and Opera Mini in
extreme mode) see a simple property list and contact details, not the full site.

Deployment steps for Render are in `DEPLOY.md`; `render.yaml` is the ready-made config.

## Before going live

1. Replace placeholder text, photos and listings (the land listing uses an apartment photo).
2. Check the phone, WhatsApp and email in `site-config.js`.
3. Set `NODE_ENV=production`, a strong `ADMIN_KEY` and `SITE_URL` on the host.
4. Use a host with a persistent disk for `DATABASE_PATH` (the database is a file).
5. Turn on `FORCE_HTTPS=true` once https works. Schedule `npm run backup`.
