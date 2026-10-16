import ImageIO
import UIKit

/// One cover already in the library, offered in the cover sheet's "Recent covers" row.
/// It carries only the small thumbnail; the full cover is read from the `CoverStore`
/// by `id` when the user picks it.
struct RecentCover: Identifiable {
    /// The id of the release the cover belongs to (the `CoverStore` key).
    let id: UUID
    let title: String
    let artist: String
    let thumbnail: UIImage

    var accessibilityLabel: String {
        Copy.Import.recentCoverLabel(title: title, artist: artist)
    }
}

/// Finds the covers already used in the library, newest release first, so the cover
/// sheet can offer them again. Nothing new is stored: it reads `LibraryStore.recent(limit:)`
/// and the cover files themselves, and decodes small thumbnails off the main actor.
struct RecentCoversLoader {
    /// How many covers the row offers at most.
    static let limit = 12
    /// Longest side of a thumbnail in pixels: 72 pt at 3x, a little over the row's tile size.
    static let thumbnailPixels = 216

    let library: LibraryStore
    let coverStore: CoverStore

    /// Up to `limit` covers, most recently updated release first. Releases with no
    /// stored cover (or one that will not decode) are skipped and do not count towards
    /// the limit. A library that cannot be read gives an empty row, not an error.
    ///
    /// Only the newest `limit` releases are fetched at first (decoding every release's
    /// tracks on the main thread is what this avoids); the window doubles only when
    /// skipped releases left the row short. Cancelling the calling task stops the
    /// thumbnail loop early and returns what was found so far.
    @MainActor
    func load() async -> [RecentCover] {
        var covers: [RecentCover] = []
        var seen = Set<String>()
        var window = Self.limit
        var scanned = 0
        while covers.count < Self.limit, !Task.isCancelled {
            // The library read stays on the main actor: the SwiftData store is main-thread bound.
            guard let releases = try? library.recent(limit: window) else { break }
            let unscanned = Array(releases.dropFirst(scanned))
            scanned = releases.count
            let found = await Self.thumbnails(for: unscanned, room: Self.limit - covers.count, seen: seen, from: coverStore)
            covers += found.covers
            seen = found.seen
            if releases.count < window { break }
            window *= 2
        }
        return covers
    }

    /// Reads and decodes covers off the main actor, stopping once `room` are found or the
    /// calling task is cancelled. `Task.detached` does not inherit cancellation, so it is
    /// passed on by hand.
    ///
    /// Each cover file's bytes are hashed (SHA-256) and a cover whose hash is in `seen` is
    /// skipped, so the same picture shows once, as the newest release's. Skipped duplicates do
    /// not count towards `room`. The updated `seen` is returned so the next pass carries on from it.
    private static func thumbnails(
        for releases: [Release], room: Int, seen: Set<String>, from store: CoverStore
    ) async -> (covers: [RecentCover], seen: Set<String>) {
        let task = Task.detached(priority: .userInitiated) {
            var covers: [RecentCover] = []
            var seen = seen
            for release in releases {
                if covers.count == room || Task.isCancelled { break }
                guard let url = store.fileURL(release.id),
                      let bytes = try? Data(contentsOf: url, options: .mappedIfSafe) else { continue }
                let hash = bytes.sha256Hex
                guard !seen.contains(hash), let thumbnail = Self.thumbnail(at: url) else { continue }
                seen.insert(hash)
                covers.append(RecentCover(id: release.id, title: release.title, artist: release.artist, thumbnail: thumbnail))
            }
            return (covers, seen)
        }
        return await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
    }

    /// Decodes straight from the file to a small image, never the full-size bitmap and
    /// never the whole file as `Data`.
    static func thumbnail(at url: URL) -> UIImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: thumbnailPixels
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }
}
