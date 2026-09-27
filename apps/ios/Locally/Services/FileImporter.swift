import Foundation
import AVFoundation

/// A file that has been copied into the app's own tmp directory (out of the
/// security-scoped source) along with whatever tags it already carried, so
/// downstream steps never need to reopen the original URL.
struct StagedFile: Identifiable, Hashable {
    var id: UUID = UUID()
    var url: URL
    var originalName: String
    var existingTags: TagSet?
}

/// Copies picked/shared audio files into the app's own storage and reads
/// whatever tags they already carry, so later steps (transcoding, tagging)
/// never touch a security-scoped or otherwise transient URL.
protocol FileImporter {
    func stage(_ urls: [URL]) async throws -> [StagedFile]
}

/// Production `FileImporter`: copies each URL into a fresh tmp directory
/// (starting/stopping security-scoped access around the read) and reads
/// existing metadata via `AVAsset`.
final class LocalFileImporter: FileImporter {
    func stage(_ urls: [URL]) async throws -> [StagedFile] {
        var staged: [StagedFile] = []
        for url in urls {
            staged.append(try await stageOne(url))
        }
        return staged
    }

    private func stageOne(_ url: URL) async throws -> StagedFile {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }

        let originalName = url.lastPathComponent
        let destDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("Locally-Import-\(UUID().uuidString)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true)
            let dest = destDir.appendingPathComponent(originalName)
            try FileManager.default.copyItem(at: url, to: dest)
            let tags = await readExistingTags(url: dest, fallbackTitle: url.deletingPathExtension().lastPathComponent)
            return StagedFile(url: dest, originalName: originalName, existingTags: tags)
        } catch {
            throw LocallyError.importFailed(error.localizedDescription)
        }
    }

    private func readExistingTags(url: URL, fallbackTitle: String) async -> TagSet? {
        let asset = AVAsset(url: url)
        var title = fallbackTitle
        var artist = ""
        var album = ""
        var genre: String?
        var year: String?

        do {
            let formats = try await asset.load(.availableMetadataFormats)
            for format in formats {
                let items = try await asset.loadMetadata(for: format)
                for item in items {
                    guard let key = item.commonKey else { continue }
                    let value = try? await item.load(.stringValue)
                    switch key {
                    case .commonKeyTitle: title = value ?? title
                    case .commonKeyArtist: artist = value ?? artist
                    case .commonKeyAlbumName: album = value ?? album
                    case .commonKeyType: genre = value ?? genre
                    case .commonKeyCreationDate: year = value ?? year
                    default: break
                    }
                }
            }
        } catch {
            // No embedded metadata (or unreadable) — fall back to filename-derived title.
        }

        return TagSet(title: title, artist: artist, album: album.isEmpty ? title : album, year: year, genre: genre)
    }
}
