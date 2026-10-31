import Foundation
import Testing
import UIKit
@testable import Locally

/// The shared cover decoder (#423): covers shrink to the size asked for, bytes that are not an image give nothing,
/// and the Stats cache that now decodes through it reads each cover once.
@Suite struct CoverThumbnailTests {

    /// A real JPEG of `width` × `height` pixels.
    private func jpeg(width: CGFloat, height: CGFloat) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        return image.jpegData(compressionQuality: 0.9)!
    }

    private func pixels(_ image: UIImage?) -> CGSize? {
        image?.cgImage.map { CGSize(width: $0.width, height: $0.height) }
    }

    @Test func shrinksTheLongerSideToTheAskedSize() {
        let image = CoverThumbnail.image(from: jpeg(width: 1000, height: 600), maxPixels: 168)
        #expect(pixels(image) == CGSize(width: 168, height: 101))
    }

    @Test func keepsTheFullSizeWithoutALimit() {
        let image = CoverThumbnail.image(from: jpeg(width: 1000, height: 600), maxPixels: nil)
        #expect(pixels(image) == CGSize(width: 1000, height: 600))
    }

    @Test func bytesThatAreNotAnImageGiveNothing() {
        #expect(CoverThumbnail.image(from: Data("not a cover".utf8), maxPixels: 168) == nil)
        #expect(CoverThumbnail.image(from: Data(), maxPixels: 168) == nil)
    }

    @Test func theStatsCacheReadsACoverOnceAndShrinksIt() async {
        let data = jpeg(width: 1000, height: 1000)
        let reads = ReadCounter()
        let cache = StatsCoverCache(loader: { _ in reads.increment(); return data })
        let id = UUID()

        let firstImage = await cache.image(for: id)
        let secondImage = await cache.image(for: id)

        #expect(reads.count == 1)
        #expect(firstImage != nil && firstImage === secondImage)
        #expect(cache.cached(id) === firstImage)
        #expect(pixels(firstImage) == CGSize(width: 420, height: 420))
    }

    @Test func theStatsCacheHoldsNothingForBadBytes() async {
        let cache = StatsCoverCache(loader: { _ in Data("not a cover".utf8) })
        let id = UUID()
        #expect(await cache.image(for: id) == nil)
        #expect(cache.cached(id) == nil)
    }
}

/// Counts loader calls from the detached read.
private final class ReadCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    var count: Int { lock.withLock { value } }
    func increment() { lock.withLock { value += 1 } }
}
