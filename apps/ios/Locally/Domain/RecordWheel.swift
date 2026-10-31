import Foundation

/// The Collections record player's wheel on the iPhone (#352, plan `docs/plans/339-collections.md` "The look"): a port
/// of the Mac's `record-player.ts` (#351), the same order, the same ends and the same window of rows. Pure: no UI,
/// so the geometry, the window and the snapping are tested without a screen.

/// The wheel's dial: a 48 pt sleeve, 76 pt between level rows at the front, each step 0.87 of the last. The hub
/// (the playing record) is tucked off the left edge (`Theme.Immersive.wheelCentreX`, #444), so `cx` is that centre and
/// rows ride the right of the dial. The radius and the step are chosen so neighbouring sleeves keep 8 pt apart
/// through the rows at full strength (the front three each side).
struct WheelGeometry: Equatable {
    var base: Double
    var row: Double
    var ratio: Double
    var radius: Double
    var cx: Double

    static let phone = WheelGeometry(base: 48, row: 76, ratio: 0.87, radius: 240, cx: Double(Theme.Immersive.wheelCentreX))
}

/// Where a row sits on the dial: its centre from the dial's centre height (`y`) and the wheel's leading edge (`x`).
struct RowPose: Equatable {
    var x: Double
    var y: Double
    var scale: Double
    var opacity: Double
    var angle: Double
}

enum RecordWheel {
    /// Rows farther than this many steps from the front are skipped before any maths (the fade has ended well before).
    static let maxSteps = 6
    /// Past this angle (rad, about 49 degrees) a row starts to fade; it is gone `fadeSpan` later.
    static let fadeStart = 0.85
    static let fadeSpan = 0.5
    /// A row this far round the dial (rad) is not drawn at all.
    static let maxAngle = 1.4
    /// A flick turns the wheel by at most this many rows.
    static let maxFlickSteps = 8

    static func mod(_ a: Int, _ n: Int) -> Int { ((a % n) + n) % n }

    /// Signed shortest distance in steps from the wheel position `pos` to row `i` of `n` (the wheel is endless).
    static func wrapD(_ i: Int, _ pos: Double, _ n: Int) -> Double {
        let count = Double(n)
        var d = (Double(i) - pos).truncatingRemainder(dividingBy: count)
        if d < 0 { d += count }
        if d > count / 2 { d -= count }
        return d
    }

    /// Arc length along the dial from the front row to a row `x` steps away: each step is shorter by the ratio.
    static func arcLen(_ x: Double, _ g: WheelGeometry = .phone) -> Double {
        func h(_ k: Int) -> Double { g.row * pow(g.ratio, Double(k)) }
        var s = 0.0
        var k = 0
        while Double(k + 1) <= x {
            s += (h(k) + h(k + 1)) / 2
            k += 1
        }
        return s + (x - Double(k)) * (h(k) + h(k + 1)) / 2
    }

    /// Opacity at an angle round the dial: full until about 49 degrees, then a fade to nothing.
    static func fadeOpacity(_ angle: Double) -> Double {
        let a = abs(angle)
        return a < fadeStart ? 1 : max(0, 1 - (a - fadeStart) / fadeSpan)
    }

    /// Where a row `d` steps from the front sits, or nil when it is not drawn. The first test is on `d` alone, so a
    /// row far from the front costs one comparison (200 collections cost the same as 20).
    static func rowPose(_ d: Double, _ g: WheelGeometry = .phone) -> RowPose? {
        let x = abs(d)
        if x > Double(maxSteps) { return nil }
        let sign: Double = d < 0 ? -1 : (d > 0 ? 1 : 0)
        let angle = sign * arcLen(x, g) / g.radius
        if abs(angle) > maxAngle { return nil }
        let opacity = fadeOpacity(angle)
        if opacity <= 0 { return nil }
        return RowPose(x: g.cx + g.radius * cos(angle), y: g.radius * sin(angle), scale: pow(g.ratio, x), opacity: opacity, angle: angle)
    }

    /// How much of a row shows in a wheel `height` tall (#444): the share of its sleeve inside the frame, squared. A row
    /// turning past the top or bottom edge fades as it goes, so the frame never cuts one to a sliver at rest.
    static func edgeOpacity(_ pose: RowPose, height: Double, _ g: WheelGeometry = .phone) -> Double {
        let half = g.base / 2 * pose.scale
        let share = min(1, max(0, (height / 2 - (abs(pose.y) - half)) / (2 * half)))
        return share * share
    }

    /// JavaScript's `Math.round`: halves go up, so the iPhone and the Mac agree on which row is in front.
    static func roundHalfUp(_ value: Double) -> Int { Int((value + 0.5).rounded(.down)) }

