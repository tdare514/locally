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
    /// The front collection's name: the wheel's value up to its first comma (the rest, "playing" or "paused", can change).
    private var frontName: String { (wheel.value as? String ?? "").components(separatedBy: ",").first ?? "" }
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

    /// Drags up from a point on the wheel's band (offsets as fractions of its width and height) by `rise` of its height.
    private func drag(fromX x: CGFloat, y: CGFloat, rise: CGFloat) {
        let start = wheel.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y))
        let end = wheel.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y - rise))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0)
        sleep(1)
    }

    /// Drags up from the point until the page has moved, up to three tries: a simulator under load sometimes drops a drag.
    private func scrollPage(fromX x: CGFloat, y: CGFloat, top: CGFloat) {
        for _ in 0..<3 where wheel.frame.minY > top - 50 { drag(fromX: x, y: y, rise: 0.5) }
    }

    /// The wheel's band is 340 pt tall; its cover rows are the column from 120 pt in (about 0.31 of the width) across the
    /// middle 300 pt. A drag there turns the wheel and leaves the page where it is (#363).
    func testDragOnTheCoversTurnsTheWheelAndThePageStays() {
        XCTAssertTrue(wheel.waitForExistence(timeout: 15))
        let before = wheel.value as? String
        let top = wheel.frame.minY
        drag(fromX: 0.7, y: 0.7, rise: 0.5)
        XCTAssertEqual(wheel.frame.minY, top, accuracy: 1, "the page scrolled")
        XCTAssertNotEqual(wheel.value as? String, before, "the wheel did not turn")
    }

    /// A drag that starts on the hub scrolls the page, and the wheel keeps its front.
    func testDragOnTheHubScrollsThePage() {
        XCTAssertTrue(wheel.waitForExistence(timeout: 15))
        let before = frontName
        let top = wheel.frame.minY
        scrollPage(fromX: 0.1, y: 0.5, top: top)
        XCTAssertLessThan(wheel.frame.minY, top - 50, "the page did not scroll")
        XCTAssertEqual(frontName, before, "the wheel turned")
    }

    /// A drag that starts in the empty space above the arc scrolls the page, and the wheel keeps its front.
    func testDragInTheEmptySpaceScrollsThePage() {
        XCTAssertTrue(wheel.waitForExistence(timeout: 15))
        let before = frontName
        let top = wheel.frame.minY
        scrollPage(fromX: 0.8, y: 0.03, top: top)
        XCTAssertLessThan(wheel.frame.minY, top - 50, "the page did not scroll")
        XCTAssertEqual(frontName, before, "the wheel turned")
    }

    /// The top of now playing is on the first screen of a 390 x 844 phone (#363).
    func testNowPlayingStartsOnTheFirstScreen() {
        XCTAssertTrue(wheel.waitForExistence(timeout: 15))
        let height = app.windows.firstMatch.frame.height
        let title = app.staticTexts["Paper Moon (feat. Okoro)"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertLessThan(title.frame.maxY, height, "now playing starts below the first screen")
    }
}
