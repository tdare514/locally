import Foundation
import Testing
import UIKit
@testable import Locally

/// The Library's cover cache (#423): bounded in bytes, a cover is read once, a request that is cancelled stops before
/// it reads, and a cover that was missing is read again so one that arrives later is found.
@Suite struct LibraryCoverCacheTests {

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

    private let updatedAt = Date(timeIntervalSinceReferenceDate: 1_000)

    @Test func aMissingCoverThatArrivesLaterAtTheSameKeyIsReadAgain() async {
        let reads = Reads(responses: [nil, jpeg(width: 400, height: 400)])
        let cache = LibraryCoverCache(loader: { _ in reads.next() })
        let id = UUID()

        let first = await cache.image(id: id, updatedAt: updatedAt, pixels: 168)
        #expect(first == nil)
        #expect(cache.cached(id: id, updatedAt: updatedAt, pixels: 168) == nil)

        let second = await cache.image(id: id, updatedAt: updatedAt, pixels: 168)
        #expect(second != nil)
        #expect(reads.count == 2)
        #expect(pixels(second) == CGSize(width: 168, height: 168))
    }

    @Test func aCoverIsReadOnceAndHeldForTheSameKey() async {
        let reads = Reads(responses: [jpeg(width: 1000, height: 1000)])
        let cache = LibraryCoverCache(loader: { _ in reads.next() })
        let id = UUID()

        let first = await cache.image(id: id, updatedAt: updatedAt, pixels: 168)
        let second = await cache.image(id: id, updatedAt: updatedAt, pixels: 168)

        #expect(reads.count == 1)
        #expect(first != nil && first === second)
        #expect(cache.cached(id: id, updatedAt: updatedAt, pixels: 168) === first)
    }

    @Test func differentPixelSizesAndVersionsAreSeparateEntries() async {
        let reads = Reads(responses: [jpeg(width: 1000, height: 1000)], repeating: true)
        let cache = LibraryCoverCache(loader: { _ in reads.next() })
        let id = UUID()

        let small = await cache.image(id: id, updatedAt: updatedAt, pixels: 168)
        let large = await cache.image(id: id, updatedAt: updatedAt, pixels: 400)
        let replaced = await cache.image(id: id, updatedAt: updatedAt.addingTimeInterval(1), pixels: 168)

        #expect(reads.count == 3)
        #expect(pixels(small) == CGSize(width: 168, height: 168))
        #expect(pixels(large) == CGSize(width: 400, height: 400))
        #expect(replaced != nil && replaced !== small)
        #expect(cache.cached(id: id, updatedAt: updatedAt, pixels: 168) === small)
        #expect(cache.cached(id: id, updatedAt: updatedAt, pixels: 400) === large)
        #expect(cache.cached(id: id, updatedAt: updatedAt, pixels: 300) == nil)
    }

    @Test func bytesThatAreNotAnImageAreNotKept() async {
        let cache = LibraryCoverCache(loader: { _ in Data("not a cover".utf8) })
        let id = UUID()
        #expect(await cache.image(id: id, updatedAt: updatedAt, pixels: 168) == nil)
        #expect(cache.cached(id: id, updatedAt: updatedAt, pixels: 168) == nil)
    }

    @Test func aCostIsTheDecodedBytes() async throws {
        let data = jpeg(width: 100, height: 50)
        let cache = LibraryCoverCache(loader: { _ in data })
        let image = try #require(await cache.image(id: UUID(), updatedAt: updatedAt, pixels: 168))
        let cg = try #require(image.cgImage)
        #expect(LibraryCoverCache.cost(of: image) == cg.bytesPerRow * cg.height)
        #expect(LibraryCoverCache.cost(of: image) >= 100 * 50 * 4)
    }

