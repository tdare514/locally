import Foundation

/// Writes a `TagSet` (and optional cover art) into an audio file at `url`,
/// in place. One implementation per format (m4a via `AVAssetExportSession`
/// passthrough + metadata, mp3 via a minimal ID3v2.4 writer) so
/// `ReleaseCoordinator` can pick the right one by extension.
protocol TagWriter {
    func write(_ tags: TagSet, cover: Data?, to url: URL) async throws
}
