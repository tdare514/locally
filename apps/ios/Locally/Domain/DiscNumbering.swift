import Foundation

/// Disc numbers for multi-disc releases (#113), as pure functions shared by the tag writers, the
/// importer and the track lists. Mirrors `apps/web/src/shared/discs.ts`.
///
/// `Track.trackNumber` stays the release-wide position (it names the file and keys the sync
/// record); `Track.discNumber` is optional. The number written into a file's track tag is derived
/// here, per disc.
enum DiscNumbering {
    /// Highest disc number a record may carry.
    static let maxDisc = 99

    /// True for an integer from 1 to `maxDisc`: what a tag or a sync record may hold as a disc.
    static func isValidDisc(_ number: Int) -> Bool {
        (1...maxDisc).contains(number)
    }

    /// What to write into one file's tags: `trkn`/TRCK as `trackNumber/totalTracks`, `disk`/TPOS as
    /// `discNumber/totalDiscs` when set.
    struct TagNumbers: Equatable {
        var trackNumber: Int
        var totalTracks: Int
        var discNumber: Int?
        var totalDiscs: Int?
    }

    /// The tag numbers for every track, in the order `tracks` gives.
    ///
    /// With no `discNumber` anywhere this is exactly what the tags held before discs existed: the
    /// track's own `trackNumber` over the release's track count, and no disc. Once any track has a
    /// disc, a track without one counts as disc 1; each track's number becomes its 1-based position
    /// among the tracks of the same disc (ordered by `trackNumber`), the total is that disc's track
    /// count, and `totalDiscs` is the highest disc number in the release.
    static func tagNumbers(for tracks: [(trackNumber: Int, discNumber: Int?)]) -> [TagNumbers] {
        guard tracks.contains(where: { $0.discNumber != nil }) else {
            return tracks.map {
                TagNumbers(trackNumber: $0.trackNumber, totalTracks: tracks.count, discNumber: nil, totalDiscs: nil)
            }
        }

        let discs = tracks.map { $0.discNumber ?? 1 }
        let totalDiscs = discs.max() ?? 1
        var indicesByDisc: [Int: [Int]] = [:]
        for (index, disc) in discs.enumerated() {
            indicesByDisc[disc, default: []].append(index)
        }

        var numbers = [TagNumbers?](repeating: nil, count: tracks.count)
        for (disc, indices) in indicesByDisc {
            let ordered = indices.sorted { a, b in
                tracks[a].trackNumber != tracks[b].trackNumber ? tracks[a].trackNumber < tracks[b].trackNumber : a < b
            }
            for (rank, index) in ordered.enumerated() {
                numbers[index] = TagNumbers(
                    trackNumber: rank + 1,
                    totalTracks: ordered.count,
                    discNumber: disc,
                    totalDiscs: totalDiscs
                )
            }
        }
        return numbers.compactMap { $0 }
    }

    /// For each row, the disc whose heading goes above it, or nil for no heading. Headings appear
    /// only when the rows span more than one distinct disc, and one goes above each row whose disc
    /// differs from the row before it (a row with no disc counts as disc 1). Presentational: the
    /// order of the rows is never changed.
    static func headings(for discs: [Int?]) -> [Int?] {
        let resolved = discs.map { $0 ?? 1 }
        guard Set(resolved).count > 1 else { return resolved.map { _ -> Int? in nil } }
        return resolved.enumerated().map { index, disc -> Int? in
            index == 0 || disc != resolved[index - 1] ? disc : nil
        }
    }

    /// The items in (disc, the file's own track number) order, for an import whose files carry disc
    /// tags. Items that tie keep the order they came in, and an item with no track tag sorts after
    /// the numbered items of its disc. When no item has a disc tag the order is returned untouched
    /// ("files without disc tags behave as today"). The caller then assigns continuous
    /// `trackNumber` values from the new positions.
    static func ordered<T>(_ items: [T], disc: (T) -> Int?, trackTag: (T) -> Int?) -> [T] {
        guard items.contains(where: { disc($0) != nil }) else { return items }
        return items.enumerated().sorted { a, b in
            let discA = disc(a.element) ?? 1
            let discB = disc(b.element) ?? 1
            if discA != discB { return discA < discB }
            let trackA = trackTag(a.element) ?? Int.max
            let trackB = trackTag(b.element) ?? Int.max
            if trackA != trackB { return trackA < trackB }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// `N` or `N/TOTAL` as ID3 TRCK and TPOS carry it ("2/3", " 2 / 3 ", "2"). Nil when `N` is not
    /// a number; a missing or unreadable total is nil.
    static func parsePair(_ text: String) -> (number: Int, total: Int?)? {
        let parts = text.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false)
        guard let first = parts.first, let number = Int(first.trimmingCharacters(in: .whitespaces)) else { return nil }
        let total = parts.count > 1 ? Int(parts[1].trimmingCharacters(in: .whitespaces)) : nil
        return (number, total)
    }

    /// The iTunes `trkn`/`disk` data form: `00 00 <number> <total> ...`, two bytes each, big-endian.
    /// Nil when it is too short to hold both.
    static func parseITunesPair(_ data: Data) -> (number: Int, total: Int?)? {
        let bytes = [UInt8](data)
        guard bytes.count >= 6 else { return nil }
        let number = Int(bytes[2]) << 8 | Int(bytes[3])
        let total = Int(bytes[4]) << 8 | Int(bytes[5])
        return (number, total == 0 ? nil : total)
    }
}
