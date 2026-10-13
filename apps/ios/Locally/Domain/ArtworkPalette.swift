import CoreGraphics
import Foundation
import ImageIO

/// Pure colour extraction for the release screen's artwork backdrop (issue #112),
/// a port of `apps/web/src/lib/artwork-palette.ts` with the same algorithm,
/// constants and outputs. It picks the cover's dominant colours and tones them
/// into three dark backdrop colours. White text sits on top of that backdrop, so
/// every colour is capped on WCAG relative luminance (a bright yellow cover would
/// otherwise make the text unreadable). The pure core takes RGBA bytes; `pixels`
/// and `palette(forCover:)` downscale an image with CoreGraphics and ImageIO only.

/// Three backdrop colours as "#rrggbb", all dark enough for white text.
struct AmbientPalette: Equatable, Sendable {
    let primary: String
    let secondary: String
    let deep: String

    /// Used when no artwork is available or its colours can't be read.
    static let neutral = AmbientPalette(primary: "#262626", secondary: "#1a1a1a", deep: "#0d0d0d")
}

enum ArtworkPalette {

    /// Hue in degrees (0..360), saturation and lightness in 0..1.
    private struct Hsl {
        var h: Double
        var s: Double
        var l: Double
    }

    /// Pixels that fell in the same quantised colour, kept as running sums so the
    /// average colour can be taken afterwards.
    private struct Bucket {
        var count = 0
        var r = 0
        var g = 0
        var b = 0
    }

    private static let minAlpha = 125
    private static let maxSaturation = 0.62
    private static let deepMaxSaturation = 0.5
    private static let deepLightness = 0.1
    private static let lightnessFloor = 0.14
    private static let minHueGap = 35.0
    private static let minSecondarySaturation = 0.15

    /// Luminance caps: white on a 0.12 colour has contrast >= 6.
    private static let primaryCap = 0.12
    private static let secondaryCap = 0.08
    private static let fallbackSecondaryCap = 0.06
    private static let deepCap = 0.035

    private static let sampleSide = 24

    /// JS `Math.round`: halves round toward +infinity.
    private static func jsRound(_ x: Double) -> Double {
        (x + 0.5).rounded(.down)
    }

    /// Parses "#rrggbb" into its three 0..255 channels.
    private static func channels(_ hex: String) -> [Int] {
        let chars = Array(hex)
        return [1, 3, 5].map { i in
            Int(String(chars[i..<(i + 2)]), radix: 16) ?? 0
        }
    }

