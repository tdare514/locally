import Foundation
import AVFoundation
import UniformTypeIdentifiers

/// A staged file that is now in a format Spotify's iOS app can read
/// (mp3 or m4a), ready for tagging.
struct PreparedFile: Identifiable, Hashable {
    var id: UUID = UUID()
    var url: URL
    /// "mp3" or "m4a".
    var ext: String
}

/// Ensures a staged file is mp3 or m4a, converting anything else (wav,
/// flac, aiff, …) to AAC m4a — iOS has no mp3 encoder, so that is the only
/// lossy-but-universal target available on-device.
protocol Transcoder {
    func prepare(_ file: StagedFile) async throws -> PreparedFile
}

/// Production `Transcoder`: passes mp3/m4a through untouched, and uses
/// `AVAssetExportSession` with the Apple M4A (AAC 256 kbps) preset for
/// everything else.
final class AVTranscoder: Transcoder {
    func prepare(_ file: StagedFile) async throws -> PreparedFile {
        let ext = file.url.pathExtension.lowercased()
        if SupportedAudio.passthrough.contains(ext) {
            return PreparedFile(url: file.url, ext: ext)
        }

        let asset = AVAsset(url: file.url)
        // `AVAssetExportSession` isn't `Sendable`; the completion handler
        // below only ever touches it from the callback queue it's already
        // confined to, so the capture is safe even though the compiler
        // can't verify that itself.
        nonisolated(unsafe) let exportSession: AVAssetExportSession
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw LocallyError.transcodeFailed(Copy.FileErrors.cannotConvertFile)
        }
        exportSession = session

        let outputURL = file.url.deletingLastPathComponent()
            .appendingPathComponent(file.url.deletingPathExtension().lastPathComponent)
            .appendingPathExtension("m4a")
        if FileManager.default.fileExists(atPath: outputURL.path) {
            try? FileManager.default.removeItem(at: outputURL)
        }

        exportSession.outputURL = outputURL
        exportSession.outputFileType = .m4a

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            exportSession.exportAsynchronously {
                switch exportSession.status {
                case .completed:
                    continuation.resume()
                case .failed, .cancelled:
                    let message = exportSession.error?.localizedDescription ?? "Export failed."
                    continuation.resume(throwing: LocallyError.transcodeFailed(message))
                default:
                    continuation.resume(throwing: LocallyError.transcodeFailed(Copy.FileErrors.unexpectedExportState))
                }
            }
        }

        return PreparedFile(url: outputURL, ext: "m4a")
    }
}
