import SwiftUI
import UIKit

/// Covers for the Library's rows and tiles (#423): each tile reads its own cover as it nears the screen, so memory
/// follows what is shown rather than the whole library. Decoded images sit in an `NSCache` bounded by their bytes
/// (64 MB), at most `maxConcurrent` reads run at once, and a request that is cancelled (its tile scrolled away, the
/// layout changed) stops before it reads or decodes. A cover that is missing is never remembered, so one that arrives
/// later is found by the next ask. The loader turns a release id into its cover bytes (production: `CoverStore.load`).
final class LibraryCoverCache: @unchecked Sendable {
    typealias Loader = @Sendable (UUID) -> Data?

    private let loader: Loader
    private let cache = NSCache<NSString, UIImage>()
    private let slots: CoverSlots

    init(loader: @escaping Loader, costLimit: Int = 64 << 20, maxConcurrent: Int = 4) {
        self.loader = loader
        slots = CoverSlots(count: maxConcurrent)
        cache.totalCostLimit = costLimit
    }

    /// An image's cost in the cache: its decoded bytes.
    static func cost(of image: UIImage) -> Int {
        guard let cg = image.cgImage else { return 0 }
        return cg.bytesPerRow * cg.height
    }

    /// The cover held for this release at `pixels`, if any, so a tile already cached draws on its first frame.
    func cached(id: UUID, updatedAt: Date, pixels: CGFloat) -> UIImage? {
        cache.object(forKey: Self.key(id: id, updatedAt: updatedAt, pixels: pixels))
    }

    /// The cover for this release at `pixels`: held, or read and decoded off the main thread once a slot is free.
    /// Nil when the release has no cover, the bytes are not an image, or the request was cancelled; nil is never kept.
    func image(id: UUID, updatedAt: Date, pixels: CGFloat) async -> UIImage? {
        let key = Self.key(id: id, updatedAt: updatedAt, pixels: pixels)
        if let hit = cache.object(forKey: key) { return hit }
        guard await slots.acquire() else { return nil }
        let image: UIImage?
        if let hit = cache.object(forKey: key) {
            image = hit
        } else if Task.isCancelled {
            image = nil
        } else {
            image = await read(id: id, pixels: pixels)
        }
        await slots.release()
        if let image { cache.setObject(image, forKey: key, cost: Self.cost(of: image)) }
        return image
    }

    /// How many requests wait for a slot. For tests.
    func waitingCount() async -> Int { await slots.waitingCount }

    /// The read and the decode, on a detached task that the caller's cancellation reaches; it checks before each step.
    private func read(id: UUID, pixels: CGFloat) async -> UIImage? {
        let loader = self.loader
        let work = Task.detached(priority: .userInitiated) { () -> ImageBox in
            guard !Task.isCancelled, let data = loader(id) else { return ImageBox(image: nil) }
            guard !Task.isCancelled else { return ImageBox(image: nil) }
            return ImageBox(image: CoverThumbnail.image(from: data, maxPixels: pixels))
        }
        return await withTaskCancellationHandler {
            await work.value.image
        } onCancel: {
            work.cancel()
        }
    }

    private static func key(id: UUID, updatedAt: Date, pixels: CGFloat) -> NSString {
        "\(id.uuidString)|\(updatedAt.timeIntervalSinceReferenceDate)|\(Int(pixels))" as NSString
    }

    private struct ImageBox: @unchecked Sendable {
        let image: UIImage?
    }
}

/// An async counting semaphore with a first-in, first-out queue. A waiter whose task is cancelled leaves the queue
/// without taking a slot.
actor CoverSlots {
    private var free: Int
    private var waiters: [(id: UUID, continuation: CheckedContinuation<Bool, Never>)] = []

    init(count: Int) { free = max(1, count) }

    var waitingCount: Int { waiters.count }

    /// True once a slot is held (call `release()` after); false when the task was cancelled first.
    func acquire() async -> Bool {
        if Task.isCancelled { return false }
        if free > 0 {
            free -= 1
            return true
        }
        let id = UUID()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                if Task.isCancelled {
                    continuation.resume(returning: false)
                } else {
                    waiters.append((id, continuation))
                }
            }
        } onCancel: {
            Task { await self.cancel(id) }
        }
    }

    /// Hands the slot to the longest waiter, or frees it.
    func release() {
        if waiters.isEmpty {
            free += 1
        } else {
            waiters.removeFirst().continuation.resume(returning: true)
        }
    }

    private func cancel(_ id: UUID) {
        guard let index = waiters.firstIndex(where: { $0.id == id }) else { return }
        waiters.remove(at: index).continuation.resume(returning: false)
    }
}

/// A Library cover filling its frame: the stored cover, the double note on `card` (#296) when there is none, and while
/// it is being read a still square once the read has taken 300 ms (#423). It asks `cache` when it appears (so a tile
/// scrolled away before its turn never reads) and again when `generation` moves, which finds a cover that was missing
/// and has since arrived. It keeps showing what it has meanwhile.
struct LibraryCoverView: View {
    let id: UUID
    let updatedAt: Date
    let pixels: CGFloat
    let cache: LibraryCoverCache
    let cornerRadius: CGFloat
    let generation: Int

    private enum Phase {
        case loading
        case found(UIImage)
        case none
    }

    /// Which release version the phase belongs to; a different one must not show the old cover.
    private struct Cover: Hashable {
        let id: UUID
        let updatedAt: Date
    }

    private struct Request: Hashable {
        let cover: Cover
        let pixels: CGFloat
        let generation: Int
    }

    @State private var phase: Phase
    @State private var shown: Cover?

    init(id: UUID, updatedAt: Date, pixels: CGFloat, cache: LibraryCoverCache, cornerRadius: CGFloat, generation: Int) {
        self.id = id
        self.updatedAt = updatedAt
        self.pixels = pixels
        self.cache = cache
        self.cornerRadius = cornerRadius
        self.generation = generation
        if let hit = cache.cached(id: id, updatedAt: updatedAt, pixels: pixels) {
            _phase = State(initialValue: .found(hit))
            _shown = State(initialValue: Cover(id: id, updatedAt: updatedAt))
        } else {
            _phase = State(initialValue: .loading)
            _shown = State(initialValue: nil)
        }
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius)
        content(shape: shape)
            .task(id: Request(cover: Cover(id: id, updatedAt: updatedAt), pixels: pixels, generation: generation)) {
                await refresh()
            }
    }

    @ViewBuilder
    private func content(shape: RoundedRectangle) -> some View {
        switch phase {
        case .found(let uiImage):
            Color.clear
                .overlay {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                }
                .clipShape(shape)
                .endsSignpost(.libraryFirstCover)
        case .none:
            NoCoverArt().clipShape(shape)
        case .loading:
            DelayedSkeleton { shape.fill(Theme.skeletonFill) }
        }
    }

    private func refresh() async {
        let cover = Cover(id: id, updatedAt: updatedAt)
        if let hit = cache.cached(id: id, updatedAt: updatedAt, pixels: pixels) {
            phase = .found(hit)
            shown = cover
            return
        }
        if shown != cover { phase = .loading }
        let image = await cache.image(id: id, updatedAt: updatedAt, pixels: pixels)
        guard !Task.isCancelled else { return }
        phase = image.map { .found($0) } ?? .none
        shown = cover
    }
}
