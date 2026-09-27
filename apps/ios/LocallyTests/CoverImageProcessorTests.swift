import CoreGraphics
import UIKit
import Testing
@testable import Locally

struct CoverImageProcessorTests {

    @Test func cropsToTheGivenRectAndKeepsPixelsFromThatRegion() throws {
        // A 400x200 image, red on the left half and blue on the right.
        let source = try #require(Self.makeSideBySideImage(
            width: 400,
            height: 200,
            left: (220, 30, 30),
            right: (30, 30, 220)
        ))

        // Crop to the left square: should contain only the red half.
        let cropped = try #require(CoverImageProcessor.crop(source, to: CGRect(x: 0, y: 0, width: 200, height: 200)))
        let image = try #require(UIImage(data: cropped))

        #expect(Int(image.size.width.rounded()) == 200)
        #expect(Int(image.size.height.rounded()) == 200)

        let pixel = try #require(Self.pixel(in: image, x: 50, y: 100))
        #expect(pixel.r > 150)
        #expect(pixel.b < 100)
    }

    @Test func cropDownscalesWhenLargerThanMaxSide() throws {
        let source = try #require(Self.makeSideBySideImage(width: 2000, height: 2000, left: (255, 0, 0), right: (0, 0, 255)))
        let cropped = try #require(CoverImageProcessor.crop(source, to: CGRect(x: 0, y: 0, width: 2000, height: 2000), maxSide: 500))
        let image = try #require(UIImage(data: cropped))

        #expect(Int(image.size.width.rounded()) == 500)
        #expect(Int(image.size.height.rounded()) == 500)
    }

    // MARK: - Fixtures

    private static func makeSideBySideImage(
        width: Int,
        height: Int,
        left: (UInt8, UInt8, UInt8),
        right: (UInt8, UInt8, UInt8)
    ) -> Data? {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }

        let halfWidth = CGFloat(width) / 2
        context.setFillColor(red: CGFloat(left.0) / 255, green: CGFloat(left.1) / 255, blue: CGFloat(left.2) / 255, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: halfWidth, height: CGFloat(height)))
        context.setFillColor(red: CGFloat(right.0) / 255, green: CGFloat(right.1) / 255, blue: CGFloat(right.2) / 255, alpha: 1)
        context.fill(CGRect(x: halfWidth, y: 0, width: halfWidth, height: CGFloat(height)))

        guard let cgImage = context.makeImage() else { return nil }
        return UIImage(cgImage: cgImage).pngData()
    }

    /// Draws `image` into a fresh RGBA buffer and reads back one pixel, so
    /// the test can check colours without depending on any particular
    /// output image format (JPEG or PNG).
    private static func pixel(in image: UIImage, x: Int, y: Int) -> (r: UInt8, g: UInt8, b: UInt8)? {
        guard let cgImage = image.cgImage else { return nil }
        let width = cgImage.width
        let height = cgImage.height
        guard x >= 0, y >= 0, x < width, y < height else { return nil }

        var buffer = [UInt8](repeating: 0, count: width * height * 4)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: &buffer,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        let offset = (y * width + x) * 4
        return (buffer[offset], buffer[offset + 1], buffer[offset + 2])
    }
}
