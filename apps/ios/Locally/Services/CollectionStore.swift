import Foundation
import SwiftData

/// The on-device collections (`docs/plans/339-collections.md`). A protocol over the plain `MusicCollection`
/// struct, as `LibraryStore` is for releases, so the SwiftData model never leaks into logic or tests.
protocol CollectionStore {
    func all() throws -> [MusicCollection]
    func get(_ id: UUID) throws -> MusicCollection?
    func upsert(_ collection: MusicCollection) throws
    func delete(id: UUID) throws
}

/// SwiftData-backed `@Model` mirroring `MusicCollection`. A purely additive model: a new entity beside the
/// library's, every property with a default, nothing changed on the existing models, so SwiftData adds it to an
/// existing store by lightweight migration. The items are one JSON blob (an array of the wire items), so an item
/// of a kind this build doesn't know is stored and re-pushed as it came.
@Model
final class CollectionRecord {
    @Attribute(.unique) var id: UUID = UUID()
    var name: String = ""
    var itemsData: Data = Data()
    var origin: String = "ios"
    var originDevice: String = ""
    var createdAt: Date = Date(timeIntervalSince1970: 0)
    var updatedAt: Date = Date(timeIntervalSince1970: 0)

    init(id: UUID, name: String, itemsData: Data, origin: String, originDevice: String, createdAt: Date, updatedAt: Date) {
        self.id = id
        self.name = name
        self.itemsData = itemsData
        self.origin = origin
        self.originDevice = originDevice
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Production `CollectionStore` on the container's `mainContext`; every operation runs on the main thread, as in
/// `SwiftDataLibraryStore`.
final class SwiftDataCollectionStore: CollectionStore {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    func all() throws -> [MusicCollection] {
        try onMain {
            try context.fetch(FetchDescriptor<CollectionRecord>()).compactMap(Self.toCollection)
        }
    }

    func get(_ id: UUID) throws -> MusicCollection? {
        try onMain { try fetch(id).flatMap(Self.toCollection) }
    }

    func upsert(_ collection: MusicCollection) throws {
        try onMain {
            let data = try JSONEncoder().encode(collection.items)
            if let existing = try fetch(collection.id) {
                existing.name = collection.name
                existing.itemsData = data
                existing.origin = collection.origin
                existing.originDevice = collection.originDevice
                existing.createdAt = collection.createdAt
                existing.updatedAt = collection.updatedAt
            } else {
                context.insert(CollectionRecord(
                    id: collection.id, name: collection.name, itemsData: data, origin: collection.origin,
                    originDevice: collection.originDevice, createdAt: collection.createdAt, updatedAt: collection.updatedAt
                ))
            }
            try context.save()
        }
    }

    func delete(id: UUID) throws {
        try onMain {
            if let existing = try fetch(id) {
                context.delete(existing)
                try context.save()
            }
        }
    }

    private func fetch(_ id: UUID) throws -> CollectionRecord? {
        let predicate = #Predicate<CollectionRecord> { $0.id == id }
        return try context.fetch(FetchDescriptor(predicate: predicate)).first
    }

    private func onMain<T>(_ body: () throws -> T) rethrows -> T {
        if Thread.isMainThread { return try body() }
        return try DispatchQueue.main.sync(execute: body)
    }

    private static func toCollection(_ record: CollectionRecord) -> MusicCollection? {
        guard let items = try? JSONDecoder().decode([CollectionItem].self, from: record.itemsData) else { return nil }
        return MusicCollection(
            id: record.id, name: record.name, items: items, origin: record.origin,
            originDevice: record.originDevice, createdAt: record.createdAt, updatedAt: record.updatedAt
        )
    }
}
