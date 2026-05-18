// ╔══════════════════════════════════════════════════════════════════╗
// ║  ALLEY RHYTHM — Multi-League Backend                            ║
// ║                                                                  ║
// ║  SETUP STEPS:                                                    ║
// ║  1. Paste this file into script.google.com                      ║
// ║  2. Set ANTHROPIC_API_KEY in Project Settings → Script Props     ║
// ║  3. Run initializeHub() ONCE from the Run menu                  ║
// ║  4. Deploy → New deployment → Web app                           ║
// ║     • Execute as: Me  • Who has access: Anyone                  ║
// ║  5. Paste Web App URL into config.js on GitHub Pages            ║
// ╚══════════════════════════════════════════════════════════════════╝

const CONFIG = {
  // ── Super admins — can create/manage ALL leagues ───────────────
  SUPER_ADMIN_EMAILS: [
    "ingramalex@gmail.com",
  ],

  // ── Anthropic API key (set in Project Settings → Script Properties)
  ANTHROPIC_API_KEY: PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'),

  // ── Sheet tab names (same structure in every league sheet) ─────
  SHEETS: {
    SESSIONS: "Sessions",
    GAMES:    "Games",
    ROSTER:   "Roster",
    BOWLERS:  "Bowlers",
    USERS:    "Users",
  },

  // ── Hub sheet tab name (lives in THIS spreadsheet) ────────────
  HUB: "Leagues",
};

// ── In-execution cache for open spreadsheets ──────────────────────
const _ssCache = {};

// ═══════════════════════════════════════════════════════════════
//  HUB: LEAGUE REGISTRY
// ═══════════════════════════════════════════════════════════════

/**
 * Returns the Leagues registry sheet from the hub spreadsheet.
 */
function getHubSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.HUB);
  if (!sh) throw new Error('Hub not initialized. Run initializeHub() first.');
  return sh;
}

/**
 * Returns the Google Spreadsheet for a given leagueId.
 */
function getLeagueSpreadsheet(leagueId) {
  if (!leagueId) throw new Error('leagueId required');
  if (_ssCache[leagueId]) return _ssCache[leagueId];
  const meta = getLeagueMeta(leagueId);
  if (!meta) throw new Error('League not found: ' + leagueId);
  if (!meta.isActive) throw new Error('League is inactive: ' + leagueId);
  const ss = meta.sheetId === '__HUB__'
    ? SpreadsheetApp.getActiveSpreadsheet()
    : SpreadsheetApp.openById(meta.sheetId);
  _ssCache[leagueId] = ss;
  return ss;
}

/**
 * Returns metadata for a league from the hub registry.
 */
function getLeagueMeta(leagueId) {
  const hub = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = hub.getSheetByName(CONFIG.HUB);
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  const hdr  = data[0]; const col = n => hdr.indexOf(n);
  const row  = data.slice(1).find(r => r[col('LeagueID')] === leagueId);
  if (!row) return null;
  return {
    leagueId:       row[col('LeagueID')],
    name:           row[col('LeagueName')],
    day:            row[col('LeagueDay')],
    sheetId:        row[col('SheetID')],
    adminEmails:    (row[col('AdminEmails')]  ||'').split(',').map(e=>e.trim()).filter(Boolean),
    approvedEmails: (row[col('ApprovedEmails')]||'').split(',').map(e=>e.trim()).filter(Boolean),
    emailRecipients:(row[col('EmailRecipients')]||'').split(',').map(e=>e.trim()).filter(Boolean),
    theme:          safeParseJSON(row[col('Theme')], {}),
    isActive:       row[col('IsActive')] !== false,
    plan:           row[col('Plan')] || 'free',
    createdAt:      row[col('CreatedAt')],
    siteUrl:        row[col('SiteURL')] || '',
    bowlers:        (row[col('Bowlers')]||'').split(',').map(b=>b.trim()).filter(Boolean),
  };
}

function safeParseJSON(str, def) {
  try { return str ? JSON.parse(str) : def; } catch(e) { return def; }
}

function listLeagues() {
  const hub = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = hub.getSheetByName(CONFIG.HUB);
  if (!sh) return { leagues: [] };
  const data = sh.getDataRange().getValues();
  const hdr  = data[0]; const col = n => hdr.indexOf(n);
  return {
    leagues: data.slice(1).filter(r => r[col('LeagueID')] && r[col('IsActive')] !== false).map(r => ({
      leagueId: r[col('LeagueID')],
      name:     r[col('LeagueName')],
      day:      r[col('LeagueDay')],
      theme:    safeParseJSON(r[col('Theme')], {}),
      plan:     r[col('Plan')] || 'free',
    }))
  };
}

/**
 * Returns user's role for a specific league.
 * Super admins have admin access to all leagues.
 */
function getUserRoleForLeague(email, leagueId) {
  const e = (email||'').toLowerCase().trim();
  if (CONFIG.SUPER_ADMIN_EMAILS.map(x=>x.toLowerCase()).includes(e)) return 'admin';
  const meta = getLeagueMeta(leagueId);
  if (!meta) return null;
  if (meta.adminEmails.map(x=>x.toLowerCase()).includes(e))    return 'admin';
  if (meta.approvedEmails.map(x=>x.toLowerCase()).includes(e)) return 'uploader';
  // Check Users sheet in league spreadsheet
  try {
    const ss = getLeagueSpreadsheet(leagueId);
    const sh = ss.getSheetByName(CONFIG.SHEETS.USERS);
    if (!sh) return null;
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][0]||'').toLowerCase() === e && rows[i][5] === true)
        return rows[i][2] || 'uploader';
    }
  } catch(err) { Logger.log('getUserRoleForLeague error: ' + err.message); }
  return null;
}

// ── Backwards compat: single-league getUserRole uses BlameItOnTheLane ──
function getUserRole(email) { return getUserRoleForLeague(email, 'BlameItOnTheLane'); }

// ═══════════════════════════════════════════════════════════════
//  HUB INIT & LEAGUE CREATION
// ═══════════════════════════════════════════════════════════════

/**
 * Run ONCE from Apps Script editor to set up the Leagues registry.
 * Registers the existing Sunday Night Crew as the first league.
 */
function initializeHub() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.HUB);
  if (!sh) { sh = ss.insertSheet(CONFIG.HUB, 0); }
  if (sh.getLastRow() === 0) {
    const headers = ['LeagueID','LeagueName','LeagueDay','SheetID',
                     'AdminEmails','ApprovedEmails','EmailRecipients',
                     'Theme','Bowlers','Plan','IsActive','SiteURL','CreatedAt','Notes'];
    sh.appendRow(headers);
    sh.getRange(1,1,1,headers.length).setBackground('#0e1220').setFontColor('#f5a623').setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 160); sh.setColumnWidth(2, 180); sh.setColumnWidth(8, 300);
  }

  // Register Sunday Night Crew pointing at this same spreadsheet
  const existing = sh.getDataRange().getValues().slice(1).map(r=>r[0]);
  if (!existing.includes('BlameItOnTheLane')) {
    const theme = JSON.stringify({ primary:'#39ff14', secondary:'#ff00ff', accent:'#00ffff', name:'BLAME IT ON THE LANE' });
    sh.appendRow([
      'BlameItOnTheLane', 'Blame It On The Lane', 'Sunday', '__HUB__',
      'ingramalex@gmail.com,jreece82@gmail.com',
      'ingramalex@gmail.com,jreece82@gmail.com',
      'ingramalex@gmail.com',
      theme,
      'Reece,Jess,Alex,Mark,Steve,Wayne,Darnell,Nikki',
      'owner', true,
      'https://alleyrhythm.com',
      new Date().toISOString(),
      'Original league — uses hub spreadsheet'
    ]);
    Logger.log('✅ Registered BlameItOnTheLane');
  }

  // Make sure existing sheets are properly initialized
  initializeLeagueSheets(ss, ['Reece','Jess','Alex','Mark','Steve','Wayne','Darnell','Nikki']);
  SpreadsheetApp.flush();
  Logger.log('✅ Hub initialized. Use createLeague() or the Admin UI to add more leagues.');
}

/**
 * Creates a new league. Called from Admin UI or Apps Script editor.
 * Creates a new Google Sheet, initializes it, registers in hub.
 */
function createNewLeague(params) {
  const { leagueName, leagueDay, adminEmails, approvedEmails, emailRecipients,
          bowlers, theme, plan, siteUrl } = params;
  if (!leagueName) throw new Error('leagueName required');

  // Generate a clean URL-safe ID
  const leagueId = leagueName.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    + '-' + Date.now().toString(36);

  // Create new Google Sheet
  const newSs = SpreadsheetApp.create('Alley Rhythm — ' + leagueName);
  const sheetId = newSs.getId();

  // Initialize sheet structure with league's bowlers
  const bowlerList = (bowlers||[]).length ? bowlers : [];
  initializeLeagueSheets(newSs, bowlerList);

  // Default theme if not provided
  const themeColors = theme || { primary:'#39ff14', secondary:'#ff00ff', accent:'#00ffff', name: leagueName.toUpperCase() };

  // Register in hub
  const hub = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = hub.getSheetByName(CONFIG.HUB);
  if (!sh) throw new Error('Hub not initialized. Run initializeHub() first.');

  sh.appendRow([
    leagueId, leagueName, leagueDay || '', sheetId,
    (adminEmails||[]).join(','),
    (approvedEmails || adminEmails || []).join(','),
    (emailRecipients || adminEmails || []).join(','),
    JSON.stringify(themeColors),
    (bowlerList).join(','),
    plan || 'free', true,
    siteUrl || '',
    new Date().toISOString(),
    'Created via Admin UI'
  ]);

  SpreadsheetApp.flush();
  Logger.log('✅ League created: ' + leagueId + ' (Sheet: https://docs.google.com/spreadsheets/d/' + sheetId + ')');
  return { success: true, leagueId, sheetId, sheetUrl: 'https://docs.google.com/spreadsheets/d/' + sheetId };
}

/**
 * Updates a league's settings in the hub registry.
 */
function updateLeagueSettings(leagueId, updates) {
  const hub = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = hub.getSheetByName(CONFIG.HUB);
  const data = sh.getDataRange().getValues();
  const hdr  = data[0]; const col = n => hdr.indexOf(n);
  for (let i = 1; i < data.length; i++) {
    if (data[i][col('LeagueID')] === leagueId) {
      Object.entries(updates).forEach(([key, val]) => {
        const c = col(key);
        if (c > -1) sh.getRange(i+1, c+1).setValue(typeof val === 'object' ? JSON.stringify(val) : val);
      });
      SpreadsheetApp.flush();
      return { success: true };
    }
  }
  throw new Error('League not found: ' + leagueId);
}

/**
 * Initialize all required sheet tabs in a given spreadsheet.
 */
function initializeLeagueSheets(ss, bowlerNames) {
  function ensure(name, headers) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
      sh.getRange(1,1,1,headers.length).setBackground('#0e1220').setFontColor('#f5a623').setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    return sh;
  }
  ensure(CONFIG.SHEETS.SESSIONS, ['SessionID','Date','WeekKey','UploadedBy','ScreenType','TeamLeft','TeamRight','RawJSON','CreatedAt']);
  ensure(CONFIG.SHEETS.GAMES,    ['GameKey','BowlerName','Date','WeekKey','Game1','Game2','Game3','Game4','Series','BallSpeedMPH','Strikes','Spares','MissedSpares','Splits','SplitsConverted','SessionAvg','SessionID','Location','Hdcp1','Hdcp2','Hdcp3','Hdcp4','IsBlind','DataSources','UpdatedAt']);
  ensure(CONFIG.SHEETS.ROSTER,   ['RawName','MappedName','LastSeen']);
  ensure(CONFIG.SHEETS.BOWLERS,  ['BowlerID','FullName','AddedAt','AddedBy','IsActive']);
  ensure(CONFIG.SHEETS.USERS,    ['Email','DisplayName','Role','ApprovedBy','ApprovedAt','IsActive']);

  if (bowlerNames && bowlerNames.length) {
    const rsh = ss.getSheetByName(CONFIG.SHEETS.ROSTER);
    if (rsh.getLastRow() <= 1) {
      bowlerNames.forEach(n => rsh.appendRow([n.toUpperCase(), n, new Date().toISOString()]));
    }
    const bsh = ss.getSheetByName(CONFIG.SHEETS.BOWLERS);
    if (bsh.getLastRow() <= 1) {
      bowlerNames.forEach((n,i) =>
        bsh.appendRow(['B'+String(i+1).padStart(4,'0'), n, new Date().toISOString(), 'system', true])
      );
    }
  }
  SpreadsheetApp.flush();
}

