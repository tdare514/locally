#if DEBUG
import SwiftUI
import UIKit

/// #423: the four slow screens over a large seeded library, for `LocallyUITests/PerformanceUITests` and Instruments.
/// About 400 releases (60 albums of 8 to 14 tracks, so about 1,000 tracks), 12 collections, a week of plays on every
/// track, and a 1000 x 1000 JPEG cover per release written through the production `FileCoverStore` (the simulator
/// app's own Application Support). The services are the gallery's: an in-memory index, a player on fakes, plays from a
/// fixed summary; nothing signs in, syncs or plays audio.
///
/// `perf-library`, `perf-stats`, `perf-player` and `perf-release` show the Library (list view), the Stats tab, the
/// Collections record player playing its first collection, and a 14-track album's release page. `perf-stats-loading`
/// is the Stats tab with a read that never answers, so its delayed skeleton can be seen; `perf-library-loading` is the
/// Library with cover reads that take 30 s, so its cover slots' skeleton can be seen.
struct PerfLibraryGallery: View {
    static let names = ["perf-library", "perf-stats", "perf-player", "perf-release", "perf-stats-loading", "perf-library-loading"]

    let name: String

    var body: some View {
        switch name {
        case "perf-stats": PerfStats(container: PerfSeed.container)
        case "perf-stats-loading": PerfStats(container: PerfSeed.heldContainer)
        case "perf-player": PerfPlayer()
        case "perf-release": PerfRelease()
        case "perf-library-loading": PerfLibrary(container: PerfSeed.heldCoversContainer)
        default: PerfLibrary(container: PerfSeed.container)
        }
    }
}

/// The seeded library, built once per launch.
@MainActor
enum PerfSeed {
    static let releaseCount = 400
    static let albumCount = 60
    static let collectionCount = 12

    static func id(_ n: Int) -> UUID { UUID(uuidString: String(format: "00000423-0000-0000-0000-%012d", n))! }
    static func trackID(release: Int, track: Int) -> UUID { id(1_000_000 + release * 100 + track) }

    private static let words = [
        "Night", "Bus", "Orange", "Street", "Light", "Paper", "Moon", "Low", "Tide", "Harbour", "Salt", "Water", "Hymn",
        "Lantern", "Midnight", "Drive", "Kitchen", "Radio", "Slow", "Fire", "Cold", "Coffee", "Glass", "River", "Static",
        "Summer", "Velvet", "Echo", "Signal", "Golden", "Hour", "Silver", "Rain", "Neon", "Garden", "Winter", "Coast",
    ]
    private static let artists = [
        "Mira Valdane", "The Salt Line", "Okoro", "Quiet Orchard", "Neon Harbor", "Juniper Hale", "Amelia Rowe",
        "Low Rooms", "Static Bloom", "Harbour Kids", "Ivy Lark", "Northbound", "Sable", "June Atlas", "The Night Ferry",
        "Corin Vale", "Pale Signal", "Wren & Ash", "Tomas Reyes", "Glasshouse", "Odile", "Marigold Club", "Sundown FM",
        "Halcyon", "Ezra Penn", "Little Comet", "Fernhill", "Blue Arcade", "Kasimir", "Rosa Lind",
    ]
    private static let genres = ["Indie pop", "Folk", "Ambient", "Dream pop", "Synthwave", "Country", "House", "Jazz", "Soul", "Rock"]

    private static func title(_ n: Int, words count: Int) -> String {
        (0..<count).map { words[(n * 7 + $0 * 13 + $0 * n) % words.count] }.joined(separator: " ")
    }

