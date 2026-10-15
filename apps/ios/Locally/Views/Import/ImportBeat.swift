import SwiftUI

/// The cover beat of "Make a record" (#205): the clock, the reducer and the frame maths, with the
/// same numbers as `apps/web/src/lib/import-flow.ts` (`BEAT`, `beatPhase`, `beatReducer`) and the
/// `.imp-*` keyframes in `apps/web/src/app/globals.css`. Pure: no view state, so a frame at any
/// millisecond can be drawn (and tested) on its own.
enum ImportBeat {
    // MARK: Clock (ms from the moment a cover is chosen)

    /// The new cover slides in from the right.
    static let slideEnd = 420.0
    /// The flash swells to fully opaque warm white, holds, then fades so the colour comes back.
    static let flashAt = 420.0
    static let fullWhiteAt = 720.0
    static let fullWhiteEnd = 820.0
    static let flashEnd = 1300.0
    /// The backdrop takes the cover's colours as the flash starts.
    static let washAt = 420.0
    /// The disc slides all the way into the sleeve, turning as it goes: sealed at `discEnd`.
    static let discAt = 1340.0
    static let discEnd = 2290.0
    /// A replacing cover first eases the disc out of the sleeve over this long.
    static let replayOutEnd = 600.0

    /// With Reduce Motion the cover just fades in, the colours follow at once and the beat is
    /// over as soon as the fade is.
    static let reducedWashAt = 0.0
    static let reducedEndAt = 160.0

    static func washAt(reduced: Bool) -> Double { reduced ? reducedWashAt : washAt }
    static func endAt(reduced: Bool) -> Double { reduced ? reducedEndAt : discEnd }

    // MARK: Phase

    enum Phase: Equatable {
        case slide, swell, white, fade, gap, seal, done
    }

    /// Which part of the beat `ms` after the cover was chosen falls in.
    static func phase(at ms: Double) -> Phase {
        if ms < slideEnd { return .slide }
        if ms < fullWhiteAt { return .swell }
        if ms < fullWhiteEnd { return .white }
        if ms < flashEnd { return .fade }
        if ms < discAt { return .gap }
        if ms < discEnd { return .seal }
        return .done
    }

    // MARK: State

    struct State: Equatable {
        /// A cover is set.
        var hasCover = false
        /// Counts covers chosen; a new value restarts the beat.
        var run = 0
        /// The beat is over: it ran out, or input jumped it to the end.
        var ended = false
        /// Input jumped it to the end (the disc lands in the sleeve at once).
        var skipped = false
        /// This cover replaced another, so the disc starts tucked in the sleeve.
        var replay = false

        static let initial = State()
    }

    enum Event: Equatable {
        case cover, skip, end, reset
    }

    /// The beat is running: a cover is set and it has not ended.
    static func isPlaying(_ state: State) -> Bool {
        state.hasCover && !state.ended
    }

    static func reduce(_ state: State, _ event: Event) -> State {
        switch event {
        case .cover:
            State(hasCover: true, run: state.run + 1, ended: false, skipped: false, replay: state.hasCover)
        case .skip:
            isPlaying(state) ? State(hasCover: state.hasCover, run: state.run, ended: true, skipped: true, replay: state.replay) : state
        case .end:
            isPlaying(state) ? State(hasCover: state.hasCover, run: state.run, ended: true, skipped: state.skipped, replay: state.replay) : state
        case .reset:
            State(hasCover: false, run: state.run, ended: false, skipped: false, replay: false)
        }
    }

    // MARK: Frame

    /// What the sleeve draws at one moment of the beat.
    struct Frame: Equatable {
        /// The cover's horizontal offset, in points (48 at the start, 0 at rest).
        var coverOffsetX: Double
        var coverOpacity: Double
        var flashOpacity: Double
        /// 0 = peeking as on the release page, 1 = fully in the sleeve (right edges level).
        var discIn: Double
        var discTurnDegrees: Double

        static let rest = Frame(coverOffsetX: 0, coverOpacity: 1, flashOpacity: 0, discIn: 1, discTurnDegrees: 0)
    }

    // The CSS cubic-bezier curves, as (x1, y1, x2, y2).
    private static let slideCurve = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.3, y: 0.5), endControlPoint: UnitPoint(x: 0.3, y: 1))
    private static let swellCurve = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.45, y: 0), endControlPoint: UnitPoint(x: 0.55, y: 1))
    private static let flashFadeCurve = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.5, y: 0), endControlPoint: UnitPoint(x: 0.7, y: 1))
    private static let discCurve = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.33, y: 0), endControlPoint: UnitPoint(x: 0.15, y: 1))
    private static let replayOutCurve = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.2, y: 0.8), endControlPoint: UnitPoint(x: 0.2, y: 1))

    /// 0 to 1 over `start...end` on `curve` (linear when nil), exact at both ends.
    private static func ramp(_ ms: Double, _ start: Double, _ end: Double, _ curve: UnitCurve?) -> Double {
        if ms <= start { return 0 }
        if ms >= end { return 1 }
        let t = (ms - start) / (end - start)
        return curve?.value(at: t) ?? t
    }

    /// Send tapped with the disc resting in the sleeve: it eases out to its peeking pose over
    /// `replayOutEnd` on the same curve a replacing cover uses, the cover and flash at rest.
    static func easeOutFrame(at ms: Double) -> Frame {
        Frame(coverOffsetX: 0, coverOpacity: 1, flashOpacity: 0, discIn: 1 - ramp(ms, 0, replayOutEnd, replayOutCurve), discTurnDegrees: 0)
    }

    static func frame(at ms: Double, replay: Bool, reduced: Bool) -> Frame {
        guard ms < endAt(reduced: reduced) else { return .rest }
        if reduced {
            return Frame(coverOffsetX: 0, coverOpacity: ramp(ms, 0, reducedEndAt, nil), flashOpacity: 0, discIn: 1, discTurnDegrees: 0)
        }
        let slide = ramp(ms, 0, slideEnd, slideCurve)
        let flash: Double
        if ms < flashAt {
            flash = 0
        } else if ms < fullWhiteAt {
            flash = ramp(ms, flashAt, fullWhiteAt, swellCurve)
        } else if ms < fullWhiteEnd {
            flash = 1
        } else {
            flash = 1 - ramp(ms, fullWhiteEnd, flashEnd, flashFadeCurve)
        }
        let seal = ramp(ms, discAt, discEnd, discCurve)
        let discIn: Double
        if replay && ms < discAt {
            discIn = 1 - ramp(ms, 0, replayOutEnd, replayOutCurve)
        } else {
            discIn = seal
        }
        return Frame(
            coverOffsetX: Theme.Import.slideDistance * (1 - slide),
            coverOpacity: slide,
            flashOpacity: flash,
            discIn: discIn,
            discTurnDegrees: -Theme.Import.discTurnDegrees * (1 - seal)
        )
    }
}
