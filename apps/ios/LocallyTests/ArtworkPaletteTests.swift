import CoreGraphics
import Foundation
import ImageIO
import Testing
@testable import Locally

@Suite struct ArtworkPaletteTests {

    typealias Colour = (r: UInt8, g: UInt8, b: UInt8, a: UInt8)

    private static func c(_ r: UInt8, _ g: UInt8, _ b: UInt8, _ a: UInt8 = 255) -> Colour {
        (r, g, b, a)
    }

    /// RGBA bytes with `counts[i]` pixels of `colours[i]`.
    private static func px(_ colours: [Colour], _ counts: [Int]) -> [UInt8] {
        var bytes: [UInt8] = []
        for (i, colour) in colours.enumerated() {
            for _ in 0..<counts[i] { bytes.append(contentsOf: [colour.r, colour.g, colour.b, colour.a]) }
        }
        return bytes
    }

    private static func solid(_ colour: Colour) throws -> AmbientPalette {
        try #require(ArtworkPalette.paletteFromPixels(px([colour], [100])))
    }

    /// Splits "#rrggbb" into [r, g, b] bytes.
    private static func rgb(_ hex: String) -> [Int] {
        let chars = Array(hex)
        return [1, 3, 5].map { Int(String(chars[$0..<($0 + 2)]), radix: 16)! }
    }

    // MARK: - paletteFromPixels

    @Test func returnsNilForEmptyOrFullyTransparentInput() {
        #expect(ArtworkPalette.paletteFromPixels([]) == nil)
        #expect(ArtworkPalette.paletteFromPixels(Self.px([Self.c(255, 0, 0, 0)], [50])) == nil)
        #expect(ArtworkPalette.paletteFromPixels(Self.px([Self.c(255, 0, 0, 124)], [50])) == nil)
    }

    @Test func tonesSolidRedToARedThatWhiteTextCanSitOn() throws {
        let primary = try Self.solid(Self.c(255, 0, 0)).primary
        let v = Self.rgb(primary)
        #expect(v[0] > v[1])
        #expect(v[0] > v[2])
        #expect(ArtworkPalette.relativeLuminance(primary) <= 0.12)
        #expect(ArtworkPalette.contrastRatio("#ffffff", primary) >= 4.5)
    }

    @Test(arguments: [
        ("yellow", [255, 255, 0]),
        ("light green", [128, 255, 128]),
    ])
    func keepsWhiteReadableOnBrightColours(name: String, rgb: [Int]) throws {
        let colour = Self.c(UInt8(rgb[0]), UInt8(rgb[1]), UInt8(rgb[2]))
        let primary = try Self.solid(colour).primary
        #expect(ArtworkPalette.contrastRatio("#ffffff", primary) >= 4.5, "\(name)")
    }

    @Test func yellowCoverKeepsAtLeastSixToOneWithWhite() throws {
        let primary = try Self.solid(Self.c(255, 255, 0)).primary
        #expect(ArtworkPalette.contrastRatio("#ffffff", primary) >= 6)
    }

    @Test func penalisesNearWhiteSoA70PercentWhiteCoverStillPicksItsBlue() throws {
        let pixels = Self.px([Self.c(255, 255, 255), Self.c(0x20, 0x50, 0xe0)], [70, 30])
        let v = Self.rgb(try #require(ArtworkPalette.paletteFromPixels(pixels)).primary)
        #expect(v[2] > v[0])
        #expect(v[2] > v[1])
    }

    @Test func picksADistinctSecondHueForSecondary() throws {
        let pixels = Self.px([Self.c(255, 0, 0), Self.c(0, 0, 255)], [60, 40])
        let palette = try #require(ArtworkPalette.paletteFromPixels(pixels))
        let p = Self.rgb(palette.primary)
        let s = Self.rgb(palette.secondary)
        #expect(p[0] > p[1])
        #expect(p[0] > p[2])
        #expect(s[2] > s[0])
        #expect(s[2] > s[1])
    }

    @Test func keepsSecondaryNoBrighterThanPrimaryForASingleHueImage() throws {
        let pixels = Self.px([Self.c(255, 140, 0), Self.c(250, 160, 20)], [70, 30])
        let palette = try #require(ArtworkPalette.paletteFromPixels(pixels))
        #expect(ArtworkPalette.relativeLuminance(palette.secondary)
                <= ArtworkPalette.relativeLuminance(palette.primary))
    }

    @Test func keepsGreyscaleInputGrey() throws {
        let v = Self.rgb(try Self.solid(Self.c(128, 128, 128)).primary)
        #expect(v[0] == v[1])
        #expect(v[1] == v[2])
    }

    @Test func givesABlackCoverAVisibleDarkGreyNotPureBlack() throws {
        let primary = try Self.solid(Self.c(0, 0, 0)).primary
        #expect(primary != "#000000")
        #expect(ArtworkPalette.relativeLuminance(primary) <= 0.12)
    }

    @Test(arguments: [
        ("red", [255, 0, 0]),
        ("yellow", [255, 255, 0]),
    ])
    func keepsDeepWithinItsCap(name: String, rgb: [Int]) throws {
        let colour = Self.c(UInt8(rgb[0]), UInt8(rgb[1]), UInt8(rgb[2]))
        #expect(ArtworkPalette.relativeLuminance(try Self.solid(colour).deep) <= 0.035, "\(name)")
    }

    // MARK: - relativeLuminance and contrastRatio

    @Test func matchesTheWcagEndpoints() {
        #expect(abs(ArtworkPalette.relativeLuminance("#ffffff") - 1) < 1e-5)
        #expect(ArtworkPalette.relativeLuminance("#000000") == 0)
        #expect(abs(ArtworkPalette.contrastRatio("#ffffff", "#000000") - 21) < 1e-5)
    }

    @Test func contrastIsSymmetricInItsArguments() {
        #expect(abs(ArtworkPalette.contrastRatio("#000000", "#ffffff") - 21) < 1e-5)
    }

    // MARK: - palette(forCover:)

    @Test func paletteForCoverFallsBackToNeutral() {
        #expect(ArtworkPalette.palette(forCover: nil) == .neutral)
        #expect(ArtworkPalette.palette(forCover: Data([1, 2, 3, 4, 5])) == .neutral)
    }

    @Test func paletteForCoverReadsASolidPng() throws {
        let png = try #require(Self.solidPng(r: 255, g: 220, b: 0, side: 16))
        let palette = ArtworkPalette.palette(forCover: png)
        #expect(palette != .neutral)
        #expect(ArtworkPalette.contrastRatio("#ffffff", palette.primary) >= 4.5)
        #expect(ArtworkPalette.relativeLuminance(palette.primary) <= 0.12)
    }

    // MARK: - Fixtures

    private static func solidPng(r: UInt8, g: UInt8, b: UInt8, side: Int) -> Data? {
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
                space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        context.setFillColor(red: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: side, height: side))
        guard let image = context.makeImage() else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return out as Data
    }
}
