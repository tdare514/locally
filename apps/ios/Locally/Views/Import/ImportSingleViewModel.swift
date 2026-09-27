import Foundation

/// Drives `ImportSingleView`: holds the picked file and editable tag
/// fields, prefills them from the file's existing tags via `FileImporter`,
/// and runs the send through `ReleaseCoordinator`. Kept as an `@Observable`
/// model (no Combine) so the view stays a thin layout description.
@Observable
final class ImportSingleViewModel {
    private let importer: FileImporter
    private let coordinator: ReleaseCoordinator

    var pickedURL: URL?
    var title: String = ""
    var artist: String = ""
    var album: String = ""
    var year: String = ""
    var genre: String = ""
    var coverData: Data?

    var isLoadingTags = false
    var isSending = false
    var errorMessage: String?
    var completedRelease: Release?

    init(importer: FileImporter, coordinator: ReleaseCoordinator) {
        self.importer = importer
        self.coordinator = coordinator
    }

    /// Records the picked file and prefills the fields from whatever tags
    /// it already carries (falling back to the filename for the title).
    func pick(url: URL) async {
        pickedURL = url
        errorMessage = nil
        isLoadingTags = true
        defer { isLoadingTags = false }

        do {
            let staged = try await importer.stage([url])
            guard let file = staged.first else { return }
            if let tags = file.existingTags {
                title = tags.title
                artist = tags.artist
                album = tags.album
                year = tags.year ?? ""
                genre = tags.genre ?? ""
            } else if title.isEmpty {
                title = url.deletingPathExtension().lastPathComponent
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Sends the picked file to Spotify's folder with the current field
    /// values. On success, `completedRelease` drives the done screen.
    func send() async {
        guard let pickedURL else { return }
        errorMessage = nil
        isSending = true
        defer { isSending = false }

        let tags = TagSet(
            title: title,
            artist: artist,
            album: album.isEmpty ? title : album,
            trackNumber: 1,
            totalTracks: 1,
            year: year.isEmpty ? nil : year,
            genre: genre.isEmpty ? nil : genre
        )

        do {
            completedRelease = try await coordinator.importSingle(file: pickedURL, tags: tags, cover: coverData)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Resets all fields so the view can be reused for another import.
    func reset() {
        pickedURL = nil
        title = ""
        artist = ""
        album = ""
        year = ""
        genre = ""
        coverData = nil
        completedRelease = nil
        errorMessage = nil
    }

    var canSend: Bool {
        pickedURL != nil && !title.isEmpty && !artist.isEmpty && !isSending
    }
}
