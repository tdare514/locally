import SwiftUI
import UIKit

/// The calm "studio" backdrop for screens with no cover to colour them (Settings, #160): the app's
/// black with a very soft, slow two-tone glow, accent blue and a cool violet. It reuses
/// `ArtworkBackdrop` with a fixed brand palette, so the drift, the Reduce Motion behaviour and the
/// luminance caps are the release page's own, and adds one quiet low glow and a faint film grain on
/// top. Nothing blurs or draws a hard edge: every colour change is a gradient.
struct StudioBackdrop: View {
    /// 1 is the library sky's own strength; the default sits a little under it so a screen of
    /// controls stays calm. Lower keeps more of the page black.
    var intensity: Double = 0.8

    var body: some View {
        ZStack {
            Theme.background
            ArtworkBackdrop(primary: Theme.Studio.blue, secondary: Theme.Studio.violet, deep: Theme.Studio.deep)
                .opacity(intensity)
            LowGlow()
                .opacity(intensity)
            FilmGrain()
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// A static violet pool in the lower corner, so the bottom of a long screen is not flat black.
/// A gradient only: no blur, no animation, nothing to redraw.
private struct LowGlow: View {
    var body: some View {
        GeometryReader { geo in
            RadialGradient(
                colors: [Theme.Studio.violet.opacity(0.14), Theme.Studio.violet.opacity(0.05), .clear],
                center: UnitPoint(x: 0.95, y: 1.02),
                startRadius: 0,
                endRadius: max(geo.size.width, geo.size.height) * 0.62
            )
        }
    }
}

/// Film grain from one tiny noise tile, built once and tiled. Plain alpha blending (no blend
/// mode), so it costs a textured quad per frame and nothing more. It also dithers the long dark
/// gradients, which would otherwise band.
private struct FilmGrain: View {
    /// The tile is 192 px square drawn at 3x, so each grain is one device pixel.
    private static let tilePixels = 192
    private static let tileScale: CGFloat = 3
    static let opacity: Double = 0.055

    var body: some View {
        Image(uiImage: Self.tile)
            .resizable(resizingMode: .tile)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .opacity(Self.opacity)
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private static let tile: UIImage = {
        let side = tilePixels
        var seed: UInt64 = 0x160
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        for pixel in 0..<(side * side) {
            // SplitMix64: fixed seed, so the grain is the same on every launch.
            seed &+= 0x9E37_79B9_7F4A_7C15
            var z = seed
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            z ^= z >> 31
            let alpha = UInt8(truncatingIfNeeded: z >> 8)
            // Half the grains lighten, half darken; premultiplied RGBA.
            let level: UInt8 = (z & 1) == 0 ? alpha : 0
            pixels[pixel * 4] = level
            pixels[pixel * 4 + 1] = level
            pixels[pixel * 4 + 2] = level
            pixels[pixel * 4 + 3] = alpha
        }
        let image: CGImage? = pixels.withUnsafeMutableBytes { buffer in
            CGContext(
                data: buffer.baseAddress,
                width: side, height: side,
                bitsPerComponent: 8, bytesPerRow: side * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )?.makeImage()
        }
        guard let image else { return UIImage() }
        return UIImage(cgImage: image, scale: tileScale, orientation: .up)
    }()
}

#if DEBUG
#Preview("Studio backdrop") {
    StudioBackdrop()
        .preferredColorScheme(.dark)
}
#endif