    /// Every sixth release up to the 60th album is an album, the rest singles; `updatedAt` spaced an hour apart.
    static let releases: [Release] = {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        return (0..<releaseCount).map { n in
            let isAlbum = n % 6 == 3 && n / 6 < albumCount
            let trackCount = isAlbum ? 8 + n % 7 : 1
            let name = title(n, words: isAlbum ? 2 : 2 + n % 2)
            let tracks = (0..<trackCount).map { t in
                Track(
                    id: trackID(release: n, track: t), title: isAlbum ? title(n + t * 31, words: 2 + t % 2) : name, trackNumber: t + 1,
                    filePath: "/perf/\(n)/\(t).mp3", originalName: "\(t).mp3", durationSec: Double(150 + (n * 17 + t * 29) % 150)
                )
            }
            return Release(
                id: id(n), kind: isAlbum ? .album : .single, title: name, artist: artists[n % artists.count],
                year: String(2000 + n % 26), genre: genres[n % genres.count], folderPath: "/perf/\(n)", tracks: tracks,
                createdAt: now.addingTimeInterval(-3600 * Double(n)), updatedAt: now.addingTimeInterval(-3600 * Double(n))
            )
        }
    }()

    private static let collectionNames = [
        "Late drives", "Sunday morning, slow coffee", "Gym", "Rainy commute", "Kitchen radio", "Road trip",
        "Focus", "Dinner party", "Summer 2025", "Winter walks", "Old favourites", "Someday",
    ]

    /// 12 collections of 4 to 37 releases each (so their covers are 2x2), a few with single tracks mixed in.
    static let collections: [MusicCollection] = {
        let stamp = Date(timeIntervalSince1970: 1_790_000_000)
        return (0..<collectionCount).map { c in
            var items: [CollectionItem] = (0..<(4 + c * 3)).map { .release(releases[(c * 29 + $0 * 11) % releases.count].id) }
            if c % 3 == 0 {
                let album = releases.first { $0.kind == .album }!
                items.append(.track(releaseId: album.id, trackId: album.tracks[c % album.tracks.count].id))
            }
            return MusicCollection(
                id: id(500_000 + c), name: collectionNames[c], items: items, origin: "ios", originDevice: "Gallery",
                createdAt: stamp, updatedAt: stamp.addingTimeInterval(-60 * Double(c))
            )
        }
    }()

    /// A week of plays on every track (1 to 60 each), and four times as many all time.
    static let plays: PlaysSummary = {
        var week: [PlayCount] = []
        var allTime: [PlayCount] = []
        for (n, release) in releases.enumerated() {
            for (t, track) in release.tracks.enumerated() {
                let daysAgo = (n + t) % 7
                let day = Calendar.current.startOfDay(for: Date().addingTimeInterval(-86_400 * Double(daysAgo)))
                let at = Int64((day.timeIntervalSince1970 + Double((n * 37 + t * 11) % 86_000)) * 1000)
                let plays = 1 + (n * 13 + t * 7) % 60
                let tid = track.id.uuidString.lowercased()
                let rid = release.id.uuidString.lowercased()
                week.append(PlayCount(trackId: tid, releaseId: rid, plays: plays, lastPlayedDay: PlayPeriods.localDayString(day, calendar: .current), lastPlayedAt: at))
                allTime.append(PlayCount(trackId: tid, releaseId: rid, plays: plays * 4, lastPlayedDay: nil, lastPlayedAt: at))
            }
        }
        return PlaysSummary(tracks: week, allTime: allTime)
    }()

    /// The production services over an in-memory index, the covers in the app's own `FileCoverStore`.
    /// No releases, and a play read that never answers: Stats stays loading.
    static let heldContainer = IconsGallery.container(releases: [], covers: [:], playStats: HeldPlayStats())

    /// The seeded library over a cover store whose reads take 30 s and find nothing: the Library's cover slots stay
    /// waiting, so their skeleton shows.
    static let heldCoversContainer: AppContainer = {
        _ = container
        let held = IconsGallery.container(releases: [], covers: [:], playStats: GalleryPlayStats(.ok(plays)), coverStore: HeldCoverStore())
        for var release in releases {
            release.coverPath = held.coverStore.fileURL(release.id)?.path
            try? held.library.upsert(release)
        }
        for collection in collections { try? held.collections.upsert(collection) }
        return held
    }()

