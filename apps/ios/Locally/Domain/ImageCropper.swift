import CoreGraphics

/// The aspect ratio offered when framing a cover image. Spotify always
/// shows local-file artwork as a square, so `.square` is the default;
/// `.original` is offered for users who want the untouched image.
enum CoverRatio: CaseIterable {
    case square
    case original

    var displayName: String {
        switch self {
        case .square: return Copy.Cover.square
        case .original: return Copy.Cover.original
        }
    }
}

/// Pure geometry for the cover crop UI: everything here works in image
/// space (pixels/points of the source image, not the screen), so it can be
/// unit tested without UIKit and reused unchanged by `CoverCropView`.
enum CropGeometry {
    /// A crop rect is never allowed to shrink below this fraction of the
    /// image's shorter side, so pinch-zoom can't collapse it to nothing.
    private static let minSideFraction: CGFloat = 0.1

    /// The largest centred rect of `ratio`'s aspect that fits inside
    /// `imageSize`. For `.square` that's a centred square sized to the
    /// image's shorter side; for `.original` it's the whole image.
    static func initialRect(imageSize: CGSize, ratio: CoverRatio) -> CGRect {
        switch ratio {
        case .original:
            return CGRect(origin: .zero, size: imageSize)
        case .square:
            let side = min(imageSize.width, imageSize.height)
            let x = (imageSize.width - side) / 2
            let y = (imageSize.height - side) / 2
            return CGRect(x: x, y: y, width: side, height: side)
        }
    }

    /// Keeps `rect` fully inside `imageSize`. If `rect` is larger than the
    /// image in either dimension it is shrunk first, preserving its aspect
    /// ratio, then repositioned so every edge lies within bounds.
    static func clamp(rect: CGRect, in imageSize: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, rect.width > 0, rect.height > 0 else {
            return CGRect(origin: .zero, size: imageSize)
        }

        var width = rect.width
        var height = rect.height
        if width > imageSize.width || height > imageSize.height {
            let shrink = min(imageSize.width / width, imageSize.height / height)
            width *= shrink
            height *= shrink
        }

        let x = max(0, min(rect.minX, imageSize.width - width))
        let y = max(0, min(rect.minY, imageSize.height - height))
        return CGRect(x: x, y: y, width: width, height: height)
    }

    /// Zooms `rect` by `scale` about the image-space point `point`, keeping
    /// `point` at the same relative offset within the new rect. `scale` > 1
    /// zooms in (the rect shrinks, showing a more magnified crop); `scale`
    /// < 1 zooms out. The result never exceeds `imageSize` and never
    /// shrinks below `minSideFraction` of its shorter side.
    static func zoomed(rect: CGRect, scale: CGFloat, about point: CGPoint, ratio: CoverRatio, imageSize: CGSize) -> CGRect {
        guard scale > 0, imageSize.width > 0, imageSize.height > 0, rect.width > 0, rect.height > 0 else {
            return rect
        }

        let aspect = aspectRatio(for: ratio, imageSize: imageSize, fallback: rect.width / rect.height)

        var newWidth = rect.width / scale
        newWidth = max(newWidth, minSide(imageSize: imageSize))
        var newHeight = newWidth / aspect

        if newWidth > imageSize.width || newHeight > imageSize.height {
            let cap = min(imageSize.width / newWidth, imageSize.height / newHeight)
            newWidth *= cap
            newHeight *= cap
        }

        let relX = (point.x - rect.minX) / rect.width
        let relY = (point.y - rect.minY) / rect.height
        let newOrigin = CGPoint(x: point.x - relX * newWidth, y: point.y - relY * newHeight)
        let newRect = CGRect(origin: newOrigin, size: CGSize(width: newWidth, height: newHeight))
        return clamp(rect: newRect, in: imageSize)
    }

    /// Translates `rect` by `delta` (image space) and clamps it back inside
    /// `imageSize`, so panning stops dead at the image's edges.
    static func panned(rect: CGRect, by delta: CGSize, imageSize: CGSize) -> CGRect {
        clamp(rect: rect.offsetBy(dx: delta.width, dy: delta.height), in: imageSize)
    }

    private static func aspectRatio(for ratio: CoverRatio, imageSize: CGSize, fallback: CGFloat) -> CGFloat {
        switch ratio {
        case .square:
            return 1
        case .original:
            guard imageSize.height > 0 else { return fallback }
            return imageSize.width / imageSize.height
        }
    }

    private static func minSide(imageSize: CGSize) -> CGFloat {
        min(imageSize.width, imageSize.height) * minSideFraction
    }
}
