import Foundation

// The phone's own play events (#397, plan 368 "Clients > iPhone"): one record per counted play with
// when its session started and how long it was heard. Counts stay in `PlayCountStore`; an event never
// changes a count. Events are pushed to `PUT /v1/plays/events` on reconcile (`spec/sync.md` "Play events").

/// One counted play. `startedAt` is epoch milliseconds, `day` the phone's local `YYYY-MM-DD` of it.
struct PlayEvent: Codable, Equatable, Identifiable {
    var id: UUID
    var releaseId: UUID
    var trackId: UUID
    var startedAt: Int64
    var day: String
    /// Audible time so far, 0 to 86,400,000.
    var listenedMs: Int
    /// The `listenedMs` the service last accepted; nil until the event was pushed.
    var pushedListenedMs: Int?

    /// Waiting to be sent: never pushed, or heard longer since.
    var isPending: Bool { pushedListenedMs.map { $0 < listenedMs } ?? true }
}

/// What the player and the sync engine use. Production: `FilePlayEventStore`.
@MainActor
protocol PlayEventStoring: AnyObject {
    /// Adds an event for a counted play whose session began at `startedAt`; returns its id.
    @discardableResult
    func append(releaseId: UUID, trackId: UUID, startedAt: Date) -> UUID
    /// Sets how long the event was heard so far. It never goes down.
    func updateListened(id: UUID, listenedMs: Int)
    /// Events not pushed, or heard longer than pushed, oldest first: at most `max`, only for releases in
    /// `liveReleases` (nil means all; the others stay pending until they are live on the service).
    func pending(liveReleases: Set<UUID>?, max: Int) -> [PlayEvent]
    /// Records that `sent` reached the service: only what was sent is marked, so listening that grew
    /// while the request was in flight stays pending.
    func markPushed(_ sent: [PlayEvent])
    /// Forgets what was pushed (sign-out, account deletion). The events stay.
    func clearPushedMarkers()
    /// All events, oldest first.
    var events: [PlayEvent] { get }
}

/// The wire form of one `PUT /v1/plays/events` event.
struct SyncPlayEvent: Codable, Equatable {
    var id: UUID
    var releaseId: UUID
    var trackId: UUID
    /// Always "locally": the phone only counts plays in its own player (#340).
    var source: String
    var startedAt: Int64
    var day: String
    var listenedMs: Int

    init(_ event: PlayEvent) {
        id = event.id
        releaseId = event.releaseId
        trackId = event.trackId
        source = SyncPlayCount.locallySource
        startedAt = event.startedAt
        day = event.day
        listenedMs = event.listenedMs
    }

    private enum CodingKeys: String, CodingKey { case id, releaseId, trackId, source, startedAt, day, listenedMs }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func uuid(_ key: CodingKeys) throws -> UUID {
            guard let value = UUID(uuidString: try c.decode(String.self, forKey: key)) else {
                throw DecodingError.dataCorruptedError(forKey: key, in: c, debugDescription: "Not a UUID")
            }
            return value
        }
        id = try uuid(.id)
        releaseId = try uuid(.releaseId)
        trackId = try uuid(.trackId)
        source = try c.decode(String.self, forKey: .source)
        startedAt = try c.decode(Int64.self, forKey: .startedAt)
        day = try c.decode(String.self, forKey: .day)
        listenedMs = try c.decode(Int.self, forKey: .listenedMs)
    }

    /// Ids go out lowercase, as the service writes them; times are JSON integers.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id.uuidString.lowercased(), forKey: .id)
        try c.encode(releaseId.uuidString.lowercased(), forKey: .releaseId)
        try c.encode(trackId.uuidString.lowercased(), forKey: .trackId)
        try c.encode(source, forKey: .source)
        try c.encode(startedAt, forKey: .startedAt)
        try c.encode(day, forKey: .day)
        try c.encode(listenedMs, forKey: .listenedMs)
    }
}

/// The body of `PUT /v1/plays/events`.
struct SyncPlayEventsBody: Codable, Equatable {
    var events: [SyncPlayEvent]
}

