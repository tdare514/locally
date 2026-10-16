import SwiftUI

/// Reads a track's length through a `TrackDurationReading`, and remembers it per URL
/// so a row scrolling back into view does not read the file again.
actor TrackLengthLoader: TrackDurationReading {
    static let shared = TrackLengthLoader()

    private let reader: TrackDurationReading
    private var cache: [URL: Double] = [:]

    init(reader: TrackDurationReading = AVTrackDurationReader()) {
        self.reader = reader
    }

    func duration(of url: URL) async -> Double? {
        if let cached = cache[url] { return cached }
        guard let seconds = await reader.duration(of: url) else { return nil }
        cache[url] = seconds
        return seconds
    }
}

/// The length a row shows, keyed by the URL it was read for. A read that finishes after the
/// URL has changed (a replaced file) is dropped, so an older read never shows against a newer file.
@MainActor
final class TrackLengthState: ObservableObject {
    @Published private(set) var loaded: (url: URL, seconds: Double?)?
    private var currentURL: URL?

    /// The loaded length, only when it was read for `url`.
    func seconds(for url: URL?) -> Double? {
        guard let url, let loaded, loaded.url == url else { return nil }
        return loaded.seconds
    }

    func load(url: URL?, reader: TrackDurationReading) async {
        currentURL = url
        loaded = nil
        guard let url else { return }
        let seconds = await reader.duration(of: url)
        guard !Task.isCancelled, currentURL == url else { return }
        loaded = (url, seconds)
    }
}

/// Supplies a track row with its length: the stored value when there is one, otherwise the
/// file's, read once through `TrackLengthLoader`.
struct TrackLengthReader<Content: View>: View {
    let stored: Double?
    let url: URL?
    @ViewBuilder let content: (Double?) -> Content

    @StateObject private var state = TrackLengthState()

    var body: some View {
        content(stored ?? state.seconds(for: url))
            .task(id: url) {
                guard stored == nil else { return }
                await state.load(url: url, reader: TrackLengthLoader.shared)
            }
    }
}
