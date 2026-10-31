import os
import SwiftUI

/// #423: os_signpost intervals around the slow screens' loads and their first cover on screen, so
/// `LocallyUITests/PerformanceUITests` can read time to first content with `XCTOSSignpostMetric` and Instruments
/// shows them beside the main thread. Each interval runs once per launch; a call costs a dictionary lookup.
@MainActor
enum PerfSignpost {
    static let subsystem = "com.tdare.locally"
    static let category = "perf"

    enum Interval: CaseIterable {
        /// The Library's index read and cover read (`LibraryView.load`), and the first cover drawn after it appears.
        case libraryLoad, libraryFirstCover
        /// The Stats read, and the first ranked cover drawn after the tab appears.
        case statsLoad, statsFirstCover
        /// The Collections record player's collection read, and the first wheel cover drawn after it appears.
        case playerLoad, playerFirstCover
        /// The release page's model (its cover read), and the sleeve's cover drawn after the page appears.
        case releaseLoad, releaseFirstCover

        var name: StaticString {
            switch self {
            case .libraryLoad: "library-load"
            case .libraryFirstCover: "library-first-cover"
            case .statsLoad: "stats-load"
            case .statsFirstCover: "stats-first-cover"
            case .playerLoad: "player-load"
            case .playerFirstCover: "player-first-cover"
            case .releaseLoad: "release-load"
            case .releaseFirstCover: "release-first-cover"
            }
        }
    }

    private static let signposter = OSSignposter(subsystem: subsystem, category: category)
    private static var open: [Interval: OSSignpostIntervalState] = [:]
    private static var finished: Set<Interval> = []

    /// Starts `interval` unless it has already run this launch.
    static func begin(_ interval: Interval) {
        guard open[interval] == nil, !finished.contains(interval) else { return }
        open[interval] = signposter.beginInterval(interval.name)
    }

    /// Ends `interval` if it is running.
    static func end(_ interval: Interval) {
        guard let state = open.removeValue(forKey: interval) else { return }
        finished.insert(interval)
        signposter.endInterval(interval.name, state)
    }

    /// Ends `interval` on the next turn of the main run loop: after the frame being built now (and the cover decode
    /// it carries) has been committed.
    static func endAfterCommit(_ interval: Interval) {
        guard open[interval] != nil else { return }
        DispatchQueue.main.async { end(interval) }
    }
}

extension View {
    /// Ends `interval` after the first committed frame in which this view is on screen with `shown` true.
    func endsSignpost(_ interval: PerfSignpost.Interval, when shown: Bool = true) -> some View {
        onAppear { if shown { PerfSignpost.endAfterCommit(interval) } }
            .onChange(of: shown) { _, now in if now { PerfSignpost.endAfterCommit(interval) } }
    }
}
