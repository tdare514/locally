import UIKit

/// Crops a picked cover image to the rect the user framed in
/// `CoverCropView` and rescales it for embedding: at most `maxSide` pixels
/// per side, JPEG at quality 0.9 unless the source was a PNG with an alpha
/// channel (JPEG has no transparency, so that case is kept as PNG).
enum CoverImageProcessor {
    static func crop(_ data: Data, to rect: CGRect, maxSide: CGFloat = 1500) -> Data? {
        guard let image = UIImage(data: data) else { return nil }

        // `UIImage.size`/`.draw(in:)` already account for the source's EXIF
        // orientation, so drawing through them (rather than the raw
        // `cgImage`) yields an upright result without any extra transform.
        let imageSize = image.size
        let cropRect = CropGeometry.clamp(rect: rect, in: imageSize)
        guard cropRect.width > 0, cropRect.height > 0 else { return nil }

        let outputSize = renderedSize(for: cropRect.size, maxSide: maxSide)
        guard outputSize.width >= 1, outputSize.height >= 1 else { return nil }

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(size: outputSize, format: format)
        let rendered = renderer.image { _ in
            let scaleX = outputSize.width / cropRect.width
            let scaleY = outputSize.height / cropRect.height
            let drawOrigin = CGPoint(x: -cropRect.minX * scaleX, y: -cropRect.minY * scaleY)
            let drawSize = CGSize(width: imageSize.width * scaleX, height: imageSize.height * scaleY)
            image.draw(in: CGRect(origin: drawOrigin, size: drawSize))
        }

        if isPNGWithAlpha(source: data, image: image) {
            return rendered.pngData()
        }
        return rendered.jpegData(compressionQuality: 0.9)
    }

    /// Shrinks `size` so its longest side is at most `maxSide`, preserving
    /// aspect ratio. Leaves `size` untouched when it's already small enough.
    private static func renderedSize(for size: CGSize, maxSide: CGFloat) -> CGSize {
        let longest = max(size.width, size.height)
        guard longest > maxSide, longest > 0 else { return size }
        let scale = maxSide / longest
        return CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
    }

    /// PNG's signature starts `0x89 0x50`; anything else is treated as a
    /// format JPEG can represent losslessly enough (transparency aside).
    private static func isPNGWithAlpha(source: Data, image: UIImage) -> Bool {
        guard source.count >= 2, source[source.startIndex] == 0x89, source[source.startIndex + 1] == 0x50 else {
            return false
        }
        guard let alphaInfo = image.cgImage?.alphaInfo else { return false }
        switch alphaInfo {
        case .none, .noneSkipFirst, .noneSkipLast:
            return false
        default:
            return true
        }
    }
}
