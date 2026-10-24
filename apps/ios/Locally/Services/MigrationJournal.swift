import Foundation

/// Where the brand-folder migration records a move before doing it (#335): track id to the
/// destination's path relative to Spotify's folder, such as "Locally/one (2).mp3". A move is only
/// safe to start once its entry is durably stored, so `save` must not return before it is.
protocol MigrationJournalStore {
    /// An absent journal is empty; any other read or decode failure throws, because treating an
    /// unreadable journal as empty would lose track of a move that was already made.
    func load() throws -> [String: String]
    func save(_ journal: [String: String]) throws
    func clear()
}

/// The production journal: a small JSON file in Application Support, written atomically and then
/// fsynced, so a crash right after the move cannot lose the entry (UserDefaults flushes lazily).
struct FileMigrationJournalStore: MigrationJournalStore {
    let url: URL
    /// Entries an earlier build left under the UserDefaults key are folded into the file once.
    let legacyDefaults: UserDefaults?
    let legacyKey: String

    init(url: URL = FileMigrationJournalStore.defaultURL,
         legacyDefaults: UserDefaults? = .standard,
         legacyKey: String = ReleaseCoordinator.brandFolderMigrationJournalKey) {
        self.url = url
        self.legacyDefaults = legacyDefaults
        self.legacyKey = legacyKey
    }

    static var defaultURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("brand-folder-journal.json")
    }

    func load() throws -> [String: String] {
        var journal: [String: String] = [:]
        do {
            let data = try Data(contentsOf: url)
            journal = try JSONDecoder().decode([String: String].self, from: data)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile {
            // No journal yet: nothing is in flight.
        }
        if let legacyDefaults,
           let old = legacyDefaults.dictionary(forKey: legacyKey) as? [String: String] {
            journal.merge(old) { current, _ in current }
            if (try? save(journal)) != nil { legacyDefaults.removeObject(forKey: legacyKey) }
        }
        return journal
    }

    func save(_ journal: [String: String]) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(journal).write(to: url, options: .atomic)
        let handle = try FileHandle(forUpdating: url)
        defer { try? handle.close() }
        try handle.synchronize()
    }

    func clear() {
        try? FileManager.default.removeItem(at: url)
        legacyDefaults?.removeObject(forKey: legacyKey)
    }
}