    static let container: AppContainer = {
        let container = IconsGallery.container(releases: [], covers: [:], playStats: GalleryPlayStats(.ok(plays)))
        let store = container.coverStore
        // Covers already written by an earlier launch are kept; the drawing is fixed per release, so they match.
        // The gallery container's store is a `FileCoverStore` in its default directory; each worker opens its own.
        let missing = releases.enumerated().filter { store.fileURL($0.element.id) == nil }.map { (n: $0.offset, id: $0.element.id) }
        let directory = FileCoverStore.defaultDirectory()
        DispatchQueue.concurrentPerform(iterations: missing.count) { i in
            _ = try? FileCoverStore(directory: directory).save(cover(missing[i].n), for: missing[i].id)
        }
        for var release in releases {
            release.coverPath = store.fileURL(release.id)?.path
            try? container.library.upsert(release)
        }
        for collection in collections { try? container.collections.upsert(collection) }
        return container
    }()

    /// A 1000 x 1000 JPEG: a diagonal gradient in three hues picked from `n`, with rings and bars over it, so each
    /// cover is different and about the size of a real one.
    nonisolated static func cover(_ n: Int) -> Data {
        let side: CGFloat = 1000
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format)
        let hue = CGFloat((n * 47) % 360) / 360
        func color(_ shift: CGFloat, _ s: CGFloat, _ b: CGFloat) -> UIColor {
            UIColor(hue: (hue + shift).truncatingRemainder(dividingBy: 1), saturation: s, brightness: b, alpha: 1)
        }
        let image = renderer.image { ctx in
            let cg = ctx.cgContext
            let colors = [color(0, 0.8, 0.9), color(0.12, 0.7, 0.6), color(0.5, 0.6, 0.3)].map(\.cgColor)
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: nil)!
            cg.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: side, y: side), options: [])
            for ring in 0..<12 {
                let r = side * CGFloat(12 - ring) / 26
                let c = CGPoint(x: side * CGFloat(20 + (n * 7 + ring * 3) % 60) / 100, y: side * CGFloat(20 + (n * 11 + ring * 5) % 60) / 100)
                cg.setStrokeColor(color(CGFloat(ring) / 12, 0.5, 1).withAlphaComponent(0.35).cgColor)
                cg.setLineWidth(side / 80)
                cg.strokeEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
            }
            for bar in 0..<24 {
                cg.setFillColor(color(CGFloat(bar) / 24, 0.4, 0.95).withAlphaComponent(0.18).cgColor)
                cg.fill(CGRect(x: CGFloat((n * 13 + bar * 41) % 1000), y: 0, width: side / CGFloat(30 + bar), height: side))
            }
        }
        return image.jpegData(compressionQuality: 0.85) ?? Data()
    }

    static func setPrefs() {
        let defaults = UserDefaults.standard
        defaults.set(LibraryLayout.list.rawValue, forKey: LibraryViewPrefs.layoutKey)
        defaults.set(LibrarySortOption.default.rawValue, forKey: LibraryViewPrefs.sortKey)
        defaults.set(CoverSize.default.rawValue, forKey: LibraryViewPrefs.coverSizeKey)
        defaults.set(false, forKey: LibraryViewPrefs.singlesCollapsedKey)
        defaults.set(false, forKey: LibraryViewPrefs.albumsCollapsedKey)
        defaults.set(StatsPeriodKind.week.rawValue, forKey: StatsViewModel.periodKey)
        defaults.set(StatsKind.tracks.rawValue, forKey: StatsViewModel.tabKey)
        defaults.set(StatsLayout.list.rawValue, forKey: StatsViewModel.layoutKey)
        defaults.set(StatsSort.plays.rawValue, forKey: StatsViewModel.sortKey)
        defaults.set(CollectionsViewMode.player.rawValue, forKey: CollectionsViewPrefs.viewKey)
        defaults.set(SpinningRecord.picture.rawValue, forKey: CollectionsViewPrefs.recordKey)
        defaults.set(false, forKey: WheelMotion.debugReduceMotionKey)
        defaults.set("", forKey: CollectionsPlayerView.debugScrollKey)
    }
}

