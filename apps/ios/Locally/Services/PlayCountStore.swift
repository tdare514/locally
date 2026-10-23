import Foundation

// The phone's own play counts (#337, plan 324 "Counting a play"): absolute per-track counts plus
// per-day buckets, kept 400 days, mirroring the Mac's `plays.json`. They are pushed to
// `PUT /v1/plays` on reconcile. Sign-out clears only the pushed markers, never the counts.

/// What the player and the sync engine use. Production: `FilePlayCountStore`.
@MainActor
protocol PlayCountStoring: AnyObject {
    /// Adds one play of the track on the phone's local calendar day of `date`.
    func increment(releaseId: UUID, trackId: UUID, at date: Date)
    /// The counts and days ahead of what was pushed: at most `maxEntries` entries and `maxDayRows`
    /// day rows in all, in a stable order. Empty when everything is pushed.
    func pending(maxEntries: Int, maxDayRows: Int) -> [SyncPlayCount]
    /// Records that `sent` reached the service: only what was sent is marked, so a play counted
    /// while the request was in flight stays pending.
    func markPushed(_ sent: [SyncPlayCount])
    /// Forgets what was pushed (sign-out, account deletion). The counts stay.
    func clearPushedMarkers()
    func count(releaseId: UUID, trackId: UUID) -> Int
}

/// The wire form of one `PUT /v1/plays` entry (`spec/sync.md` "Play counts").
struct SyncPlayCount: Codable, Equatable {
    var releaseId: UUID
    var trackId: UUID
    var count: Int
    /// Always "locally": the phone only counts plays in its own player (#340).
    var source: String
    var days: [SyncPlayDay]?

    static let locallySource = "locally"

    init(releaseId: UUID, trackId: UUID, count: Int, source: String = SyncPlayCount.locallySource, days: [SyncPlayDay]? = nil) {
        self.releaseId = releaseId
        self.trackId = trackId
        self.count = count
        self.source = source
        self.days = days
    }

    private enum CodingKeys: String, CodingKey { case releaseId, trackId, count, source, days }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func id(_ key: CodingKeys) throws -> UUID {
            let text = try c.decode(String.self, forKey: key)
            guard let uuid = UUID(uuidString: text) else {
                throw DecodingError.dataCorruptedError(forKey: key, in: c, debugDescription: "Not a UUID")
            }
            return uuid
        }
        releaseId = try id(.releaseId)
        trackId = try id(.trackId)
        count = try c.decode(Int.self, forKey: .count)
        source = try c.decode(String.self, forKey: .source)
        days = try c.decodeIfPresent([SyncPlayDay].self, forKey: .days)
    }

    /// Ids go out lowercase, as the service writes them (`UUID` would encode uppercase).
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(releaseId.uuidString.lowercased(), forKey: .releaseId)
        try c.encode(trackId.uuidString.lowercased(), forKey: .trackId)
        try c.encode(count, forKey: .count)
        try c.encode(source, forKey: .source)
        try c.encodeIfPresent(days, forKey: .days)
    }
}

/// This device's absolute count for one track on one day (`YYYY-MM-DD`, the phone's calendar).
struct SyncPlayDay: Codable, Equatable {
    var day: String
    var count: Int
}

/// The body of `PUT /v1/plays`.
struct SyncPlayCountsBody: Codable, Equatable {
    var counts: [SyncPlayCount]
}

/// `{ accepted, ignored }`.
struct SyncPlaysPutResult: Decodable, Equatable {
    var accepted: Int
    var ignored: Int
}

/// `plays.json` in Application Support, written atomically on every change.
@MainActor
final class FilePlayCountStore: PlayCountStoring {
    static let keepDays = 400

    private struct Entry: Codable, Equatable {
        var releaseId: UUID
        var trackId: UUID
        var count = 0
        var days: [String: Int] = [:]
        var pushedCount = 0
        var pushedDays: [String: Int] = [:]
    }

