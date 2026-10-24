import Foundation
import Observation

/// What the Collections screens read and change (#350): the collections, the releases they name, and the edits.
/// Every edit saves to the store, bumps `updatedAt`, and tells the sync hook, so the change is queued in the
/// outbox and sent. Plain services only, so tests drive it with the in-memory fakes.
@MainActor
@Observable
final class CollectionsModel {
    private let store: CollectionStore
    private let library: LibraryStore
    private let hook: CollectionSyncHook?
    private let deviceName: () -> String
    private let now: () -> Date

    /// Newest change first.
    private(set) var collections: [MusicCollection] = []
    /// One per collection, in the same order, computed once per read so the record player's wheel never works them out per frame (#352).
    private(set) var summaries: [CollectionSummary] = []
    private(set) var releases: [UUID: Release] = [:]
    /// False until the local store has been read once, so the screen can show placeholders for that moment.
    private(set) var isLoaded = false
    /// The last write that did not save (shown by the screen that made it), cleared by the next success.
    private(set) var failure: String?
    /// Why the collections could not be read; the screens show it, with Try again, instead of an empty library.
    private(set) var readFailure: String?

    init(store: CollectionStore, library: LibraryStore, hook: CollectionSyncHook?, deviceName: @escaping () -> String = { "iPhone" }, now: @escaping () -> Date = { Date() }) {
        self.store = store
        self.library = library
        self.hook = hook
        self.deviceName = deviceName
        self.now = now
    }