/// The Library in list view, as the Library tab shows it.
private struct PerfLibrary: View {
    let container: AppContainer
    @State private var tab = RootView.Tab.library
    @State private var importKind: ImportKind?
    @State private var search: String?

    init(container: AppContainer) {
        self.container = container
        PerfSeed.setPrefs()
    }

    var body: some View {
        IconsGallery.environment(
            TabView(selection: $tab) {
                LibraryView(selectedTab: $tab, requestedImportKind: $importKind, librarySearchRequest: $search)
                    .tabItem { Label(Copy.Library.title, image: "Icon/Library") }
                    .tag(RootView.Tab.library)
            },
            container
        )
    }
}

/// The Stats tab as `RootView` builds it: its model and covers from the container.
private struct PerfStats: View {
    let container: AppContainer
    @State private var tab = RootView.Tab.stats
    @State private var search: String?

    init(container: AppContainer) {
        self.container = container
        PerfSeed.setPrefs()
    }

    var body: some View {
        IconsGallery.environment(
            TabView(selection: $tab) {
                StatsTab(selectedTab: $tab, librarySearchRequest: $search)
                    .tabItem { Label(Copy.Stats.tabLabel, image: "Icon/Stats") }
                    .tag(RootView.Tab.stats)
            },
            container
        )
    }
}

/// The Collections record player, playing the first collection from its third track (the hub turns).
private struct PerfPlayer: View {
    @State private var model: CollectionsModel
    @State private var playback = CollectionsGallery.fakePlayback()

    init() {
        PerfSeed.setPrefs()
        let model = PerfSeed.container.makeCollectionsModel()
        model.reload()
        _model = State(initialValue: model)
    }

    var body: some View {
        IconsGallery.environment(
            NavigationStack { CollectionsView(model: model, onOpen: { _ in }) }
                .environment(\.playback, playback),
            PerfSeed.container
        )
        .task {
            let first = PerfSeed.collections[0].id
            let queue = model.collection(first).map { model.playQueue(of: $0) } ?? []
            let releases = Set(queue.map(\.releaseID)).compactMap { model.releases[$0] }
            playback.play(
                items: queue.map { QueueItem(releaseId: $0.releaseID, trackId: $0.trackID) }, releases: releases,
                context: QueueContext(kind: .collection, id: first), startingAt: 2
            )
        }
    }
}

/// A 14-track album's release page.
private struct PerfRelease: View {
    init() { PerfSeed.setPrefs() }

    var body: some View {
        let release = PerfSeed.releases.filter { $0.kind == .album }.max { $0.tracks.count < $1.tracks.count }!
        var stored = release
        stored.coverPath = PerfSeed.container.coverStore.fileURL(release.id)?.path
        return IconsGallery.environment(NavigationStack { ReleaseDetailView(release: stored) }, PerfSeed.container)
    }
}

/// A play read that never answers, for `perf-stats-loading`.
private final class HeldPlayStats: PlayStatsReading {
    @MainActor func summary(from: String, to: String, force: Bool) async -> PlayStatsRead {
        try? await Task.sleep(for: .seconds(3600))
        return .ok(PerfSeed.plays)
    }
}
/// The app's cover store, except that a read waits 30 s and finds nothing (`perf-library-loading`).
private struct HeldCoverStore: CoverStore {
    let base = FileCoverStore()
    func save(_ data: Data, for id: UUID) throws -> String { try base.save(data, for: id) }
    func load(_ id: UUID) -> Data? {
        Thread.sleep(forTimeInterval: 30)
        return nil
    }
    func fileURL(_ id: UUID) -> URL? { base.fileURL(id) }
    func delete(_ id: UUID) throws { try base.delete(id) }
}

#endif
