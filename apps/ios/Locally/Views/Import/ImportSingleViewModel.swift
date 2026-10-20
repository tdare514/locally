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
    /// What the file chip shows: the name the user knows the file by, which
    /// for a shared file is its original name rather than the inbox copy's.
    var pickedName: String?
    var title: String = ""
    var artist: String = ""
    /// The featured artists (#287). `title` is the plain title; send joins the two into the
    /// track's "Song (feat. B)" form.
    var featuring: [String] = []
    /// What is typed in the Featuring field and not yet added; send adds it.
    var featuringDraft = ""
    /// What is typed in the Release date field (#221); `releaseDateEntry` reads it.
    var releaseDateText: String = ""
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
        pickedName = inboxFile?.originalName ?? url.lastPathComponent
        errorMessage = nil
        isLoadingTags = true
        defer { isLoadingTags = false }

        do {
            let staged = try await importer.stage([url])
            guard let file = staged.first else { return }
            if let tags = file.existingTags {
                // "Song (feat. B)" and "A feat. B" arrive as a plain title, artist and names.
                let splitTitle = ArtistNames.splitFeaturing(tags.title)
                let splitArtist = ArtistNames.splitArtistFeaturing(tags.artist)
                title = splitTitle.title
                artist = splitArtist.artist
                featuring = FeaturingNames.merged(splitTitle.featuring, splitArtist.featuring)
                releaseDateText = tags.date?.formatted() ?? ""
                genre = tags.genre ?? ""
            } else if title.isEmpty {
                let split = ArtistNames.splitFeaturing(((pickedName ?? "") as NSString).deletingPathExtension)
                title = split.title
                featuring = split.featuring
            }
            if let inboxFile {
                // The inbox original is deleted below, so Send must read the
                // staged copy, never the URL we were handed.
                pickedURL = file.url
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

        let tags = tagSet()

        do {
            completedRelease = try await coordinator.importSingle(file: pickedURL, tags: tags, cover: coverData)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// The tags for the file: the track's title in the "Song (feat. B)" form, the artist plain,
    /// and the album the plain title, which is what every later save writes too (#293). A name
    /// typed in the Featuring field and not yet added is added first.
    func tagSet() -> TagSet {
        featuring = FeaturingNames.commit(featuringDraft, to: featuring)
        featuringDraft = ""
        return TagSet(
            title: ArtistNames.joinFeaturing(title, featuring),
            artist: artist,
            album: title,
            trackNumber: 1,
            totalTracks: 1,
            date: releaseDateEntry.date,
            genre: genre.isEmpty ? nil : genre
        )
    }

    /// Empties the draft (file, fields, cover, messages) and leaves the share queue alone. Used by
    /// `reset()` and when the record switches to an album.
    func clearDraft() {
        pickedURL = nil
        pickedName = nil
        title = ""
        artist = ""
        featuring = []
        featuringDraft = ""
        releaseDateText = ""
        genre = ""
        coverData = nil
        completedRelease = nil
        errorMessage = nil
    }

    /// Resets all fields so the view can be reused for another import. If a
    /// share queue is still waiting (`startInboxQueue`), loads the next
    /// file instead of leaving the form blank, so "Add another" walks
    /// through everything that was shared in, one at a time.
    func reset() {
        clearDraft()

        guard !pendingInboxQueue.isEmpty else { return }
        let next = pendingInboxQueue.removeFirst()
        Task { await pick(url: next.url, inboxFile: next) }
    }

    var releaseDateEntry: ReleaseDateEntry { ReleaseDateText.parse(releaseDateText) }

    /// The impossible or unreadable line under the date field, nil otherwise.
    var releaseDateMessage: String? { releaseDateEntry.message }

    var canSend: Bool {
        pickedURL != nil && !title.isEmpty && !artist.isEmpty && !isSending && !isLoadingTags && releaseDateMessage == nil
    }
}
