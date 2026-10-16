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

    /// `discs` as they stand after a move, with the moved row (at `movedIndex`) joined to the disc it
    /// now sits in: the disc of the row directly above it, or of the row below when it is now first.
    /// Only a release that has discs is touched, and a neighbour with no disc counts as disc 1, so a
    /// moved row always ends up with a number. Because a row only ever joins its neighbour's disc,
    /// `headings` never repeats a heading after a move.
    static func adoptDiscAfterMove(_ discs: [Int?], movedIndex: Int) -> [Int?] {
        var out = discs
        let neighbour = movedIndex > 0 ? movedIndex - 1 : movedIndex + 1
        guard discs.contains(where: { $0 != nil }), discs.indices.contains(movedIndex), discs.indices.contains(neighbour) else {
            return out
        }
        out[movedIndex] = discs[neighbour] ?? 1
        return out
    }

    /// The row index where each disc range begins: row 0, and every row whose disc differs from the row
    /// before it (a row with no disc counts as disc 1). Discs are contiguous ranges.
    private static func rangeStarts(_ discs: [Int?]) -> [Int] {
        discs.indices.filter { $0 == 0 || (discs[$0] ?? 1) != (discs[$0 - 1] ?? 1) }
    }

    /// `discs` with the ranges that begin at `starts` numbered from the first row's disc (1 when it has
    /// none). One range numbered from 1 clears every disc number: the release goes back to no discs.
    private static func renumber(_ discs: [Int?], starts: [Int]) -> [Int?] {
        let base = discs.first.flatMap { $0 } ?? 1
        let clear = starts.count == 1 && base == 1
        var range = -1
        return discs.indices.map { index -> Int? in
            if starts.contains(index) { range += 1 }
            return clear ? nil : base + range
        }
    }

    /// `discs` with a new disc starting at row `index` (#222): that row and the rest of its disc range
    /// move up to a new disc, and later discs shift up by one. Unchanged for the first row, a row that
    /// already begins a disc, or an index outside the list. Mirrors `startDiscAt` in `discs.ts`.
    static func startDisc(at index: Int, in discs: [Int?]) -> [Int?] {
        let starts = rangeStarts(discs)
        guard index > 0, index < discs.count, !starts.contains(index) else { return discs }
        return renumber(discs, starts: (starts + [index]).sorted())
    }

    /// `discs` with the disc that begins at row `index` merged into the one before it (#222), later
    /// discs shifting down by one. Unchanged unless `index` is the first row of a disc after the first.
    /// Mirrors `joinPreviousDisc` in `discs.ts`.
    static func joinPreviousDisc(at index: Int, in discs: [Int?]) -> [Int?] {
        let starts = rangeStarts(discs)
        guard index > 0, starts.contains(index) else { return discs }
        return renumber(discs, starts: starts.filter { $0 != index })
    }

    /// What the disc menu offers on a row, as the disc numbers its labels show.
    struct Actions: Equatable {
        /// "Start disc N here": any row but the first, unless it already begins a disc.
        var start: Int?
        /// "Join disc N": the first row of a disc after the first; N is the disc before.
        var join: Int?

        var isEmpty: Bool { start == nil && join == nil }
    }

    /// The actions the menu offers on row `index`; none means a plain number. Mirrors `discActionsFor`.
    static func actions(for discs: [Int?], at index: Int) -> Actions {
        guard index > 0, index < discs.count else { return Actions() }
        let starts = rangeStarts(discs)
        let base = discs.first.flatMap { $0 } ?? 1
        if let position = starts.firstIndex(of: index) { return Actions(join: base + position - 1) }
        let range = starts.filter { $0 < index }.count - 1
        return Actions(start: base + range + 1)
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
