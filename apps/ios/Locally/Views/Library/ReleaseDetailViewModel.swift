import Foundation

/// One line of the save-review sheet: what the user changed, old against new.
enum ReleaseChange: Equatable, Identifiable {
    case field(label: String, old: String, new: String)
    case cover(old: Data?, new: Data?)
    case trackRenamed(id: UUID, old: String, new: String)
    case trackOrder
    /// The disc layout, as `Copy.Release.discLayout` words it (#222).
    case discs(old: String, new: String)

    var id: String {
        switch self {
        case .field(let label, _, _): "field-\(label)"
        case .cover: "cover"
        case .trackRenamed(let id, _, _): "track-\(id.uuidString)"
        case .trackOrder: "order"
        case .discs: "discs"
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
        /// The plain title: "Song (feat. B)" is split into this and `featuring` (#287), and save
        /// joins them again.
        var title: String
        var featuring: [String] = []
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
    /// What is typed in the Release date field (#221); `releaseDateEntry` reads it.
    var releaseDateText: String
    var genre: String
    var coverData: Data?
    var trackRows: [TrackRow]
    /// Spotify play totals across all devices, by lowercased track id; empty when signed out or offline.
    private(set) var playTotals: [String: Int] = [:]

    /// What is typed in a single's Featuring field and not yet added; saving adds it.
    var featuringDraft = ""
    /// The album row whose feat. sheet is open, if any.
    var featuringRowID: UUID?

    private var originalTitle: String
    private var originalArtist: String
    private var originalReleaseDateText: String
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
        let title = Self.editorTitle(of: release)
        let artist = release.artist
        let releaseDateText = Self.dateText(of: release)
        let genre = release.genre ?? ""
        let cover = release.coverPath != nil ? coverStore.load(release.id) : nil
        let rows = Self.rows(of: release)

        self.release = release
        self.releaseId = release.id
        self.kind = release.kind
        self.coordinator = coordinator
        self.coverStore = coverStore
        self.syncApi = syncApi
        self.isSignedIn = isSignedIn

        self.title = title
        self.artist = artist
        self.releaseDateText = releaseDateText
        self.genre = genre
        self.coverData = cover
        self.trackRows = rows

        self.originalTitle = title
        self.originalArtist = artist
        self.originalReleaseDateText = releaseDateText
        self.originalGenre = genre
        self.originalCoverData = cover
        self.originalTrackRows = rows
    }

    /// The Title field's text. A single's release title is plain, but one saved before the
    /// Featuring field may hold "Song (feat. B)", which the field splits.
    private static func editorTitle(of release: Release) -> String {
        release.kind == .single ? ArtistNames.splitFeaturing(release.title).title : release.title
    }

    /// The editable rows: each track's title split into the plain title and its featured artists.
    private static func rows(of release: Release) -> [TrackRow] {
        release.tracks
            .sorted { $0.trackNumber < $1.trackNumber }
            .map {
                let split = ArtistNames.splitFeaturing($0.title)
                return TrackRow(id: $0.id, title: split.title, featuring: split.featuring, discNumber: $0.discNumber, durationSec: $0.durationSec)
            }
    }

    /// A single's featured artists, kept on its one track row.
    var singleFeaturing: [String] {
        get { trackRows.first?.featuring ?? [] }
        set { if !trackRows.isEmpty { trackRows[0].featuring = newValue } }
    }

    /// Adds a name typed in the single's Featuring field and not yet confirmed.
    func commitFeaturingDraft() {
        singleFeaturing = FeaturingNames.commit(featuringDraft, to: singleFeaturing)
        featuringDraft = ""
    }

    /// The track's title as saved in its file, by id.
    private func savedTitle(of id: UUID) -> String? {
        release.tracks.first { $0.id == id }?.title
    }

    var hasChanges: Bool {
        !FeaturingNames.add(featuringDraft, to: []).isEmpty
            || title != originalTitle
            || artist != originalArtist
            || releaseDateChanged
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
            (Copy.DateField.label, dateChange == nil ? "" : originalReleaseDateText, dateChange.map { $0?.formatted() ?? "" } ?? ""),
            (Copy.Import.fieldGenre, originalGenre, genre)
        ]
        for (label, old, new) in fields where old != new {
            result.append(.field(label: label, old: old, new: new))
        }

        if coverData != originalCoverData {
            result.append(.cover(old: originalCoverData, new: coverData))
        }
        if kind == .single {
            let old = originalTrackRows.first?.featuring ?? []
            let new = FeaturingNames.commit(featuringDraft, to: singleFeaturing)
            if old != new {
                result.append(.field(label: Copy.Featuring.field, old: FeaturingNames.display(old), new: FeaturingNames.display(new)))
            }
        } else {
            for row in trackRows {
                guard let old = savedTitle(of: row.id) else { continue }
                let new = FeaturingNames.fullTitle(plain: row.title, featuring: row.featuring, original: old)
                if old != new {
                    result.append(.trackRenamed(id: row.id, old: old, new: new))
                }
            }
        }
        if trackRows.map(\.id) != originalTrackRows.map(\.id) {
            result.append(.trackOrder)
        }
        // Compared as numbers, not as words: two different layouts must never look unchanged.
        let originalDiscs = Dictionary(originalTrackRows.map { ($0.id, $0.discNumber) }, uniquingKeysWith: { first, _ in first })
        if trackRows.contains(where: { originalDiscs[$0.id] != $0.discNumber }) {
            result.append(.discs(
                old: Copy.Release.discLayout(originalTrackRows.map(\.discNumber)),
                new: Copy.Release.discLayout(trackRows.map(\.discNumber))
            ))
        }
        return result
    }

