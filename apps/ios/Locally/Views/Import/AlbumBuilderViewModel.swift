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
        /// The featured artists (#287). `title` is plain; send joins them into "Song (feat. B)".
        var featuring: [String] = []
        /// From the file's disc tag, when it has one.
        var discNumber: Int?
        /// From the file's own track tag; only used to order a multi-disc import.
        var tagTrackNumber: Int?
    }

    private let importer: FileImporter
    private let coordinator: ReleaseCoordinator
    private let inbox: InboxStore?

    var rows: [TrackRow] = []
    var albumTitle: String = ""
    var artist: String = ""
    /// What is typed in the Release date field (#221); `releaseDateEntry` reads it.
    var releaseDateText: String = "" {
        didSet { if !isPrefillingDate { releaseDateEdited = true } }
    }
    /// True once the person has typed or cleared the date; an empty field then stays empty when
    /// tracks are added. The prefill and `reset()` do not count.
    private var releaseDateEdited = false
    private var isPrefillingDate = false
    var genre: String = ""
    var coverData: Data?
    /// The row whose feat. sheet is open, if any.
    var featuringRowID: TrackRow.ID?

    var isLoadingTags = false
    var isSending = false
    var progressDone = 0
    var progressTotal = 0
    var errorMessage: String?
    var completedRelease: Release?

    init(importer: FileImporter, coordinator: ReleaseCoordinator, inbox: InboxStore? = nil) {
        self.importer = importer
        self.coordinator = coordinator
        self.inbox = inbox
    }

    /// Appends a row for each newly picked file, prefilling its title from
    /// whatever tags the file already carries (falling back to the
    /// filename), same as the single-import flow. When `inboxFiles` is
    /// given (files shared in from other apps rather than picked), the
    /// matching file — by position — is removed from the inbox as soon as
    /// its staging copy succeeds.
    func addFiles(_ urls: [URL], inboxFiles: [InboxFile] = []) async {
        guard !urls.isEmpty else { return }
        errorMessage = nil
        isLoadingTags = true
        defer { isLoadingTags = false }

        var batch: [TrackRow] = []
        var firstDate: ReleaseDate?
        for (index, url) in urls.enumerated() {
            let inboxFile = index < inboxFiles.count ? inboxFiles[index] : nil
            let shownName = inboxFile?.originalName ?? url.lastPathComponent
            var title = (shownName as NSString).deletingPathExtension
            var featuring: [String] = []
            var rowURL = url
            var discNumber: Int?
            var tagTrackNumber: Int?
            if let staged = try? await importer.stage([url]), let file = staged.first {
                // Rows keep the staged copy: an inbox original is deleted
                // right after, and a picker URL's security scope may lapse.
                rowURL = file.url
                if let tags = file.existingTags, !tags.title.isEmpty {
                    title = tags.title
                }
                featuring = Self.featuring(in: title, artistTag: file.existingTags?.artist ?? "")
                title = ArtistNames.splitFeaturing(title).title
                discNumber = file.existingTags?.discNumber
                tagTrackNumber = file.tagTrackNumber
                if firstDate == nil { firstDate = file.existingTags?.date }
            }
            batch.append(TrackRow(url: rowURL, title: title, featuring: featuring, discNumber: discNumber, tagTrackNumber: tagTrackNumber))
            if let inboxFile {
                try? inbox?.remove(inboxFile)
            }
        }
        // Files tagged with a disc go in (disc, track) order; untagged files keep the order they came
        // in. Only this batch is reordered, so rows the user already arranged stay where they are.
        rows.append(contentsOf: DiscNumbering.ordered(batch, disc: \.discNumber, trackTag: \.tagTrackNumber))
        // The first track with an embedded date fills an empty field; typed text or an earlier date stays.
        if !releaseDateEdited, releaseDateText.isEmpty, let firstDate {
            isPrefillingDate = true
            releaseDateText = firstDate.formatted()
            isPrefillingDate = false
        }
    }

    /// Swaps the file behind one row for `url`, from the row's own replace button. The row keeps
    /// its place and disc; its title comes from the new file's tags, or its name, as when adding.
    /// If staging fails or returns nothing, the row is left as it was and `errorMessage` says why.
    func replaceRow(_ id: TrackRow.ID, with url: URL) async {
        guard rows.contains(where: { $0.id == id }) else { return }
        errorMessage = nil
        isLoadingTags = true
        defer { isLoadingTags = false }

        var title = (url.lastPathComponent as NSString).deletingPathExtension
        let file: StagedFile
        do {
            guard let staged = try await importer.stage([url]).first else { return }
            file = staged
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        if let tags = file.existingTags, !tags.title.isEmpty {
            title = tags.title
        }
        let featuring = Self.featuring(in: title, artistTag: file.existingTags?.artist ?? "")
        title = ArtistNames.splitFeaturing(title).title
        // The list can change while the file stages (a swipe delete, a drag).
        guard let index = rows.firstIndex(where: { $0.id == id }) else { return }
        rows[index].url = file.url
        rows[index].title = title
        rows[index].featuring = featuring
        rows[index].tagTrackNumber = file.tagTrackNumber
    }

    /// The names a file brings: those in its title's "(feat. B)" and in its artist tag's "A feat. B".
    private static func featuring(in title: String, artistTag: String) -> [String] {
        FeaturingNames.merged(ArtistNames.splitFeaturing(title).featuring, ArtistNames.splitArtistFeaturing(artistTag).featuring)
    }

    /// The disc heading to show above each row, or nil for none (see `DiscNumbering.headings`).
    var discHeadings: [Int?] {
        DiscNumbering.headings(for: rows.map(\.discNumber))
    }

    /// What the disc menu on row `index` offers (#222); none for a lone track.
    func discActions(at index: Int) -> DiscNumbering.Actions {
        rows.count >= 2 ? DiscNumbering.actions(for: rows.map(\.discNumber), at: index) : DiscNumbering.Actions()
    }

    func startDisc(at index: Int) {
        let discs = DiscNumbering.startDisc(at: index, in: rows.map(\.discNumber))
        for i in rows.indices { rows[i].discNumber = discs[i] }
    }

    func joinPreviousDisc(at index: Int) {
        let discs = DiscNumbering.joinPreviousDisc(at: index, in: rows.map(\.discNumber))
        for i in rows.indices { rows[i].discNumber = discs[i] }
    }

    /// Convenience for `AlbumBuilderView`'s "Make an album" inbox action:
    /// adds every shared file as a row, in the order they were shared.
    func addFiles(fromInbox files: [InboxFile]) async {
        await addFiles(files.map(\.url), inboxFiles: files)
    }

    func removeRows(at offsets: IndexSet) {
        rows.remove(atOffsets: offsets)
    }

    func moveRows(from source: IndexSet, to destination: Int) {
        let order = rows.map(\.id)
        let movedIds = source.map { rows[$0].id }
        rows.move(fromOffsets: source, toOffset: destination)
        guard rows.map(\.id) != order else { return }
        // A row dropped in among another disc's rows joins that disc, so a disc is never split.
        for index in rows.indices where movedIds.contains(rows[index].id) {
            rows[index].discNumber = DiscNumbering.adoptDiscAfterMove(rows.map(\.discNumber), movedIndex: index)[index]
        }
    }

    var releaseDateEntry: ReleaseDateEntry { ReleaseDateText.parse(releaseDateText) }

    /// The impossible or unreadable line under the date field, nil otherwise.
    var releaseDateMessage: String? { releaseDateEntry.message }

    var canSend: Bool {
        !rows.isEmpty && !albumTitle.isEmpty && !artist.isEmpty && !isSending && !isLoadingTags && releaseDateMessage == nil
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
        let tracks = rows.map { TrackDraft(title: ArtistNames.joinFeaturing($0.title, $0.featuring), discNumber: $0.discNumber) }
        let album = AlbumDraft(
            title: albumTitle,
            artist: artist,
            date: releaseDateEntry.date,
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
        featuringRowID = nil
        albumTitle = ""
        artist = ""
        releaseDateText = ""
        releaseDateEdited = false
        genre = ""
        coverData = nil
        completedRelease = nil
        errorMessage = nil
        progressDone = 0
        progressTotal = 0
    }

    /// The track titles in final order, for `DoneView`'s checklist.
    var orderedTrackTitles: [String] {
        rows.map { ArtistNames.joinFeaturing($0.title, $0.featuring) }
    }
}
