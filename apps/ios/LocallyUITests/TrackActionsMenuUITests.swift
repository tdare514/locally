import XCTest

/// The long-press menu of a collection queue row (#364), over the component gallery's seeded collections (DEBUG
/// builds). On demand, like the other UI tests. The open menu is attached as a screenshot ("menu-open").
final class TrackActionsMenuUITests: XCTestCase {
    func testLongPressOnAQueueRowShowsTheTrackActions() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-componentGallery", "collections-queue"]
        app.launch()
        XCTAssertTrue(app.staticTexts["collection-queue-title"].waitForExistence(timeout: 20))
        // The first queue row: the first button below the queue header that is not part of the header.
        let title = app.staticTexts["collection-queue-title"]
        let rows = app.buttons.allElementsBoundByIndex.filter { $0.frame.minY > title.frame.maxY && $0.frame.height > 40 && $0.frame.width > 200 }
        let row = try? XCTUnwrap(rows.first, "no queue row found")
        row?.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Play next"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Add to queue"].exists)
        XCTAssertTrue(app.buttons["Add to collection"].exists)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "menu-open"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
