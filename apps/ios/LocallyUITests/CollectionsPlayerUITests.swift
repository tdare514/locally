import XCTest

/// The Collections record player (#352), over the component gallery's seeded collections (DEBUG builds). On demand, like
/// the other UI tests: a vertical drag that starts on the wheel turns it, a drag anywhere else scrolls the page, and the
/// VoiceOver adjustable action changes the queue header.
final class CollectionsPlayerUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-componentGallery", "collections-player-playing"]
        app.launch()
    }

    private var wheel: XCUIElement { app.descendants(matching: .any).matching(identifier: "collections-wheel").firstMatch }
    private var queueTitle: XCUIElement { app.staticTexts["collection-queue-title"] }

    /// XCUITest can't send VoiceOver's increment to a button-like element, so this turns the wheel by a swipe: the
    /// same `settle` the adjustable action calls, and the queue header follows the front.
    func testTurningTheWheelChangesTheQueueHeader() {
        XCTAssertTrue(wheel.waitForExistence(timeout: 15))
        XCTAssertEqual(queueTitle.label, "Late drives")
        XCTAssertTrue((wheel.value as? String ?? "").hasPrefix("Late drives"), "value: \(String(describing: wheel.value))")
        wheel.swipeUp()
        sleep(1)
        XCTAssertNotEqual(queueTitle.label, "Late drives")
    }

    func testDragOnTheWheelTurnsItAndDragBelowScrollsThePage() {
        XCTAssertTrue(wheel.waitForExistence(timeout: 15))
        let before = wheel.value as? String
        let top = wheel.frame.minY
        // A drag that starts on the wheel turns it and leaves the page where it is.
        let start = wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.7))
        let end = wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.2))
        start.press(forDuration: 0.1, thenDragTo: end)
        sleep(1)
        XCTAssertNotEqual(wheel.value as? String, before, "the wheel did not turn")
        XCTAssertEqual(wheel.frame.minY, top, accuracy: 1, "the page scrolled")
        // A drag that starts below the wheel scrolls the page.
        let low = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95))
        let high = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
        low.press(forDuration: 0.1, thenDragTo: high)
        sleep(1)
        XCTAssertLessThan(wheel.frame.minY, top - 50, "the page did not scroll")
    }
}
