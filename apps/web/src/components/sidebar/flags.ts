/** Switches for sidebar parts whose page does not exist yet (#154). */

/**
 * The Stats rail icon, its panel row and "See all stats". On since the Stats page exists (#145):
 * AppShell has a "stats" view and passes `onStatsClick` and `activePage="stats"` to the Sidebar.
 */
export const HAS_STATS_PAGE = true;

/**
 * The Spotify connection (#239): the Settings row and the /api/spotify/connection and
 * /api/spotify/auth routes. Off, or with no client id, they answer 404 and the row is hidden.
 */
export const HAS_SPOTIFY_CONNECTION = true;
