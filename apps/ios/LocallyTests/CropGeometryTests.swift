import CoreGraphics
import Testing
@testable import Locally

struct CropGeometryTests {

    // MARK: - initialRect

    @Test func squareInitialRectForLandscapeImageIsCentredHorizontally() {
        let rect = CropGeometry.initialRect(imageSize: CGSize(width: 400, height: 200), ratio: .square)
        #expect(rect == CGRect(x: 100, y: 0, width: 200, height: 200))
    }

    @Test func squareInitialRectForPortraitImageIsCentredVertically() {
        let rect = CropGeometry.initialRect(imageSize: CGSize(width: 200, height: 400), ratio: .square)
        #expect(rect == CGRect(x: 0, y: 100, width: 200, height: 200))
    }

    @Test func originalRatioReturnsTheFullImage() {
        let size = CGSize(width: 400, height: 200)
        #expect(CropGeometry.initialRect(imageSize: size, ratio: .original) == CGRect(origin: .zero, size: size))

        let portrait = CGSize(width: 300, height: 900)
        #expect(CropGeometry.initialRect(imageSize: portrait, ratio: .original) == CGRect(origin: .zero, size: portrait))
    }

    // MARK: - clamp

    private let imageSize = CGSize(width: 400, height: 300)

    @Test func clampPullsBackARectPastTheLeftEdge() {
        let rect = CGRect(x: -50, y: 50, width: 100, height: 100)
        let clamped = CropGeometry.clamp(rect: rect, in: imageSize)
        #expect(clamped == CGRect(x: 0, y: 50, width: 100, height: 100))
    }

    @Test func clampPullsBackARectPastTheRightEdge() {
        let rect = CGRect(x: 350, y: 50, width: 100, height: 100)
        let clamped = CropGeometry.clamp(rect: rect, in: imageSize)
        #expect(clamped == CGRect(x: 300, y: 50, width: 100, height: 100))
    }

    @Test func clampPullsBackARectPastTheTopEdge() {
        let rect = CGRect(x: 50, y: -80, width: 100, height: 100)
        let clamped = CropGeometry.clamp(rect: rect, in: imageSize)
        #expect(clamped == CGRect(x: 50, y: 0, width: 100, height: 100))
    }

    @Test func clampPullsBackARectPastTheBottomEdge() {
        let rect = CGRect(x: 50, y: 250, width: 100, height: 100)
        let clamped = CropGeometry.clamp(rect: rect, in: imageSize)
        #expect(clamped == CGRect(x: 50, y: 200, width: 100, height: 100))
    }

    @Test func clampShrinksARectLargerThanTheImagePreservingAspect() {
        // 2:1, which does not match the 4:3 image, so this only passes if
        // the aspect ratio is actually preserved rather than the rect being
        // independently clipped per axis.
        let rect = CGRect(x: 0, y: 0, width: 800, height: 400)
        let clamped = CropGeometry.clamp(rect: rect, in: imageSize)
        #expect(clamped.width <= imageSize.width)
        #expect(clamped.height <= imageSize.height)
        #expect(abs(clamped.width / clamped.height - rect.width / rect.height) < 0.0001)
    }

    @Test func clampOnAnAlreadyValidRectIsANoOp() {
        let rect = CGRect(x: 50, y: 50, width: 100, height: 100)
        #expect(CropGeometry.clamp(rect: rect, in: imageSize) == rect)
    }

    // MARK: - zoomed

    @Test func zoomingInShrinksTheRectAboutItsCentre() {
        let imageSize = CGSize(width: 1000, height: 1000)
        let rect = CGRect(x: 200, y: 200, width: 400, height: 400)
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let zoomed = CropGeometry.zoomed(rect: rect, scale: 2, about: center, ratio: .square, imageSize: imageSize)
        #expect(zoomed.width < rect.width)
        #expect(abs(zoomed.midX - center.x) < 0.001)
        #expect(abs(zoomed.midY - center.y) < 0.001)
    }

    @Test func zoomNeverExceedsTheImageBounds() {
        let imageSize = CGSize(width: 500, height: 500)
        var rect = CropGeometry.initialRect(imageSize: imageSize, ratio: .square)
        // Repeatedly "zoom out" (scale < 1): the rect must never grow past the image.
        for _ in 0..<50 {
            let center = CGPoint(x: rect.midX, y: rect.midY)
            rect = CropGeometry.zoomed(rect: rect, scale: 0.5, about: center, ratio: .square, imageSize: imageSize)
            #expect(rect.width <= imageSize.width + 0.001)
            #expect(rect.height <= imageSize.height + 0.001)
            #expect(rect.minX >= -0.001)
            #expect(rect.minY >= -0.001)
            #expect(rect.maxX <= imageSize.width + 0.001)
            #expect(rect.maxY <= imageSize.height + 0.001)
        }
    }

    @Test func zoomInNeverShrinksBelowAMinimumSize() {
        let imageSize = CGSize(width: 1000, height: 1000)
        var rect = CropGeometry.initialRect(imageSize: imageSize, ratio: .square)
        for _ in 0..<50 {
            let center = CGPoint(x: rect.midX, y: rect.midY)
            rect = CropGeometry.zoomed(rect: rect, scale: 2, about: center, ratio: .square, imageSize: imageSize)
        }
        #expect(rect.width > 0)
        #expect(rect.height > 0)
    }

    @Test func zoomKeepsTheSquareRatioSquare() {
        let imageSize = CGSize(width: 800, height: 600)
        let rect = CropGeometry.initialRect(imageSize: imageSize, ratio: .square)
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let zoomed = CropGeometry.zoomed(rect: rect, scale: 1.5, about: center, ratio: .square, imageSize: imageSize)
        #expect(abs(zoomed.width - zoomed.height) < 0.001)
    }

    // MARK: - panned

    @Test func panMovesTheRectByTheGivenDelta() {
        let imageSize = CGSize(width: 400, height: 400)
        let rect = CGRect(x: 100, y: 100, width: 100, height: 100)
        let panned = CropGeometry.panned(rect: rect, by: CGSize(width: 20, height: -10), imageSize: imageSize)
        #expect(panned == CGRect(x: 120, y: 90, width: 100, height: 100))
    }

    @Test func panStopsAtTheLeftAndTopEdges() {
        let imageSize = CGSize(width: 400, height: 400)
        let rect = CGRect(x: 50, y: 50, width: 100, height: 100)
        let panned = CropGeometry.panned(rect: rect, by: CGSize(width: -500, height: -500), imageSize: imageSize)
        #expect(panned.minX == 0)
        #expect(panned.minY == 0)
        #expect(panned.width == 100)
        #expect(panned.height == 100)
    }

    @Test func panStopsAtTheRightAndBottomEdges() {
        let imageSize = CGSize(width: 400, height: 400)
        let rect = CGRect(x: 250, y: 250, width: 100, height: 100)
        let panned = CropGeometry.panned(rect: rect, by: CGSize(width: 500, height: 500), imageSize: imageSize)
        #expect(panned.maxX == imageSize.width)
        #expect(panned.maxY == imageSize.height)
        #expect(panned.width == 100)
        #expect(panned.height == 100)
    }
}
