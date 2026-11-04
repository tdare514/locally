import Foundation

/// What the scan needs from one audio file (the Mac's `AdoptFileTags`). `albumArtist` is TPE2/aART.
struct AdoptFileTags: Equatable {
    var title: String?
    var artist: String?
    var albumArtist: String?
    var album: String?
    /// Four-digit year.
    var year: String?
    var genre: String?
    var trackNumber: Int?
    var discNumber: Int?
    var durationSec: Double?
    var hasCover: Bool
    /// True for an mp4 that carries a video track.
    var hasVideo: Bool

    init(
        title: String? = nil, artist: String? = nil, albumArtist: String? = nil, album: String? = nil,
        year: String? = nil, genre: String? = nil, trackNumber: Int? = nil, discNumber: Int? = nil,
        durationSec: Double? = nil, hasCover: Bool = false, hasVideo: Bool = false
    ) {
        self.title = title
        self.artist = artist
        self.albumArtist = albumArtist
        self.album = album
        self.year = year
        self.genre = genre
        self.trackNumber = trackNumber
        self.discNumber = discNumber
        self.durationSec = durationSec
        self.hasCover = hasCover
        self.hasVideo = hasVideo
    }
}

/// One audio file found in the Spotify folder, with its tags. `path` is relative to the folder.
struct ScannedFile: Equatable {
    var path: String
    var tags: AdoptFileTags
}

/// One track of a proposed release.
struct ProposedTrack: Equatable {
    /// Relative to the Spotify folder.
    var path: String
    var title: String
    var trackNumber: Int
    var discNumber: Int?
    var durationSec: Double
    /// The `spotify:local:` id Spotify builds from the file's tags.
    var localId: String
}

/// A release the scan suggests adopting: one folder, one album artist and album, or one single.
struct ProposedGroup: Identifiable, Equatable {
    /// Stable across rescans: a hash of the folder and the grouping key.
    var key: String
    var folder: String
    var kind: ReleaseKind
    var title: String
    var artist: String
    var year: String?
    var genre: String?
    /// Relative path of the first file with embedded art, or nil.
    var coverFrom: String?
    var tracks: [ProposedTrack]

    var id: String { key }
}

/// Groups scanned files into proposed releases the way the Mac does (#245 decision 4), one folder at a time:
/// files with the same album artist (TPE2/aART) and album form one release, an album when it has two or more
/// tracks; a file with no album tag is a single titled from its title tag or file name; tracks run by disc, then
/// track tag, then file name. Pure, so it is tested without a disk.
enum AdoptGrouping {
    /// The Mac's `Intl.Collator("en", { numeric: true, sensitivity: "base" })`: digits by value, case and accents ignored.
    static func collate(_ a: String, _ b: String) -> ComparisonResult {
        a.compare(b, options: [.numeric, .caseInsensitive, .diacriticInsensitive], range: nil, locale: Locale(identifier: "en"))
    }

    static func group(_ files: [ScannedFile]) -> [ProposedGroup] {
        var folders: [String: [ScannedFile]] = [:]
        for file in files {
            folders[folder(of: file.path), default: []].append(file)
        }
        var groups: [ProposedGroup] = []
        for folder in folders.keys.sorted(by: { collate($0, $1) == .orderedAscending }) {
            let inFolder = folders[folder] ?? []
            // Buckets keep the order their key first appears in, like a JavaScript Map.
            var order: [String] = []
            var buckets: [String: [ScannedFile]] = [:]
            for file in inFolder {
                let key: String
                if let album = file.tags.album {
                    key = "album\0\(file.tags.albumArtist ?? "")\0\(album)"
                } else {
                    key = "file\0\(fileName(of: file.path))"
                }
                if buckets[key] == nil { order.append(key) }
                buckets[key, default: []].append(file)
            }
            for key in order {
                groups.append(makeGroup(folder: folder, groupKey: key, members: buckets[key] ?? []))
            }
        }
        return groups
    }

    // MARK: Paths

    static func folder(of path: String) -> String {
        guard let slash = path.lastIndex(of: "/") else { return "" }
        return String(path[path.startIndex..<slash])
    }

    static func fileName(of path: String) -> String {
        guard let slash = path.lastIndex(of: "/") else { return path }
        return String(path[path.index(after: slash)...])
    }

    private static func baseName(of path: String) -> String {
        (fileName(of: path) as NSString).deletingPathExtension
    }

    // MARK: Group

    private static func makeGroup(folder: String, groupKey: String, members: [ScannedFile]) -> ProposedGroup {
        let sorted = members.sorted { a, b in
            let aDisc = a.tags.discNumber ?? 0, bDisc = b.tags.discNumber ?? 0
            if aDisc != bDisc { return aDisc < bDisc }
            let aTrack = a.tags.trackNumber ?? Int.max, bTrack = b.tags.trackNumber ?? Int.max
            if aTrack != bTrack { return aTrack < bTrack }
            return collate(fileName(of: a.path), fileName(of: b.path)) == .orderedAscending
        }
        let first = sorted[0]
        let album = first.tags.album
        func fileTitle(_ file: ScannedFile) -> String { file.tags.title ?? baseName(of: file.path) }
        let artist = first.tags.albumArtist
            ?? mostCommon(sorted.compactMap { $0.tags.artist })
            ?? ""
        let tracks: [ProposedTrack] = sorted.enumerated().map { index, file in
            let duration = file.tags.durationSec ?? 0
            return ProposedTrack(
                path: file.path,
                title: fileTitle(file),
                trackNumber: file.tags.trackNumber ?? index + 1,
                discNumber: file.tags.discNumber,
                durationSec: duration,
                localId: LocalId.build(
                    artist: file.tags.artist ?? "", album: file.tags.album ?? "",
                    title: fileTitle(file), durationSec: duration
                )
            )
        }
        let isAlbum = album != nil && sorted.count >= 2
        return ProposedGroup(
            key: key(folder: folder, groupKey: groupKey),
            folder: folder,
            kind: isAlbum ? .album : .single,
            title: album ?? fileTitle(first),
            artist: artist,
            year: sorted.compactMap { $0.tags.year }.first,
            genre: sorted.compactMap { $0.tags.genre }.first,
            coverFrom: sorted.first { $0.tags.hasCover }?.path,
            tracks: tracks
        )
    }

    /// 16 hex characters of a SHA-256 of the folder and the grouping key.
    static func key(folder: String, groupKey: String) -> String {
        String(Data("\(folder)\0\(groupKey)".utf8).sha256Hex.prefix(16))
    }

    /// The value that appears most often; on a tie the one seen first.
    private static func mostCommon(_ values: [String]) -> String? {
        var counts: [String: Int] = [:]
        var order: [String] = []
        for value in values {
            if counts[value] == nil { order.append(value) }
            counts[value, default: 0] += 1
        }
        var best: String?
        var bestCount = 0
        for value in order where (counts[value] ?? 0) > bestCount {
            best = value
            bestCount = counts[value] ?? 0
        }
        return best
    }
}
