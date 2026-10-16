import AVFoundation
import SwiftUI

/// Reads a track's length from its audio file, off the main thread, and remembers it per URL
/// so a row scrolling back into view does not read the file again.
actor TrackLengthLoader {
    static let shared = TrackLengthLoader()

    private var cache: [URL: Double] = [:]

    func duration(of url: URL) async -> Double? {
        if let cached = cache[url] { return cached }
        guard let seconds = await Self.read(url) else { return nil }
        cache[url] = seconds
        return seconds
    }

    /// The file's length in seconds, or nil when it cannot be read. Not cached.
    static func read(_ url: URL) async -> Double? {
        guard let time = try? await AVURLAsset(url: url).load(.duration) else { return nil }
        let seconds = time.seconds
        return seconds.isFinite && seconds > 0 ? seconds : nil
    }
}

/// Supplies a track row with its length: the stored value when there is one, otherwise the
/// file's, read once through `TrackLengthLoader`.
struct TrackLengthReader<Content: View>: View {
    let stored: Double?
    let url: URL?
    @ViewBuilder let content: (Double?) -> Content

    @State private var loaded: Double?

    var body: some View {
        content(stored ?? loaded)
            .task(id: url) {
                guard stored == nil, let url else { return }
                loaded = await TrackLengthLoader.shared.duration(of: url)
            }
    }
}
