import Foundation
import ImageIO
import UIKit

/// Covers decoded once, off the main thread, at the size they are shown (#423): a 56 pt Library row holds a 168 px
/// bitmap rather than the stored 1000 px cover. Callers run these from a detached task; nothing here touches the
/// main actor.
enum CoverThumbnail {
    /// `data` decoded with its orientation applied, its longer side at most `maxPixels` (nil keeps the full size),
    /// and fully decoded now so drawing it later costs nothing. Nil when `data` is not an image.
    static func image(from data: Data, maxPixels: CGFloat?) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        var options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        if let maxPixels { options[kCGImageSourceThumbnailMaxPixelSize] = maxPixels }
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }
}
