import Foundation
import UniformTypeIdentifiers

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
}

/// Production `InboxStore`: the `Inbox` folder inside the App Group
/// container both this app and `LocallyShare` can reach.
final class AppGroupInboxStore: InboxStore {
    private let inboxDirectory: URL?

    /// Resolves the Inbox folder via the App Group container.
    init(appGroupIdentifier: String = AppGroup.identifier) {
        self.inboxDirectory = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)?
            .appendingPathComponent("Inbox", isDirectory: true)
    }

    /// Testing seam: point directly at a directory instead of resolving one
    /// through an App Group container (unavailable to a plain unit test).
    init(directory: URL) {
        self.inboxDirectory = directory
    }

    func pendingFiles() -> [InboxFile] {
        guard let inboxDirectory else { return [] }
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: inboxDirectory.path) else { return [] }

        var files: [InboxFile] = []
        for name in names {
            guard !name.hasPrefix("."),
                  let originalName = InboxFileNaming.originalName(fromInboxFileName: name) else { continue }

            let url = inboxDirectory.appendingPathComponent(name)
            let type = UTType(filenameExtension: url.pathExtension)
            guard let type, type.conforms(to: .audio) else { continue }

            let attributes = try? fm.attributesOfItem(atPath: url.path)
            let createdAt = (attributes?[.creationDate] as? Date) ?? .distantPast
            files.append(InboxFile(url: url, originalName: originalName, createdAt: createdAt))
        }
        return files.sorted { $0.createdAt < $1.createdAt }
    }

    func remove(_ file: InboxFile) throws {
        guard FileManager.default.fileExists(atPath: file.url.path) else { return }
        try FileManager.default.removeItem(at: file.url)
    }
}
