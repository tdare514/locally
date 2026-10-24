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
    private(set) var releases: [UUID: Release] = [:]
    /// False until the local store has been read once, so the screen can show placeholders for that moment.
    private(set) var isLoaded = false
    private(set) var failure: String?

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
            failure = nil
        } catch {
            failure = error.localizedDescription
        }
        isLoaded = true
    }

    func collection(_ id: UUID) -> MusicCollection? { collections.first { $0.id == id } }

    /// The tracks a collection shows, with those this phone doesn't hold marked.
    func rows(of collection: MusicCollection) -> [CollectionQueue.Row] {
        CollectionQueue.rows(collection.items, releases: releases)
    }

    /// What Play will queue (wired to the player once #344 lands).
    func playQueue(of collection: MusicCollection) -> [(releaseID: UUID, trackID: UUID)] {
        CollectionQueue.items(collection.items, releases: releases)
    }

    func trackCount(of collection: MusicCollection) -> Int { rows(of: collection).count }

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

    /// Makes a collection named `name` holding `items`; `nil` for a name that isn't valid.
    @discardableResult
    func create(name: String, items: [CollectionItem] = []) -> UUID? {
        guard let name = MusicCollection.validName(name) else { return nil }
        let stamp = now()
        let made = MusicCollection(
            id: UUID(), name: name, items: CollectionEdit.appended([], items).items, origin: "ios",
            originDevice: deviceName(), createdAt: stamp, updatedAt: stamp
        )
        return save(made) ? made.id : nil
    }

    @discardableResult
    func rename(_ id: UUID, to name: String) -> Bool {
        guard let name = MusicCollection.validName(name) else { return false }
        return change(id) { $0.name = name }
    }

    /// Adds `items`; returns how many went in (an item already there is skipped).
    @discardableResult
    func add(_ items: [CollectionItem], to id: UUID) -> Int {
        var added = 0
        change(id) { collection in
            let result = CollectionEdit.appended(collection.items, items)
            collection.items = result.items
            added = result.added
        }
        return added
    }

    func move(_ id: UUID, from source: IndexSet, to destination: Int) {
        change(id) { collection in
            collection.items = CollectionEdit.moved(collection.items, visible: CollectionEdit.visible(collection.items, releases: releases), from: source, to: destination)
        }
    }

    /// VoiceOver's "Move up" / "Move down" (`step` -1 / +1) on the visible entry at `position`.
    func move(_ id: UUID, position: Int, by step: Int) {
        change(id) { collection in
            collection.items = CollectionEdit.moved(collection.items, visible: CollectionEdit.visible(collection.items, releases: releases), position: position, by: step)
        }
    }

    func remove(_ id: UUID, position: Int) {
        change(id) { collection in
            collection.items = CollectionEdit.removed(collection.items, visible: CollectionEdit.visible(collection.items, releases: releases), position: position)
        }
    }

    func delete(_ id: UUID) {
        do {
            try store.delete(id: id)
            hook?.collectionDeleted(id)
            failure = nil
        } catch {
            failure = error.localizedDescription
        }
        reload()
    }

    /// Applies `edit`, stamps `updatedAt` and saves, only when the collection changed.
    @discardableResult
    private func change(_ id: UUID, _ edit: (inout MusicCollection) -> Void) -> Bool {
        guard var current = collection(id) else { return false }
        let before = current
        edit(&current)
        guard current != before else { return true }
        current.updatedAt = max(now(), before.updatedAt.addingTimeInterval(0.001))
        return save(current)
    }

    private func save(_ collection: MusicCollection) -> Bool {
        do {
            try store.upsert(collection)
            hook?.collectionChanged(collection.id)
            reload()
            return true
        } catch {
            failure = error.localizedDescription
            return false
        }
    }
}

extension AppContainer {
    /// A model over the app's stores, with edits queued for sync.
    func makeCollectionsModel() -> CollectionsModel {
        CollectionsModel(store: collections, library: library, hook: syncEngine, deviceName: { SyncDeviceName.current() })
    }
}
