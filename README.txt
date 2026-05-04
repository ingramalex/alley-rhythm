ALLEY RHYTHM — Bowling Stats Tracker
=====================================

WHAT'S IN THIS PACKAGE
-----------------------

UPLOAD THESE 4 FILES TO GITHUB:
  index.html      → Public stats dashboard (leaderboard, history, weekly)
  upload.html     → Score upload page (Google Sign-In protected)
  admin.html      → Admin panel (manage sessions, roster, delete data)
  config.js       → ⚠ EDIT THIS FIRST — paste your Script URL and Client ID

DO NOT UPLOAD TO GITHUB (Apps Script only):
  apps-script/Code.gs             → Your backend — paste into Google Apps Script
  apps-script/Code-additions.gs   → Additional functions — paste AFTER Code.gs

REFERENCE:
  setup-guide.html  → Open this in your browser for full setup instructions


QUICK START
-----------
1. Open setup-guide.html in your browser
2. Follow the 5 phases (GitHub → Apps Script → Google Cloud → Anthropic → Connect)
3. Total setup time: ~30–45 minutes


FILES YOU MUST EDIT BEFORE GOING LIVE
--------------------------------------
config.js:
  - SCRIPT_URL       → Your Apps Script Web App URL (from Phase 2)
  - GOOGLE_CLIENT_ID → Your OAuth Client ID (from Phase 3)
  - LEAGUE_NAME      → Change to your group's name

apps-script/Code.gs:
  - APPROVED_EMAILS  → Google emails allowed to upload scores
  - ADMIN_EMAIL      → Your email for notifications
  - ANTHROPIC_API_KEY → Your API key (from Phase 4)

apps-script/Code.gs (EMAIL_CONFIG section):
  - RECIPIENTS       → Everyone who gets the weekly digest email
  - SITE_URL         → Your GitHub Pages or custom domain URL


COST
----
Hosting:  Free (GitHub Pages)
Database: Free (Google Sheets + Apps Script)
AI reads: ~$0.01 per photo upload (Anthropic API)
Estimate: ~$1-2/month for a group bowling twice a week


SUPPORT
-------
Open setup-guide.html for full step-by-step instructions with screenshots.