// ── Legacy initializeSheets() for backwards compat ───────────────
function initializeSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  initializeLeagueSheets(ss, ['Reece','Jess','Alex','Mark','Steve','Wayne','Darnell','Nikki']);
  const ush = ss.getSheetByName(CONFIG.SHEETS.USERS);
  if (ush && ush.getLastRow() <= 1) {
    CONFIG.SUPER_ADMIN_EMAILS.forEach(e =>
      ush.appendRow([e, 'Admin', 'admin', 'system', new Date().toISOString(), true])
    );
  }
  Logger.log('Sheets initialized.');
}

// ═══════════════════════════════════════════════════════════════
//  HTTP ROUTER
// ═══════════════════════════════════════════════════════════════
function doGet(e) {
  const action   = (e.parameter.action   || 'stats').toLowerCase();
  const leagueId = (e.parameter.leagueId || '').trim();
  try {
    // League-independent public endpoints
    if (action === 'list_leagues') return json(listLeagues());
    if (action === 'league_info')  return json(leagueId ? (getLeagueMeta(leagueId)||{error:'Not found'}) : {error:'leagueId required'});

    if (!leagueId) return json({ error: 'leagueId required' }, 400);
    const ss = getLeagueSpreadsheet(leagueId);

    const map = {
      stats:                    () => getPublicStats(ss),
      history:                  () => getSessionHistory(ss),
      weekly:                   () => getWeeklySummary(ss),
      awards:                   () => getAwards(ss),
      recap:                    () => generateWeeklyRecap(ss, leagueId),
      recent_sessions_for_dupe: () => getRecentSessionsForDupe(ss),
      admin_sessions:           () => getAdminSessions(ss),
      admin_roster:             () => getAdminRoster(ss),
      admin_overview:           () => getAdminOverview(ss),
      export_all:               () => exportAllData(ss),
      debug: () => {
        const result = {};
        Object.entries(CONFIG.SHEETS).forEach(([key, name]) => {
          try {
            const sh = ss.getSheetByName(name);
            if (!sh) { result[key] = 'SHEET NOT FOUND'; return; }
            const data = sh.getDataRange().getValues();
            result[key] = { headers: data[0], rowCount: data.length - 1 };
          } catch(e) { result[key] = 'ERROR: ' + e.message; }
        });
        return result;
      },
      awards_debug: () => {
        const sh   = ss.getSheetByName(CONFIG.SHEETS.GAMES);
        const data = sh.getDataRange().getValues();
        const hdr  = data[0]; const col = n => hdr.indexOf(n);
        return { rows: data.slice(1).filter(r=>r[col('BowlerName')]).map(r=>({
          name: r[col('BowlerName')], date: r[col('Date')],
          computedWk: r[col('Date')] ? getWeekKey(new Date(r[col('Date')])) : '?',
          game1: r[col('Game1')], game2: r[col('Game2')],
          splits: r[col('Splits')], spares: r[col('Spares')],
        }))};
      },
      awards_debug2: () => {
        const a = getAwards(ss);
        return { currentWeek: a.currentWeek, weeklyHighGame: a.weekly.highGame,
          weeklySplits: a.weekly.splits, weeklySpare: a.weekly.spare };
      },
    };
    if (!map[action]) return json({ error: 'Unknown action' }, 400);
    return json(map[action]());
  } catch(err) {
    Logger.log('GET error [' + action + ']: ' + err.message);
    return json({ error: err.message }, 500);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const { action, token, leagueId } = body;

    const user = verifyToken(token);
    if (!user) return json({ error: 'Invalid or expired sign-in. Please sign out and back in.' }, 401);

    // Super-admin only: league management
    const isSuperAdmin = CONFIG.SUPER_ADMIN_EMAILS.map(x=>x.toLowerCase()).includes(user.email.toLowerCase());
    if (action === 'create_league') {
      if (!isSuperAdmin) return json({ error: 'Super admin only.' }, 403);
      return json(createNewLeague(body));
    }
    if (action === 'update_league') {
      if (!isSuperAdmin) return json({ error: 'Super admin only.' }, 403);
      return json(updateLeagueSettings(body.leagueId, body.updates));
    }
    if (action === 'list_leagues_admin') {
      if (!isSuperAdmin) return json({ error: 'Super admin only.' }, 403);
      return json(listLeagues());
    }

    if (!leagueId) return json({ error: 'leagueId required' }, 400);

    const role = getUserRoleForLeague(user.email, leagueId);
    if (!role) return json({ error: 'Your account is not approved for this league.' }, 403);

    const ss = getLeagueSpreadsheet(leagueId);
    const meta = getLeagueMeta(leagueId);

    const adminOnly = { list_users:1, add_user:1, remove_user:1, update_user:1,
                        admin_delete_session:1, admin_remove_bowler:1, send_test_email:1 };
    if (adminOnly[action] && role !== 'admin') return json({ error: 'Admin access required.' }, 403);

    const handlers = {
      upload_image:         () => handleImageUpload(body, user, ss),
      analyze_image:        () => handleImageUpload(body, user, ss),
      save_session:         () => saveAndMergeSession(body.session, user, ss),
      get_roster:           () => ({ roster: getFullRoster(ss) }),
      whoami:               () => ({ email: user.email, name: user.name, picture: user.picture, role, isSuperAdmin }),
      admin_verify:         () => ({ isAdmin: role === 'admin', email: user.email, role, isSuperAdmin }),
      list_users:           () => listLeagueUsers(ss, meta),
      add_user:             () => addLeagueUser(ss, body.email, body.displayName, body.role, user),
      remove_user:          () => removeLeagueUser(ss, body.email),
      update_user:          () => updateLeagueUser(ss, body.email, body.updates),
      admin_delete_session: () => adminDeleteSession(body.sessionId, user, ss),
      admin_remove_bowler:  () => adminRemoveBowler(body.name, user, ss),
      add_bowler:           () => addBowlerToRoster(body.name, user, ss),
      send_test_email:      () => { sendLeagueWeeklyEmail(ss, meta); return { success: true }; },
      export_all:           () => exportAllData(ss),
    };
    if (!handlers[action]) return json({ error: 'Unknown action: ' + action }, 400);
    return json(handlers[action]());
  } catch(err) {
    Logger.log('POST error: ' + err.message);
    return json({ error: err.message }, 500);
  }
}

function verifyToken(idToken) {
  if (!idToken) return null;
  try {
    const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + idToken, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return null;
    const info = JSON.parse(r.getContentText());
    if (!info.email_verified) return null;
    return { email: info.email.toLowerCase(), name: info.name || info.email, picture: info.picture || '' };
  } catch(e) { Logger.log('verifyToken: ' + e.message); return null; }
}

// ═══════════════════════════════════════════════════════════════
//  USER MANAGEMENT (league-aware — ss passed from router)
// ═══════════════════════════════════════════════════════════════
function listLeagueUsers(ss, meta) {
  const sh   = ss.getSheetByName(CONFIG.SHEETS.USERS);
  const rows = sh ? sh.getDataRange().getValues().slice(1) : [];
  const users = rows.filter(r=>r[0]).map(r=>({ email:r[0], displayName:r[1], role:r[2], approvedBy:r[3], approvedAt:r[4]+'', isActive:r[5] }));
  const adminEmails = (meta ? meta.adminEmails : CONFIG.SUPER_ADMIN_EMAILS).map(e=>e.toLowerCase());
  const existing = users.map(u=>u.email.toLowerCase());
  adminEmails.forEach(e => {
    if (!existing.includes(e))
      users.unshift({ email:e, displayName:'Admin', role:'admin', approvedBy:'system', approvedAt:'', isActive:true, hardcoded:true });
  });
  return { users };
}
// Backwards compat alias
function listUsers() { return listLeagueUsers(SpreadsheetApp.getActiveSpreadsheet(), null); }

function addLeagueUser(ss, email, displayName, role, approver) {
  if (!email||!email.includes('@')) throw new Error('Invalid email');
  const e = email.toLowerCase().trim();
  const sh = ss.getSheetByName(CONFIG.SHEETS.USERS);
  const rows = sh.getDataRange().getValues();
  for (let i=1; i<rows.length; i++) {
    if ((rows[i][0]||'').toLowerCase()===e) {
      sh.getRange(i+1,2).setValue(displayName||rows[i][1]);
      sh.getRange(i+1,3).setValue(role||'uploader');
      sh.getRange(i+1,4).setValue(approver.email);
      sh.getRange(i+1,5).setValue(new Date().toISOString());
      sh.getRange(i+1,6).setValue(true);
      SpreadsheetApp.flush();
      return { success:true, message:email+' reactivated.' };
    }
  }
  sh.appendRow([e, displayName||'', role||'uploader', approver.email, new Date().toISOString(), true]);
  SpreadsheetApp.flush();
  return { success:true, message:email+' added.' };
}

function removeLeagueUser(ss, email) {
  const e = (email||'').toLowerCase();
  const sh = ss.getSheetByName(CONFIG.SHEETS.USERS);
  const rows = sh.getDataRange().getValues();
  for (let i=1; i<rows.length; i++) {
    if ((rows[i][0]||'').toLowerCase()===e) {
      sh.getRange(i+1,6).setValue(false);
      SpreadsheetApp.flush();
      return { success:true, message:email+' deactivated.' };
    }
  }
  return { success:false, message:'User not found.' };
}

function updateLeagueUser(ss, email, updates) {
  const e = (email||'').toLowerCase();
  const sh = ss.getSheetByName(CONFIG.SHEETS.USERS);
  const rows = sh.getDataRange().getValues();
  for (let i=1; i<rows.length; i++) {
    if ((rows[i][0]||'').toLowerCase()===e) {
      if (updates.displayName)          sh.getRange(i+1,2).setValue(updates.displayName);
      if (updates.role)                 sh.getRange(i+1,3).setValue(updates.role);
      if (updates.isActive!==undefined) sh.getRange(i+1,6).setValue(updates.isActive);
      SpreadsheetApp.flush();
      return { success:true };
    }
  }
  return { success:false, message:'User not found.' };
}

// ═══════════════════════════════════════════════════════════════
//  AI IMAGE ANALYSIS
// ═══════════════════════════════════════════════════════════════
function analyzeImage(body, user, ss) {
  const { imageBase64 } = body;
  let { mediaType } = body;

  // ── Detect actual format from magic bytes ─────────────────────
  // The browser may send HEIC with wrong or blank mediaType.
  // Anthropic API accepts: image/jpeg, image/png, image/gif, image/webp
  // HEIC is NOT supported by Anthropic — we must re-encode it.
  // We detect the real format and handle accordingly.
  const detectedType = detectImageType(imageBase64);
  if (detectedType) mediaType = detectedType;

  // If it's HEIC/HEIF, we can't send it to Anthropic directly.
  // Use Apps Script's built-in image utilities to convert to JPEG.
  if (mediaType === 'image/heic' || mediaType === 'image/heif') {
    try {
      const blob = Utilities.newBlob(Utilities.base64Decode(imageBase64), mediaType);
      // Drive's image conversion: save as HEIC, re-export as JPEG
      const file = DriveApp.createFile(blob);
      file.setName('heic_convert_temp.heic');
      const jpegBlob = file.getBlob().getAs('image/jpeg');
      imageBase64Converted = Utilities.base64Encode(jpegBlob.getBytes());
      file.setTrashed(true); // clean up temp file
      mediaType = 'image/jpeg';
      return analyzeImageWithData(imageBase64Converted, mediaType, user, ss);
    } catch(convErr) {
      Logger.log('HEIC DriveApp conversion failed: ' + convErr.message);
      mediaType = 'image/jpeg';
    }
  }
  return analyzeImageWithData(imageBase64, mediaType, user, ss);
}

