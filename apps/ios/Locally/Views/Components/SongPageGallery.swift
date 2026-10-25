#if DEBUG
import SwiftUI

/// #365: the real song page over a sample song (track 3 of 10 on disc 1 of 2, 124 plays, two collections) in the
/// in-memory library, with the player on fakes. Nothing here signs in or syncs.
struct SongPageGallery: View {
    static let names = ["song-page", "song-page-bottom", "song-page-adopted", "song-page-ax3", "song-page-ax5", "song-page-narrow", "song-page-signed-out", "song-page-paused", "song-page-missing", "song-page-wont-play"]

    /// The phone-held song and the details-only one, over the stats gallery's covers.
    private static let releaseID = UUID(uuidString: "00000000-0000-0000-0000-0000000005a1")!
    private static let trackID = UUID(uuidString: "00000000-0000-0000-0000-0000000005a3")!
    private static let adoptedReleaseID = UUID(uuidString: "00000000-0000-0000-0000-0000000005b1")!
    private static let adoptedTrackID = UUID(uuidString: "00000000-0000-0000-0000-0000000005b2")!

    private static func song(adopted: Bool) -> Release {
        if adopted {
            return Release(
                id: adoptedReleaseID, kind: .album, title: "Saltwater Hymns", artist: "Okoro feat. Quiet Orchard", year: "2023", genre: "Ambient",
                coverPath: "/cover/s.png", folderPath: "/mac", tracks: (1...6).map { n in
                    Track(id: n == 2 ? adoptedTrackID : UUID(), title: n == 2 ? "Tide" : "Hymn \(n)", trackNumber: n, filePath: "", originalName: n == 2 ? "Okoro - Tide.mp3" : "h\(n).mp3", durationSec: n == 2 ? 348 : 200)
                }, source: .adopted)
        }
        let tracks = (1...10).map { n in
            Track(id: n == 3 ? trackID : UUID(), title: n == 3 ? "Paper Moon (feat. Okoro)" : "Night Bus \(n)", trackNumber: n, discNumber: n <= 5 ? 1 : 2,
                  filePath: "/lib/Locally/\(n) Paper Moon.m4a", originalName: n == 3 ? "03 Paper Moon.m4a" : "\(n).m4a", durationSec: n == 3 ? 204 : 190)
        }
        return Release(id: releaseID, kind: .album, title: "Night Bus to Nowhere", artist: "Mira Valdane feat. Juniper Hale", year: "2025", releaseDate: "2025-03-14",
                       genre: "Indie pop", coverPath: "/cover/s.png", folderPath: "/lib", tracks: tracks)
    }

    private static func covers() -> [UUID: Data] {
        [releaseID: SampleArtwork.cover([.systemIndigo, .systemPurple, .systemPink], size: 360).pngData() ?? Data(),
         adoptedReleaseID: SampleArtwork.cover([UIColor(red: 0.95, green: 0.75, blue: 0.30, alpha: 1), .systemOrange, .systemRed], size: 360).pngData() ?? Data()]
    }

    let name: String
    @State private var built: (container: AppContainer, model: CollectionsModel, playback: PlaybackService, release: Release, trackID: UUID)
    @State private var loader: SongPageLoader

    init(name: String) {
        self.name = name
        let adopted = name == "song-page-adopted"
        let release = Self.song(adopted: adopted)
        let setup = CollectionsGallery.playingSetup(
            missingTrack: name == "song-page-missing" ? Self.trackID : nil, corruptFirstPlay: name == "song-page-wont-play",
            seed: false, extra: [release], extraCovers: Self.covers())
        let other = StatsGallery.releases
        let stamp = Date()
        func make(_ name: String, _ items: [CollectionItem]) -> MusicCollection {
            MusicCollection(id: UUID(), name: name, items: items, origin: "ios", originDevice: "Gallery", createdAt: stamp, updatedAt: stamp)
        }
        let track = adopted ? Self.adoptedTrackID : Self.trackID
        try? setup.container.collections.upsert(make("Late drives", [.release(other[4].id), .track(releaseId: release.id, trackId: track)]))
        try? setup.container.collections.upsert(make("Rainy Sundays", [.release(other[1].id), .release(release.id)]))
        setup.model.reload()
        _built = State(initialValue: (setup.container, setup.model, setup.playback, release, track))
        let stats: PlayStatsReading = name == "song-page-signed-out" ? GalleryPlayStats(.signedOut) : SongGalleryStats(releaseID: release.id, trackID: track)
        _loader = State(initialValue: SongPageLoader(
            stats: stats, readFile: { _, _ in SongFileFacts(size: 8_400_000, duration: nil) },
            allTimePlays: { _, _ in name == "song-page-signed-out" ? nil : 124 }))
    }

    var body: some View {
        let page = SongPageView(
            release: built.release, trackID: built.trackID, onEdit: {}, onOpenCollection: { _ in }, onOpenHistory: { _ in },
            loader: loader, collectionsModel: built.model, startsAtEnd: name == "song-page-bottom")
        IconsGallery.environment(
            NavigationStack { page }.environment(\.playback, built.playback),
            built.container
        )
        .dynamicTypeSize(name == "song-page-ax3" ? .accessibility3 : name == "song-page-ax5" ? .accessibility5 : .large)
        .frame(maxWidth: name == "song-page-narrow" ? 320 : .infinity)
        .task {
            guard name != "song-page-adopted" else { return }
            built.playback.play(release: built.release, startingAt: built.trackID)
            if name == "song-page-paused" {
                try? await Task.sleep(for: .milliseconds(1200))
                built.playback.togglePlayPause()
            }
        }
    }
}

/// Plays that differ by range, as the real service's would: today 0, this week 12, this month 31, this year 96
/// (everything, 124, comes from the per-release read), last played yesterday.
@MainActor
private final class SongGalleryStats: PlayStatsReading {
    let releaseID: UUID
    let trackID: UUID
    init(releaseID: UUID, trackID: UUID) {
        self.releaseID = releaseID
        self.trackID = trackID
    }

    func summary(from: String, to: String, force: Bool) async -> PlayStatsRead {
        let today = PlayPeriods.localDayString(Date(), calendar: .current)
        let firstDay = PlayPeriods.isoFirstDay(fromAppleFirstWeekday: Calendar.current.firstWeekday)
        let counts: [(StatsPeriodKind, Int)] = [(.today, 0), (.week, 12), (.month, 31), (.year, 96)]
        let kind = counts.first { PlayPeriods.selectionRange(PeriodSelection(kind: $0.0, back: 0), today: today, firstDay: firstDay) == DayRange(from: from, to: to) }
        let yesterday = PlayPeriods.addDays(today, -1)
        // Played yesterday at 21:14 (#397), so the panel shows the time.
        let start = Calendar.current.date(byAdding: .day, value: -1, to: Calendar.current.startOfDay(for: Date())) ?? Date()
        let playedAt = Int64((start.timeIntervalSince1970 + 21 * 3600 + 14 * 60) * 1000)
        func row(_ plays: Int, day: String?) -> PlayCount {
            var count = PlayCount(trackId: trackID.uuidString.lowercased(), releaseId: releaseID.uuidString.lowercased(), plays: plays, lastPlayedDay: day)
            count.lastPlayedAt = playedAt
            return count
        }
        let plays = counts.first { $0.0 == kind?.0 }?.1 ?? 0
        return .ok(PlaysSummary(tracks: plays > 0 ? [row(plays, day: yesterday)] : [], allTime: []))
    }
}
#endif
