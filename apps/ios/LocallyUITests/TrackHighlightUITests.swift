import XCTest

/// Opening a Stats track lands on its release with that track's row on screen (#362). Runs over the
/// component gallery's sample plays (DEBUG builds), so it needs no account, files or network.
final class TrackHighlightUITests: XCTestCase {
    func testStatsTrackOpensItsReleaseWithThatRowOnScreen() {
        let app = XCUIApplication()
        app.launchArguments = ["-componentGallery", "stats-open-track"]
        app.launch()
        // The fan's lead tile is the track "Night Bus to Nowhere", the first track of its release.
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Night Bus to Nowhere")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "no Stats row")
        row.tap()
        let trackRow = app.descendants(matching: .any)["track-row-1"].firstMatch
        // The fan lifts a sleeve on the first tap and opens it on the second.
        if !trackRow.waitForExistence(timeout: 4) { row.tap() }
        XCTAssertTrue(trackRow.waitForExistence(timeout: 10), "release page shows no track-row-1")
        XCTAssertTrue(trackRow.isHittable, "track-row-1 is not on screen")
    }
}
