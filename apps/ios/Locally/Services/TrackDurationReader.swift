import AVFoundation
import Foundation

/// Reads how long an audio file is. A protocol so `ReleaseCoordinator` and the track-length
/// views can be tested with a fake instead of AVFoundation.
protocol TrackDurationReading {
    /// The file's length in seconds, or nil when it cannot be read.
    func duration(of url: URL) async -> Double?
}

/// Production `TrackDurationReading`: asks AVFoundation for the asset's duration.
struct AVTrackDurationReader: TrackDurationReading {
    func duration(of url: URL) async -> Double? {
        guard let time = try? await AVURLAsset(url: url).load(.duration) else { return nil }
        let seconds = time.seconds
        return seconds.isFinite && seconds > 0 ? seconds : nil
    }
}
