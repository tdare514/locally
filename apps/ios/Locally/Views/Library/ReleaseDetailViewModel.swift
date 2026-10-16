import Foundation

/// One line of the save-review sheet: what the user changed, old against new.
enum ReleaseChange: Equatable, Identifiable {
    case field(label: String, old: String, new: String)
    case cover(old: Data?, new: Data?)
    case trackRenamed(id: UUID, old: String, new: String)
    case trackOrder

    var id: String {
        switch self {
        case .field(let label, _, _): "field-\(label)"
        case .cover: "cover"
        case .trackRenamed(let id, _, _): "track-\(id.uuidString)"
        case .trackOrder: "order"
        }
    }
}

/// Drives `ReleaseDetailView`: holds editable copies of a release's fields
/// and track titles/order, tracks whether anything actually changed (so
/// "Save changes" only enables when it should), and runs saves/deletes
/// through `ReleaseCoordinator`.
@Observable
final class ReleaseDetailViewModel {
    /// One track's editable title, identified by its stable `Track.id` so
    /// reordering never mixes up which title belongs to which file.
    struct TrackRow: Identifiable, Hashable {
        let id: UUID
        var title: String
        /// Which disc the track is on, when the release has discs. Read only: it sets the
        /// "Disc N" headings.
        var discNumber: Int?
        /// The stored length in seconds, when the release carries one.
        var durationSec: Double?
    }

    private let coordinator: ReleaseCoordinator
    private let coverStore: CoverStore
    private let syncApi: SyncApi?
    private let isSignedIn: () -> Bool

    let releaseId: UUID
    let kind: ReleaseKind

    var title: String
    var artist: String
    var year: String
    var genre: String
    var coverData: Data?
    var trackRows: [TrackRow]
    /// Spotify play totals across all devices, by lowercased track id; empty when signed out or offline.
    private(set) var playTotals: [String: Int] = [:]

    private var originalTitle: String
    private var originalArtist: String
    private var originalYear: String
    private var originalGenre: String
    private var originalCoverData: Data?
    private var originalTrackRows: [TrackRow]

    /// The release page opens in view mode; Edit turns this on, a save or discard turns it off.
    var isEditing = false
    var isSaving = false
    var isDeleting = false
    var errorMessage: String?
    var statusMessage: String?
    var isDeleted = false
    /// Lengths read from the track files for tracks that carry none, by track id.
    private(set) var readLengths: [UUID: Double] = [:]
    private var release: Release
    /// Bumped after each successful save; the view plays the record ceremony on it.
    private(set) var saveCount = 0

    init(
        release: Release,
        coordinator: ReleaseCoordinator,
        coverStore: CoverStore,
        syncApi: SyncApi? = nil,
        isSignedIn: @escaping () -> Bool = { false }
    ) {
        // `@Observable` forbids reading a tracked property via `self` until
        // every stored property is initialized, so every value below is
        // computed into a local first and used to set both the editable
        // and "original" properties — never re-read from `self`.
        let title = release.title
        let artist = release.artist
        let year = release.year ?? ""
        let genre = release.genre ?? ""
        let cover = release.coverPath != nil ? coverStore.load(release.id) : nil
        let rows = release.tracks
            .sorted { $0.trackNumber < $1.trackNumber }
            .map { TrackRow(id: $0.id, title: $0.title, discNumber: $0.discNumber, durationSec: $0.durationSec) }

        self.release = release
        self.releaseId = release.id
        self.kind = release.kind
        self.coordinator = coordinator
        self.coverStore = coverStore
        self.syncApi = syncApi
        self.isSignedIn = isSignedIn

        self.title = title
        self.artist = artist
        self.year = year
        self.genre = genre
        self.coverData = cover
        self.trackRows = rows

        self.originalTitle = title
        self.originalArtist = artist
        self.originalYear = year
        self.originalGenre = genre
        self.originalCoverData = cover
        self.originalTrackRows = rows
    }

    var hasChanges: Bool {
        title != originalTitle
            || artist != originalArtist
            || year != originalYear
            || genre != originalGenre
            || coverData != originalCoverData
            || trackRows != originalTrackRows
    }

    /// What changed against the saved release, for the review sheet. Empty when nothing did.
    var changes: [ReleaseChange] {
        var result: [ReleaseChange] = []
        let fields: [(String, String, String)] = [
            (Copy.Import.fieldTitle, originalTitle, title),
            (Copy.Import.fieldArtist, originalArtist, artist),
            (Copy.Import.fieldYear, originalYear, year),
            (Copy.Import.fieldGenre, originalGenre, genre)
        ]
        for (label, old, new) in fields where old != new {
            result.append(.field(label: label, old: old, new: new))
        }
        if coverData != originalCoverData {
            result.append(.cover(old: originalCoverData, new: coverData))
        }
        let oldTitles = Dictionary(originalTrackRows.map { ($0.id, $0.title) }, uniquingKeysWith: { first, _ in first })
        for row in trackRows {
            if let old = oldTitles[row.id], old != row.title {
                result.append(.trackRenamed(id: row.id, old: old, new: row.title))
            }
        }
        if trackRows.map(\.id) != originalTrackRows.map(\.id) {
            result.append(.trackOrder)
        }
        return result
    }