    /// WCAG 2.x relative luminance of a "#rrggbb" colour, 0 (black) to 1 (white).
    static func relativeLuminance(_ hex: String) -> Double {
        let lin = channels(hex).map { c -> Double in
            let v = Double(c) / 255
            return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    }

    /// WCAG contrast ratio, 1 to 21, whichever argument is lighter.
    static func contrastRatio(_ a: String, _ b: String) -> Double {
        let la = relativeLuminance(a)
        let lb = relativeLuminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    private static func rgbToHsl(_ r: Double, _ g: Double, _ b: Double) -> Hsl {
        let rn = r / 255
        let gn = g / 255
        let bn = b / 255
        let mx = max(rn, gn, bn)
        let mn = min(rn, gn, bn)
        let l = (mx + mn) / 2
        let d = mx - mn
        if d == 0 { return Hsl(h: 0, s: 0, l: l) }
        let s = d / (1 - abs(2 * l - 1))
        let h: Double
        if mx == rn {
            h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
        } else if mx == gn {
            h = ((bn - rn) / d + 2) * 60
        } else {
            h = ((rn - gn) / d + 4) * 60
        }
        return Hsl(h: h, s: s, l: l)
    }

    private static func hslToHex(_ hsl: Hsl) -> String {
        let a = hsl.s * min(hsl.l, 1 - hsl.l)
        func channel(_ n: Double) -> String {
            let k = (n + hsl.h / 30).truncatingRemainder(dividingBy: 12)
            let v = hsl.l - a * max(-1, min(k - 3, 9 - k, 1))
            let hex = String(Int(jsRound(v * 255)), radix: 16)
            return hex.count < 2 ? String(repeating: "0", count: 2 - hex.count) + hex : hex
        }
        return "#\(channel(0))\(channel(8))\(channel(4))"
    }

    /// Circular distance between two hues, 0..180 degrees.
    private static func hueGap(_ a: Double, _ b: Double) -> Double {
        let d = abs(a - b).truncatingRemainder(dividingBy: 360)
        return d > 180 ? 360 - d : d
    }

    /// Lowers lightness in 0.01 steps until the colour's luminance is within `cap`.
    /// Lightness is also lifted to `wantedFloor` (so black reads as a visible dark
    /// grey) unless that floor would itself break the cap.
    private static func toneDown(_ hsl: Hsl, cap: Double, wantedFloor: Double = lightnessFloor) -> String {
        var atFloor = hsl
        atFloor.l = wantedFloor
        let floor = relativeLuminance(hslToHex(atFloor)) <= cap ? wantedFloor : 0
        var l = max(hsl.l, floor)
        var current = hsl
        current.l = l
        var hex = hslToHex(current)
        while l > floor && relativeLuminance(hex) > cap {
            l = max(floor, l - 0.01)
            current.l = l
            hex = hslToHex(current)
        }
        return hex
    }

    /// Picks a backdrop palette from RGBA bytes (a multiple of 4, as from a
    /// canvas `getImageData`), or nil when every pixel is mostly transparent.
    static func paletteFromPixels(_ rgba: [UInt8]) -> AmbientPalette? {
        // Ordered like a JS Map: first-seen key first.
        var order: [Bucket] = []
        var index: [Int: Int] = [:]
        var i = 0
        while i + 3 < rgba.count {
            defer { i += 4 }
            if Int(rgba[i + 3]) < minAlpha { continue }
            let r = Int(rgba[i])
            let g = Int(rgba[i + 1])
            let b = Int(rgba[i + 2])
            let key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
            let slot: Int
            if let existing = index[key] {
                slot = existing
            } else {
                slot = order.count
                index[key] = slot
                order.append(Bucket())
            }
            order[slot].count += 1
            order[slot].r += r
            order[slot].g += g
            order[slot].b += b
        }
        if order.isEmpty { return nil }

        // Near-black and near-white buckets are down-weighted so a plain background
        // rarely beats the artwork's real colours.
        let scored: [(hsl: Hsl, score: Double)] = order.map { bucket in
            let n = Double(bucket.count)
            let hsl = rgbToHsl(
                jsRound(Double(bucket.r) / n),
                jsRound(Double(bucket.g) / n),
                jsRound(Double(bucket.b) / n)
            )
            let weight = hsl.l < 0.08 || hsl.l > 0.92 ? 0.15 : 1
            return (hsl, n * (0.35 + hsl.s) * weight)
        }
        func best(_ items: [(hsl: Hsl, score: Double)]) -> Hsl {
            var top = items[0]
            for item in items.dropFirst() where item.score > top.score { top = item }
            return top.hsl
        }

        let primary = best(scored)
        let others = scored.filter {
            $0.hsl.s >= minSecondarySaturation && hueGap($0.hsl.h, primary.h) >= minHueGap
        }
        let secondary: Hsl? = others.isEmpty ? nil : best(others)

        func soften(_ hsl: Hsl) -> Hsl {
            var out = hsl
            out.s = min(hsl.s, maxSaturation)
            return out
        }
        return AmbientPalette(
            primary: toneDown(soften(primary), cap: primaryCap),
            secondary: secondary.map { toneDown(soften($0), cap: secondaryCap) }
                ?? toneDown(soften(primary), cap: fallbackSecondaryCap),
            deep: toneDown(
                Hsl(h: primary.h, s: min(primary.s, deepMaxSaturation), l: deepLightness),
                cap: deepCap,
                wantedFloor: 0
            )
        )
    }

    // MARK: - Image helper

    /// Decodes the first image in `data` and draws it, stretched like the web's
    /// `drawImage(img, 0, 0, 24, 24)`, into a `side` x `side` RGBA8 sRGB bitmap.
    /// Returns straight (un-premultiplied) bytes, like canvas `getImageData`.
    static func pixels(fromImageData data: Data, side: Int = sampleSide) -> [UInt8]? {
        guard side > 0,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) > 0,
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              let space = CGColorSpace(name: CGColorSpace.sRGB)
        else { return nil }

        var bytes = [UInt8](repeating: 0, count: side * side * 4)
        let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: side,
                height: side,
                bitsPerComponent: 8,
                bytesPerRow: side * 4,
                space: space,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            context.interpolationQuality = .high
            context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
            return true
        }
        guard drawn else { return nil }

        var i = 0
        while i + 3 < bytes.count {
            let a = Int(bytes[i + 3])
            if a > 0 && a < 255 {
                for c in 0..<3 {
                    bytes[i + c] = UInt8(min(255, (Int(bytes[i + c]) * 255 + a / 2) / a))
                }
            }
            i += 4
        }
        return bytes
    }

    /// The backdrop palette for cover image data; `.neutral` when there is no
    /// cover, it can't be decoded, or it is all transparent.
    static func palette(forCover data: Data?) -> AmbientPalette {
        guard let data,
              let rgba = pixels(fromImageData: data),
              let palette = paletteFromPixels(rgba)
        else { return .neutral }
        return palette
    }
}
