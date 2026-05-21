// ╔══════════════════════════════════════════════════════════════════╗
// ║  ALLEY RHYTHM — Site Configuration                              ║
// ╚══════════════════════════════════════════════════════════════════╝
// var (not const/let) so window.LANE_CONFIG is a real window property accessible across scripts
var LANE_CONFIG = {
  SCRIPT_URL:       "https://script.google.com/macros/s/AKfycbyC94fiIbIMsXxUKT-hD1Wxcq8nj2apLHeYugxPdcYelvQ3WlwZMmMbOfkN_N_eOE1yJQ/exec",
  GOOGLE_CLIENT_ID: "288728154445-7dhhfgipuq69smendv7ntro4p3mkbe9e.apps.googleusercontent.com",
  SITE_NAME:        "Alley Rhythm",
  LEAGUE_NAME:      "Blame It On The Lane",
  LEAGUE_DAY:       "Sunday",

  // Embed leagues here to skip the API call on the league selection screen.
  // Update this if you add a new league.
  LEAGUES: [
    { leagueId: 'BlameItOnTheLane', name: 'Blame It On The Lane', day: 'Sunday',   useHandicap: false },
    { leagueId: 'youth-league-mox9ep3l', name: 'Youth League', day: 'Thursday', useHandicap: true  },
  ],
};
