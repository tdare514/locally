import CoreGraphics
import UIKit
import Testing
@testable import Locally

/// Output-shape checks for `CoverImageProcessor` (ImageRenderer.swift) and
/// the `CropGeometry` limits it relies on.
struct CoverImageProcessorGeometryTests {

    @Test func squareCropOfANonSquareImageHasEqualSides() throws {
        let source = try #require(Self.solidImage(width: 400, height: 200, alpha: false, png: false))
        let rect = CropGeometry.initialRect(imageSize: CGSize(width: 400, height: 200), ratio: .square)
        let out = try #require(CoverImageProcessor.crop(source, to: rect))
        let size = try Self.pixelSize(of: out)
        #expect(size.width == size.height)
        #expect(size == CGSize(width: 200, height: 200))
    }

    @Test func originalModeKeepsTheAspectRatio() throws {
        let source = try #require(Self.solidImage(width: 400, height: 200, alpha: false, png: false))
        let rect = CropGeometry.initialRect(imageSize: CGSize(width: 400, height: 200), ratio: .original)
        let out = try #require(CoverImageProcessor.crop(source, to: rect))
        #expect(try Self.pixelSize(of: out) == CGSize(width: 400, height: 200))
    }

    @Test func originalModeKeepsTheAspectRatioWhenDownscaled() throws {
        let source = try #require(Self.solidImage(width: 400, height: 200, alpha: false, png: false))
        let out = try #require(CoverImageProcessor.crop(source, to: CGRect(x: 0, y: 0, width: 400, height: 200), maxSide: 100))
        #expect(try Self.pixelSize(of: out) == CGSize(width: 100, height: 50))
    }

    @Test func aCropRectPastTheImageIsClampedToIt() throws {
        let source = try #require(Self.solidImage(width: 400, height: 200, alpha: false, png: false))
        // Larger than the image and offset off its edge.
        let out = try #require(CoverImageProcessor.crop(source, to: CGRect(x: 300, y: -50, width: 1000, height: 500)))
        #expect(try Self.pixelSize(of: out) == CGSize(width: 400, height: 200))
    }

    @Test func aDegenerateCropRectFallsBackToTheWholeImage() throws {
        let source = try #require(Self.solidImage(width: 40, height: 20, alpha: false, png: false))
        let out = try #require(CoverImageProcessor.crop(source, to: .zero))
        #expect(try Self.pixelSize(of: out) == CGSize(width: 40, height: 20))
    }

    @Test func zoomingInStopsAtTenPercentOfTheShorterSide() {
        let imageSize = CGSize(width: 400, height: 200)
        let start = CropGeometry.initialRect(imageSize: imageSize, ratio: .square)
        let zoomed = CropGeometry.zoomed(rect: start, scale: 1000, about: CGPoint(x: 200, y: 100), ratio: .square, imageSize: imageSize)
        #expect(abs(zoomed.width - 20) < 0.001)
        #expect(abs(zoomed.height - 20) < 0.001)
    }

    @Test func opaqueSourceEncodesAsJpeg() throws {
        let source = try #require(Self.solidImage(width: 40, height: 40, alpha: false, png: true))
        let out = try #require(CoverImageProcessor.crop(source, to: CGRect(x: 0, y: 0, width: 40, height: 40)))
        #expect(!out.isEmpty)
        #expect(Array(out.prefix(2)) == [0xff, 0xd8])
    }

    @Test func pngWithAlphaStaysPng() throws {
        let source = try #require(Self.solidImage(width: 40, height: 40, alpha: true, png: true))
        let out = try #require(CoverImageProcessor.crop(source, to: CGRect(x: 0, y: 0, width: 40, height: 40)))
        #expect(Array(out.prefix(2)) == [0x89, 0x50])
        #expect(try Self.pixelSize(of: out) == CGSize(width: 40, height: 40))
    }

    @Test func undecodableDataReturnsNil() {
        #expect(CoverImageProcessor.crop(Data([1, 2, 3]), to: CGRect(x: 0, y: 0, width: 10, height: 10)) == nil)
    }

    // MARK: - Fixtures

    private static func solidImage(width: Int, height: Int, alpha: Bool, png: Bool) -> Data? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = !alpha
        let size = CGSize(width: width, height: height)
        let image = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor(red: 0.8, green: 0.2, blue: 0.2, alpha: alpha ? 0.5 : 1).setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
        }
        return png ? image.pngData() : image.jpegData(compressionQuality: 1)
    }

    private static func pixelSize(of data: Data) throws -> CGSize {
        let image = try #require(UIImage(data: data))
        let cg = try #require(image.cgImage)
        return CGSize(width: cg.width, height: cg.height)
    }
}