    /// The row indexes that can be on the dial when the wheel is at `pos`: at most 2 * (maxSteps + 1) + 1, whatever `n` is.
    static func windowIndexes(_ pos: Double, _ n: Int, steps: Int = maxSteps + 1) -> [Int] {
        guard n > 0 else { return [] }
        let centre = roundHalfUp(pos)
        var out: [Int] = []
        var seen = Set<Int>()
        for k in -steps...steps {
            let i = mod(centre + k, n)
            if seen.insert(i).inserted { out.append(i) }
        }
        return out
    }

    /// The index in front when the wheel is at `pos`.
    static func frontIndex(_ pos: Double, _ n: Int) -> Int { n > 0 ? mod(roundHalfUp(pos), n) : 0 }

    /// The target (an integer in the wheel's own, unwrapped count) that brings row `i` to the front by the shortest way.
    static func turnTarget(_ i: Int, from: Double, _ n: Int) -> Int {
        let at = roundHalfUp(from)
        return at + Int(wrapD(i, Double(at), n).rounded())
    }

    /// Where a drag that ends sends the wheel: from `start` (the position when the drag began) by the predicted end
    /// translation (points, up is negative), `pitch` points a row, to the nearest row, a flick capped at `maxFlickSteps`.
    static func snapTarget(start: Double, predictedTranslation: Double, pitch: Double) -> Int {
        let steps = min(max(-predictedTranslation / pitch, -Double(maxFlickSteps)), Double(maxFlickSteps))
        return roundHalfUp(start + steps)
    }

    /// The wheel position while a finger is down: the translation (points, up is negative) in rows from `start`.
    static func dragPosition(start: Double, translation: Double, pitch: Double) -> Double {
        start - translation / pitch
    }

    /// Which collection is in front after the collections change (one deleted, made or moved): the same one when it is
    /// still there; otherwise its replacement at the same place, or the new last one when the last was deleted. Nil with
    /// none left. The playing collection does not matter: the wheel follows what is in front.
    static func frontAfterChange(oldIDs: [UUID], oldFront: UUID?, newIDs: [UUID]) -> (index: Int, id: UUID)? {
        guard !newIDs.isEmpty else { return nil }
        if let oldFront, let index = newIDs.firstIndex(of: oldFront) { return (index, oldFront) }
        // The place it had in the old list (not the new count), so deleting the last one lands on the new last.
        let oldIndex = oldFront.flatMap { oldIDs.firstIndex(of: $0) } ?? 0
        let index = min(max(oldIndex, 0), newIDs.count - 1)
        return (index, newIDs[index])
    }

    // MARK: Captions

    /// "1 hr 56 min", "24 min", "2 hr" (whole minutes, rounded); empty when there is no length.
    static func durationLabel(_ totalSec: Double?) -> String {
        guard let totalSec, totalSec > 0 else { return "" }
        let minutes = max(1, Int((totalSec / 60).rounded()))
        let h = minutes / 60
        let m = minutes % 60
        if h == 0 { return "\(m) min" }
        return m == 0 ? "\(h) hr" : "\(h) hr \(m) min"
    }

    /// The hub's count: "5 of 24" (`front` is 0-based).
    static func hubCount(_ front: Int, _ n: Int) -> String { "\(front + 1) of \(n)" }

    /// The wheel's spoken value: "Late drives, 27 tracks, 1 hr 56 min, playing, 1 of 24". `state` comes from the same
    /// player state as the visible tag.
    static func spokenValue(name: String, tracks: Int, totalSec: Double?, state: String?, front: Int, count: Int) -> String {
        let counted = "\(tracks) \(tracks == 1 ? "track" : "tracks")"
        return [name, counted, durationLabel(totalSec), state ?? "", hubCount(front, count)].filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

/// The hub record's turn: 33 1/3 rpm, one turn every 1.8 s, accumulated across pauses so it stays at its angle when
/// paused and never restarts.
enum RecordSpin {
    static let degreesPerSecond = 200.0

    /// The angle in degrees: what was turned before, plus the time since the turn (re)started when it is running.
    static func angle(accumulated: Double, startedAt: Date?, now: Date) -> Double {
        guard let startedAt else { return accumulated }
        return accumulated + max(0, now.timeIntervalSince(startedAt)) * degreesPerSecond
    }
}

/// The two per-device choices (the Mac's `record-player.ts`): Record player / List, and Picture disc / Black vinyl.
enum CollectionsViewMode: String, CaseIterable {
    case player
    case list

    static let `default`: CollectionsViewMode = .player
    init(storedRaw: String?) { self = storedRaw.flatMap(CollectionsViewMode.init(rawValue:)) ?? .default }
}

enum SpinningRecord: String, CaseIterable {
    case picture
    case vinyl

    static let `default`: SpinningRecord = .picture
    init(storedRaw: String?) { self = storedRaw.flatMap(SpinningRecord.init(rawValue:)) ?? .default }
}

/// `UserDefaults` / `@AppStorage` keys for the two choices (the Mac's `locally.collections.view` and `.record`).
enum CollectionsViewPrefs {
    static let viewKey = "locally.collections.view"
    static let recordKey = "locally.collections.record"
}
