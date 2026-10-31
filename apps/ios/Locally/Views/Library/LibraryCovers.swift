import SwiftUI
import UIKit

/// Covers for the Library's rows and tiles (#423): each tile reads its own cover as it nears the screen, so memory
/// follows what is shown rather than the whole library. Decoded images sit in an `NSCache` bounded by their bytes
/// (64 MB), at most `maxConcurrent` reads run at once, and a request that is cancelled (its tile scrolled away, the
/// layout changed) stops before it reads or decodes. A cover that is missing is never remembered, so one that arrives
/// later is found by the next ask, and a cover rewritten on disk is read again, because its file's modification date
/// is checked when a tile asks. The loader turns a release id into its cover bytes (production: `CoverStore.load`);
/// the revision turns it into when those bytes were last written (production: `CoverStore.revision`).
final class LibraryCoverCache: @unchecked Sendable {
    typealias Loader = @Sendable (UUID) -> Data?
    typealias Revision = @Sendable (UUID) -> Date?

    /// A decoded cover and the revision of the bytes it came from.
    private final class Entry: NSObject {
        let image: UIImage
        let revision: Date?

        init(image: UIImage, revision: Date?) {
            self.image = image
            self.revision = revision
        }
    }

    private let loader: Loader
    private let revision: Revision
    private let cache = NSCache<NSString, Entry>()
    private let slots: CoverSlots

    init(loader: @escaping Loader, revision: @escaping Revision = { _ in nil },
         costLimit: Int = 64 << 20, maxConcurrent: Int = 4) {
        self.loader = loader
        self.revision = revision
        slots = CoverSlots(count: maxConcurrent)
        cache.totalCostLimit = costLimit
    }

    /// An image's cost in the cache: its decoded bytes.
    static func cost(of image: UIImage) -> Int {
        guard let cg = image.cgImage else { return 0 }
        return cg.bytesPerRow * cg.height
    }

    /// The cover held for this release at `pixels`, if any, so a tile already cached draws on its first frame. It may
    /// be one revision behind: `image(...)` checks the file and returns the current one.
    func cached(id: UUID, updatedAt: Date, pixels: CGFloat) -> UIImage? {
        cache.object(forKey: Self.key(id: id, updatedAt: updatedAt, pixels: pixels))?.image
    }

    /// The cover for this release at `pixels`: held while its file's revision is unchanged, otherwise read and decoded
    /// off the main thread once a slot is free. Nil when the release has no cover, the bytes are not an image, or the
    /// request was cancelled; nil is never kept, and a cover that is gone or no longer an image is dropped.
    func image(id: UUID, updatedAt: Date, pixels: CGFloat) async -> UIImage? {
        let key = Self.key(id: id, updatedAt: updatedAt, pixels: pixels)
        // The revision is read before the bytes: a save landing between the two costs one extra read later, never a
        // stale entry.
        let current = await currentRevision(id: id)
        if let hit = cache.object(forKey: key), hit.revision == current { return hit.image }
        guard await slots.acquire() else { return nil }
        let image: UIImage?
        if let hit = cache.object(forKey: key), hit.revision == current {
            image = hit.image
        } else if Task.isCancelled {
            image = nil
        } else {
            image = await read(id: id, pixels: pixels)
            if let image {
                cache.setObject(Entry(image: image, revision: current), forKey: key, cost: Self.cost(of: image))
            } else if !Task.isCancelled {
                cache.removeObject(forKey: key)
            }
        }
        await slots.release()
        return image
    }

    /// How many requests wait for a slot. For tests.
    func waitingCount() async -> Int { await slots.waitingCount }

    /// The cover file's revision, read on a detached task so the file system is never touched on the main thread.
    private func currentRevision(id: UUID) async -> Date? {
        let revision = self.revision
        return await Task.detached(priority: .userInitiated) { revision(id) }.value
    }

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
/// and has since arrived. A cover the cache already holds draws on the first frame, and the same ask then checks the
/// file's revision: it keeps that image when the file is unchanged and swaps in the new one when it was rewritten. It
/// keeps showing what it has meanwhile.
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
        } else if shown != cover {
            phase = .loading
        }
        let image = await cache.image(id: id, updatedAt: updatedAt, pixels: pixels)
        guard !Task.isCancelled else { return }
        if case .found(let current) = phase, let image, current === image {
            shown = cover
            return
        }
        phase = image.map { .found($0) } ?? .none
        shown = cover
    }
}
