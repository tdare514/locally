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
/// sheet can offer them again. Nothing new is stored: it reads `LibraryStore` and
/// `CoverStore.load(_:)` and decodes small thumbnails off the main actor.
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
    @MainActor
    func load() async -> [RecentCover] {
        // The library read stays on the main actor: the SwiftData store is main-thread bound.
        guard let releases = try? library.all() else { return [] }
        let newestFirst = releases.sorted {
            $0.updatedAt != $1.updatedAt ? $0.updatedAt > $1.updatedAt : $0.id.uuidString < $1.id.uuidString
        }
        let store = coverStore
        return await Task.detached(priority: .userInitiated) {
            var covers: [RecentCover] = []
            for release in newestFirst {
                if covers.count == Self.limit { break }
                guard let data = store.load(release.id), let thumbnail = Self.thumbnail(from: data) else { continue }
                covers.append(RecentCover(id: release.id, title: release.title, artist: release.artist, thumbnail: thumbnail))
            }
            return covers
        }.value
    }

    /// Decodes straight to a small image, never the full-size bitmap.
    static func thumbnail(from data: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
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
