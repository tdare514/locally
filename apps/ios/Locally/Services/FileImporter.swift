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
    /// The track number the file's own track tag (TRCK/trkn) carries, or nil when it has none.
    /// Only used to order a multi-disc import, where a file with no track tag sorts last in its disc.
    var tagTrackNumber: Int?
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
            let (tags, trackNumber) = await readExistingTags(url: dest, fallbackTitle: url.deletingPathExtension().lastPathComponent)
            return StagedFile(url: dest, originalName: originalName, existingTags: tags, tagTrackNumber: trackNumber)
        } catch {
            throw LocallyError.importFailed(error.localizedDescription)
        }
    }

    private func readExistingTags(url: URL, fallbackTitle: String) async -> (tags: TagSet, trackNumber: Int?) {
        let asset = AVAsset(url: url)
        var title = fallbackTitle
        var artist = ""
        var album = ""
        var genre: String?
        var creationDate: String?
        var recordingTime: String?
        var id3Year: String?
        var id3Day: String?
        var releaseDateAtom: String?
        var trackTag: (number: Int, total: Int?)?
        var discTag: (number: Int, total: Int?)?

        do {
            let formats = try await asset.load(.availableMetadataFormats)
            for format in formats {
                let items = try await asset.loadMetadata(for: format)
                for item in items {
                    if let pair = await Self.numberPair(of: item) {
                        if pair.isDisc { discTag = (pair.number, pair.total) } else { trackTag = (pair.number, pair.total) }
                        continue
                    }
                    switch item.identifier {
                    case .id3MetadataRecordingTime: recordingTime = (try? await item.load(.stringValue)) ?? recordingTime
                    case .id3MetadataYear: id3Year = (try? await item.load(.stringValue)) ?? id3Year
                    case .id3MetadataDate: id3Day = (try? await item.load(.stringValue)) ?? id3Day
                    case .iTunesMetadataReleaseDate: releaseDateAtom = (try? await item.load(.stringValue)) ?? releaseDateAtom
                    default: break
                    }
                    guard let key = item.commonKey else { continue }
                    let value = try? await item.load(.stringValue)
                    switch key {
                    case .commonKeyTitle: title = value ?? title
                    case .commonKeyArtist: artist = value ?? artist
                    case .commonKeyAlbumName: album = value ?? album
                    case .commonKeyType: genre = value ?? genre
                    case .commonKeyCreationDate: creationDate = value ?? creationDate
                    default: break
                    }
                }
            }
        } catch {
            // No embedded metadata (or unreadable) — fall back to filename-derived title.
        }

        // A disc outside 1...99 is ignored, and so is a track number below 1. The track number stays
        // nil when the file has none, so an untagged file sorts last in its disc.
        let disc = discTag.flatMap { DiscNumbering.isValidDisc($0.number) ? $0 : nil }
        let trackNumber = trackTag.flatMap { $0.number >= 1 ? $0.number : nil }
        // The most precise date the file has: TDRC, then TYER (with TDAT's DDMM), then ©day, then the creation date.
        let date = recordingTime.flatMap(ReleaseDate.fromTag)
            ?? Self.id3YearAndDay(year: id3Year, day: id3Day)
            ?? releaseDateAtom.flatMap(ReleaseDate.fromTag)
            ?? creationDate.flatMap(ReleaseDate.fromTag)
        let tags = TagSet(
            title: title,
            artist: artist,
            album: album.isEmpty ? title : album,
            date: date,
            genre: genre,
            discNumber: disc?.number,
            totalDiscs: disc?.total
        )
        return (tags, trackNumber)
    }

    /// TYER's year, made a day when TDAT's "DDMM" is present and gives a real date for that year.
    static func id3YearAndDay(year: String?, day: String?) -> ReleaseDate? {
        guard let year, let base = ReleaseDate.fromTag(year) else { return nil }
        let digits = day?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard digits.count == 4, digits.allSatisfy({ $0.isASCII && $0.isNumber }),
              let dd = Int(digits.prefix(2)), let mm = Int(digits.suffix(2)),
              let full = ReleaseDate(year: base.year, month: mm, day: dd) else { return base }
        return full
    }

    /// The track or disc number an item carries: TRCK/TPOS as text (`2/3`), trkn/disk as the
    /// raw iTunes data. Nil for any other item, or one whose value doesn't parse.
    private static func numberPair(of item: AVMetadataItem) async -> (isDisc: Bool, number: Int, total: Int?)? {
        switch item.identifier {
        case AVMetadataIdentifier.id3MetadataTrackNumber, AVMetadataIdentifier.id3MetadataPartOfASet:
            guard let text = try? await item.load(.stringValue), let pair = DiscNumbering.parsePair(text) else { return nil }
            return (item.identifier == .id3MetadataPartOfASet, pair.number, pair.total)
        case AVMetadataIdentifier.iTunesMetadataTrackNumber, AVMetadataIdentifier.iTunesMetadataDiscNumber:
            guard let data = try? await item.load(.dataValue), let pair = DiscNumbering.parseITunesPair(data) else { return nil }
            return (item.identifier == .iTunesMetadataDiscNumber, pair.number, pair.total)
        default:
            return nil
        }
    }
}