    @Test func aCancelledRequestWaitingForASlotNeverReadsAndLeavesTheQueue() async throws {
        let gate = Gate()
        let data = jpeg(width: 400, height: 400)
        let reads = Reads(responses: [data], repeating: true, blockFirstOn: gate)
        let cache = LibraryCoverCache(loader: { _ in reads.next() }, maxConcurrent: 1)

        let a = Task { await cache.image(id: UUID(), updatedAt: updatedAt, pixels: 168) }
        try await eventually { reads.count == 1 }   // A holds the only slot, blocked inside its read

        let b = Task { await cache.image(id: UUID(), updatedAt: updatedAt, pixels: 168) }
        try await eventually { await cache.waitingCount() == 1 }

        b.cancel()
        #expect(await b.value == nil)
        try await eventually { await cache.waitingCount() == 0 }

        gate.open()
        #expect(await a.value != nil)
        #expect(reads.count == 1)

        // The cancelled waiter took no slot: the next request is served.
        #expect(await cache.image(id: UUID(), updatedAt: updatedAt, pixels: 168) != nil)
        #expect(reads.count == 2)
    }

    @Test func aRequestCancelledDuringItsReadIsNotDecodedOrKept() async throws {
        let gate = Gate()
        let reads = Reads(responses: [jpeg(width: 400, height: 400)], repeating: true, blockFirstOn: gate)
        let cache = LibraryCoverCache(loader: { _ in reads.next() }, maxConcurrent: 1)
        let id = UUID()

        let a = Task { await cache.image(id: id, updatedAt: updatedAt, pixels: 168) }
        try await eventually { reads.count == 1 }

        a.cancel()
        gate.open()

        #expect(await a.value == nil)
        #expect(cache.cached(id: id, updatedAt: updatedAt, pixels: 168) == nil)
        // The slot came back.
        #expect(await cache.image(id: UUID(), updatedAt: updatedAt, pixels: 168) != nil)
    }

    @Test func atMostMaxConcurrentReadsRunAtOnce() async throws {
        let gate = Gate()
        let reads = Reads(responses: [jpeg(width: 200, height: 200)], repeating: true, blockAllOn: gate)
        let cache = LibraryCoverCache(loader: { _ in reads.next() }, maxConcurrent: 2)

        let tasks = (0..<5).map { _ in Task { await cache.image(id: UUID(), updatedAt: updatedAt, pixels: 168) } }
        try await eventually { reads.count == 2 }
        try await eventually { await cache.waitingCount() == 3 }
        #expect(reads.count == 2)

        gate.open()
        for task in tasks { #expect(await task.value != nil) }
        #expect(reads.count == 5)
        #expect(reads.mostAtOnce == 2)
    }

    /// Polls `condition` until true, failing after 5 s so a broken test cannot hang.
    private func eventually(_ condition: () async -> Bool) async throws {
        let deadline = Date().addingTimeInterval(5)
        while !(await condition()) {
            guard Date() < deadline else { throw WaitTimeout() }
            try await Task.sleep(for: .milliseconds(5))
        }
    }

    private struct WaitTimeout: Error {}
}

/// A fake loader's script: counts calls, answers from `responses` in turn (the last one again when `repeating`),
/// and can block in the read until a `Gate` opens.
private final class Reads: @unchecked Sendable {
    private let lock = NSLock()
    private let responses: [Data?]
    private let repeating: Bool
    private let blockFirstOn: Gate?
    private let blockAllOn: Gate?
    private var calls = 0
    private var running = 0
    private var peak = 0

    init(responses: [Data?], repeating: Bool = false, blockFirstOn: Gate? = nil, blockAllOn: Gate? = nil) {
        self.responses = responses
        self.repeating = repeating
        self.blockFirstOn = blockFirstOn
        self.blockAllOn = blockAllOn
    }

    var count: Int { lock.withLock { calls } }
    var mostAtOnce: Int { lock.withLock { peak } }

    func next() -> Data? {
        let (index, gate): (Int, Gate?) = lock.withLock {
            calls += 1
            running += 1
            peak = max(peak, running)
            return (calls - 1, blockAllOn ?? (calls == 1 ? blockFirstOn : nil))
        }
        gate?.wait()
        return lock.withLock {
            running -= 1
            if index < responses.count { return responses[index] }
            return repeating ? responses.last ?? nil : nil
        }
    }
}

/// Holds a blocked read until the test opens it; a wait gives up after 10 s.
private final class Gate: @unchecked Sendable {
    private let semaphore = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var isOpen = false

    func wait() {
        if lock.withLock({ isOpen }) { return }
        _ = semaphore.wait(timeout: .now() + 10)
    }

    func open() {
        lock.withLock { isOpen = true }
        for _ in 0..<16 { semaphore.signal() }
    }
}