    func beginEditing() {
        guard !release.isAdopted else { return }
        isEditing = true
    }

    /// Puts every field back to the saved release and leaves edit mode.
    func discardChanges() {
        title = originalTitle
        artist = originalArtist
        releaseDateText = originalReleaseDateText
        genre = originalGenre
        coverData = originalCoverData
        trackRows = originalTrackRows
        featuringDraft = ""
        featuringRowID = nil
        errorMessage = nil
        isEditing = false
    }

    var canSave: Bool {
        hasChanges && !title.isEmpty && !artist.isEmpty && !isSaving && releaseDateMessage == nil
    }

    /// The text the Release date field starts from: the date formatted, else a legacy year as it was stored.
    private static func dateText(of release: Release) -> String {
        release.date?.formatted() ?? release.year ?? ""
    }

    /// The language the date is typed in; tests set it.
    var locale: Locale = .current

    var releaseDateEntry: ReleaseDateEntry { ReleaseDateText.parse(releaseDateText, locale: locale) }

    /// The impossible or unreadable line under the date field. Nil while the text is as it was saved,
    /// so a legacy year like "soon" never blocks saving something else.
    var releaseDateMessage: String? {
        releaseDateText == originalReleaseDateText ? nil : releaseDateEntry.message
    }

    /// The date change to save: nil keeps, `.some(nil)` clears, `.some(date)` sets. Compares dates, not text.
    private var dateChange: ReleaseDate?? {
        guard releaseDateText != originalReleaseDateText else { return nil }
        switch releaseDateEntry {
        case .date(let date): return date == release.date ? nil : .some(date)
        case .empty: return originalReleaseDateText.isEmpty ? nil : .some(nil)
        case .impossible, .unreadable: return nil
        }
    }

    /// An edited date to save, or one that can't be saved yet.
    private var releaseDateChanged: Bool { dateChange != nil || releaseDateMessage != nil }

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

    // MARK: Shares (#183)

    /// Distinct people the release is shared with through live shares, and whether a live link
    /// share exists; read before the delete confirm, which says what deleting does to them.
    private(set) var liveSharePeople = 0
    private(set) var hasLiveLinkShare = false

    /// Sharing needs an account, and an adopted release's audio is not on the server.
    var canShare: Bool { !isAdopted }
    var isSignedInForSharing: Bool { isSignedIn() }

    func loadShareImpact(now: Date = Date()) async {
        guard let syncApi, isSignedIn() else { return }
        guard let sent = try? await syncApi.sentShares() else { return }
        let mine = sent.filter { $0.releaseId.lowercased() == releaseId.uuidString.lowercased() && $0.isLive(at: now) }
        liveSharePeople = Set(mine.flatMap(\.recipients).map { $0.email.lowercased() }).count
        hasLiveLinkShare = mine.contains { $0.hasLink }
    }