    func reload() {
        do {
            collections = try store.all().sorted { $0.updatedAt != $1.updatedAt ? $0.updatedAt > $1.updatedAt : $0.id.uuidString < $1.id.uuidString }
            releases = Dictionary(try library.all().map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            summaries = collections.map(summary(of:))
            readFailure = nil
        } catch {
            readFailure = error.localizedDescription
        }
        isLoaded = true
    }

    private func summary(of collection: MusicCollection) -> CollectionSummary {
        CollectionSummary(
            id: collection.id, name: collection.name, tracks: trackCount(of: collection),
            coverReleaseIDs: coverReleaseIDs(of: collection), playableSeconds: playableDuration(of: collection)
        )
    }

    func summary(_ id: UUID) -> CollectionSummary? { summaries.first { $0.id == id } }

    func collection(_ id: UUID) -> MusicCollection? { collections.first { $0.id == id } }

    /// The tracks a collection shows, with those this phone doesn't hold marked.
    func rows(of collection: MusicCollection) -> [CollectionQueue.Row] {
        CollectionQueue.rows(collection.items, releases: releases)
    }

    /// What Play queues: the rows this phone holds, in order.
    func playQueue(of collection: MusicCollection) -> [(releaseID: UUID, trackID: UUID)] {
        CollectionQueue.items(collection.items, releases: releases)
    }

    func trackCount(of collection: MusicCollection) -> Int { rows(of: collection).count }

    /// Seconds in the tracks this phone can play; nil when none has a known length.
    func playableDuration(of collection: MusicCollection) -> Double? {
        let total = rows(of: collection).filter(\.isHeld).compactMap(\.durationSec).filter { $0.isFinite && $0 > 0 }.reduce(0, +)
        return total > 0 ? total : nil
    }

    /// The first four different covers among the items' releases (the 2x2, or one when only one).
    func coverReleaseIDs(of collection: MusicCollection) -> [UUID] {
        var seen: [UUID] = []
        for row in rows(of: collection) where !seen.contains(row.releaseID) && releases[row.releaseID]?.coverPath != nil {
            seen.append(row.releaseID)
            if seen.count == 4 { break }
        }
        return seen
    }

    /// Items the edit list shows, as positions in `collection.items`.
    func visibleItems(of collection: MusicCollection) -> [Int] {
        CollectionEdit.visible(collection.items, releases: releases)
    }

    /// Makes a collection named `name` holding `items`; `nil` for a name that isn't valid. Throws when it can't be saved.
    @discardableResult
    func create(name: String, items: [CollectionItem] = []) throws -> UUID? {
        guard let name = MusicCollection.validName(name) else { return nil }
        let stamp = now()
        let made = MusicCollection(
            id: UUID(), name: name, items: CollectionEdit.appended([], items).items, origin: "ios",
            originDevice: deviceName(), createdAt: stamp, updatedAt: stamp
        )
        try save(made)
        return made.id
    }

    /// `false` for a name that isn't valid. Throws when it can't be saved.
    @discardableResult
    func rename(_ id: UUID, to name: String) throws -> Bool {
        guard let name = MusicCollection.validName(name) else { return false }
        try change(id) { $0.name = name }
        return true
    }

    /// Adds `items`; returns how many went in (an item already there is skipped). Throws when it can't be saved.
    @discardableResult
    func add(_ items: [CollectionItem], to id: UUID) throws -> Int {
        var added = 0
        try change(id) { collection in
            let result = CollectionEdit.appended(collection.items, items)
            collection.items = result.items
            added = result.added
        }
        return added
    }

    /// The edits below throw when they can't be saved, so the screen can say so and offer Try again.
    func move(_ id: UUID, from source: IndexSet, to destination: Int) throws {
        try change(id) { collection in
            collection.items = CollectionEdit.moved(collection.items, visible: CollectionEdit.visible(collection.items, releases: releases), from: source, to: destination)
        }
    }

    /// VoiceOver's "Move up" / "Move down" (`step` -1 / +1) on the visible entry at `position`.
    func move(_ id: UUID, position: Int, by step: Int) throws {
        try change(id) { collection in
            collection.items = CollectionEdit.moved(collection.items, visible: CollectionEdit.visible(collection.items, releases: releases), position: position, by: step)
        }
    }

    func remove(_ id: UUID, position: Int) throws {
        try change(id) { collection in
            collection.items = CollectionEdit.removed(collection.items, visible: CollectionEdit.visible(collection.items, releases: releases), position: position)
        }
    }

    func delete(_ id: UUID) throws {
        do {
            try store.delete(id: id)
        } catch {
            failure = error.localizedDescription
            throw error
        }
        hook?.collectionDeleted(id)
        failure = nil
        reload()
    }

    /// Applies `edit`, stamps `updatedAt` and saves, only when the collection changed. A collection that is gone
    /// is an error too.
    private func change(_ id: UUID, _ edit: (inout MusicCollection) -> Void) throws {
        guard var current = collection(id) else { throw CollectionsModelError.missing }
        let before = current
        edit(&current)
        guard current != before else { return }
        current.updatedAt = max(now(), before.updatedAt.addingTimeInterval(0.001))
        try save(current)
    }

    private func save(_ collection: MusicCollection) throws {
        do {
            try store.upsert(collection)
        } catch {
            failure = error.localizedDescription
            throw error
        }
        failure = nil
        hook?.collectionChanged(collection.id)
        reload()
    }
}

/// What a wheel row and the player's captions show about a collection (#352).
struct CollectionSummary: Equatable, Identifiable {
    let id: UUID
    let name: String
    let tracks: Int
    let coverReleaseIDs: [UUID]
    /// Seconds in the tracks this phone can play; nil when none has a known length.
    let playableSeconds: Double?
}

/// The spoken state of the Play / Pause pill and of a queue row, from the same state as their glyphs.
enum CollectionPlayState {
    /// "Pause {detail}" only on the current row while it plays; otherwise "Play {detail}".
    static func rowLabel(_ detail: String, isCurrentRow: Bool, isPlaying: Bool) -> String {
        isCurrentRow && isPlaying ? Copy.Collections.pauseRow(detail) : Copy.Collections.playRow(detail)
    }

    /// "Playing" / "Paused" on the current row only; nothing on any other.
    static func rowValue(isCurrentRow: Bool, isPlaying: Bool) -> String {
        guard isCurrentRow else { return "" }
        return isPlaying ? Copy.Collections.playing : Copy.Collections.paused
    }
}

enum CollectionsModelError: Error {
    /// The collection an edit named is no longer there.
    case missing
}

extension AppContainer {
    /// A model over the app's stores, with edits queued for sync.
    func makeCollectionsModel() -> CollectionsModel {
        CollectionsModel(store: collections, library: library, hook: syncEngine, deviceName: { SyncDeviceName.current() })
    }
}
