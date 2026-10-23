import Foundation

/// The covers of shares waiting in the tray (#183), kept as `share-covers/<shareId>.<ext>` so each is
/// downloaded once, never once per view: every download counts against the sender. The share id is
/// validated as a UUID and every path is checked to be inside the directory.
final class ShareCoverCache {
    let directory: URL
    private let layout = ReleaseLayout()

    init(directory: URL) {
        self.directory = directory
    }

    /// `Application Support/share-covers`.
    static func standard() -> ShareCoverCache {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return ShareCoverCache(directory: base.appendingPathComponent("share-covers", isDirectory: true))
    }

    private static let extensions: Set<String> = ["jpg", "jpeg", "png"]

    /// Where `shareId`'s cover (named `coverName` in its snapshot) lives, or nil when the id is not a UUID,
    /// the name has no image extension or the path would leave the directory.
    func fileURL(shareId: String, coverName: String) -> URL? {
        guard let uuid = UUID(uuidString: shareId) else { return nil }
        let ext = (coverName as NSString).pathExtension.lowercased()
        guard Self.extensions.contains(ext) else { return nil }
        let url = directory.appendingPathComponent("\(uuid.uuidString.lowercased()).\(ext)")
        guard layout.isInside(folder: directory, path: url.path) else { return nil }
        return url
    }

    /// The cached bytes for a share, or nil when none was downloaded.
    func data(shareId: String, coverName: String) -> Data? {
        guard let url = fileURL(shareId: shareId, coverName: coverName) else { return nil }
        return try? Data(contentsOf: url)
    }

    func prepareDirectory() {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// Deletes every cached cover whose share is not in `shareIds`.
    func prune(keeping shareIds: Set<String>) {
        let keep = Set(shareIds.compactMap { UUID(uuidString: $0)?.uuidString.lowercased() })
        for url in files() where !keep.contains(url.deletingPathExtension().lastPathComponent) {
            removeInside(url)
        }
    }

    func removeAll() {
        for url in files() { removeInside(url) }
    }

    private func files() -> [URL] {
        (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    }

    private func removeInside(_ url: URL) {
        guard layout.isInside(folder: directory, path: url.path) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
