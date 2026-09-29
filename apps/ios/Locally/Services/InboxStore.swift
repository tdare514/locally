import Foundation

/// One audio file waiting in the shared Inbox, written there by the
/// "Send to Locally" share extension via `InboxFileNaming`.
struct InboxFile: Identifiable, Hashable {
    var id: String { url.path }
    var url: URL
    /// The name the user originally shared (before `InboxFileNaming` added
    /// the uuid prefix), used to prefill the import flow the same way a
    /// picked file's name would.
    var originalName: String
    var createdAt: Date
}

/// Reads and removes files the share extension staged into the App Group's
/// shared container, so `ImportView` can offer to import them without the
/// extension ever needing to open the main app (not possible from a share
/// extension).
protocol InboxStore {
    /// Every audio file currently waiting, oldest first.
    func pendingFiles() -> [InboxFile]
    /// Removes one file once it has been staged into the app's own storage
    /// (see `FileImporter.stage`), so it isn't offered again.
    func remove(_ file: InboxFile) throws
    /// Deletes Inbox files that can never be imported or were left behind
    /// (see `AppGroupInboxStore.sweepOrphans`). Returns how many were removed.
    @discardableResult
    func sweepOrphans() -> Int
}

/// Production `InboxStore`. Two places count as "waiting":
/// - the `Inbox` folder inside the App Group container, written by the
///   "Send to Locally" share extension (names carry a uuid prefix);
/// - the app's own Documents folder, which iOS shows in Files as
///   "On My iPhone > Locally". People drop audio there with "Save to Files"
///   or by copying in Files, and expect the app to notice.
final class AppGroupInboxStore: InboxStore {
    static let orphanGracePeriod: TimeInterval = 60 * 60

    private let inboxDirectory: URL?
    private let documentsDirectory: URL?

    /// Resolves the Inbox folder via the App Group container and the app's
    /// Documents folder via `FileManager`.
    init(appGroupIdentifier: String = AppGroup.identifier) {
        self.inboxDirectory = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)?
            .appendingPathComponent("Inbox", isDirectory: true)
        self.documentsDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    }

    /// Testing seam: point directly at directories instead of resolving them
    /// through an App Group container (unavailable to a plain unit test).
    init(directory: URL, documentsDirectory: URL? = nil) {
        self.inboxDirectory = directory
        self.documentsDirectory = documentsDirectory
    }

    func pendingFiles() -> [InboxFile] {
        var files: [InboxFile] = []
        if let inboxDirectory {
            files += Self.audioFiles(in: inboxDirectory) { name in
                InboxFileNaming.originalName(fromInboxFileName: name)
            }
        }
        if let documentsDirectory {
            files += Self.audioFiles(in: documentsDirectory) { name in name }
        }
        return files.sorted { $0.createdAt < $1.createdAt }
    }

    func remove(_ file: InboxFile) throws {
        guard FileManager.default.fileExists(atPath: file.url.path) else { return }
        try FileManager.default.removeItem(at: file.url)
    }

    func sweepOrphans() -> Int {
        guard let inboxDirectory, FileManager.default.fileExists(atPath: inboxDirectory.path) else {
            return 0
        }
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: inboxDirectory.path) else { return 0 }
        let now = Date()
        var deleted = 0
        for name in names {
            guard !name.hasPrefix(".") else { continue }
            let url = inboxDirectory.appendingPathComponent(name)
            var isDirectory: ObjCBool = false
            guard fm.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
                continue
            }
            let attributes = try? fm.attributesOfItem(atPath: url.path)
            let modificationDate = attributes?[.modificationDate] as? Date
            let creationDate = attributes?[.creationDate] as? Date
            let referenceDate = modificationDate ?? creationDate
            let age: TimeInterval
            if let referenceDate {
                age = now.timeIntervalSince(referenceDate)
            } else {
                age = 0
            }
            let size = (attributes?[.size] as? NSNumber)?.intValue ?? -1

            let shouldDelete: Bool
            if !SupportedAudio.isSupported(fileName: name) {
                shouldDelete = true
            } else if InboxFileNaming.originalName(fromInboxFileName: name) == nil {
                shouldDelete = age > Self.orphanGracePeriod
            } else if size == 0 {
                shouldDelete = age > Self.orphanGracePeriod
            } else {
                shouldDelete = false
            }

            guard shouldDelete else { continue }
            try? fm.removeItem(at: url)
            if !fm.fileExists(atPath: url.path) {
                deleted += 1
            }
        }
        return deleted
    }

    /// Top-level audio files in `directory`, skipping hidden files and any
    /// name `originalName` rejects (returns nil for).
    private static func audioFiles(in directory: URL, originalName: (String) -> String?) -> [InboxFile] {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: directory.path) else { return [] }
        var files: [InboxFile] = []
        for name in names {
            guard !name.hasPrefix("."), let original = originalName(name) else { continue }
            let url = directory.appendingPathComponent(name)
            var isDirectory: ObjCBool = false
            guard fm.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue else { continue }
            guard SupportedAudio.isSupported(fileName: name) else { continue }
            let attributes = try? fm.attributesOfItem(atPath: url.path)
            let createdAt = (attributes?[.creationDate] as? Date) ?? .distantPast
            files.append(InboxFile(url: url, originalName: original, createdAt: createdAt))
        }
        return files
    }
}
