import Foundation
import AVFoundation
import CoreMedia

/// Writes iTunes-style metadata atoms (©nam, ©ART, aART, ©alb, trkn, ©day,
/// ©gen, covr) into an m4a file by re-exporting it with
/// `AVAssetExportPresetPassthrough` and a metadata item list — the audio
/// itself is copied through untouched, only the metadata track changes.
final class M4ATagWriter: TagWriter {
    /// Swaps `replacement` over `original` in place. Injected so tests can
    /// make the swap fail without touching AVFoundation's export path.
    typealias ReplaceItem = (_ original: URL, _ replacement: URL) throws -> Void

    private let replaceItem: ReplaceItem

    init(replaceItem: @escaping ReplaceItem = { original, replacement in
        _ = try FileManager.default.replaceItemAt(original, withItemAt: replacement)
    }) {
        self.replaceItem = replaceItem
    }

    func write(_ tags: TagSet, cover: Data?, to url: URL) async throws {
        let asset = AVAsset(url: url)
        // `AVAssetExportSession` isn't `Sendable`; the completion handler
        // below only ever touches it from the callback queue it's already
        // confined to, so the capture is safe even though the compiler
        // can't verify that itself.
        nonisolated(unsafe) let exportSession: AVAssetExportSession
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
            throw LocallyError.taggingFailed(Copy.FileErrors.cannotTagFile)
        }
        exportSession = session

        // Same directory as the target so `replaceItemAt` is a rename on the same volume,
        // and `.tmp` so Spotify's scanner never indexes a half-written export if the app
        // dies before the swap. The container format comes from `outputFileType`, not the name.
        let tmpOutput = url.deletingLastPathComponent()
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("tmp")

        exportSession.outputURL = tmpOutput
        exportSession.outputFileType = .m4a
        exportSession.metadata = metadataItems(for: tags, cover: cover)

        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                exportSession.exportAsynchronously {
                    switch exportSession.status {
                    case .completed:
                        continuation.resume()
                    case .failed, .cancelled:
                        let message = exportSession.error?.localizedDescription ?? "Tagging failed."
                        continuation.resume(throwing: LocallyError.taggingFailed(message))
                    default:
                        continuation.resume(throwing: LocallyError.taggingFailed(Copy.FileErrors.unexpectedExportState))
                    }
                }
            }
        } catch {
            removeTempOutput(tmpOutput)
            throw error
        }

        // Replace the original in place so callers can keep treating `url`
        // as the file's final location. A failed swap is a tagging failure:
        // the caller must not index a file whose tags never landed.
        do {
            try replaceItem(url, tmpOutput)
        } catch {
            removeTempOutput(tmpOutput)
            throw LocallyError.taggingFailed(error.localizedDescription)
        }
        guard FileManager.default.fileExists(atPath: url.path) else {
            removeTempOutput(tmpOutput)
            throw LocallyError.taggingFailed(Copy.FileErrors.taggedFileMissing)
        }
    }

    /// Removes the writer's own temp export, if it exists. Only ever called
    /// with `tmpOutput`, a file this writer created next to `url`; never
    /// with `url` itself.
    private func removeTempOutput(_ tmpOutput: URL) {
        guard FileManager.default.fileExists(atPath: tmpOutput.path) else { return }
        try? FileManager.default.removeItem(at: tmpOutput)
    }

    private func metadataItems(for tags: TagSet, cover: Data?) -> [AVMetadataItem] {
        var items: [AVMetadataItem] = []

        items.append(item(.iTunesMetadataSongName, value: tags.title))
        items.append(item(.iTunesMetadataArtist, value: tags.artist))
        items.append(item(.iTunesMetadataAlbumArtist, value: tags.albumArtist))
        items.append(item(.iTunesMetadataAlbum, value: tags.album))
        if let genre = tags.genre, !genre.isEmpty {
            items.append(item(.iTunesMetadataUserGenre, value: genre))
        }
        if let year = tags.year, !year.isEmpty {
            items.append(item(.iTunesMetadataReleaseDate, value: year))
        }
        items.append(trackNumberItem(track: tags.trackNumber, total: tags.totalTracks))
        if let cover {
            items.append(coverItem(cover))
        }

        return items
    }

    private func item(_ identifier: AVMetadataIdentifier, value: String) -> AVMetadataItem {
        let metadataItem = AVMutableMetadataItem()
        metadataItem.identifier = identifier
        metadataItem.value = value as NSString
        metadataItem.dataType = kCMMetadataBaseDataType_UTF8 as String
        return metadataItem
    }

    /// `trkn` needs the raw iTunes data form: 8 bytes, big-endian
    /// `00 00 <track> <total> 00 00`.
    private func trackNumberItem(track: Int, total: Int) -> AVMetadataItem {
        var bytes = [UInt8](repeating: 0, count: 8)
        bytes[2] = UInt8((track >> 8) & 0xFF)
        bytes[3] = UInt8(track & 0xFF)
        bytes[4] = UInt8((total >> 8) & 0xFF)
        bytes[5] = UInt8(total & 0xFF)
        let data = Data(bytes)

        let metadataItem = AVMutableMetadataItem()
        metadataItem.identifier = .iTunesMetadataTrackNumber
        metadataItem.value = data as NSData
        metadataItem.dataType = kCMMetadataBaseDataType_RawData as String
        return metadataItem
    }

    private func coverItem(_ data: Data) -> AVMetadataItem {
        let metadataItem = AVMutableMetadataItem()
        metadataItem.identifier = .iTunesMetadataCoverArt
        metadataItem.value = data as NSData
        metadataItem.dataType = kCMMetadataBaseDataType_JPEG as String
        return metadataItem
    }
}
