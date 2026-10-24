import XCTest

/// Opening a release from a track lands on that row, washed once; any other push shows no wash (#362).
/// Runs over the component gallery's sample releases (DEBUG builds), so it needs no account, files or network.
final class TrackHighlightUITests: XCTestCase {
    private func launch(_ name: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-componentGallery", name]
        app.launch()
        return app
    }

    private func row(_ number: Int, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["track-row-\(number)"].firstMatch
    }

    func testStatsTrackOpensItsReleaseWithThatRowOnScreen() {
        let app = launch("stats-open-track")
        // The fan's lead tile is the track "Night Bus to Nowhere", the first track of its release.
        let tile = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Night Bus to Nowhere")).firstMatch
        XCTAssertTrue(tile.waitForExistence(timeout: 15), "no Stats row")
        tile.tap()
        let trackRow = row(1, in: app)
        // The fan lifts a sleeve on the first tap and opens it on the second.
        if !trackRow.waitForExistence(timeout: 4) { tile.tap() }
        XCTAssertTrue(trackRow.waitForExistence(timeout: 10), "release page shows no track-row-1")
        XCTAssertTrue(trackRow.isHittable, "track-row-1 is not on screen")
    }

    /// The same 12-track release twice: pushed plainly, track 10 is below the fold and unwashed; opened
    /// from track 10, the page scrolls it into view and marks it highlighted.
    func testAPlainPushLeavesADeepTrackOffScreenAndUnwashed() {
        let app = launch("release-track-plain-long")
        let deep = row(10, in: app)
        // The list is lazy: a row below the fold is not in the tree at all, or is there but off screen.
        XCTAssertTrue(row(1, in: app).waitForExistence(timeout: 15), "release page shows no track-row-1")
        sleep(2)
        XCTAssertFalse(deep.exists && deep.isHittable, "track-row-10 should be below the fold")
        XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "value == %@", "highlighted")).firstMatch.exists)
    }

    func testOpeningFromADeepTrackScrollsItIntoViewAndHighlightsIt() {
        let app = launch("release-track-highlight-long")
        let deep = row(10, in: app)
        XCTAssertTrue(deep.waitForExistence(timeout: 15), "no track-row-10")
        let hittable = NSPredicate(format: "isHittable == true")
        expectation(for: hittable, evaluatedWith: deep)
        waitForExpectations(timeout: 10)
        let washed = NSPredicate(format: "value == %@", "highlighted")
        expectation(for: washed, evaluatedWith: deep)
        waitForExpectations(timeout: 10)
    }
}
