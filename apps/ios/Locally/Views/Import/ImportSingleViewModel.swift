import Foundation

/// Drives `ImportSingleView`: holds the picked file and editable tag
/// fields, prefills them from the file's existing tags via `FileImporter`,
/// and runs the send through `ReleaseCoordinator`. Kept as an `@Observable`
/// model (no Combine) so the view stays a thin layout description.
@Observable
final class ImportSingleViewModel {
    private let importer: FileImporter
    private let coordinator: ReleaseCoordinator
    private let inbox: InboxStore?

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

    /// Files shared in from other apps, still waiting after the one
    /// currently loaded in the form. Populated by `startInboxQueue`;
    /// `reset()` advances to the next one automatically so "Add another"
    /// walks through the whole share in order.
    private(set) var pendingInboxQueue: [InboxFile] = []

    init(importer: FileImporter, coordinator: ReleaseCoordinator, inbox: InboxStore? = nil) {
        self.importer = importer
        self.coordinator = coordinator
        self.inbox = inbox
    }

    /// Records the picked file and prefills the fields from whatever tags
    /// it already carries (falling back to the filename for the title).
    /// When `inboxFile` is given (the file came from the share inbox
    /// rather than a document picker), it's removed from the inbox as soon
    /// as staging copies it out — the copy in the app's own tmp directory
    /// is now the only one that matters.
    func pick(url: URL, inboxFile: InboxFile? = nil) async {
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
            if let inboxFile {
                try? inbox?.remove(inboxFile)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Starts working through files shared in from other apps: loads the
    /// first into the form (prefilled, same as any picked file) and keeps
    /// the rest queued for `reset()` to advance through one at a time.
    func startInboxQueue(_ files: [InboxFile]) async {
        guard let first = files.first else { return }
        pendingInboxQueue = Array(files.dropFirst())
        await pick(url: first.url, inboxFile: first)
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

    /// Resets all fields so the view can be reused for another import. If a
    /// share queue is still waiting (`startInboxQueue`), loads the next
    /// file instead of leaving the form blank, so "Add another" walks
    /// through everything that was shared in, one at a time.
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

        guard !pendingInboxQueue.isEmpty else { return }
        let next = pendingInboxQueue.removeFirst()
        Task { await pick(url: next.url, inboxFile: next) }
    }

    var canSend: Bool {
        pickedURL != nil && !title.isEmpty && !artist.isEmpty && !isSending
    }
}
