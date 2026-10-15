import Testing
@testable import Locally

/// The Make a record beat (#205): the same clock, frames and reducer as the Mac's
/// `import-flow.ts` and the `.imp-*` keyframes.
struct ImportBeatTests {
    // MARK: Phase

    @Test(arguments: [
        (0.0, ImportBeat.Phase.slide), (419, .slide), (420, .swell), (719, .swell), (720, .white),
        (819, .white), (820, .fade), (1299, .fade), (1300, .gap), (1339, .gap), (1340, .seal),
        (2289, .seal), (2290, .done),
    ])
    func phaseBoundaries(ms: Double, phase: ImportBeat.Phase) {
        #expect(ImportBeat.phase(at: ms) == phase)
    }

    @Test func reducedTimes() {
        #expect(ImportBeat.washAt(reduced: true) == 0)
        #expect(ImportBeat.endAt(reduced: true) == 160)
        #expect(ImportBeat.washAt(reduced: false) == 420)
        #expect(ImportBeat.endAt(reduced: false) == 2290)
    }

    // MARK: Frames

    private func frame(_ ms: Double, replay: Bool = false, reduced: Bool = false) -> ImportBeat.Frame {
        ImportBeat.frame(at: ms, replay: replay, reduced: reduced)
    }

    @Test func coverSlidesIn() {
        #expect(frame(0).coverOffsetX == 48)
        #expect(frame(0).coverOpacity == 0)
        #expect(frame(420).coverOffsetX == 0)
        #expect(frame(420).coverOpacity == 1)
        #expect(frame(200).coverOffsetX > 0 && frame(200).coverOffsetX < 48)
    }

    @Test func flashSwellsHoldsAndFades() {
        #expect(frame(419).flashOpacity == 0)
        #expect(frame(720).flashOpacity == 1)
        #expect(frame(819).flashOpacity == 1)
        #expect(frame(1300).flashOpacity == 0)
        #expect(frame(1100).flashOpacity > 0 && frame(1100).flashOpacity < 1)
    }

    @Test func discSealsAndTurns() {
        #expect(frame(1339).discIn == 0)
        #expect(frame(1339).discTurnDegrees == -240)
        #expect(frame(2290).discIn == 1)
        #expect(frame(2290).discTurnDegrees == 0)
        #expect(frame(1800).discIn > 0 && frame(1800).discIn < 1)
        #expect(frame(1800).discTurnDegrees < 0 && frame(1800).discTurnDegrees > -240)
        #expect(frame(2290) == .rest)
        #expect(frame(5000) == .rest)
    }

    @Test func replayEasesTheDiscOutFirst() {
        #expect(frame(0, replay: true).discIn == 1)
        #expect(frame(300, replay: true).discIn > 0 && frame(300, replay: true).discIn < 1)
        for ms in stride(from: 600.0, through: 1339, by: 37) {
            #expect(frame(ms, replay: true).discIn == 0)
        }
        #expect(frame(1340, replay: true).discIn == 0)
        #expect(frame(2290, replay: true).discIn == 1)
    }

    @Test func reducedMotionOnlyFadesTheCoverIn() {
        for ms in stride(from: 0.0, through: 3000, by: 10) {
            let f = frame(ms, reduced: true)
            #expect(f.flashOpacity == 0)
            #expect(f.discIn == 1)
            #expect(f.coverOffsetX == 0)
            #expect(f.discTurnDegrees == 0)
        }
        #expect(frame(80, reduced: true).coverOpacity == 0.5)
        #expect(frame(160, reduced: true) == .rest)
    }

    @Test func rampsAreMonotonic() {
        let steps = Array(stride(from: 0.0, through: 2290, by: 5))
        let cover = steps.map { frame($0).coverOpacity }
        #expect(zip(cover, cover.dropFirst()).allSatisfy { $0 <= $1 })
        let offset = steps.map { frame($0).coverOffsetX }
        #expect(zip(offset, offset.dropFirst()).allSatisfy { $0 >= $1 })
        let swell = steps.filter { $0 >= 420 && $0 <= 720 }.map { frame($0).flashOpacity }
        #expect(zip(swell, swell.dropFirst()).allSatisfy { $0 <= $1 })
        let fade = steps.filter { $0 >= 820 && $0 <= 1300 }.map { frame($0).flashOpacity }
        #expect(zip(fade, fade.dropFirst()).allSatisfy { $0 >= $1 })
        let seal = steps.filter { $0 >= 1340 }.map { frame($0).discIn }
        #expect(zip(seal, seal.dropFirst()).allSatisfy { $0 <= $1 })
        let turn = steps.filter { $0 >= 1340 }.map { frame($0).discTurnDegrees }
        #expect(zip(turn, turn.dropFirst()).allSatisfy { $0 <= $1 })
        let out = Array(stride(from: 0.0, through: 600, by: 5)).map { frame($0, replay: true).discIn }
        #expect(zip(out, out.dropFirst()).allSatisfy { $0 >= $1 })
    }

    // MARK: Reducer

    private func run(_ events: [ImportBeat.Event], from state: ImportBeat.State = .initial) -> ImportBeat.State {
        events.reduce(state) { ImportBeat.reduce($0, $1) }
    }

    @Test func firstCoverIsNotAReplay() {
        let s = run([.cover])
        #expect(s.hasCover && s.run == 1 && !s.ended && !s.skipped && !s.replay)
        #expect(ImportBeat.isPlaying(s))
    }

    @Test func aReplacingCoverReplays() {
        let s = run([.cover, .end, .cover])
        #expect(s.replay && s.run == 2 && !s.ended)
    }

    @Test func skipAndEndOnlyWhilePlaying() {
        #expect(run([.skip]) == .initial)
        #expect(run([.end]) == .initial)
        let skipped = run([.cover, .skip])
        #expect(skipped.ended && skipped.skipped)
        let ended = run([.cover, .end])
        #expect(ended.ended && !ended.skipped)
        #expect(run([.cover, .end, .skip]) == ended)
        #expect(run([.cover, .skip, .end]) == skipped)
        #expect(!ImportBeat.isPlaying(ended))
    }

    @Test func resetKeepsTheRunCount() {
        let s = run([.cover, .cover, .reset])
        #expect(s == ImportBeat.State(hasCover: false, run: 2, ended: false, skipped: false, replay: false))
        #expect(run([.cover], from: s).replay == false)
    }
}