/**
 * Detect image format from first few base64-decoded bytes (magic numbers).
 * Returns the correct MIME type, or null if unknown.
 */
function detectImageType(base64) {
  try {
    const bytes = Utilities.base64Decode(base64.substring(0, 16));
    if (bytes[0]===0xFF && bytes[1]===0xD8 && bytes[2]===0xFF) return 'image/jpeg';
    if (bytes[0]===0x89 && bytes[1]===0x50 && bytes[2]===0x4E && bytes[3]===0x47) return 'image/png';
    if (bytes[0]===0x47 && bytes[1]===0x49 && bytes[2]===0x46) return 'image/gif';
    if (bytes[0]===0x52 && bytes[1]===0x49 && bytes[2]===0x46 && bytes[3]===0x46) return 'image/webp';
    if (bytes[4]===0x66 && bytes[5]===0x74 && bytes[6]===0x79 && bytes[7]===0x70) return 'image/heic';
    return null;
  } catch(e) { return null; }
}

function analyzeImageWithData(imageBase64, mediaType, user, ss) {

  const prompt = `You are analyzing a bowling alley score screen. Return ONLY a valid JSON object — no markdown fences, no explanation.

SCREEN TYPES:

TYPE "scorecard" — Frame-by-frame scoring. Often shows TWO teams side by side — capture ALL bowlers from BOTH sides.

  CRITICAL — MATCHING NAMES TO SCORES (most common mistake):
  The screen shows each bowler as a HORIZONTAL ROW: [NAME on far left] [10 frames across] [TOTAL on far right]
  - The name on the LEFT of a row belongs to the total score on the RIGHT of that SAME row
  - Never assign a score from one row to the name from a different row
  - Read rows strictly top-to-bottom, left-to-right
  - The "Player: NAME" label at the BOTTOM of the screen is a UI selection highlight — COMPLETELY IGNORE IT. It does NOT represent a bowler row and must NEVER be used to assign or reassign scores.
  - The "Team: NAME" label at the bottom is also just a UI label — COMPLETELY IGNORE IT
  - When TWO screens are shown side by side, treat each screen independently. The "Player:" name at the bottom of the RIGHT screen may be a name that also appears on the LEFT screen — this is coincidental, ignore it entirely and do not let it affect score assignments on either screen.
  - Background color (blue, red, dark) does not affect how you read the data
  - Names may be truncated (WAYN, NIKK, DARN, ALEX) — keep them exactly as shown in the left column

  VERIFICATION — after reading all rows, check each bowler's score:
  The small number at the bottom of frame 10 (the last cumulative total) should equal or be very close to the large final score on the far right of that same row. If they do not match, you have read the wrong row — re-read that screen top to bottom.

  HOW TO READ EACH FRAME:
  The score screen shows each frame as a small box with ball symbols in the top and cumulative running total below.
  Frames 1-9 have at most 2 balls. Frame 10 has at most 3 balls.

  SYMBOLS:
  - X = Strike (all 10 pins on FIRST ball)
  - / = Spare (all remaining pins on SECOND ball)
  - - = Zero pins on that ball
  - Number = pins knocked down on that ball
  - Number in RED CIRCLE or RED BOX on first ball = split (only in UPPER symbol area of frame, NOT the running total below)

  STRIKES: Every X as a FIRST ball in frames 1-9. Each X in frame 10 counted separately.
  SPARES: Every / as SECOND ball in frames 1-9. Each / in frame 10 counted separately.

  MISSED SPARES: Any frame where first ball ≠ strike AND second ball ≠ spare (pins still standing after both balls).
  Examples: "9-"=miss, "8 1"=miss, "6 3"=miss, "--"=miss, "-3"=miss, "-/"=NOT miss (converted), "X"=no opportunity

  SPLITS — READ CAREFULLY:
  A split is ONLY when the FIRST BALL symbol in the TOP of the frame box is shown inside a RED CIRCLE or RED BOX.
  CRITICAL RULES:
  - Each frame box has TWO rows: TOP = ball symbols (X, /, numbers), BOTTOM = smaller running cumulative total
  - A split marker is ONLY on a ball symbol in the TOP row — NEVER on the cumulative total in the BOTTOM row
  - The running totals (e.g. 28, 37, 54, 62...) shown in smaller text below frames are NEVER split indicators
  - A frame CAN be both a split AND a spare — if the first ball is red-circled AND the second ball is /, that is 1 split AND 1 converted split AND 1 spare. This is a rare achievement.
  - A frame CAN be a split without converting — red-circled first ball followed by a number or dash = split not converted
  - Only count a split when you can clearly see a red highlight on the actual first-ball number in the UPPER frame symbol area
  - When in doubt, do NOT count it as a split

  ROW ISOLATION — CRITICAL FOR ALL STATS:
  Each bowler occupies their OWN horizontal row on the scorecard. Every stat — strikes, spares, missedSpares, splits, splitsConverted, games, and total score — must be read EXCLUSIVELY from that bowler's own row of frames.

  MANDATORY PROCESS — follow this for EVERY bowler:
  1. Identify the bowler's name in the LEFT column.
  2. Trace that name's horizontal band ALL THE WAY across to the RIGHT — this is the ONLY row you read for that bowler.
  3. Count strikes, spares, missed spares, and splits ONLY within that horizontal band.
  4. Record the total score from the FAR RIGHT of that SAME band.
  5. Do NOT look up, down, or sideways into adjacent rows at any point.
  6. Fully complete one bowler before starting the next.

  NEVER mix rows: if you are not certain a frame belongs to the current bowler's row, skip it — do not guess.
  A wrong row assignment will corrupt EVERY stat for BOTH bowlers involved.

  Extract per bowler: rawName (exactly as in LEFT column of their row), final total scores (FAR RIGHT of that same row), ballSpeed (m.p.h. at bottom bar for that screen), strikes, spares, missedSpares, splits, splitsConverted.

  BLIND BOWLERS — IMPORTANT:
  If you see the word "BLIND" displayed under or near a bowler's name, that bowler was absent this week.
  - Set isBlind: true for that bowler
  - Set their games: [0] — do NOT use the displayed blind score
  - Set scratchScore: 0, handicapScore: 0
  - Still record their name so they can be updated later

  SCRATCH vs HANDICAP SCORES:
  Some scorecards show TWO totals on the far right per bowler:
  - LEFT total = scratch score (actual pins knocked down, no bonus)
  - RIGHT total = handicap score (scratch + handicap bonus)
  - If you see two numbers, record scratchScore = left number, handicapScore = right number
  - If you see only one number, set scratchScore = that number, handicapScore = null
  - The "Tot + hdcp" column header confirms the right column includes handicap
  - Use SCRATCH scores in the "games" array — always scratch, never handicap

  MULTIPLE GAMES PER BOWLER:
  Some scorecard screens show ALL games for a session (e.g. Game 1, Game 2, Game 3 for each bowler).
  - ALWAYS return ALL games in the "games" array: e.g. games: [124, 160, 124]
  - NEVER return just the total or just one game
  - If handicap scores are shown per game, return them in "handicapGames": [169, 205, 169]
  - series = sum of all scratch games
  - scratchScore = total scratch (sum of games array)
  - handicapScore = total with handicap (right column total)
  Put final score in "games": [score]. This is ONE game.

TYPE "stats" — Per-bowler stats panel (orange background).
  Extract: session average, total pinfall, game scores list, ball speed, high score, low score.

TYPE "recap" — End-of-session recap table (green border).
  Columns: 1st game, 2nd game, 3rd game, Totals. No split/strike data visible.

JSON schema:
{
  "screenType": "scorecard|stats|recap",
  "bowlers": [
    {
      "rawName": "EXACTLY as shown — keep truncations like WAYN, NIKK, DARN",
      "games": [],
      "series": null,
      "scratchScore": null,
      "handicapScore": null,
      "handicapGames": [],
      "isBlind": false,
      "ballSpeed": null,
      "strikes": null,
      "spares": null,
      "missedSpares": null,
      "splits": null,
      "splitsConverted": null,
      "sessionAverage": null,
      "sessionGames": [],
      "highScore": null,
      "lowScore": null
    }
  ],
  "teamLeft":  { "name": null, "total": null },
  "teamRight": { "name": null, "total": null }
}

Output rules:
- scorecard → games:[finalScore], count all stats from frames carefully
- recap → games:[g1,g2,g3], series: total, other stats: null
- stats → games:[], sessionGames:[list of scores]
- Use null (not 0) when data is genuinely not visible or not applicable
- ONLY return the JSON object, nothing else`;

  // Retry up to 3 times on 529 overload or 529-like transient errors
  const MAX_RETRIES = 3;
  let resp, lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key':CONFIG.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
      payload: JSON.stringify({
        model:'claude-sonnet-4-5', max_tokens:1200,
        messages:[{ role:'user', content:[
          { type:'image', source:{ type:'base64', media_type:mediaType||'image/jpeg', data:imageBase64 } },
          { type:'text', text:prompt }
        ]}]
      }),
      muteHttpExceptions:true
    });

    const code = resp.getResponseCode();

    if (code === 200) break; // success — exit retry loop

    lastError = 'AI error ' + code + ': ' + resp.getContentText().substring(0, 200);

    // Retry on 529 (overloaded) or 503 (service unavailable) — wait longer each attempt
    if ((code === 529 || code === 503 || code === 500) && attempt < MAX_RETRIES) {
      const waitSeconds = attempt * 8; // 8s, 16s between retries
      Logger.log('Anthropic API overloaded (attempt ' + attempt + '), retrying in ' + waitSeconds + 's...');
      Utilities.sleep(waitSeconds * 1000);
      continue;
    }

    // Non-retryable error (400, 401, 404, etc.) — throw immediately
    throw new Error(lastError);
  }

  if (resp.getResponseCode() !== 200) throw new Error(lastError);
  const data = JSON.parse(resp.getContentText());
  const raw = data.content.map(b=>b.text||'').join('').trim().replace(/```json|```/g,'').trim();
  const parsed = JSON.parse(raw);
  const rosterMap = getRosterMap(ss);
  const fullRoster = ss ? getFullRoster(ss) : Object.values(rosterMap);

  // Validate scores are in valid bowling range (0-300)
  parsed.bowlers = (parsed.bowlers||[]).map(b => {
    const games = (b.games||[]).map(s => Number(s)).filter(s => !isNaN(s) && s >= 0 && s <= 300);
    return {
      ...b,
      games,
      matchedName: matchName(b.rawName, rosterMap, fullRoster),
      isNew: !rosterMap[(b.rawName||'').toUpperCase().trim()]
    };
  }).filter(b => b.rawName && (b.games||[]).length > 0);

  return { success:true, analysis:parsed };
}

// handleImageUpload is an alias used by the doPost handler
function handleImageUpload(body, user, ss) {
  return analyzeImage(body, user, ss);
}

