import Foundation
import SwiftData

/// A single release's pending sync work: either "push my current state" or
/// "tell the server I deleted this". Kept as a plain struct (not the
/// `@Model` type itself) so `SyncEngine` and its tests never need to know
/// SwiftData exists.
struct SyncOutboxEntry: Equatable {
    enum Operation: String {
        case push
        case delete
    }

    let releaseId: UUID
    var operation: Operation
    var attempts: Int
    var lastError: String?
    var enqueuedAt: Date
}

/// A persistent queue of sync work that survives a process restart, so a
/// delete (or push) made while the app is being killed, or while offline,
/// is not lost the way a bare `Task { ... }` would lose it (#19).
///
/// Every conformer — `SwiftDataSyncOutbox` in production,
/// `InMemorySyncOutbox` in tests — must follow the same enqueue rules:
///
/// - At most one entry per release id.
/// - `enqueue(id, .delete)` replaces any existing entry for that id with a
///   fresh delete entry, regardless of what was queued before.
/// - `enqueue(id, .push)` is a no-op if an entry for that id already
///   exists, whether push or delete. A delete always wins over a push
///   enqueued before or after it; an existing push entry doesn't need a
///   second one, since it reads the release's latest state when it is
///   finally sent.
/// - `remove(id, ifOperation:)` removes the entry only when its *current*
///   operation still matches the one passed in. This is what lets a push
///   that finishes after the user deleted the release avoid wiping out the
///   delete that was queued in the meantime: the push removes itself only
///   `ifOperation: .push`, so a delete queued mid-flight survives.
protocol SyncOutbox: AnyObject {
    /// Every queued entry, oldest `enqueuedAt` first.
    func all() throws -> [SyncOutboxEntry]
    func enqueue(_ releaseId: UUID, _ operation: SyncOutboxEntry.Operation) throws
    /// Records a failed send attempt: `attempts += 1`, `lastError = error`.
    func recordFailure(_ releaseId: UUID, error: String) throws
    func remove(_ releaseId: UUID, ifOperation operation: SyncOutboxEntry.Operation) throws
    func removeAll() throws
}

/// SwiftData-backed `@Model` mirroring `SyncOutboxEntry`.
@Model
final class SyncOutboxRecord {
    @Attribute(.unique) var releaseId: UUID
    var operationRaw: String
    var attempts: Int
    var lastError: String?
    var enqueuedAt: Date

    init(releaseId: UUID, operationRaw: String, attempts: Int, lastError: String?, enqueuedAt: Date) {
        self.releaseId = releaseId
        self.operationRaw = operationRaw
        self.attempts = attempts
        self.lastError = lastError
        self.enqueuedAt = enqueuedAt
    }
}

/// Production `SyncOutbox`, backed by the container's `mainContext`. Hops to
/// the main thread the same way `SwiftDataLibraryStore` does, for the same
/// reason: `ModelContext` isn't thread-safe, and the engine's callers can
/// resume off the main actor after an `await`.
final class SwiftDataSyncOutbox: SyncOutbox {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    func all() throws -> [SyncOutboxEntry] {
        try onMain {
            let records = try context.fetch(FetchDescriptor<SyncOutboxRecord>(
                sortBy: [SortDescriptor(\.enqueuedAt, order: .forward)]
            ))
            return records.compactMap(Self.toEntry)
        }
    }

    func enqueue(_ releaseId: UUID, _ operation: SyncOutboxEntry.Operation) throws {
        try onMain {
            if let existing = try fetch(releaseId) {
                guard operation == .delete else { return }
                existing.operationRaw = operation.rawValue
                existing.attempts = 0
                existing.lastError = nil
                existing.enqueuedAt = Date()
            } else {
                let record = SyncOutboxRecord(
                    releaseId: releaseId,
                    operationRaw: operation.rawValue,
                    attempts: 0,
                    lastError: nil,
                    enqueuedAt: Date()
                )
                context.insert(record)
            }
            try context.save()
        }
    }

    func recordFailure(_ releaseId: UUID, error: String) throws {
        try onMain {
            guard let existing = try fetch(releaseId) else { return }
            existing.attempts += 1
            existing.lastError = error
            try context.save()
        }
    }

    func remove(_ releaseId: UUID, ifOperation operation: SyncOutboxEntry.Operation) throws {
        try onMain {
            guard let existing = try fetch(releaseId), existing.operationRaw == operation.rawValue else { return }
            context.delete(existing)
            try context.save()
        }
    }

    func removeAll() throws {
        try onMain {
            let records = try context.fetch(FetchDescriptor<SyncOutboxRecord>())
            for record in records { context.delete(record) }
            try context.save()
        }
    }

    private func fetch(_ releaseId: UUID) throws -> SyncOutboxRecord? {
        let predicate = #Predicate<SyncOutboxRecord> { $0.releaseId == releaseId }
        return try context.fetch(FetchDescriptor(predicate: predicate)).first
    }

    /// Runs `body` on the main thread; see `SwiftDataLibraryStore.onMain`.
    private func onMain<T>(_ body: () throws -> T) rethrows -> T {
        if Thread.isMainThread { return try body() }
        return try DispatchQueue.main.sync(execute: body)
    }

    private static func toEntry(_ record: SyncOutboxRecord) -> SyncOutboxEntry? {
        guard let operation = SyncOutboxEntry.Operation(rawValue: record.operationRaw) else { return nil }
        return SyncOutboxEntry(
            releaseId: record.releaseId,
            operation: operation,
            attempts: record.attempts,
            lastError: record.lastError,
            enqueuedAt: record.enqueuedAt
        )
    }
}