    /// The line the delete confirm adds when the release is shared, else nil.
    var deleteShareWarning: String? {
        if liveSharePeople > 0 { return Copy.Share.deleteWarning(people: liveSharePeople) }
        return hasLiveLinkShare ? Copy.Share.deleteWarningLink : nil
    }

    /// The play total to show under a track row, or nil when it has none.
    func playTotal(for row: TrackRow) -> Int? {
        playTotals[row.id.uuidString.lowercased()]
    }

    var hasPlays: Bool { !playTotals.isEmpty }
    /// An adopted release is details only: view mode, never edited here.
    var isAdopted: Bool { release.isAdopted }

    /// The disc heading to show above each row, or nil for none (see `DiscNumbering.headings`).
    var discHeadings: [Int?] {
        DiscNumbering.headings(for: trackRows.map(\.discNumber))
    }

    /// What the disc menu on row `index` offers (#222). Only an album in edit mode with two or more
    /// tracks has one; view mode and singles keep a plain number.
    func discActions(at index: Int) -> DiscNumbering.Actions {
        guard isEditing, kind == .album, !isAdopted, trackRows.count >= 2 else { return DiscNumbering.Actions() }
        return DiscNumbering.actions(for: trackRows.map(\.discNumber), at: index)
    }

    func startDisc(at index: Int) {
        let discs = DiscNumbering.startDisc(at: index, in: trackRows.map(\.discNumber))
        for i in trackRows.indices { trackRows[i].discNumber = discs[i] }
    }

    func joinPreviousDisc(at index: Int) {
        let discs = DiscNumbering.joinPreviousDisc(at: index, in: trackRows.map(\.discNumber))
        for i in trackRows.indices { trackRows[i].discNumber = discs[i] }
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

        commitFeaturingDraft()
        // A track's file carries its title in the "Song (feat. B)" form; the release title stays plain.
        var trackTitles: [UUID: String] = [:]
        for row in trackRows {
            trackTitles[row.id] = FeaturingNames.fullTitle(plain: row.title, featuring: row.featuring, original: savedTitle(of: row.id))
        }
        // A single has one title: what the user edits as "Title" is what
        // Spotify shows for the track, so the track tag follows it.
        if kind == .single, let only = trackRows.first {
            // The track keeps its own plain title (the Mac can give it one unlike the release's);
            // only an edited Title field replaces it.
            let plain = title == originalTitle ? only.title : title
            trackTitles[only.id] = FeaturingNames.fullTitle(plain: plain, featuring: only.featuring, original: savedTitle(of: only.id))
        }

        let originalDiscs = Dictionary(originalTrackRows.compactMap { row in row.discNumber.map { (row.id, $0) } }, uniquingKeysWith: { first, _ in first })
        // The Title field shows a legacy single's "Song (feat. B)" as "Song". Left alone, the release
        // title stays as it was saved; edited, it is the plain title typed.
        let changes = ReleaseChanges(
            title: title == originalTitle ? release.title : title,
            artist: artist,
            date: dateChange,
            genre: genre,
            cover: coverData != originalCoverData ? coverData : nil,
            trackTitles: trackTitles,
            trackOrder: trackRows.map { $0.id },
            trackDiscs: Dictionary(uniqueKeysWithValues: trackRows.compactMap { row in row.discNumber.map { (row.id, $0) } }),
            clearedDiscs: Set(trackRows.filter { $0.discNumber == nil && originalDiscs[$0.id] != nil }.map(\.id))
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
        title = Self.editorTitle(of: release)
        artist = release.artist
        releaseDateText = Self.dateText(of: release)
        genre = release.genre ?? ""
        coverData = release.coverPath != nil ? coverStore.load(release.id) : coverData
        trackRows = Self.rows(of: release)
        featuringDraft = ""

        originalTitle = title
        originalArtist = artist
        originalReleaseDateText = releaseDateText
        originalGenre = genre
        originalCoverData = coverData
        originalTrackRows = trackRows
    }
}
