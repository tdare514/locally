import Foundation

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
    }

    private let coordinator: ReleaseCoordinator
    private let coverStore: CoverStore

    let releaseId: UUID
    let kind: ReleaseKind

    var title: String
    var artist: String
    var year: String
    var genre: String
    var coverData: Data?
    var trackRows: [TrackRow]

    private var originalTitle: String
    private var originalArtist: String
    private var originalYear: String
    private var originalGenre: String
    private var originalCoverData: Data?
    private var originalTrackRows: [TrackRow]

    var isSaving = false
    var isDeleting = false
    var errorMessage: String?
    var statusMessage: String?
    var isDeleted = false

    init(release: Release, coordinator: ReleaseCoordinator, coverStore: CoverStore) {
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
            .map { TrackRow(id: $0.id, title: $0.title) }

        self.releaseId = release.id
        self.kind = release.kind
        self.coordinator = coordinator
        self.coverStore = coverStore

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

    var canSave: Bool {
        hasChanges && !title.isEmpty && !artist.isEmpty && !isSaving
    }

    func moveTracks(from source: IndexSet, to destination: Int) {
        trackRows.move(fromOffsets: source, toOffset: destination)
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
            trackOrder: trackRows.map { $0.id }
        )

        do {
            let updated = try await coordinator.updateRelease(releaseId, changes: changes)
            apply(updated)
            statusMessage = Copy.Import.afterEdit
        } catch {
            errorMessage = error.localizedDescription
        }
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
        title = release.title
        artist = release.artist
        year = release.year ?? ""
        genre = release.genre ?? ""
        coverData = release.coverPath != nil ? coverStore.load(release.id) : coverData
        trackRows = release.tracks
            .sorted { $0.trackNumber < $1.trackNumber }
            .map { TrackRow(id: $0.id, title: $0.title) }

        originalTitle = title
        originalArtist = artist
        originalYear = year
        originalGenre = genre
        originalCoverData = coverData
        originalTrackRows = trackRows
    }
}