// ═══════════════════════════════════════════════════════════════
//  SMART MERGE & SAVE
// ═══════════════════════════════════════════════════════════════
function saveAndMergeSession(session, user, ss) {
  const now = new Date();
  const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'MM/dd/yyyy');
  const weekKey = getWeekKey(now);
  const sessionId = 'S' + now.getTime();
  const screenType = (session.screenType||'scorecard').toLowerCase();
  const location = (session.location || '').trim();

  const bowlers = (session.bowlers||[]).map(b=>({ ...b, finalName:(b.confirmedName||b.matchedName||b.rawName||'').trim() }));

  // Log raw session — include location
  const sessSh = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
  sessSh.appendRow([sessionId, dateStr, weekKey, user.email, screenType,
    (session.teamLeft||{}).name||'', (session.teamRight||{}).name||'',
    JSON.stringify(session), now.toISOString()]);

  // Load Games sheet for merge
  const gamesSh = ss.getSheetByName(CONFIG.SHEETS.GAMES);
  const gData = gamesSh.getDataRange().getValues();
  const hdr = gData[0];
  const col = n => hdr.indexOf(n);

  // Build lookup: gameKey → row index (1-based in sheet)
  const keyToRow = {};
  for (let i=1; i<gData.length; i++) { if(gData[i][0]) keyToRow[gData[i][0]] = i+1; }

  const newBowlerNames = [];

  bowlers.forEach(b => {
    const name = b.finalName; if(!name) return;
    const gameKey = name.toLowerCase().replace(/\s+/g,'_') + '|' + dateStr;

    ensureBowlerInSheets(b, name, user, ss, newBowlerNames);

    if (!keyToRow[gameKey]) {
      const row = buildNewGameRow(gameKey, name, dateStr, weekKey, b, screenType, sessionId, location);
      gamesSh.appendRow(row);
      keyToRow[gameKey] = gamesSh.getLastRow();
    } else {
      const rowIdx = keyToRow[gameKey];
      const existing = gData[rowIdx - 1];
      const merged = mergeIntoExisting(existing, b, screenType, hdr, col);
      const sidCol = col('SessionID');
      if (sidCol > -1 && !merged[sidCol]) merged[sidCol] = sessionId;
      // Update location if not set
      const locCol = col('Location');
      if (locCol > -1 && location && !merged[locCol]) merged[locCol] = location;
      gamesSh.getRange(rowIdx, 1, 1, merged.length).setValues([merged]);
    }
  });

  SpreadsheetApp.flush();
  if (newBowlerNames.length) notifyAdmins(newBowlerNames, user.email);
  return { success:true, sessionId, bowlersProcessed:bowlers.length };
}

function buildNewGameRow(gameKey, name, dateStr, weekKey, b, screenType, sessionId, location) {
  let g1='', g2='', g3='', g4='', series='', sources=screenType;
  let h1='', h2='', h3='', h4='';
  const isBlind = b.isBlind ? true : false;

  if (isBlind) {
    // Blind bowler — all zeros
    g1=0; g2=''; g3=''; g4=''; series=0;
    h1=0; h2=''; h3=''; h4='';
  } else {
    const games = b.games || [];
    const hdcps = b.handicapGames || [];

    // scratchScore / handicapScore come from single-game screens (one total each)
    // For multi-game screens, games[] has each individual game
    // Always use games[] if it has multiple entries; fall back to scratchScore for single game
    if (games.length >= 2) {
      // Multi-game scorecard (youth league style — all games shown at once)
      g1 = games[0] || ''; g2 = games[1] || ''; g3 = games[2] || ''; g4 = games[3] || '';
      h1 = hdcps[0] || ''; h2 = hdcps[1] || ''; h3 = hdcps[2] || ''; h4 = hdcps[3] || '';
      // If only one handicap total was given, store it in h1
      if (!h1 && b.handicapScore) h1 = b.handicapScore;
    } else {
      // Single game scorecard
      g1 = b.scratchScore != null ? b.scratchScore : (games[0] || '');
      h1 = b.handicapScore || '';
    }

    series = b.series || [g1,g2,g3,g4].reduce((a,c)=>a+(Number(c)||0), 0) || '';
  }

  return [gameKey, name, dateStr, weekKey, g1, g2, g3, g4, series,
    isBlind ? '' : (b.ballSpeed||''),
    isBlind ? 0  : (b.strikes||0),
    isBlind ? 0  : (b.spares||0),
    isBlind ? 0  : (b.missedSpares||0),
    isBlind ? 0  : (b.splits||0),
    isBlind ? 0  : (b.splitsConverted||0),
    isBlind ? '' : (b.sessionAverage||''),
    sessionId||'', location||'', h1, h2, h3, h4,
    isBlind ? 'YES' : '',
    sources, new Date().toISOString()];
}

function mergeIntoExisting(existing, b, screenType, hdr, col) {
  // Pad existing row to current header length — handles rows written before
  // new columns (Splits, SplitsConverted) were added
  const m = [...existing];
  while (m.length < hdr.length) m.push('');

  // Safe getter/setter — won't crash if column doesn't exist
  const get = name => { const i=col(name); return (i>-1 && i<m.length) ? (m[i]??'') : ''; };
  const set = (name, val) => { const i=col(name); if(i>-1) m[i]=val; };

  const sources = String(get('DataSources')||'').split(',').map(s=>s.trim()).filter(Boolean);
  const now = new Date().toISOString();

  if (screenType==='recap') {
    const g=b.games||[];
    if(g[0]) set('Game1',g[0]);
    if(g[1]) set('Game2',g[1]);
    if(g[2]) set('Game3',g[2]);
    if(g[3]) set('Game4',g[3]);
    const s=g.reduce((a,c)=>a+(Number(c)||0),0); if(s>0) set('Series',s);
    if(!sources.includes('recap')) sources.push('recap');

  } else if (screenType==='scorecard') {
    const score=(b.games||[])[0];
    // Track how many scorecards have been merged so we can cap accumulation
    const scorecardCount = sources.filter(s => s === 'scorecard').length;
    const maxGames = ['Game1','Game2','Game3','Game4'].filter(s => Number(get(s)) > 0).length;
    // Only accumulate stats if this scorecard slot hasn't been filled yet
    const allowAccumulate = scorecardCount < 4 && (!score || maxGames < 4);
    if(score) {
      for(const s of ['Game1','Game2','Game3','Game4']) {
        if(!get(s)) { set(s,score); break; }
        if(Number(get(s))===Number(score)) break;
      }
    }
    if(b.ballSpeed && !get('BallSpeedMPH')) set('BallSpeedMPH', b.ballSpeed);
    if(allowAccumulate) {
      // Cap each stat field so a single game can contribute at most 10 (max frames)
      const capStat = (field, val) => {
        if (val == null) return;
        const capped = Math.min(Number(val) || 0, 10);
        set(field, (Number(get(field)) || 0) + capped);
      };
      capStat('Strikes',         b.strikes);
      capStat('Spares',          b.spares);
      capStat('MissedSpares',    b.missedSpares);
      capStat('Splits',          b.splits);
      capStat('SplitsConverted', b.splitsConverted);
    }
    sources.push('scorecard'); // track each upload separately (allows up to 4)

  } else if (screenType==='stats') {
    if(b.ballSpeed && !get('BallSpeedMPH')) set('BallSpeedMPH', b.ballSpeed);
    if(b.sessionAverage && !get('SessionAvg')) set('SessionAvg', b.sessionAverage);
    const sg=b.sessionGames||[];
    ['Game1','Game2','Game3','Game4'].forEach((s,i)=>{ if(i<sg.length && sg[i] && !get(s)) set(s,sg[i]); });
    const statsSeries=sg.reduce((a,c)=>a+(Number(c)||0),0);
    if(statsSeries>0 && !get('Series')) set('Series',statsSeries);
    if(!sources.includes('stats')) sources.push('stats');
  }

  // Recompute series if still missing
  if(!get('Series')) {
    const tot=['Game1','Game2','Game3','Game4'].reduce((a,s)=>a+(Number(get(s))||0),0);
    if(tot>0) set('Series',tot);
  }

  set('DataSources', sources.join(','));
  set('UpdatedAt', now);
  return m;
}

function ensureBowlerInSheets(b, name, user, ss, newArr) {
  const rawUpper=(b.rawName||'').toUpperCase().trim();
  const rsh=ss.getSheetByName(CONFIG.SHEETS.ROSTER);
  const rd=rsh.getDataRange().getValues();
  if(rawUpper && !rd.slice(1).find(r=>(r[0]||'').toUpperCase()===rawUpper))
    rsh.appendRow([rawUpper, name, new Date().toISOString()]);
  const bsh=ss.getSheetByName(CONFIG.SHEETS.BOWLERS);
  const bd=bsh.getDataRange().getValues();
  if(!bd.slice(1).find(r=>(r[1]||'').toLowerCase()===name.toLowerCase()&&r[4])) {
    bsh.appendRow(['B'+String(bsh.getLastRow()).padStart(4,'0'), name, new Date().toISOString(), user.email, true]);
    newArr.push(name);
  }
}

// ═══════════════════════════════════════════════════════════════
//  NAME MATCHING
// ═══════════════════════════════════════════════════════════════
function getRosterMap(ss) {
  const sh=ss.getSheetByName(CONFIG.SHEETS.ROSTER);
  const data=sh.getDataRange().getValues(); const map={};
  for(let i=1;i<data.length;i++) if(data[i][0]) map[data[i][0].toString().toUpperCase().trim()]=data[i][1];
  return map;
}
function getFullRoster(ss) {
  const sh=ss.getSheetByName(CONFIG.SHEETS.BOWLERS);
  return sh.getDataRange().getValues().slice(1).filter(r=>r[4]).map(r=>r[1]);
}
function matchName(rawName, rosterMap, fullRoster) {
  if(!rawName) return rawName;
  const up=rawName.toUpperCase().trim();
  if(rosterMap[up]) return rosterMap[up];
  const full = fullRoster || Object.values(rosterMap);
  const pref=full.find(n=>n.toUpperCase().startsWith(up)||up.startsWith(n.toUpperCase().substring(0,4)));
  if(pref) return pref;
  let best=null, bestD=Infinity;
  for(const n of full){ const d=lev(up,n.toUpperCase().substring(0,up.length+2)); if(d<bestD){bestD=d;best=n;} }
  if(bestD<=2&&best) return best;
  return rawName;
}
function lev(a,b) {
  const m=a.length,n=b.length,dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i?j?0:i:j));
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++) dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}

// ═══════════════════════════════════════════════════════════════
//  WEEK KEY
// ═══════════════════════════════════════════════════════════════
//  WEEK KEY — anchored to Monday of each Mon-Sun week
//  So all uploads from Mon through Sun share the same WeekKey
// ═══════════════════════════════════════════════════════════════
function getWeekKey(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Shift back to Monday: Sunday (0) goes back 6 days, Mon (1) stays, Tue (2) goes back 1, etc.
  const daysToMonday = (day === 0) ? 6 : day - 1;
  d.setDate(d.getDate() - daysToMonday);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/dd/yyyy');
}

