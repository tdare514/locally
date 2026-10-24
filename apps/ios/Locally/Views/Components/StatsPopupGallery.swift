#if DEBUG
import SwiftUI

/// #367: the Stats page with the period pill closed and open, and the minutes sort, over the
/// same sample plays as `StatsGallery`.
enum StatsPopupGallery {
    static let names = ["stats-period-closed", "stats-period-open", "stats-sort-minutes", "stats-period-ax3", "stats-period-sheet-ax5", "stats-period-sheet-ax3", "stats-grid-minutes"]

    @MainActor
    static func page(_ name: String) -> some View {
        let open = name == "stats-period-open" || name == "stats-period-sheet-ax5" || name == "stats-period-sheet-ax3"
        let minutes = name == "stats-sort-minutes" || name == "stats-grid-minutes"
        return TabView {
            view(open: open, minutes: minutes, grid: name == "stats-grid-minutes")
                .tabItem { Label(Copy.Stats.tabLabel, image: "Icon/Stats") }
        }
        .tint(Theme.accent)
        .environment(FolderStatus(isConnected: true))
        .environment(PurchaseStatus(isFullUnlocked: false))
        .environment(SyncStatus())
        .dynamicTypeSize(name == "stats-period-ax3" ? .accessibility3 : (name == "stats-period-sheet-ax5" ? .accessibility5 : (name == "stats-period-sheet-ax3" ? .accessibility3 : .large)))
    }

    @MainActor
    private static func view(open: Bool, minutes: Bool, grid: Bool = false) -> some View {
        let suite = "gallery.stats.popup"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        defaults.set(StatsPeriodKind.week.rawValue, forKey: StatsViewModel.periodKey)
        if minutes { defaults.set(StatsSort.minutes.rawValue, forKey: StatsViewModel.sortKey) }
        if grid { defaults.set(StatsLayout.grid.rawValue, forKey: StatsViewModel.layoutKey) }
        let releases = StatsGallery.releases
        let covers = StatsGallery.covers
        var counts: [PlayCount] = []
        for (r, release) in releases.enumerated() {
            for (t, track) in release.tracks.enumerated() {
                counts.append(PlayCount(
                    trackId: track.id.uuidString.lowercased(), releaseId: release.id.uuidString.lowercased(),
                    plays: max(1, 48 - r * 6 - t * 9), lastPlayedDay: PlayPeriods.localDayString(Date(), calendar: .current)
                ))
            }
        }
        // Lengths differ, so the minutes order is not the plays order.
        let lengthened = releases.enumerated().map { r, release -> Release in
            var copy = release
            copy.tracks = release.tracks.map { var t = $0; t.durationSec = r % 3 == 0 ? 150 : (r % 3 == 1 ? 420 : 260); return t }
            return copy
        }
        let model = StatsViewModel(stats: GalleryPlayStats(.ok(PlaysSummary(tracks: counts, allTime: counts))), releases: { lengthened }, defaults: defaults)
        let cache = StatsCoverCache(loader: { covers[$0] })
        return StatsView(model: model, cache: cache, selectedTab: .constant(.stats), librarySearchRequest: .constant(nil), periodOpen: open)
    }
}
#endif
