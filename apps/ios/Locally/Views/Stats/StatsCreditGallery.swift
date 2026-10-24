#if DEBUG
import SwiftUI

/// #361: the Stats grid and the artist rows for screenshots. The name is `stats-361-<what>` with an
/// optional `-bright` (a pale cover at rank 1, so the page wash is pale), `-320` (a 320 pt screen) and `-ax3` (accessibility3). The rows all carry one artist and
/// two features: "Mira Valdane, feat. Okoro & Juniper Hale".
struct StatsCreditGallery: View {
    let name: String

    private var base: String {
        name.replacingOccurrences(of: "-320", with: "").replacingOccurrences(of: "-ax3", with: "")
            .replacingOccurrences(of: "-bright", with: "")
    }

    var body: some View {
        content
            .frame(width: name.contains("-320") ? 320 : nil)
            .dynamicTypeSize(name.contains("-ax3") ? .accessibility3 : .large)
    }

    @ViewBuilder
    private var content: some View {
        switch base {
        case "stats-361-grid-tracks": grid(.tracks)
        case "stats-361-grid-albums": grid(.albums)
        case "stats-361-grid-artists": grid(.artists)
        case "stats-361-stats-row": statsRows
        case "stats-361-track-row": trackRows
        default: IconsGallery.artistPage(name: "Neon Harbor")
        }
    }

    /// The sea itself over the sample releases, so the whole grid is in one frame.
    private func grid(_ kind: StatsKind) -> some View {
        let releases = StatsGallery.releases
        var items: [StatItem] = []
        switch kind {
        case .tracks:
            for release in releases { for (i, track) in release.tracks.enumerated() {
                items.append(StatItem(id: track.id.uuidString, rank: 0, title: track.title, subtitle: release.artist, plays: 60 - items.count * 3 + i,
                                      lastPlayedDay: nil, releaseId: release.id, trackId: track.id, coverPath: nil, medal: nil))
            } }
        case .albums:
            items = releases.map { StatItem(id: $0.id.uuidString, rank: 0, title: $0.title, subtitle: $0.artist, plays: 40, lastPlayedDay: nil, releaseId: $0.id, trackId: nil, coverPath: nil, medal: nil) }
        case .artists:
            items = releases.map { StatItem(id: $0.id.uuidString, rank: 0, title: $0.artist, subtitle: "", plays: 40, lastPlayedDay: nil, releaseId: $0.id, trackId: nil, coverPath: nil, medal: nil) }
        }
        items = Array(items.prefix(12)).enumerated().map { i, item in
            var item = item
            item.rank = i + 1
            item.plays = max(3, 300 - i * 23)
            item.medal = [Medal.gold, .silver, .bronze][safe: i]
            return item
        }
        var covers = StatsGallery.covers
        var palette: AmbientPalette?
        if name.contains("-bright"), let first = releases.first, let data = SampleArtwork.bright.pngData() {
            covers[first.id] = data
            palette = ArtworkPalette.palette(forCover: data)
        }
        let ids = Dictionary(uniqueKeysWithValues: items.compactMap { item in item.releaseId.map { (item.id, $0) } })
        return ZStack {
            if let palette { Theme.background.ignoresSafeArea(); ArtworkBackdrop(palette: palette) } else { StudioBackdrop() }
            GeometryReader { geo in
                ScrollView {
                    StatsSea(items: items, width: geo.size.width - 32, round: kind == .artists, cache: StatsCoverCache(loader: { covers[$0] }),
                             ownerOf: { ids[$0.id] }, label: "Your \(kind.rawValue)", onOpen: { _ in })
                        .padding(16)
                }
            }
        }
    }

    private var statsRows: some View {
        let items = [
            StatItem(id: "a", rank: 1, title: "Headlights (feat. Okoro & Juniper Hale)", subtitle: "Mira Valdane", plays: 1204, lastPlayedDay: nil,
                     releaseId: UUID(), trackId: UUID(), coverPath: nil, medal: .gold),
            StatItem(id: "b", rank: 2, title: "Orange Streetlight (feat. Okoro)", subtitle: "Mira Valdane", plays: 31, lastPlayedDay: nil,
                     releaseId: UUID(), trackId: UUID(), coverPath: nil, medal: nil),
        ]
        return ZStack {
            StudioBackdrop()
            ScrollView {
                StatsList(items: items, today: "2026-10-24", round: false, cache: StatsCoverCache(loader: { _ in nil }),
                          ownerOf: { _ in nil }, label: "Your tracks", onOpen: { _ in })
                    .padding(16)
            }
        }
    }

    private var trackRows: some View {
        ZStack {
            StudioBackdrop()
            VStack(spacing: 0) {
                ReleaseTrackRow(number: 1, title: "Headlights", featuring: ["Okoro", "Juniper Hale"], artist: "Mira Valdane",
                                plays: 1204, time: "3:34", timeSpoken: "3 minutes 34 seconds")
                ReleaseTrackRow(number: 2, title: "Orange Streetlight", featuring: [], artist: "Mira Valdane",
                                plays: 31, time: "4:02", timeSpoken: "4 minutes 2 seconds")
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 80)
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
#endif
