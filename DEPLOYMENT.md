# Tide Chart — Deployment

Two halves, same as Jetty Central:

- **Backend** = Google Apps Script + a Google Sheet. Pulls the Monday email, parses
  it, caches the dashboard JSON, and serves it at a `?key=` URL.
- **Frontend** = the static `public/` folder on Netlify, auto-deployed from GitHub.

You only do this setup once. After that it runs itself every Monday.

---

## Part A — Backend (Apps Script + Sheet)

### 1. Create the Sheet
- New Google Sheet (any name, e.g. "Tide Chart Data"). Copy its **ID** from the URL:
  `https://docs.google.com/spreadsheets/d/`**`THIS_LONG_ID`**`/edit`.

### 2. Create the Apps Script project
- In that Sheet: **Extensions ▸ Apps Script**.
- Delete the default `Code.gs`. Create files matching `apps-script/` in this repo and
  paste each one in: `Config.gs`, `Code.gs`, `Ingest.gs`, `Normalize.gs`.
  (Or push with **clasp** — see the bottom.)
- Also set the manifest: **Project Settings ▸ “Show appsscript.json”** ✔, then paste
  `apps-script/appsscript.json`.

### 3. Set Script Properties
**Project Settings ▸ Script Properties ▸ Add**:

| Property         | Value                                              |
|------------------|----------------------------------------------------|
| `SPREADSHEET_ID` | the Sheet ID from step 1                            |
| `READ_KEY`       | any hard-to-guess string, e.g. `tide-read-4821`    |

### 4. Confirm the email is found, then run once
- Run `debugInbox` (Run ▸ select `debugInbox`). Approve the Gmail/Sheets permissions
  the first time. Open the **Log** tab and confirm you see the WHSL export email and
  its attachment name.
  - If it isn’t found, note the real **From** address / exact **subject**, then adjust
    `SUBJECT` / `SENDER` in `Config.gs`.
- Run `runIngestNow`. The Log tab should say `Ingest OK … kept 41,029/…`. This fills
  the **Meta** tab with the cached JSON.

### 5. Deploy the web app
- **Deploy ▸ New deployment ▸ Web app**
  - *Execute as:* **Me**
  - *Who has access:* **Anyone**  (security is the `READ_KEY`, not Google login)
- Copy the **/exec** URL. Your data URL is:
  `https://script.google.com/macros/s/XXXX/exec?key=YOUR_READ_KEY`
- Paste that URL into `public/js/config.js` → `DATA_URL`. Commit + push (Part B).

### 6. Schedule it
- Run `installTrigger` once. That sets `ingestWeekly` to run **Monday ~6:15am**
  (after your 6am email), fully replacing the dataset each week.

---

## Part B — Frontend (GitHub → Netlify)

### 1. Push to GitHub
From this folder (git is already initialized with an initial commit):

```bash
git remote add origin git@github.com:<you>/tide-chart.git   # or https URL
git push -u origin main
```

> Keep the repo **private** — `public/data/tide-data.json` contains real sales data
> (it ships so the site works before the Apps Script URL is wired).

### 2. Connect Netlify
- Netlify ▸ **Add new site ▸ Import an existing project** ▸ pick the GitHub repo.
- Netlify reads `netlify.toml` automatically: publish dir `public`, no build command.
- Deploy. Every `git push` to `main` auto-deploys.

### 3. Share the link
Send the team: `https://<your-site>.netlify.app/`
(The site fetches the live data from the Apps Script `DATA_URL` you set in step A5,
so the `?key=` stays in the code, not in the link people share.)

---

## Weekly rhythm (automatic)
1. Mon 6:00am — WHSL export email lands in your Gmail.
2. Mon 6:15am — `ingestWeekly` parses it, replaces the cached JSON.
3. Team opens the Netlify link — sees the new week (30-min browser cache).

Nothing to do manually. To force a refresh sooner, run `runIngestNow` in Apps Script.

---

## Optional — push Apps Script with clasp (instead of copy/paste)
```bash
npm i -g @google/clasp
clasp login
clasp create --type sheets --title "Tide Chart Data"   # or: clasp clone <scriptId>
clasp push          # from the apps-script/ folder
```
