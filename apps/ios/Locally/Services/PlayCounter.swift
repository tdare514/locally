import Foundation

/// One look at the player, about twice a second.
struct PlaySample: Equatable {
    /// Wall-clock time of the sample, in seconds.
    var at: TimeInterval
    var playing: Bool
    var positionSec: Double
    /// 0 when unknown.
    var durationSec: Double
}

/// Decides when a play in Locally's own player counts (#337). A port of the Mac's `PlayCounter`
/// (`apps/web/src/server/plays/PlayCounter.ts`): a play counts once it has played
/// `min(30 s, 90% of the track)`, once per play session. Pausing doesn't start a new session, and a
/// jump back of more than 3 seconds (a replay from the start) does. Pure: no I/O, no timers.
///
/// One difference: the Mac also remembers ended sessions so a source switch inside Spotify resumes
/// the same play. Locally has one source and starts a session with `reset()` for each queue item,
/// so there is nothing to continue.
struct PlayCounter {
    static let maxThresholdSec: Double = 30
    static let thresholdFraction: Double = 0.9
    static let backwardSeekSec: Double = 3
    static let seekSlackSec: Double = 2

    /// Audible seconds in the current session: paused time and seeks add nothing (#397).
    private(set) var listenedSec: Double = 0
    /// Wall-clock time of the first playing sample of the current session, for a play event's `startedAt`.
    private(set) var sessionStart: TimeInterval?
    /// Bumps whenever a session ends (a jump back, `reset()`), so a play event can tell its session is over.
    private(set) var sessionNumber = 0
    private var counted = false
    private var prev: (at: TimeInterval, positionSec: Double, playing: Bool)?

    /// Feeds one sample. Returns true when this sample makes the play count (once per session).
    mutating func push(_ sample: PlaySample) -> Bool {
        if let prev, sample.positionSec < prev.positionSec - Self.backwardSeekSec {
            // Back to the start: a new play.
            listenedSec = 0
            counted = false
            sessionStart = nil
            sessionNumber += 1
            self.prev = nil
        }
        if sample.playing, sessionStart == nil { sessionStart = sample.at }
        if sample.playing, let prev, prev.playing {
            let delta = sample.positionSec - prev.positionSec
            let wallGap = sample.at - prev.at
            if delta > 0, delta <= wallGap + Self.seekSlackSec { listenedSec += delta }
        }
        prev = (sample.at, sample.positionSec, sample.playing)

        if counted { return false }
        let threshold = sample.durationSec > 0 ? min(Self.maxThresholdSec, Self.thresholdFraction * sample.durationSec) : Self.maxThresholdSec
        if listenedSec >= threshold {
            counted = true
            return true
        }
        return false
    }

    /// A new item starts: forget the session.
    mutating func reset() {
        listenedSec = 0
        counted = false
        sessionStart = nil
        sessionNumber += 1
        prev = nil
    }
}
