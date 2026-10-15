/** Switches for sidebar parts whose page does not exist yet (#154). */

/**
 * The Stats rail icon, its panel row and "See all stats". Off until the Stats page exists
 * (#145, PR #192). To turn it on: set this true, add a "stats" view to AppShell, and pass
 * `onStatsClick` and `activePage="stats"` to the Sidebar.
 */
export const HAS_STATS_PAGE = false;