// ═══════════════════════════════════════════════════════════════
//  PUBLIC DATA APIs
// ═══════════════════════════════════════════════════════════════
function getPublicStats(ss) {
  const sh  = ss.getSheetByName(CONFIG.SHEETS.GAMES);
  const data = sh.getDataRange().getValues();
  const hdr  = data[0];
  const col  = n => hdr.indexOf(n);

  const stats = {};

  data.slice(1).filter(r => r[col('BowlerName')]).forEach(r => {
    const name    = (r[col('BowlerName')] || '').trim();
    if (!name) return;
    const date    = r[col('Date')] || '';
    // Always recompute weekKey from date — avoids stale stored values
    const weekKey = date ? getWeekKey(new Date(date)) : (r[col('WeekKey')] || '');

    if (!stats[name]) stats[name] = {
      name, totalPins: 0, totalGames: 0,
      games: [], gamesByDate: {},
      speeds: [], strikes: 0, spares: 0, missedSpares: 0,
      splits: 0, splitsConverted: 0,
      sessionAvgs: [], weeks: new Set(),
      locationCount: {},
      hdcpGames: [], blindWeeks: 0
    };

    const s = stats[name];
    const isBlind = r[col('IsBlind')] === 'YES' || r[col('IsBlind')] === true;

    const gameScores = [];
    ['Game1','Game2','Game3','Game4'].forEach((g, i) => {
      const v = Number(r[col(g)]);
      const hdcpCols = ['Hdcp1','Hdcp2','Hdcp3','Hdcp4'];
      const hdcpCol = col(hdcpCols[i]);
      const h = hdcpCol > -1 ? Number(r[hdcpCol]) : 0;
      // Only count non-blind games toward averages
      if (v > 0 && !isBlind) {
        gameScores.push(v);
        s.games.push(v);
        s.totalPins += v;
        s.totalGames++;
        if (h > 0) s.hdcpGames.push(h);
      }
    });

    if (isBlind) s.blindWeeks++;

    if (gameScores.length > 0) {
      if (!s.gamesByDate[weekKey]) s.gamesByDate[weekKey] = [];
      s.gamesByDate[weekKey].push(...gameScores);
    }

    // Track location
    const locCol = col('Location');
    const loc = locCol > -1 ? (r[locCol] || '') : '';
    if (loc && gameScores.length > 0) {
      s.locationCount[loc] = (s.locationCount[loc] || 0) + gameScores.length;
    }

    const sp = Number(r[col('BallSpeedMPH')]); if (sp > 0 && !isBlind) s.speeds.push(sp);
    if (!isBlind) {
      s.strikes       += Number(r[col('Strikes')])        || 0;
      s.spares        += Number(r[col('Spares')])         || 0;
      s.missedSpares  += Number(r[col('MissedSpares')])   || 0;
      const splCol     = col('Splits');
      const splCnvCol  = col('SplitsConverted');
      if (splCol    > -1) s.splits          += Number(r[splCol])    || 0;
      if (splCnvCol > -1) s.splitsConverted += Number(r[splCnvCol]) || 0;
      const sa = Number(r[col('SessionAvg')]); if (sa > 0) s.sessionAvgs.push(sa);
    }
    if (weekKey) s.weeks.add(weekKey);
  });

  const av = arr => arr.length ? Math.round(arr.reduce((a,b) => a+b, 0) / arr.length) : 0;
  const HANDICAP_BASE = 220; // standard league handicap base
  const HANDICAP_PCT  = 0.9;

  const bowlers = Object.values(stats).map(b => {
    const sorted = [...b.games].sort((a,z) => z - a);

    // ── Bowling Average: Total Pins / Total Games ──────────────────
    const avg = b.totalGames > 0 ? Math.round(b.totalPins / b.totalGames) : 0;

    // ── Handicap: (Base - Avg) × Pct, min 0 ──────────────────────
    const handicap = Math.max(0, Math.round((HANDICAP_BASE - avg) * HANDICAP_PCT));

    // ── High Game: single highest game score ──────────────────────
    const highGame = sorted[0] || 0;

    // ── High Series: highest sum of games bowled on same day ──────
    // A "series" is all games bowled in one session (same date)
    let highSeries = 0;
    Object.values(b.gamesByDate).forEach(dayGames => {
      const dayTotal = dayGames.reduce((a, c) => a + c, 0);
      if (dayTotal > highSeries) highSeries = dayTotal;
    });

    // ── Strike %: Strikes / Total First Ball Frames × 100 ────────
    // Total first ball frames = total games × 10
    const totalFirstBallFrames = b.totalGames * 10;
    const strikePct = totalFirstBallFrames > 0
      ? Math.round((b.strikes / totalFirstBallFrames) * 100) : null;

    // ── Spare %: Spares / (Frames - Strikes) × 100 ───────────────
    // Spare opportunities = total frames where first ball was NOT a strike
    const spareOpportunities = b.spares + b.missedSpares;
    const sparePct = spareOpportunities > 0
      ? Math.round((b.spares / spareOpportunities) * 100) : null;

    // ── Split Conversion %: SplitsConverted / Splits × 100 ───────
    const splitPct = b.splits > 0
      ? Math.round((b.splitsConverted / b.splits) * 100) : null;

    // ── Potential avg at 70% spare conversion ─────────────────────
    let potentialAvg = null;
    if (sparePct !== null && sparePct < 70 && spareOpportunities > 0) {
      const spareOppsPerGame   = spareOpportunities / b.totalGames;
      const currentConvPerGame = b.spares / b.totalGames;
      const targetConvPerGame  = spareOppsPerGame * 0.70;
      const extraSpares        = targetConvPerGame - currentConvPerGame;
      potentialAvg = Math.round(avg + extraSpares * 10);
    }

    // ── Locations summary ─────────────────────────────────────────
    // Sort by game count to show most-played location first
    const locations = Object.entries(b.locationCount || {})
      .sort((a,z) => z[1] - a[1])
      .map(([name, games]) => ({ name, games }));
    const primaryLocation = locations.length ? locations[0].name : null;

    return {
      name:            b.name,
      avg,
      handicap,
      hdcpAvg:         b.hdcpGames.length ? Math.round(b.hdcpGames.reduce((a,c)=>a+c,0)/b.hdcpGames.length) : null,
      blindWeeks:      b.blindWeeks || 0,
      totalPins:       b.totalPins,
      totalGames:      b.totalGames,
      gamesCount:      b.totalGames,
      weeksCount:      b.weeks.size,
      highGame,
      highSeries,
      avgSeries:       av(Object.values(b.gamesByDate).map(dg => dg.reduce((a,c)=>a+c,0)).filter(v=>v>0)),
      top3Avg:         av(sorted.slice(0, 3)),
      first3Avg:       av(b.games.slice(0, 3)),
      strikes:         b.strikes,
      spares:          b.spares,
      missedSpares:    b.missedSpares,
      splits:          b.splits,
      splitsConverted: b.splitsConverted,
      strikePct,
      sparePct,
      splitPct,
      potentialAvg,
      avgSpeed:        b.speeds.length ? (b.speeds.reduce((a,c)=>a+c,0)/b.speeds.length).toFixed(1) : null,
      recentGames:     b.games.slice(-16),
      gamesByDate:     b.gamesByDate,
      locations,
      primaryLocation,
    };
  });

  return { bowlers, updatedAt: new Date().toISOString() };
}

function getLeaderboard() {
  const { bowlers }=getPublicStats();
  return {
    byAverage:  [...bowlers].filter(b=>b.avg>0).sort((a,z)=>z.avg-a.avg).slice(0,10),
    byHighGame: [...bowlers].filter(b=>b.highGame>0).sort((a,z)=>z.highGame-a.highGame).slice(0,10),
    byHighSeries:[...bowlers].filter(b=>b.highSeries>0).sort((a,z)=>z.highSeries-a.highSeries).slice(0,10),
    bySpeed:    [...bowlers].filter(b=>b.avgSpeed).sort((a,z)=>parseFloat(z.avgSpeed)-parseFloat(a.avgSpeed)).slice(0,10),
    updatedAt:  new Date().toISOString()
  };
}

function getSessionHistory(ss) {
  const sh=ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
  const data=sh.getDataRange().getValues(); const hdr=data[0]; const col=n=>hdr.indexOf(n);

  // Build location lookup from Games sheet by date
  const gameSh = ss.getSheetByName(CONFIG.SHEETS.GAMES);
  const gData  = gameSh.getDataRange().getValues();
  const gh = gData[0]; const gc = n => gh.indexOf(n);
  const locationByDate = {};
  gData.slice(1).filter(r=>r[gc('Date')]).forEach(r => {
    const loc = r[gc('Location')];
    if (loc) locationByDate[r[gc('Date')]] = loc;
  });

  const sessions=data.slice(1).filter(r=>r[0]).reverse().slice(0,60).map(r=>{
    let rawBowlers=[];
    try{rawBowlers=(JSON.parse(r[col('RawJSON')])||{}).bowlers||[];}catch(e){}
    // Deduplicate bowlers by name — team scorecards can list the same bowler on both sides
    const bowlerMap={};
    rawBowlers.forEach(b=>{
      const key=(b.matchedName||b.name||'').trim().toLowerCase();
      if(!key) return;
      if(!bowlerMap[key]) { bowlerMap[key]={...b}; }
      else { bowlerMap[key].games=[...(bowlerMap[key].games||[]),...(b.games||[])]; }
    });
    const bowlers=Object.values(bowlerMap);
    const date = r[col('Date')];
    return { id:r[col('SessionID')], date, weekKey:r[col('WeekKey')],
      screenType:r[col('ScreenType')], teamLeft:r[col('TeamLeft')], teamRight:r[col('TeamRight')],
      location: locationByDate[date] || '',
      bowlers };
  });
  return { sessions };
}

function getWeeklySummary(ss) {
  const sh=ss.getSheetByName(CONFIG.SHEETS.GAMES);
  const data=sh.getDataRange().getValues(); const hdr=data[0]; const col=n=>hdr.indexOf(n);
  const weeks={};
  data.slice(1).filter(r=>r[col('BowlerName')]).forEach(r=>{
    const date=r[col('Date')]||'';
    const wk = date ? getWeekKey(new Date(date)) : (r[col('WeekKey')]||'');
    const name=(r[col('BowlerName')]||'').trim();
    if(!name) return;
    if(!weeks[wk]) weeks[wk]={week:wk,bowlers:{},allGames:[]};
    if(!weeks[wk].bowlers[name]) weeks[wk].bowlers[name]={
      name, games:[], splits:0, spares:0, missedSpares:0, strikes:0, totalPins:0
    };
    const b = weeks[wk].bowlers[name];
    ['Game1','Game2','Game3','Game4'].forEach(g=>{
      const v=Number(r[col(g)]);if(v>0){b.games.push(v);b.totalPins+=v;weeks[wk].allGames.push(v);}
    });
    b.splits       += Number(r[col('Splits')])||0;
    b.spares       += Number(r[col('Spares')])||0;
    b.missedSpares += Number(r[col('MissedSpares')])||0;
    b.strikes      += Number(r[col('Strikes')])||0;
  });
  const av=arr=>arr.length?Math.round(arr.reduce((a,b)=>a+b,0)/arr.length):0;
  const summaries=Object.values(weeks).map(w=>({
    week:w.week, groupAvg:av(w.allGames), highGame:w.allGames.length?Math.max(...w.allGames):0,
    bowlers:Object.values(w.bowlers).map(b=>({
      name:b.name, avg:av(b.games), high:Math.max(...b.games,0),
      games:b.games, splits:b.splits, spares:b.spares, missedSpares:b.missedSpares,
      strikes:b.strikes, totalPins:b.totalPins
    })).sort((a,z)=>z.avg-a.avg)
  })).sort((a,z)=>new Date(z.week)-new Date(a.week)).slice(0,16);
  return { weeks:summaries };
}

