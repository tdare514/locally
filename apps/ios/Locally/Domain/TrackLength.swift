import Foundation

/// How a track's length reads in a track row: `m:ss`, or `h:mm:ss` from one hour.
enum TrackLength {
    /// nil for nil, NaN, infinite or values of zero or less, so an unknown length is left out.
    static func format(_ seconds: Double?) -> String? {
        guard let seconds, seconds.isFinite, seconds > 0 else { return nil }
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }
        return String(format: "%d:%02d", minutes, secs)
    }

    /// The length for VoiceOver, in words ("3 minutes, 24 seconds").
    static func spoken(_ seconds: Double?) -> String? {
        guard let seconds, seconds.isFinite, seconds > 0 else { return nil }
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .spellOut
        formatter.allowedUnits = [.hour, .minute, .second]
        return formatter.string(from: seconds.rounded())
    }

    /// A total for VoiceOver in whole minutes ("32 minutes", "1 hour, 5 minutes"); seconds only under a minute.
    static func spokenTotal(_ seconds: Double?) -> String? {
        guard let seconds, seconds.isFinite, seconds > 0 else { return nil }
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .full
        formatter.allowedUnits = seconds < 60 ? [.second] : [.hour, .minute]
        formatter.zeroFormattingBehavior = .dropAll
        return formatter.string(from: seconds < 60 ? seconds.rounded() : (seconds / 60).rounded() * 60)
    }
}
