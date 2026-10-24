import Foundation

/// One artist line at one shortening level (#361). Pure; the views try the levels in order and keep
/// the first that fits on one line.
///
/// - Level 0: "A, feat. B & C", every name.
/// - Level 1: "A, feat. B & 1 more", the first featured name, then the count of the rest.
/// - Level 2 and beyond: "A & 2 more", the main name and the count of every feature.
///
/// A level that would repeat the one before (one feature has no level 1) is the same credit.
struct ArtistCredit: Equatable {
    /// The most levels there are to try; the last one is cut with a tail ellipsis when it still does not fit.
    static let levelCount = 3

    let main: String
    /// The featured names that show, in order; each keeps its link.
    let featuring: [String]
    /// How many names are folded into "& N more" (not a link); 0 when none are.
    let more: Int
    /// True when the shown names follow "feat."; false for the main name's own "& N more".
    let hasFeatPart: Bool

    static func shortened(main: String, featuring: [String], level: Int) -> ArtistCredit {
        let full = ArtistCredit(main: main, featuring: featuring, more: 0, hasFeatPart: !featuring.isEmpty)
        switch min(max(level, 0), levelCount - 1) {
        case 0:
            return full
        case 1:
            guard featuring.count > 1 else { return full }
            return ArtistCredit(main: main, featuring: [featuring[0]], more: featuring.count - 1, hasFeatPart: true)
        default:
            return ArtistCredit(main: main, featuring: [], more: featuring.count, hasFeatPart: false)
        }
    }

    /// The line as plain text.
    var text: String {
        var result = main
        if hasFeatPart {
            result += (main.isEmpty ? "" : ", ") + "feat. " + ArtistNames.joinNames(featuring)
        }
        if more > 0 {
            result += (result.isEmpty ? "" : " & ") + Copy.Artists.andMore(more)
        }
        return result
    }

    /// What VoiceOver reads: every name, whatever the level.
    static func spoken(main: String, featuring: [String]) -> String {
        shortened(main: main, featuring: featuring, level: 0).text
    }
}
