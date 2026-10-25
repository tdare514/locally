#if DEBUG
import SwiftUI
import UIKit

/// #399: the real History screen over fixture plays, as the visual test. No networking: the service is a fake. Each of
/// `history`, `history-ax3` (Dynamic Type accessibility3) and `history-narrow` (320 pt wide) shows the crate; the
/// others show the states. `history-flow` is the whole way in: the real Stats page over a seeded library, its History
/// control, a day, a play and the song page (the UI test's frame).
struct HistoryGallery: View {
    static let names = ["history", "history-ax3", "history-narrow", "history-empty", "history-signed-out", "history-loading", "history-offline", "history-busy", "history-flow"]

    let name: String

    var body: some View {
        if name == "history-flow" {
            IconsGallery.environment(StatsGallery.page(.week), IconsGallery.container(playHistory: GalleryPlayHistory(.plays)))
        } else {
            frame
        }
    }

    private var read: GalleryPlayHistory.Mode {
        switch name {
        case "history-empty": return .empty
        case "history-signed-out": return .signedOut
        case "history-loading": return .never
        case "history-offline": return .stale(busy: false)
        case "history-busy": return .stale(busy: true)
        default: return .plays
        }
    }

    private var frame: some View {
        let releases = StatsGallery.releases
        let covers = StatsGallery.covers
        let model = HistoryModel(service: GalleryPlayHistory(read), releases: { releases })
        return HistoryView(model: model, covers: HistoryCovers(cache: StatsCoverCache(loader: { covers[$0] })))
            .environment(\.openSong, { _ in })
            .environment(\.openSettingsTab, {})
            .preferredColorScheme(.dark)
            .dynamicTypeSize(name.hasSuffix("-ax3") ? .accessibility3 : .large)
            .frame(maxWidth: name.hasSuffix("-narrow") ? 320 : .infinity)
            .background(Theme.background)
    }
}

/// A `PlayHistoryReading` over the fixture plays, or a fixed state. It answers any window with the plays inside it.
@MainActor
final class GalleryPlayHistory: PlayHistoryReading {
    enum Mode {
        case plays
        case empty
        case signedOut
        /// Never answers: the loading state.
        case never
        /// Answers with the plays but says the last answer was kept.
        case stale(busy: Bool)
    }

    private let mode: Mode
    init(_ mode: Mode) { self.mode = mode }

    func events(from: Date, to: Date, force: Bool) async -> PlayHistoryRead {
        let inside = Self.plays.filter { $0.started >= from && $0.started < to }
        switch mode {
        case .plays: return .ok(inside)
        case .empty: return .ok([])
        case .signedOut: return .signedOut
        case .never:
            try? await Task.sleep(for: .seconds(3600))
            return .failed
        case .stale(let busy): return .stale(inside, busy: busy)
        }
    }

    /// (days ago, hour, minute, release, track, listened s, device: 0 iPhone, 1 Mac, 2 Spotify). Newest first.
    /// 14 plays over Today, Yesterday and five days ago; a few more on other days only fill the 14-day strip.
    private static let rows: [(Int, Int, Int, Int, Int, Int, Int)] = [
        (0, 15, 48, 0, 0, 200, 0), (0, 13, 5, 1, 0, 31, 1), (0, 12, 31, 4, 1, 200, 2),
        (0, 9, 14, 0, 1, 164, 0), (0, 8, 20, 2, 0, 30, 1), (0, 7, 42, 3, 0, 200, 0),
        (1, 22, 3, 3, 0, 200, 0), (1, 20, 40, 5, 0, 118, 1), (1, 18, 12, 1, 1, 200, 2),
        (1, 12, 55, 2, 1, 44, 0), (1, 9, 30, 4, 0, 200, 0),
        (3, 21, 10, 0, 2, 200, 0), (3, 17, 36, 1, 0, 200, 1), (3, 8, 15, 4, 1, 52, 2),
        (5, 22, 18, 2, 0, 200, 1), (5, 19, 2, 0, 0, 30, 0), (5, 14, 44, 5, 0, 200, 2),
        (8, 20, 5, 3, 0, 200, 0), (8, 11, 20, 1, 1, 90, 1),
        (10, 18, 33, 4, 0, 200, 2), (10, 9, 9, 0, 1, 200, 0),
        (12, 21, 1, 2, 1, 160, 1),
    ]

    static let plays: [HistoryEvent] = {
        let calendar = Calendar.current
        let releases = Array(StatsGallery.releases.prefix(6))
        return rows.enumerated().map { index, row in
            let start = calendar.startOfDay(for: Date())
            let dayStart = calendar.date(byAdding: .day, value: -row.0, to: start) ?? start
            let date = calendar.date(bySettingHour: row.1, minute: row.2, second: 0, of: dayStart) ?? dayStart
            let release = releases[row.3]
            let device = row.6 == 1
                ? HistoryDevice(name: "Mac", platform: "macos", current: false)
                : HistoryDevice(name: "iPhone", platform: "ios", current: row.6 == 0)
            return HistoryEvent(
                id: String(format: "00000000-0000-0000-0000-%012d", 9000 + index), releaseId: release.id,
                trackId: release.tracks[min(row.4, release.tracks.count - 1)].id, source: row.6 == 2 ? "spotify" : "locally",
                startedAt: Int64(date.timeIntervalSince1970 * 1000), day: PlayPeriods.localDayString(date, calendar: calendar),
                listenedMs: row.5 * 1000, device: device)
        }
    }()
}
#endif
