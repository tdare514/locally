import Foundation

/// What reading a song's file tells the page: its size, and its length when the index stores none.
struct SongFileFacts: Equatable, Sendable {
    var size: Int64?
    var duration: Double?
}

/// Reads what the song page shows that is not in the library index (#365): the plays through the play stats
/// service and the file's size and length. The four ranged plays use the service's cache and request budget (never
/// forced); the all-time total comes from the per-release plays read, so the heaviest summary read is not made. Signed
/// out or offline leaves the plays nil and the page hides that group.
@MainActor
@Observable
final class SongPageLoader {
    /// The four ranged reads, shortest period first, as the Stats tab asks for them (all time is not among them).
    static let periods: [StatsPeriodKind] = StatsPeriodKind.allCases.filter { $0 != .all }

    private(set) var plays: SongPlays?
    private(set) var fileSize: Int64?
    private(set) var readLength: Double?
    /// The local day the plays were read for, for "last played yesterday".
    private(set) var today = ""

    @ObservationIgnored private let stats: PlayStatsReading?
    @ObservationIgnored private let readFile: ((Release, Track) async -> SongFileFacts)?
    /// The track's all-time plays from `GET /v1/releases/:id/plays`; nil when signed out or the read failed.
    @ObservationIgnored private let allTimePlays: ((Release, UUID) async -> Int?)?

    init(stats: PlayStatsReading?, readFile: ((Release, Track) async -> SongFileFacts)? = nil,
         allTimePlays: ((Release, UUID) async -> Int?)? = nil) {
        self.stats = stats
        self.readFile = readFile
        self.allTimePlays = allTimePlays
    }

    /// The all-time total of one track from the sync API's per-release plays read (what `ReleaseDetailViewModel.loadPlays`
    /// reads); a track the server lists no plays for has none.
    static func allTimeTotal(api: SyncApi, isSignedIn: Bool, release: Release, trackID: UUID) async -> Int? {
        guard isSignedIn, let result = try? await api.releasePlays(releaseId: release.id.uuidString) else { return nil }
        let id = trackID.uuidString.lowercased()
        return result.tracks.filter { $0.trackId.lowercased() == id }.map(\.total).max() ?? 0
    }

    /// The production loader: plays from the container's service, the file read inside the Spotify folder's access.
    convenience init(container: AppContainer) {
        let coordinator = container.coordinator
        let api = container.syncApi
        let account = container.syncAccount
        self.init(stats: container.playStats, readFile: { release, track in
            var only = release
            only.tracks = [track]
            let facts: SongFileFacts? = try? await coordinator.withContainedTrackFiles(of: only) { files in
                // A path outside the connected folder has no url: no stat, no length read.
                guard let url = files.first?.url else { return SongFileFacts() }
                // The stat and the length read stay off the main thread.
                let size: Int64? = await Task.detached(priority: .utility) {
                    ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.int64Value
                }.value
                let duration = track.durationSec == nil ? await TrackLengthLoader.shared.duration(of: url) : nil
                return SongFileFacts(size: size, duration: duration)
            }
            return facts ?? SongFileFacts()
        }, allTimePlays: { release, trackID in
            await Self.allTimeTotal(api: api, isSignedIn: account.deviceToken != nil, release: release, trackID: trackID)
        })
    }

    func load(release: Release, trackID: UUID, now: Date = Date(), calendar: Calendar = .current) async {
        async let plays: Void = loadPlays(release: release, trackID: trackID, now: now, calendar: calendar)
        async let file: Void = loadFile(release: release, trackID: trackID)
        _ = await (plays, file)
    }

    private func loadPlays(release: Release, trackID: UUID, now: Date, calendar: Calendar) async {
        guard let stats, let allTimePlays else { plays = nil; return }
        let today = PlayPeriods.localDayString(now, calendar: calendar)
        let firstDay = PlayPeriods.isoFirstDay(fromAppleFirstWeekday: calendar.firstWeekday)
        self.today = today
        var reads: [StatsPeriodKind: PlaysSummary] = [:]
        var signedOut = false
        // One read per period; the service shares a request between equal ranges and answers from its 5-minute cache.
        await withTaskGroup(of: (StatsPeriodKind, PlayStatsRead).self) { group in
            for kind in Self.periods {
                let range = PlayPeriods.selectionRange(PeriodSelection(kind: kind, back: 0), today: today, firstDay: firstDay)
                group.addTask { @MainActor in (kind, await stats.summary(from: range.from, to: range.to, force: false)) }
            }
            for await (kind, read) in group {
                switch read {
                case .ok(let summary): reads[kind] = summary
                case .signedOut: signedOut = true
                case .failed, .busy: break
                }
            }
        }
        // Without the all-time total (signed out, offline) there is nothing honest to show.
        if signedOut { plays = nil; return }
        guard let total = await allTimePlays(release, trackID) else { plays = nil; return }
        plays = SongPlays.make(trackID: trackID, releaseID: release.id, total: total, reads: reads)
    }

    private func loadFile(release: Release, trackID: UUID) async {
        guard !release.isAdopted, let readFile, let track = release.tracks.first(where: { $0.id == trackID }) else { return }
        let facts = await readFile(release, track)
        fileSize = facts.size
        readLength = facts.duration
    }
}