// ═══════════════════════════════════════════════════════════════
//  AWARDS ENGINE
// ═══════════════════════════════════════════════════════════════
function getAwards(ss) {
  const sh   = ss.getSheetByName(CONFIG.SHEETS.GAMES);
  const data = sh.getDataRange().getValues();
  const hdr  = data[0]; const col = n => hdr.indexOf(n);

  // ── Build season stats — track prior weeks separately for over-avg ─
  const season = {};
  const priorSeason = {}; // same but excludes current week — used for over-avg
  const allGames = []; // { name, score, date, weekKey }

  data.slice(1).filter(r => r[col('BowlerName')]).forEach(r => {
    const name    = r[col('BowlerName')];
    const date    = r[col('Date')] || '';
    // Always recompute weekKey from the actual date — this handles rows uploaded
    // before the Monday-anchoring fix was deployed
    const weekKey = date ? getWeekKey(new Date(date)) : (r[col('WeekKey')] || '');
    const hasStatData = (Number(r[col('Strikes')])||0) + (Number(r[col('Spares')])||0) + (Number(r[col('MissedSpares')])||0) > 0;

    if (!season[name]) season[name] = {
      name, totalPins:0, totalGames:0, games:[], gamesByDate:{},
      splits:0, spares:0, missedSpares:0, strikes:0, weeks: new Set(),
      hasStats: false
    };
    if (!priorSeason[name]) priorSeason[name] = { games: [] };

    const s = season[name];
    const gameScores = [];
    ['Game1','Game2','Game3','Game4'].forEach(g => {
      const v = Number(r[col(g)]);
      if (v > 0) {
        s.games.push(v); s.totalPins += v; s.totalGames++;
        gameScores.push(v);
        allGames.push({ name, score: v, date, weekKey });
        // Group by weekKey so all games across multiple uploads in the same week aggregate correctly
        if (!s.gamesByDate[weekKey]) s.gamesByDate[weekKey] = [];
        s.gamesByDate[weekKey].push(v);
      }
    });

    // Only count spare/split stats from rows that actually have stat data
    // (rows uploaded before stat tracking was added will have 0s — skip those)
    if (hasStatData) {
      s.splits       += Number(r[col('Splits')])||0;
      s.spares       += Number(r[col('Spares')])||0;
      s.missedSpares += Number(r[col('MissedSpares')])||0;
      s.strikes      += Number(r[col('Strikes')])||0;
      s.hasStats = true;
    }
    if (weekKey) s.weeks.add(weekKey);

    // Will be filled after we know currentWeek — placeholder for now
    priorSeason[name]._rows = priorSeason[name]._rows || [];
    priorSeason[name]._rows.push({ weekKey, games: gameScores });
  });

  const av = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0;

  // ── Game milestone badges (all-time) ─────────────────────────
  // Award highest milestone achieved per bowler per game
  const MILESTONES = [
    { min:300, max:300, key:'300', label:'PERFECT 300',  emoji:'🏆', rarity:'legendary' },
    { min:290, max:299, key:'290', label:'290+ GAME',    emoji:'💎', rarity:'epic' },
    { min:275, max:289, key:'275', label:'275+ GAME',    emoji:'🔥', rarity:'epic' },
    { min:250, max:274, key:'250', label:'250+ GAME',    emoji:'⚡', rarity:'rare' },
    { min:225, max:249, key:'225', label:'225+ GAME',    emoji:'🌟', rarity:'rare' },
    { min:200, max:224, key:'200', label:'200+ GAME',    emoji:'✨', rarity:'uncommon' },
    { min:175, max:199, key:'175', label:'175+ GAME',    emoji:'🎳', rarity:'common' },
  ];

  // Count milestone achievements per bowler
  const milestoneCounts = {}; // { name: { '300':0, '290':0, ... } }
  const milestoneGames  = {}; // all individual milestone achievements for the timeline

  allGames.forEach(g => {
    const m = MILESTONES.find(m => g.score >= m.min && g.score <= m.max);
    if (!m) return;
    if (!milestoneCounts[g.name]) milestoneCounts[g.name] = {};
    milestoneCounts[g.name][m.key] = (milestoneCounts[g.name][m.key]||0) + 1;
    if (!milestoneGames[g.name]) milestoneGames[g.name] = [];
    milestoneGames[g.name].push({ ...g, milestone: m });
  });

  // ── Weekly awards — find the most recent week and get ALL rows for it ──
  // Use the computed weekKey from the date column as fallback in case stored
  // WeekKey is stale (e.g. uploaded before Monday-anchoring was implemented)
  const allWeeks = [...new Set(allGames.map(g => g.weekKey))]
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a)); // newest first
  const currentWeek = allWeeks[0];
  const weekGames   = allGames.filter(g => g.weekKey === currentWeek);

  const weekBowlers = {};
  data.slice(1).filter(r => {
    if (!r[col('BowlerName')]) return false;
    // Match either the stored WeekKey OR the recomputed WeekKey from the date
    const storedWk   = r[col('WeekKey')] || '';
    const computedWk = r[col('Date')] ? getWeekKey(new Date(r[col('Date')])) : '';
    return storedWk === currentWeek || computedWk === currentWeek;
  }).forEach(r => {
    const name = r[col('BowlerName')];
    if (!weekBowlers[name]) weekBowlers[name] = {
      name, games:[], totalPins:0, splits:0, spares:0, missedSpares:0, strikes:0
    };
    const b = weekBowlers[name];
    ['Game1','Game2','Game3','Game4'].forEach(g => {
      const v = Number(r[col(g)]); if (v > 0) { b.games.push(v); b.totalPins += v; }
    });
    b.splits       += Number(r[col('Splits')])||0;
    b.spares       += Number(r[col('Spares')])||0;
    b.missedSpares += Number(r[col('MissedSpares')])||0;
    b.strikes      += Number(r[col('Strikes')])||0;
  });

  const weekArr = Object.values(weekBowlers);

  // Biggest "Huh?!" Award — largest swing between highest and lowest game this week
  // Only qualifies if bowler has 2+ games this week
  const weeklyHuh = weekArr
    .filter(b => b.games.length >= 2)
    .map(b => {
      const high = Math.max(...b.games);
      const low  = Math.min(...b.games);
      return { name:b.name, high, low, swing: high - low, games: b.games };
    })
    .sort((a,z) => z.swing - a.swing);

  // Most over average this week
  // Compare this week's average against PRIOR weeks only (exclude current week from baseline)
  // so the award reflects genuine improvement, not a circular calculation
  const weeklyOverAvg = weekArr.map(b => {
    const priorGames = (priorSeason[b.name]?._rows || [])
      .filter(r => r.weekKey !== currentWeek)
      .flatMap(r => r.games);
    const priorAvg = priorGames.length > 0 ? av(priorGames) : null;
    const weekAvg  = av(b.games);
    // Only award if they have a prior week to compare against
    if (priorAvg === null) return null;
    return { name:b.name, weekAvg, priorAvg, overAvg: weekAvg - priorAvg };
  }).filter(b => b && b.overAvg > 0).sort((a,z) => z.overAvg - a.overAvg);

  // Royal Split Award — most splits this week
  const weeklySplits = weekArr.filter(b => b.splits > 0)
    .sort((a,z) => z.splits - a.splits);

  // Best spare shooter this week — only bowlers with actual stat data
  const weeklySpare = weekArr
    .filter(b => (b.spares + b.missedSpares) > 0)
    .map(b => ({ name:b.name, pct: Math.round(b.spares/(b.spares+b.missedSpares)*100), spares:b.spares, misses:b.missedSpares }))
    .filter(b => b.pct >= 0)
    .sort((a,z) => z.pct - a.pct);

  // High game of the week — highest single game score, numeric comparison
  const weekHighGame = weekGames.length
    ? weekGames.reduce((best, g) => Number(g.score) > Number(best.score) ? g : best, weekGames[0])
    : null;

  // ── Season awards ─────────────────────────────────────────────
  const seasonArr = Object.values(season).filter(b => b.totalGames > 0);

  // Season spare leader — only include bowlers where stat data was actually recorded
  const seasonSpare = seasonArr
    .filter(b => b.hasStats && (b.spares + b.missedSpares) > 0)
    .map(b => ({ name:b.name, pct: Math.round(b.spares/(b.spares+b.missedSpares)*100) }))
    .sort((a,z) => z.pct - a.pct);

  const seasonSplits = seasonArr.filter(b => b.splits > 0)
    .sort((a,z) => z.splits - a.splits);

  return {
    currentWeek,
    weekly: {
      overAvg:    weeklyOverAvg,
      splits:     weeklySplits,
      spare:      weeklySpare,
      highGame:   weekHighGame,
      huh:        weeklyHuh,
    },
    season: {
      spare:      seasonSpare,
      splits:     seasonSplits,
    },
    milestones:      milestoneCounts,
    milestoneGames,
    updatedAt: new Date().toISOString()
  };
}

function notifyAdmins(names, uploadedBy) {
  try { GmailApp.sendEmail(CONFIG.SUPER_ADMIN_EMAILS[0],'🎳 Lane Legends — New Bowler(s) Added',
    'New bowler(s):\n\n'+names.join('\n')+'\n\nAdded by: '+uploadedBy); }
  catch(e){ Logger.log('Email error: '+e.message); }
}

// ── doOptions handles iOS Safari CORS preflight ──────────────────
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

