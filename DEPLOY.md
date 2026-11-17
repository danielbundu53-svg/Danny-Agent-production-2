# Deploying to Render (step by step)

About 30 minutes. Cost: roughly $7 to $8 per month (the paid "Starter" plan is needed for a
disk that keeps your enquiries). Do not use a free plan: it erases the database on every restart.

## 1. Put the project on GitHub

1. Create a free account at github.com and a **private** repository named `danny-agent`.
2. Upload the project folder contents (the zip, unzipped). Do not upload `.env` or
   `node_modules` (the `.gitignore` already excludes them).
   Easiest way: on the new repository page choose "uploading an existing file" and drag the files in,
   or use GitHub Desktop.
3. Check that `public/css/site.css` and `public/js/icons.js` are in the repository. The server needs them.

## 2. Create the service on Render

1. Sign up at render.com and connect your GitHub account.
2. New + > **Blueprint**, choose the `danny-agent` repository. Render reads `render.yaml` and
   shows one web service with a 1 GB disk. It asks for `SITE_URL`: type your final address,
   for example `https://www.yourdomain.com`.
3. Click Apply. The first build takes a few minutes.
4. When it shows "Live", open the `.onrender.com` address. Check the home page, a property, and the contact form.
5. Open the service > Environment, reveal `ADMIN_KEY`, and copy it somewhere safe (password manager).
   That is the password for `/admin.html`.

## 2b. Switch on the chat assistant (optional)

1. Create an account at console.anthropic.com, add a small credit, and **set a monthly spend limit**.
2. API keys > create a key and copy it.
3. In Render > your service > Environment, paste it as `ANTHROPIC_API_KEY`, then save. Render redeploys.
4. Open the site: a "Chat with us" button appears bottom right. Ask it about a property and test saving an enquiry.
   Without the key, the button never shows.

## 3. Connect your domain

1. Service > Settings > Custom Domains > add `www.yourdomain.com` (and `yourdomain.com`).
2. Render shows the exact DNS records to create. At your domain registrar add them
   (normally a CNAME for `www`, and an A or ALIAS record for the bare domain). Use the values Render shows, not values from other guides.
3. Wait until Render shows the domain as verified; https is issued automatically (minutes to a few hours).
4. Make sure `SITE_URL` matches the address people will use. Redeploy if you change it.
5. Optional once https works: add environment variable `FORCE_HTTPS=true`.

## 4. Check it works (10 minutes)

- Open the site on a phone using mobile data, not your wifi.
- Send a test enquiry from the contact page, then open `/admin.html` and see it appear.
- Visit `https://yourdomain/api/health`. It should say `"status":"online"`.
- Visit `/robots.txt` and `/sitemap.xml` and check they show your domain.
- Share a property link in WhatsApp to see the preview card.
- Render > Logs should show request lines without errors.

## 5. Keep it safe

- **Backups:** Render > your service > Disk shows automatic daily snapshots (kept for days). For extra safety, run
  `npm run backup` from Render's Shell and download the file now and then.
- **Updates:** push changes to GitHub and Render redeploys automatically. After editing `public/js/site-config.js` or
  `properties.js` there is nothing to build. If you change page layout or add styles, run `npm run build` on your
  computer first and upload the new `public/css/site.css`.
- **Only one instance:** do not scale the service above 1 instance. The database is a single file.
- Never share the `ADMIN_KEY`. If it leaks, change it in Environment and redeploy.

## Moving your existing enquiries

The zip has no database. The 2 enquiries in your local `data/danny-angel.sqlite` look like tests.
If you want to keep them, tell me and I will write a short import step; otherwise start fresh.

## Before telling customers

Replace the placeholder text, photos and listings, and confirm the phone, WhatsApp and email in `site-config.js`.
