import Foundation

/// Drives `AlbumBuilderView`: holds the picked files as ordered rows (each
/// with an editable, tag-prefilled title), the shared album fields, and
/// runs the send through `ReleaseCoordinator.importAlbum`. An `@Observable`
/// model, mirroring `ImportSingleViewModel`'s shape.
@Observable
final class AlbumBuilderViewModel {
    /// One picked file paired with its editable track title. Kept together
    /// so reordering (`.onMove`) and removal (swipe) move both at once.
    struct TrackRow: Identifiable, Hashable {
        let id = UUID()
        var url: URL
        var title: String
    }

    private let importer: FileImporter
    private let coordinator: ReleaseCoordinator

    var rows: [TrackRow] = []
    var albumTitle: String = ""
    var artist: String = ""
    var year: String = ""
    var genre: String = ""
    var coverData: Data?

    var isLoadingTags = false
    var isSending = false
    var progressDone = 0
    var progressTotal = 0
    var errorMessage: String?
    var completedRelease: Release?

    init(importer: FileImporter, coordinator: ReleaseCoordinator) {
        self.importer = importer
        self.coordinator = coordinator
    }

    /// Appends a row for each newly picked file, prefilling its title from
    /// whatever tags the file already carries (falling back to the
    /// filename), same as the single-import flow.
    func addFiles(_ urls: [URL]) async {
        guard !urls.isEmpty else { return }
        errorMessage = nil
        isLoadingTags = true
        defer { isLoadingTags = false }

        for url in urls {
            let fallbackTitle = url.deletingPathExtension().lastPathComponent
            var title = fallbackTitle
            if let staged = try? await importer.stage([url]),
               let file = staged.first,
               let tags = file.existingTags,
               !tags.title.isEmpty {
                title = tags.title
            }
            rows.append(TrackRow(url: url, title: title))
        }
    }

    func removeRows(at offsets: IndexSet) {
        rows.remove(atOffsets: offsets)
    }

    func moveRows(from source: IndexSet, to destination: Int) {
        rows.move(fromOffsets: source, toOffset: destination)
    }

    var canSend: Bool {
        !rows.isEmpty && !albumTitle.isEmpty && !artist.isEmpty && !isSending
    }

    /// Sends every row as one album, in its current order, reporting
    /// progress as each track lands.
    func send() async {
        guard canSend else { return }
        errorMessage = nil
        isSending = true
        progressDone = 0
        progressTotal = rows.count
        defer { isSending = false }

        let files = rows.map { $0.url }
        let tracks = rows.map { TrackDraft(title: $0.title) }
        let album = AlbumDraft(
            title: albumTitle,
            artist: artist,
            year: year.isEmpty ? nil : year,
            genre: genre.isEmpty ? nil : genre,
            tracks: tracks
        )

        do {
            completedRelease = try await coordinator.importAlbum(files: files, album: album, cover: coverData) { [weak self] done, total in
                Task { @MainActor in
                    self?.progressDone = done
                    self?.progressTotal = total
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Resets everything so the view can be reused for another album.
    func reset() {
        rows = []
        albumTitle = ""
        artist = ""
        year = ""
        genre = ""
        coverData = nil
        completedRelease = nil
        errorMessage = nil
        progressDone = 0
        progressTotal = 0
    }

    /// The track titles in final order, for `DoneView`'s checklist.
    var orderedTrackTitles: [String] {
        rows.map { $0.title }
    }
}