function json(data) {
  // Apps Script doesn't support custom headers, but setting MimeType to JSON
  // and using text/plain on the client side avoids the preflight entirely.
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════
//  MISSING FUNCTIONS — referenced in doGet/doPost handlers
// ═══════════════════════════════════════════════════════════════

function getRecentSessionsForDupe(ss) {

  const gameSh = ss.getSheetByName(CONFIG.SHEETS.GAMES);
  const data = gameSh.getDataRange().getValues();
  const hdr = data[0]; const col = n => hdr.indexOf(n);

  // Group game rows by date+bowler into session-like objects for fingerprinting
  const sessMap = {};
  data.slice(1).filter(r => r[col('BowlerName')]).forEach(r => {
    const dateKey = r[col('Date')] || '';
    if (!sessMap[dateKey]) sessMap[dateKey] = { date: dateKey, bowlers: [] };
    const games = ['Game1','Game2','Game3','Game4'].map(g => Number(r[col(g)])||0).filter(v=>v>0);
    const series = Number(r[col('Series')]) || games.reduce((a,c)=>a+c,0);
    sessMap[dateKey].bowlers.push({ name: r[col('BowlerName')], matchedName: r[col('BowlerName')], games, series });
  });

  return { sessions: Object.values(sessMap).slice(-50) };
}

function getAdminSessions(ss) {
  const sessSh = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
  const gameSh = ss.getSheetByName(CONFIG.SHEETS.GAMES);

  const sessData = sessSh.getDataRange().getValues();
  const sh = sessData[0]; const sc = n => sh.indexOf(n);

  const gameData = gameSh.getDataRange().getValues();
  const gh = gameData[0]; const gc = n => gh.indexOf(n);

  // Build lookup by SessionID (exact) — each upload gets only its own bowlers
  const gamesBySessionId = {};
  gameData.slice(1).filter(r => r[gc('BowlerName')]).forEach(r => {
    const sid = String(r[gc('SessionID')] || '');
    if (!sid) return;
    if (!gamesBySessionId[sid]) gamesBySessionId[sid] = [];
    const games = ['Game1','Game2','Game3','Game4'].map(g=>Number(r[gc(g)])||0).filter(v=>v>0);
    const series = games.reduce((a,c)=>a+c, 0);
    const hdcpCol = gc('Hdcp1');
    const hdcp = hdcpCol > -1 ? Number(r[hdcpCol])||0 : 0;
    gamesBySessionId[sid].push({
      matchedName: r[gc('BowlerName')],
      games, series, hdcp,
      isBlind: r[gc('IsBlind')] === 'YES'
    });
  });

  const sessions = sessData.slice(1).filter(r => r[0]).reverse().slice(0, 60).map(r => {
    const sessionId  = r[sc('SessionID')];
    const rawDate    = r[sc('Date')];
    const uploadedAt = r[sc('CreatedAt')];
    const teamLeft   = r[sc('TeamLeft')]  || '';
    const teamRight  = r[sc('TeamRight')] || '';
    const screenType = r[sc('ScreenType')] || '';

    let displayDate = '';
    try {
      const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (!isNaN(d.getTime()))
        displayDate = Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEE, MMM d yyyy');
      else displayDate = String(rawDate);
    } catch(e) { displayDate = String(rawDate); }

    let displayTime = '';
    try {
      const d = uploadedAt instanceof Date ? uploadedAt : new Date(uploadedAt);
      if (!isNaN(d.getTime()))
        displayTime = Utilities.formatDate(d, Session.getScriptTimeZone(), 'h:mm a');
    } catch(e) {}

    // Use SessionID-exact match — each upload shows only its own bowlers
    const bowlers = gamesBySessionId[sessionId] || [];
    const totalPins = bowlers.filter(b=>!b.isBlind).reduce((sum,b)=>sum+(b.series||0), 0);
    const teamName = [teamLeft,teamRight].filter(Boolean).join(' & ') || screenType || 'Session';

    return {
      id:          sessionId,
      date:        displayDate,
      uploadedAt:  displayTime,
      teamName,
      uploadedBy:  r[sc('UploadedBy')],
      bowlers,
      totalPins,
      playerCount: bowlers.length,
    };
  });

  return { sessions };
}

function getAdminRoster(ss) {

  const bowlerSh = ss.getSheetByName(CONFIG.SHEETS.BOWLERS);
  const rosterSh = ss.getSheetByName(CONFIG.SHEETS.ROSTER);

  const roster = bowlerSh.getDataRange().getValues().slice(1)
    .filter(r=>r[4]).map(r=>r[1]);

  const mappings = rosterSh.getDataRange().getValues().slice(1)
    .filter(r=>r[0] && r[1] && r[0].toUpperCase()!==r[1].toUpperCase())
    .map(r=>({ rawName:r[0], mappedName:r[1], lastSeen:r[2]||'' }));

  return { roster, mappings };
}

function getAdminOverview(ss) {

  const sessCount  = Math.max(0, ss.getSheetByName(CONFIG.SHEETS.SESSIONS).getLastRow()-1);
  const gameCount  = Math.max(0, ss.getSheetByName(CONFIG.SHEETS.GAMES).getLastRow()-1);
  const bowlerCount = ss.getSheetByName(CONFIG.SHEETS.BOWLERS).getDataRange().getValues()
    .slice(1).filter(r=>r[4]).length;

  const sessions = ss.getSheetByName(CONFIG.SHEETS.SESSIONS).getDataRange().getValues().slice(1);
  const weekKeys = new Set();
  sessions.forEach(r => { if(r[2]) weekKeys.add(r[2]); });

  return { sessionCount:sessCount, gameCount, bowlerCount, weekCount:weekKeys.size };
}

function exportAllData(ss) {
  return {
    exportedAt: new Date().toISOString(),
    bowlers:    getPublicStats().bowlers,
    sessions:   getSessionHistory().sessions,
    roster:     getAdminRoster().roster,
  };
}

function adminDeleteSession(sessionId, user, ss) {
  if (!sessionId) throw new Error('Session ID required');


  // ── Delete from Sessions sheet ──────────────────────────────────
  const sessSh  = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
  const sessData = sessSh.getDataRange().getValues();
  const sessHdr  = sessData[0]; const sc = n => sessHdr.indexOf(n);

  let sessionFound = false;
  for (let i = sessData.length-1; i >= 1; i--) {
    if (sessData[i][0] === sessionId) {
      sessSh.deleteRow(i+1);
      sessionFound = true;
      break;
    }
  }
  if (!sessionFound) throw new Error('Session not found: ' + sessionId);

  // ── Delete from Games sheet by SessionID column ─────────────────
  // SessionID is now stored directly in each game row — exact match, no date ambiguity
  const gameSh   = ss.getSheetByName(CONFIG.SHEETS.GAMES);
  const gameData  = gameSh.getDataRange().getValues();
  const gh        = gameData[0]; const gc = n => gh.indexOf(n);
  const sidCol    = gc('SessionID');

  const rowsToDelete = [];

  if (sidCol > -1) {
    // New rows have SessionID — use exact match
    for (let i = gameData.length-1; i >= 1; i--) {
      if (gameData[i][sidCol] === sessionId) {
        rowsToDelete.push(i+1);
      }
    }
  }

  // Fallback for older rows without SessionID:
  // if no rows found by SessionID, fall back to date + time window matching
  if (rowsToDelete.length === 0) {
    Logger.log('No game rows found by SessionID — falling back to date/time matching');
    const sessRow    = sessData.find(r => r[0] === sessionId) ||
                       sessData.find(r => String(r[0]) === String(sessionId));
    // Re-read since we deleted it — use the data we already have
    const allSessData = sessSh.getDataRange().getValues();
    // Can't re-read deleted session — use what we had
    // Just delete all rows with matching date as last resort
    const dateVal = sessData.find(r => r[0] === sessionId)?.[sc('Date')] || '';
    if (dateVal) {
      for (let i = gameData.length-1; i >= 1; i--) {
        if (!gameData[i][gc('BowlerName')]) continue;
        const rowDate = gameData[i][gc('Date')];
        // Compare as strings after normalising
        if (String(rowDate) === String(dateVal)) {
          rowsToDelete.push(i+1);
        }
      }
    }
  }

  // Delete from bottom up to preserve row indices
  rowsToDelete.sort((a,b) => b-a).forEach(rowNum => gameSh.deleteRow(rowNum));

  SpreadsheetApp.flush();
  Logger.log('Admin delete: session ' + sessionId + ' removed ' + rowsToDelete.length + ' game rows by ' + user.email);
  return { success:true, deletedSessionId:sessionId, gameRowsRemoved:rowsToDelete.length };
}

function adminRemoveBowler(name, user, ss) {
  if (!name) throw new Error('Name required');
  const sh = ss.getSheetByName(CONFIG.SHEETS.BOWLERS);
  const data = sh.getDataRange().getValues();
  for (let i = data.length-1; i >= 1; i--) {
    if ((data[i][1]||'').toLowerCase() === name.toLowerCase()) {
      sh.getRange(i+1, 5).setValue(false);
      break;
    }
  }
  SpreadsheetApp.flush();
  return { success:true };
}

function addBowlerToRoster(name, user, ss) {
  if (!name) throw new Error('Name required');
  const existing = getFullRoster(ss);
  if (existing.map(n=>n.toLowerCase()).includes(name.toLowerCase()))
    return { success:false, message:'Bowler already exists' };
  const sh = ss.getSheetByName(CONFIG.SHEETS.BOWLERS);
  const id = 'B' + String(sh.getLastRow()).padStart(4,'0');
  sh.appendRow([id, name, new Date().toISOString(), user.email, true]);
  SpreadsheetApp.flush();
  return { success:true, message: name+' added' };
}

// ═══════════════════════════════════════════════════════════════
//  FIX EXISTING SHEETS — run once from Apps Script editor
//  Pass a leagueId to fix a specific league, or leave blank for
//  the hub (BlameItOnTheLane) sheet.
//  Example: fixMissingColumns('youth-league-abc123')
// ═══════════════════════════════════════════════════════════════
function fixMissingColumns(leagueId) {
  const ss = leagueId ? getLeagueSpreadsheet(leagueId) : SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEETS.GAMES);
  if (!sh) { Logger.log('❌ Games sheet not found in ' + (leagueId||'hub')); return; }
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  function addAfter(afterCol, newColName) {
    const idx = headers.indexOf(afterCol);
    const exists = headers.indexOf(newColName);
    if (exists > -1) { Logger.log(newColName + ' already exists'); return; }
    if (idx === -1)  { Logger.log('Could not find ' + afterCol + ' — skipping ' + newColName); return; }
    sh.insertColumnAfter(idx + 1);
    sh.getRange(1, idx + 2).setValue(newColName)
      .setBackground('#1a1f2e').setFontColor('#f5a623').setFontWeight('bold');
    headers.splice(idx + 1, 0, newColName);
    Logger.log('✓ Added ' + newColName + ' after ' + afterCol);
  }

  addAfter('MissedSpares',    'Splits');
  addAfter('Splits',          'SplitsConverted');
  addAfter('SplitsConverted', 'SessionAvg');
  addAfter('SessionAvg',      'SessionID');
  addAfter('SessionID',       'Location');
  addAfter('Location',        'Hdcp1');
  addAfter('Hdcp1',           'Hdcp2');
  addAfter('Hdcp2',           'Hdcp3');
  addAfter('Hdcp3',           'Hdcp4');
  addAfter('Hdcp4',           'IsBlind');
  SpreadsheetApp.flush();
  Logger.log('✅ fixMissingColumns complete for ' + (leagueId || 'hub (BlameItOnTheLane)'));
}

// ═══════════════════════════════════════════════════════════════
//  FIX ALL LEAGUES — convenience function to fix every league
//  at once. Run from Apps Script editor.
// ═══════════════════════════════════════════════════════════════
function fixAllLeagues() {
  const leagues = listLeagues().leagues || [];
  Logger.log('Fixing ' + leagues.length + ' leagues...');
  leagues.forEach(l => {
    try {
      Logger.log('--- Fixing: ' + l.leagueId);
      fixMissingColumns(l.leagueId);
    } catch(e) {
      Logger.log('❌ Error fixing ' + l.leagueId + ': ' + e.message);
    }
  });
  Logger.log('✅ fixAllLeagues complete');
}

// ═══════════════════════════════════════════════════════════════
//  MIGRATE LOCATIONS — run ONCE from Apps Script editor
//  Sets location for all existing game rows based on date.
//  Pass leagueId to run on a specific league, or blank for hub.
//  • Today (2026-05-10) → Crestwood Bowl
//  • All other dates    → Du Bowl Lanes
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  REPAIR YOUTH LEAGUE DATA — run ONCE to fix existing bad rows
//  Fixes: Series not summed, blind bowler stats not zeroed,
//         Game2/Game3 stored correctly
// ═══════════════════════════════════════════════════════════════
function repairYouthLeagueData() {
  // Find the youth league spreadsheet
  const hub = SpreadsheetApp.getActiveSpreadsheet();
  const hubSh = hub.getSheetByName(CONFIG.HUB);
  if (!hubSh) { Logger.log('Hub not found — run initializeHub first'); return; }

  const hubData = hubSh.getDataRange().getValues();
  const hdrH = hubData[0]; const hcol = n => hdrH.indexOf(n);
  const youthRow = hubData.slice(1).find(r =>
    (r[hcol('LeagueName')]||'').toLowerCase().includes('youth') ||
    (r[hcol('LeagueID')]||'').toLowerCase().includes('youth')
  );

  if (!youthRow) { Logger.log('Youth league not found in registry'); return; }
  const sheetId = youthRow[hcol('SheetID')];
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName(CONFIG.SHEETS.GAMES);
  const data = sh.getDataRange().getValues();
  const hdr = data[0]; const col = n => hdr.indexOf(n);

  let fixed = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[col('BowlerName')]) continue;

    const isBlind = row[col('IsBlind')] === 'YES';
    let changed = false;

    if (isBlind) {
      // Zero out all stats for blind bowlers
      const zeroFields = ['Strikes','Spares','MissedSpares','Splits','SplitsConverted','BallSpeedMPH'];
      zeroFields.forEach(f => {
        const c = col(f);
        if (c > -1 && row[c] !== '' && row[c] !== 0) {
          sh.getRange(i+1, c+1).setValue(0);
          changed = true;
        }
      });
    } else {
      // Fix Series = sum of Game1+Game2+Game3+Game4
      const g1=Number(row[col('Game1')])||0;
      const g2=Number(row[col('Game2')])||0;
      const g3=Number(row[col('Game3')])||0;
      const g4=Number(row[col('Game4')])||0;
      const correctSeries = g1+g2+g3+g4;
      const storedSeries = Number(row[col('Series')])||0;

      if (correctSeries > 0 && storedSeries !== correctSeries) {
        sh.getRange(i+1, col('Series')+1).setValue(correctSeries);
        Logger.log(`Fixed series for ${row[col('BowlerName')]}: ${storedSeries} → ${correctSeries}`);
        changed = true;
      }
    }
    if (changed) fixed++;
  }

  SpreadsheetApp.flush();
  Logger.log(`✅ repairYouthLeagueData complete — fixed ${fixed} rows`);
}

function debugDates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEETS.GAMES);
  const data = sh.getDataRange().getValues();
  const hdr = data[0]; const col = n => hdr.indexOf(n);
  const results = data.slice(1).filter(r=>r[col('BowlerName')]).map(r => {
    const rawDate = r[col('Date')];
    const d = (rawDate instanceof Date) ? rawDate : new Date(rawDate);
    return {
      name:     r[col('BowlerName')],
      rawDate:  String(rawDate),
      isDate:   rawDate instanceof Date,
      year:     d.getFullYear(),
      month:    d.getMonth(),
      day:      d.getDate(),
      location: r[col('Location')] || '(empty)',
      game1:    r[col('Game1')]
    };
  });
  Logger.log(JSON.stringify(results, null, 2));
  return results;
}