/// `{ accepted, ignored }` of `PUT /v1/plays/events`.
struct SyncPlayEventsPutResult: Decodable, Equatable {
    var accepted: Int
    var ignored: Int
}

/// `play-events.json` in Application Support, written atomically on every change.
@MainActor
final class FilePlayEventStore: PlayEventStoring {
    static let keepDays = 400
    static let maxEvents = 20_000
    static let maxListenedMs = 86_400_000

    private struct File: Codable {
        var version = 1
        var events: [PlayEvent] = []
    }

    private let url: URL
    private let calendar: Calendar
    private let now: () -> Date
    private var stored: [PlayEvent] = []
    private var indexById: [UUID: Int] = [:]

    /// `url` is the `play-events.json` file; `now` is the clock the 400-day prune reads.
    init(url: URL, calendar: Calendar = .current, now: @escaping () -> Date = Date.init) {
        self.url = url
        self.calendar = calendar
        self.now = now
        if let data = try? Data(contentsOf: url), let file = try? JSONDecoder().decode(File.self, from: data) {
            stored = file.events
            reindex()
        }
    }

    static func standard() -> FilePlayEventStore {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return FilePlayEventStore(url: base.appendingPathComponent("play-events.json"))
    }

    var events: [PlayEvent] { stored }

    // MARK: PlayEventStoring

    @discardableResult
    func append(releaseId: UUID, trackId: UUID, startedAt: Date) -> UUID {
        let event = PlayEvent(
            id: UUID(), releaseId: releaseId, trackId: trackId,
            startedAt: Int64((startedAt.timeIntervalSince1970 * 1000).rounded()),
            day: PlayPeriods.localDayString(startedAt, calendar: calendar), listenedMs: 0, pushedListenedMs: nil
        )
        stored.append(event)
        trim()
        save()
        return event.id
    }

    func updateListened(id: UUID, listenedMs: Int) {
        guard let i = indexById[id] else { return }
        let value = min(Self.maxListenedMs, max(0, listenedMs))
        guard value > stored[i].listenedMs else { return }
        stored[i].listenedMs = value
        save()
    }

    func pending(liveReleases: Set<UUID>?, max: Int) -> [PlayEvent] {
        let ahead = stored.filter { event in
            if let liveReleases, !liveReleases.contains(event.releaseId) { return false }
            return event.isPending
        }
        return Array(ahead.sorted { ($0.startedAt, $0.id.uuidString) < ($1.startedAt, $1.id.uuidString) }.prefix(Swift.max(0, max)))
    }

    func markPushed(_ sent: [PlayEvent]) {
        for item in sent {
            guard let i = indexById[item.id] else { continue }
            stored[i].pushedListenedMs = Swift.max(stored[i].pushedListenedMs ?? 0, item.listenedMs)
        }
        save()
    }

    func clearPushedMarkers() {
        for i in stored.indices { stored[i].pushedListenedMs = nil }
        save()
    }

    // MARK: Cap, prune and disk

    private func reindex() {
        indexById = [:]
        for (i, event) in stored.enumerated() { indexById[event.id] = i }
    }

    /// Drops events past 400 days, then keeps at most 20,000: the oldest pushed events go first, the oldest
    /// unpushed ones only when nothing pushed is left to drop.
    private func trim() {
        let cutoff = Int64(((now().timeIntervalSince1970) - Double(Self.keepDays) * 86_400) * 1000)
        stored.removeAll { $0.startedAt < cutoff }
        var over = stored.count - Self.maxEvents
        if over > 0 {
            let pushed = stored.filter { $0.pushedListenedMs != nil }.sorted { $0.startedAt < $1.startedAt }
            let drop = Set(pushed.prefix(over).map(\.id))
            stored.removeAll { drop.contains($0.id) }
            over = stored.count - Self.maxEvents
        }
        if over > 0 {
            let drop = Set(stored.sorted { $0.startedAt < $1.startedAt }.prefix(over).map(\.id))
            stored.removeAll { drop.contains($0.id) }
        }
        reindex()
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(File(events: stored)) else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }
}
