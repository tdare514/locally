/** Switches for sidebar parts whose data or page does not exist yet (#154). */

/**
 * The Today / This week / This month control. Off until the Mac stores per-day play counts
 * (plan #193, PR #194). Until then the widgets show all-time totals under "Your plays".
 */
export const HAS_DAILY_COUNTS = false;

/**
 * The Stats rail icon, its panel row and "See all stats". Off until the Stats page exists
 * (#145, PR #192). To turn it on: set this true, add a "stats" view to AppShell, and pass
 * `onStatsClick` and `activePage="stats"` to the Sidebar.
 */
export const HAS_STATS_PAGE = false;
