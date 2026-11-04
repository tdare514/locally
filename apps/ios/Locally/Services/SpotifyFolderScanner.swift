import AVFoundation
import Foundation

/// Reads the tags of one audio file where it sits, without copying it. A protocol so the scan is tested with
/// a fake instead of AVFoundation (#332). Read only.
protocol AdoptTagReading {
    func readTags(at url: URL) async throws -> AdoptFileTags
    /// The first embedded picture's bytes, or nil.
    func coverData(at url: URL) async -> Data?
}

/// Production `AdoptTagReading`: AVFoundation reads the ID3 and iTunes tags in place, the same items
/// `LocalFileImporter` reads from a staged copy.
struct AVAdoptTagReader: AdoptTagReading {
    func readTags(at url: URL) async throws -> AdoptFileTags {
        let asset = AVURLAsset(url: url)
        var title: String?
        var artist: String?
        var albumArtist: String?
        var album: String?
        var genre: String?
        var creationDate: String?
        var recordingTime: String?
        var id3Year: String?
        var id3Day: String?
        var releaseDateAtom: String?
        var trackTag: Int?
        var discTag: Int?
        var hasCover = false

        let formats = try await asset.load(.availableMetadataFormats)
        for format in formats {
            let items = try await asset.loadMetadata(for: format)
            for item in items {
                if let pair = await LocalFileImporter.numberPair(of: item) {
                    if pair.isDisc { discTag = pair.number } else { trackTag = pair.number }
                    continue
                }
                switch item.identifier {
                case .id3MetadataBand, .iTunesMetadataAlbumArtist:
                    albumArtist = Self.clean(try? await item.load(.stringValue)) ?? albumArtist
                case .id3MetadataRecordingTime: recordingTime = (try? await item.load(.stringValue)) ?? recordingTime
                case .id3MetadataYear: id3Year = (try? await item.load(.stringValue)) ?? id3Year
                case .id3MetadataDate: id3Day = (try? await item.load(.stringValue)) ?? id3Day
                case .iTunesMetadataReleaseDate: releaseDateAtom = (try? await item.load(.stringValue)) ?? releaseDateAtom
                default: break
                }
                guard let key = item.commonKey else { continue }
                if key == .commonKeyArtwork {
                    hasCover = true
                    continue
                }
                let value = Self.clean(try? await item.load(.stringValue))
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

        let date = recordingTime.flatMap(ReleaseDate.fromTag)
            ?? LocalFileImporter.id3YearAndDay(year: id3Year, day: id3Day)
            ?? releaseDateAtom.flatMap(ReleaseDate.fromTag)
            ?? creationDate.flatMap(ReleaseDate.fromTag)
        let seconds = (try? await asset.load(.duration))?.seconds
        let videoTracks = (try? await asset.loadTracks(withMediaType: .video)) ?? []
        return AdoptFileTags(
            title: title,
            artist: artist,
            albumArtist: albumArtist,
            album: album,
            year: date?.yearString,
            genre: genre,
            trackNumber: trackTag.flatMap { $0 >= 1 ? $0 : nil },
            discNumber: discTag.flatMap { DiscNumbering.isValidDisc($0) ? $0 : nil },
            durationSec: seconds.flatMap { $0.isFinite && $0 > 0 ? $0 : nil },
            hasCover: hasCover,
            hasVideo: !videoTracks.isEmpty
        )
    }

    func coverData(at url: URL) async -> Data? {
        let asset = AVURLAsset(url: url)
        guard let formats = try? await asset.load(.availableMetadataFormats) else { return nil }
        for format in formats {
            guard let items = try? await asset.loadMetadata(for: format) else { continue }
            for item in items where item.commonKey == .commonKeyArtwork {
                if let data = try? await item.load(.dataValue), !data.isEmpty { return data }
            }
        }
        return nil
    }

    /// Tags as the Mac's scanner reads them: trimmed, composed (NFC), empty as absent. `localId` is built from these.
    static func clean(_ raw: String?) -> String? {
        guard let trimmed = raw?.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        return trimmed
    }
}

/// What a scan found.
struct AdoptScan: Equatable {
    var groups: [ProposedGroup]
    /// Audio files left out, counted by lower-case extension (".flac"), plus files whose tags couldn't be read.
    var skipped: [String: Int]
    /// Folders the scan could not open.
    var unreadable: Int
}

/// Walks the Spotify folder (already opened by the caller, inside `SpotifyFolderAccess.withAccess`) and proposes
/// releases. Read only: it never writes, moves, re-tags or deletes. It skips hidden entries, symbolic links,
/// the whole top-level `Locally/` folder (Locally's own releases and delivered copies) and every path Locally
/// already tracks (#332).
struct SpotifyFolderScanner {
    var reader: AdoptTagReading

    /// What the wire format and Spotify's phone app both take. An mp4 is left out: the sync service takes mp3 and m4a only.
    static let adoptableExtensions: Set<String> = ["mp3", "m4a"]
    /// Audio Locally can't adopt, counted so the review can say so. Other files (pictures, playlists) are not counted.
    static let knownAudioExtensions: Set<String> = ["mp3", "m4a", "mp4", "flac", "wav", "aac", "ogg", "opus", "aif", "aiff", "wma", "alac"]

    struct Listing {
        /// Relative path and absolute URL of each adoptable file, in a stable order.
        var files: [(path: String, url: URL)] = []
        var skipped: [String: Int] = [:]
        var unreadable = 0
    }

    /// `tracked` holds paths relative to the folder that Locally already knows. `onProgress(done, total)` runs on
    /// the main actor as files are read.
    func scan(root: URL, tracked: Set<String>, onProgress: @MainActor (Int, Int) -> Void = { _, _ in }) async -> AdoptScan {
        let base = root.resolvingSymlinksInPath()
        var listing = Self.list(root: base)
        listing.files.removeAll { tracked.contains($0.path) }
        var skipped = listing.skipped
        var scanned: [ScannedFile] = []
        let total = listing.files.count
        for (index, entry) in listing.files.enumerated() {
            await onProgress(index, total)
            do {
                let tags = try await reader.readTags(at: entry.url)
                if tags.hasVideo {
                    skipped[".\((entry.path as NSString).pathExtension.lowercased())", default: 0] += 1
                    continue
                }
                scanned.append(ScannedFile(path: entry.path, tags: tags))
            } catch {
                skipped[".\((entry.path as NSString).pathExtension.lowercased())", default: 0] += 1
            }
        }
        await onProgress(total, total)
        return AdoptScan(groups: AdoptGrouping.group(scanned), skipped: skipped, unreadable: listing.unreadable)
    }

    /// Synchronous so the directory enumerator is never iterated from async code.
    static func list(root: URL, fileManager: FileManager = .default) -> Listing {
        var listing = Listing()
        let keys: [URLResourceKey] = [.isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey]
        var failedDirectories = 0
        guard let enumerator = fileManager.enumerator(
            at: root,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles, .skipsPackageDescendants],
            errorHandler: { _, _ in
                failedDirectories += 1
                return true
            }
        ) else {
            listing.unreadable = 1
            return listing
        }
        let rootCount = root.pathComponents.count
        var found: [(path: String, url: URL)] = []
        while let next = enumerator.nextObject() {
            guard let url = next as? URL else { continue }
            let values = try? url.resourceValues(forKeys: Set(keys))
            let relative = url.pathComponents.dropFirst(rootCount).joined(separator: "/")
            if values?.isSymbolicLink == true {
                if values?.isDirectory == true { enumerator.skipDescendants() }
                continue
            }
            if values?.isDirectory == true {
                // Locally's own folder at the top level: never scanned.
                if relative == Brand.folderName { enumerator.skipDescendants() }
                continue
            }
            guard values?.isRegularFile == true, !relative.isEmpty else { continue }
            let ext = url.pathExtension.lowercased()
            if adoptableExtensions.contains(ext) {
                found.append((relative, url))
            } else if knownAudioExtensions.contains(ext) {
                listing.skipped[".\(ext)", default: 0] += 1
            }
        }
        listing.unreadable = failedDirectories
        listing.files = found.sorted { AdoptGrouping.collate($0.path, $1.path) == .orderedAscending }
        return listing
    }
}