    func beginEditing() {
        isEditing = true
    }

    /// Puts every field back to the saved release and leaves edit mode.
    func discardChanges() {
        title = originalTitle
        artist = originalArtist
        year = originalYear
        genre = originalGenre
        coverData = originalCoverData
        trackRows = originalTrackRows
        errorMessage = nil
        isEditing = false
    }

    var canSave: Bool {
        hasChanges && !title.isEmpty && !artist.isEmpty && !isSaving
    }

    /// Reads play counts from the sync API (read-only; the phone adds none).
    /// Signed out, no api, or any error leaves the counts empty.
    func loadPlays() async {
        guard let syncApi, isSignedIn() else { return }
        do {
            let result = try await syncApi.releasePlays(releaseId: releaseId.uuidString)
            var totals: [String: Int] = [:]
            for track in result.tracks where track.total > 0 {
                totals[track.trackId.lowercased()] = track.total
            }
            playTotals = totals
        } catch {
            playTotals = [:]
        }
    }

    /// The play total to show under a track row, or nil when it has none.
    func playTotal(for row: TrackRow) -> Int? {
        playTotals[row.id.uuidString.lowercased()]
    }

    var hasPlays: Bool { !playTotals.isEmpty }

    /// The disc heading to show above each row, or nil for none (see `DiscNumbering.headings`).
    var discHeadings: [Int?] {
        DiscNumbering.headings(for: trackRows.map(\.discNumber))
    }

    func moveTracks(from source: IndexSet, to destination: Int) {
        let order = trackRows.map(\.id)
        let movedIds = source.map { trackRows[$0].id }
        trackRows.move(fromOffsets: source, toOffset: destination)
        guard trackRows.map(\.id) != order else { return }
        // A row dropped in among another disc's rows joins that disc, so a disc is never split.
        for index in trackRows.indices where movedIds.contains(trackRows[index].id) {
            trackRows[index].discNumber = DiscNumbering.adoptDiscAfterMove(trackRows.map(\.discNumber), movedIndex: index)[index]
        }
    }

    func save() async {
        guard canSave else { return }
        errorMessage = nil
        statusMessage = nil
        isSaving = true
        defer { isSaving = false }

        var trackTitles: [UUID: String] = [:]
        for row in trackRows {
            trackTitles[row.id] = row.title
        }
        // A single has one title: what the user edits as "Title" is what
        // Spotify shows for the track, so the track tag follows it.
        if kind == .single, let only = trackRows.first {
            trackTitles[only.id] = title
        }

        let changes = ReleaseChanges(
            title: title,
            artist: artist,
            year: year,
            genre: genre,
            cover: coverData != originalCoverData ? coverData : nil,
            trackTitles: trackTitles,
            trackOrder: trackRows.map { $0.id },
            trackDiscs: Dictionary(uniqueKeysWithValues: trackRows.compactMap { row in row.discNumber.map { (row.id, $0) } })
        )

        do {
            let updated = try await coordinator.updateRelease(releaseId, changes: changes)
            apply(updated)
            saveCount += 1
            isEditing = false
            statusMessage = Copy.Import.afterEdit
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Reads the length of every track the release has none stored for, from the file as the
    /// coordinator resolves it (inside the Spotify folder's security scope). A folder that is
    /// not connected, or a file that will not read, leaves that length out.
    func loadMissingLengths() async {
        let missing = release.tracks.filter { $0.durationSec == nil && readLengths[$0.id] == nil }
        guard !missing.isEmpty else { return }
        let wanted = Set(missing.map(\.id))
        let found: [UUID: Double]? = try? await coordinator.withTrackFiles(of: release) { files in
            var result: [UUID: Double] = [:]
            for file in files where wanted.contains(file.track.id) {
                if let seconds = await TrackLengthLoader.shared.duration(of: file.url) {
                    result[file.track.id] = seconds
                }
            }
            return result
        }
        if let found { readLengths.merge(found) { _, new in new } }
    }

    func delete() async {
        errorMessage = nil
        isDeleting = true
        defer { isDeleting = false }

        do {
            try await coordinator.deleteRelease(releaseId)
            isDeleted = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Resyncs both the editable and "original" snapshots to a freshly
    /// saved release, so `hasChanges`/`canSave` go back to false until the
    /// user changes something new.
    private func apply(_ release: Release) {
        self.release = release
        title = release.title
        artist = release.artist
        year = release.year ?? ""
        genre = release.genre ?? ""
        coverData = release.coverPath != nil ? coverStore.load(release.id) : coverData
        trackRows = release.tracks
            .sorted { $0.trackNumber < $1.trackNumber }
            .map { TrackRow(id: $0.id, title: $0.title, discNumber: $0.discNumber, durationSec: $0.durationSec) }

        originalTitle = title
        originalArtist = artist
        originalYear = year
        originalGenre = genre
        originalCoverData = coverData
        originalTrackRows = trackRows
    }
}