function migrateLocations(leagueId) {
  const ss = leagueId ? getLeagueSpreadsheet(leagueId) : SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEETS.GAMES);
  const data = sh.getDataRange().getValues();
  const hdr = data[0];
  const col = n => hdr.indexOf(n);
  const locCol = col('Location');

  if (locCol === -1) {
    Logger.log('❌ Location column not found — run fixMissingColumns() first');
    return;
  }

  const CRESTWOOD_DATE = '05/10/2026';
  const DU_BOWL       = 'Du Bowl Lanes';
  const CRESTWOOD     = 'Crestwood Bowl';

  let updated = 0;
  for (let i = 1; i < data.length; i++) {
    if (!data[i][col('BowlerName')]) continue;
    // Do NOT skip rows that already have a location — we need to correct wrong ones

    const rawDate = data[i][col('Date')];
    // rawDate is a JS Date object in Apps Script — use getMonth/getDate directly
    // rather than string matching which is unreliable
    let isCrestwood = false;
    try {
      const d = (rawDate instanceof Date) ? rawDate : new Date(rawDate);
      // May = month 4 (0-indexed), day 10, year 2026
      isCrestwood = (d.getFullYear() === 2026 && d.getMonth() === 4 && d.getDate() === 10);
    } catch(e) {
      // fallback string check
      const s = String(rawDate || '');
      isCrestwood = s.includes('May 10 2026') || s.includes('05/10/2026') || s.includes('2026-05-10');
    }
    const correctLocation = isCrestwood ? CRESTWOOD : DU_BOWL;
    const currentLocation = String(data[i][locCol] || '');
    // Always overwrite — fixes cases where wrong location was already set
    if (currentLocation !== correctLocation) {
      sh.getRange(i + 1, locCol + 1).setValue(correctLocation);
      updated++;
    }
  }

  SpreadsheetApp.flush();
  Logger.log(`✅ migrateLocations complete for ${leagueId||'hub'} — updated ${updated} rows`);
}

// ═══════════════════════════════════════════════════════════════
//  CLEAR ALL TEST DATA — run from Apps Script editor
//  Wipes Sessions, Games, Roster mappings, and Bowlers
//  then re-seeds the default roster so the app is ready to go
// ═══════════════════════════════════════════════════════════════
function clearAllData() {


  function clearSheetKeepHeader(name) {
    const sh = ss.getSheetByName(name);
    if (!sh) { Logger.log('Sheet not found: ' + name); return; }
    const lastRow = sh.getLastRow();
    if (lastRow > 1) {
      sh.deleteRows(2, lastRow - 1);
    }
    Logger.log('✓ Cleared ' + name + ' (' + (lastRow - 1) + ' rows removed)');
  }

  // Clear all data rows, keep headers
  clearSheetKeepHeader(CONFIG.SHEETS.SESSIONS);
  clearSheetKeepHeader(CONFIG.SHEETS.GAMES);
  clearSheetKeepHeader(CONFIG.SHEETS.BOWLERS);
  clearSheetKeepHeader(CONFIG.SHEETS.ROSTER);

  // Re-seed the default roster so name matching works from day one
  const rosterSh = ss.getSheetByName(CONFIG.SHEETS.ROSTER);
  const now = new Date().toISOString();
  [
    ['REECE','Reece'], ['JESS','Jess'], ['ALEX','Alex'], ['MARK','Mark'],
    ['STEVE','Steve'], ['WAYN','Wayne'], ['WAYNE','Wayne'],
    ['DARN','Darnell'], ['DARNELL','Darnell']
  ].forEach(m => rosterSh.appendRow([m[0], m[1], now]));

  // Re-seed default bowlers list
  const bowlerSh = ss.getSheetByName(CONFIG.SHEETS.BOWLERS);
  ['Reece','Jess','Alex','Mark','Steve','Wayne','Darnell'].forEach((name, i) => {
    bowlerSh.appendRow(['B' + String(i+1).padStart(4,'0'), name, now, 'system', true]);
  });

  SpreadsheetApp.flush();
  Logger.log('✅ All test data cleared. Roster re-seeded. Ready for live use!');
}

// ── Weekly recap (Blame It On The Lane only) ─────────────────────────────────
function generateWeeklyRecap(ss, leagueId) {
  if (leagueId !== 'BlameItOnTheLane') return { recap: null };

  const awards = getAwards(ss);
  const currentWeek = awards.currentWeek;
  if (!currentWeek) return { recap: null };

  // Return cached recap if it exists for this week
  const cacheKey = 'recap_' + currentWeek;
  const cached = PropertiesService.getScriptProperties().getProperty(cacheKey);
  if (cached) return JSON.parse(cached);

  const w = awards.weekly;
  const weekly = getWeeklySummary(ss);
  const currentWeekData = (weekly.weeks || []).find(wk => wk.week === currentWeek) || {};
  const bowlers = currentWeekData.bowlers || [];

  // Build a plain-English data summary for the AI
  const lines = [];
  lines.push('League: Blame It On The Lane (group of friends, adult bowling league)');
  lines.push('Week: ' + currentWeek);
  lines.push('');

  if (bowlers.length) {
    lines.push('BOWLER SCORES THIS WEEK:');
    bowlers.forEach(b => {
      const games = (b.games || []).join(', ');
      const avg = b.avg || '?';
      lines.push(`  ${b.name}: games [${games}], avg ${avg}`);
    });
  }

  if (w.highGame) lines.push(`\nHIGH GAME: ${w.highGame.name} with a ${w.highGame.score}`);

  if (w.overAvg && w.overAvg.length) {
    lines.push('\nBOWLED OVER THEIR AVERAGE:');
    w.overAvg.forEach(b => lines.push(`  ${b.name}: ${b.weekAvg} avg this week vs ${b.priorAvg} season avg (+${b.overAvg})`));
  }

  if (w.huh && w.huh.length) {
    const h = w.huh[0];
    lines.push(`\nBIGGEST SWING (Huh?! Award): ${h.name} — games ${h.games.join(', ')}, swing of ${h.swing} pins`);
  }

  if (w.splits && w.splits.length) {
    lines.push('\nSPLITS (unlucky):');
    w.splits.forEach(b => lines.push(`  ${b.name}: ${b.splits} split${b.splits !== 1 ? 's' : ''}`));
  }

  if (w.spare && w.spare.length) {
    lines.push('\nSPARE SHOOTING:');
    w.spare.forEach(b => lines.push(`  ${b.name}: ${b.pct}% conversion (${b.spares} made, ${b.misses} missed)`));
  }

  const dataSummary = lines.join('\n');

  const recapPrompt = `You are the snarky, hilarious beat reporter for a bowling league newsletter called "The Gutter Gazette." Write a weekly recap in the style of a sports news story — 3 short punchy paragraphs.

BOWLING KNOWLEDGE — use this to write accurately and with credibility:

SCORING: A perfect game is 300 (12 consecutive strikes). A strike (X) = all 10 pins on the first ball, scores 10 + next two balls. A spare (/) = all remaining pins on the second ball, scores 10 + next ball. A series is the sum of multiple games in a session.

SPLITS — IMPORTANT, do not oversimplify:
A split is when the first ball leaves two or more pins standing with a gap between them wider than a bowling ball diameter, and no hidden "sleeper" pin directly behind another. It is marked on the scorecard with a red circle or box around the pin count. Splits are NOT always the 7-10. Common splits include:
- 7-10 ("Bedposts"): the hardest — far back corners only. Extremely rare to convert.
- Baby split (2-7 or 3-10): smaller gap, more makeable with a ricochet.
- Greek Church (4-6-7-8-10 or similar): three pins one side, two the other. Brutal.
- Big Four (4-6-7-10): four pins in a wide spread. Demoralizing.
When writing about splits, vary your language. Reference the difficulty and the player's bad luck — but don't assume it was a 7-10 unless specifically noted. A bowler with multiple splits had a tough night on the lanes, period.

AVERAGES: A 180+ average is solid recreational. 200+ is strong. Under 140 is a rough night. A big swing between games (e.g. 120 then 210) means the bowler was inconsistent.

SPARE SHOOTING: Missing spares costs points fast. A bowler missing 40%+ of spare chances is leaving significant pins on the table. Spare conversion is a key skill separating good bowlers from great ones.

LEAGUE CULTURE — weave this in naturally when relevant:
This group bowls with two regular spectators, Rick and Chris, who show up to cheer everyone on. Rick is known for shouting "TWO CARDS!" whenever a bowler faces a split — it's his way of encouraging them to convert it.

The group plays a side card game each session: every bowler puts in $1 per game. You earn one card for a strike or a spare. If you face a split and convert it to a spare, you earn TWO cards. After each game, the bowler with the best poker hand wins the pot. This means splits aren't just bad luck on the scoreboard — they're also a high-stakes card opportunity. Converting a split is both redemption AND a ticket to the pot. Missing one costs you dearly in two ways.

Reference Rick's "two cards" call, the card game stakes, and Rick & Chris's reactions when it fits naturally — don't force it every week, but use it for color and to make the recap feel like it's written for THIS specific group.

More league color to use sparingly and naturally:
- Jessica (Jess) has a habit of inviting too many new people to bowl. If there are new or unfamiliar bowlers mentioned in the data, it's probably her doing again.
- Jake is the bowling manager at DuBowl (where they bowl) and is notoriously late every Sunday. Feel free to take a jab at Jake when it fits — he's earned it.

WRITING RULES:
- Give genuine praise to top performers with specific scores
- Playfully trash talk the worst performers (keep it friendly — these are close friends)
- Call out split disasters by name and be specific about their misery
- Reference specific scores and stats to make it feel real
- Use bowling puns and sports clichés but keep it fresh and varied
- End with a one-liner prediction or trash-talk challenge for next week
- Write in third person about the players ("Steve rolled...") NOT first person
- Keep it under 220 words total
- Do NOT use markdown headers, bullet points, or formatting — just flowing prose paragraphs separated by line breaks

Here is the data:\n\n${dataSummary}`;

  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: recapPrompt }]
    }),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  const recapText = (result.content && result.content[0] && result.content[0].text) || null;

  const out = { recap: recapText, week: currentWeek };
  if (recapText) {
    PropertiesService.getScriptProperties().setProperty(cacheKey, JSON.stringify(out));
  }
  return out;
}

// Run this from Apps Script editor any time you want to force a fresh recap (e.g. after prompt changes)
function clearRecapCache() {
  const props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).filter(k => k.startsWith('recap_')).forEach(k => {
    PropertiesService.getScriptProperties().deleteProperty(k);
  });
  Logger.log('✅ Recap cache cleared — next page load will regenerate.');
}

// ── Manual stat correction ────────────────────────────────────────────────────
// Run from the Apps Script editor to fix a bowler's stats for a specific date.
// 1. Set BOWLER_NAME, DATE_STR (or leave blank for most recent), and CORRECTIONS
// 2. Run → correctBowlerStats
function correctBowlerStats() {
  const BOWLER_NAME = 'Mark';   // exact name as stored in sheet
  const DATE_STR    = '';       // e.g. '2026-05-15' — blank = most recent row for this bowler
  const CORRECTIONS = {
    Splits:          7,    // set to correct value
    SplitsConverted: null  // set to correct value, or null to leave unchanged
  };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEETS.GAMES);
  if (!sh) { Logger.log('❌ Games sheet not found'); return; }

  const data = sh.getDataRange().getValues();
  const hdr  = data[0];
  const col  = n => hdr.indexOf(n);
  const results = [];
  let lastMatchRow = -1;

  for (let i = 1; i < data.length; i++) {
    const rowName = (data[i][col('BowlerName')] || '').trim();
    if (rowName.toLowerCase() !== BOWLER_NAME.toLowerCase()) continue;
    const rowDate = (data[i][col('Date')] instanceof Date)
      ? data[i][col('Date')].toISOString().slice(0,10)
      : String(data[i][col('Date')] || '').slice(0,10);
    if (DATE_STR && rowDate !== DATE_STR) continue;
    lastMatchRow = i;
  }

  if (lastMatchRow === -1) {
    Logger.log('⚠️ No matching rows found. Check BOWLER_NAME and DATE_STR.');
    return;
  }

  const rowDate = (data[lastMatchRow][col('Date')] instanceof Date)
    ? data[lastMatchRow][col('Date')].toISOString().slice(0,10)
    : String(data[lastMatchRow][col('Date')] || '').slice(0,10);

  Object.entries(CORRECTIONS).forEach(([field, val]) => {
    if (val === null) return;
    const c = col(field);
    if (c > -1) {
      sh.getRange(lastMatchRow + 1, c + 1).setValue(val);
      results.push(`Row ${lastMatchRow+1}: set ${field} = ${val} for ${BOWLER_NAME} on ${rowDate}`);
    }
  });

  SpreadsheetApp.flush();
  Logger.log(results.length
    ? '✅ Corrections applied:\n' + results.join('\n')
    : '⚠️ Nothing changed — all corrections were null.');
}
