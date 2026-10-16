import SwiftUI
import UIKit
import ImageIO

/// Covers for the Stats page: read off the main thread, shrunk to a size the fan's biggest sleeve
/// needs, and kept in memory so scrolling a long list does not read the same file twice. The
/// loader turns a release id into its cover bytes (production: `CoverStore.load`; the component
/// gallery supplies drawn images).
final class StatsCoverCache: @unchecked Sendable {
    typealias Loader = @Sendable (UUID) -> Data?

    private let loader: Loader
    private let cache = NSCache<NSUUID, UIImage>()
    private static let maxPixels: CGFloat = 420

    init(loader: @escaping Loader) {
        self.loader = loader
        cache.countLimit = 160
    }

    func cached(_ id: UUID) -> UIImage? {
        cache.object(forKey: id as NSUUID)
    }

    func image(for id: UUID) async -> UIImage? {
        if let hit = cached(id) { return hit }
        let loader = self.loader
        let box = await Task.detached(priority: .userInitiated) { () -> ImageBox in
            guard let data = loader(id) else { return ImageBox(image: nil) }
            return ImageBox(image: Self.thumbnail(data))
        }.value
        if let image = box.image { cache.setObject(image, forKey: id as NSUUID) }
        return box.image
    }

    /// The raw cover bytes, for the backdrop's palette.
    func data(for id: UUID) async -> Data? {
        let loader = self.loader
        return await Task.detached(priority: .utility) { loader(id) }.value
    }

    private struct ImageBox: @unchecked Sendable {
        let image: UIImage?
    }

    private static func thumbnail(_ data: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// A cover filling its frame, loaded by release id; a quiet tile with a music note when there is
/// none (the Mac's placeholder). `round` crops it to a circle, for artists.
struct StatsCoverView: View {
    let owner: UUID?
    let cache: StatsCoverCache
    var round = false
    var cornerRadius: CGFloat = 6

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Theme.elevated
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "music.note")
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .clipShape(round ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)))
        .accessibilityHidden(true)
        .task(id: owner) {
            guard let owner else { image = nil; return }
            image = cache.cached(owner)
            if image == nil { image = await cache.image(for: owner) }
        }
    }
}