    private struct File: Codable {
        var version = 1
        var tracks: [Entry] = []
    }

    private struct Key: Hashable {
        var releaseId: UUID
        var trackId: UUID
    }

    private let url: URL
    private let calendar: Calendar
    private var entries: [Key: Entry] = [:]

    /// `url` is the `plays.json` file.
    init(url: URL, calendar: Calendar = .current) {
        self.url = url
        self.calendar = calendar
        if let data = try? Data(contentsOf: url), let file = try? JSONDecoder().decode(File.self, from: data) {
            for entry in file.tracks { entries[Key(releaseId: entry.releaseId, trackId: entry.trackId)] = entry }
        }
    }

    static func standard() -> FilePlayCountStore {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return FilePlayCountStore(url: base.appendingPathComponent("plays.json"))
    }

    // MARK: PlayCountStoring

    func increment(releaseId: UUID, trackId: UUID, at date: Date) {
        let key = Key(releaseId: releaseId, trackId: trackId)
        var entry = entries[key] ?? Entry(releaseId: releaseId, trackId: trackId)
        entry.count += 1
        entry.days[dayString(date), default: 0] += 1
        entries[key] = entry
        prune(today: date)
        save()
    }

    func count(releaseId: UUID, trackId: UUID) -> Int {
        entries[Key(releaseId: releaseId, trackId: trackId)]?.count ?? 0
    }

    func pending(maxEntries: Int, maxDayRows: Int) -> [SyncPlayCount] {
        var result: [SyncPlayCount] = []
        var rows = 0
        let ordered = entries.values.sorted { ($0.releaseId.uuidString, $0.trackId.uuidString) < ($1.releaseId.uuidString, $1.trackId.uuidString) }
        for entry in ordered {
            let ahead = entry.days.filter { $0.value > (entry.pushedDays[$0.key] ?? 0) }
                .map { SyncPlayDay(day: $0.key, count: $0.value) }
                .sorted { $0.day < $1.day }
            guard entry.count > entry.pushedCount || !ahead.isEmpty else { continue }
            if result.count >= maxEntries { break }
            // A request holds at most `maxDayRows` day rows; the first entry always goes.
            if !result.isEmpty, rows + ahead.count > maxDayRows { break }
            rows += ahead.count
            result.append(SyncPlayCount(releaseId: entry.releaseId, trackId: entry.trackId, count: entry.count, days: ahead.isEmpty ? nil : ahead))
        }
        return result
    }

    func markPushed(_ sent: [SyncPlayCount]) {
        for item in sent {
            let key = Key(releaseId: item.releaseId, trackId: item.trackId)
            guard var entry = entries[key] else { continue }
            entry.pushedCount = max(entry.pushedCount, item.count)
            for day in item.days ?? [] { entry.pushedDays[day.day] = max(entry.pushedDays[day.day] ?? 0, day.count) }
            entries[key] = entry
        }
        save()
    }

    func clearPushedMarkers() {
        for key in Array(entries.keys) {
            entries[key]?.pushedCount = 0
            entries[key]?.pushedDays = [:]
        }
        save()
    }

    // MARK: Days and disk

    /// The phone's local calendar date as `YYYY-MM-DD`.
    func dayString(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Drops day buckets (and their markers) older than the 400 days ending today.
    private func prune(today: Date) {
        guard let first = calendar.date(byAdding: .day, value: -(Self.keepDays - 1), to: today) else { return }
        let cutoff = dayString(first)
        for key in Array(entries.keys) {
            guard var entry = entries[key] else { continue }
            entry.days = entry.days.filter { $0.key >= cutoff }
            entry.pushedDays = entry.pushedDays.filter { $0.key >= cutoff }
            entries[key] = entry
        }
    }

    private func save() {
        let file = File(tracks: entries.values.sorted { ($0.releaseId.uuidString, $0.trackId.uuidString) < ($1.releaseId.uuidString, $1.trackId.uuidString) })
        guard let data = try? JSONEncoder().encode(file) else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }
}
