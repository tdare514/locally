#if DEBUG
import SwiftUI

/// #446: the real Library over the sample library, sample collections and sample plays, for the header's states: the
/// three cards loaded, loading (the week's read held back, so the placeholders show), with no plays this week (the
/// cards are gone and the shelf moves up) and with the search open on a query. Nothing here signs in or syncs.
struct LibraryHeaderGallery: View {
    static let names = ["library-header", "library-header-loading", "library-header-no-plays", "library-header-search"]

    let name: String
    @State private var container: AppContainer
    @State private var tab = RootView.Tab.library
    @State private var importKind: ImportKind?
    @State private var search: String?

    init(name: String) {
        self.name = name
        UserDefaults.standard.set(LibraryLayout.list.rawValue, forKey: LibraryViewPrefs.layoutKey)
        UserDefaults.standard.set(LibraryFilter.all.rawValue, forKey: LibraryViewPrefs.filterKey)
        let read: PlayStatsRead = .ok(name == "library-header-no-plays" ? PlaysSummary(tracks: [], allTime: []) : StatsGallery.summary(empty: false))
        // Held back for a minute: the loading frame stays up while it is photographed.
        let stats = GalleryPlayStats(read, delay: name == "library-header-loading" ? .seconds(60) : .zero)
        _container = State(initialValue: CollectionsGallery.container(seed: true, playStats: stats).0)
    }

    var body: some View {
        IconsGallery.environment(
            LibraryView(selectedTab: $tab, requestedImportKind: $importKind, librarySearchRequest: $search), container
        )
        .task {
            guard name == "library-header-search" else { return }
            try? await Task.sleep(for: .milliseconds(600))
            search = "okoro"
        }
    }
}
#endif
