import XCTest

/// History (#399) over the component gallery's seeded data (DEBUG builds): from Stats to a day to a play to the song
/// page. On demand, like the other UI tests.
final class HistoryUITests: XCTestCase {
    private func launch(_ name: String) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-componentGallery", name]
        app.launch()
        return app
    }

    private func waitHittable(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// The local day `daysAgo` days back, as the strip buttons' identifiers carry it.
    private func day(_ daysAgo: Int) -> String {
        let calendar = Calendar.current
        let date = calendar.date(byAdding: .day, value: -daysAgo, to: calendar.startOfDay(for: Date()))!
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    func testHistoryOpensFromStatsAndADayAndAPlayOpenTheSongPage() {
        let app = launch("history-flow")
        let entry = app.buttons["stats-history"]
        XCTAssertTrue(waitHittable(entry, timeout: 20), "no History control in the Stats header")
        XCTAssertEqual(entry.label, "History")
        XCTAssertGreaterThanOrEqual(entry.frame.height, 44)
        XCTAssertGreaterThanOrEqual(entry.frame.width, 44)
        attach("stats-header")
        entry.tap()

        // Today is selected; tap yesterday in the strip.
        let yesterday = app.buttons["history-day-\(day(1))"]
        XCTAssertTrue(waitHittable(yesterday, timeout: 15), "no strip button for yesterday")
        XCTAssertGreaterThanOrEqual(yesterday.frame.height, 44)
        XCTAssertTrue(yesterday.label.contains("5 plays"), "label was \(yesterday.label)")
        XCTAssertTrue(yesterday.label.contains("minutes"), "label was \(yesterday.label)")
        XCTAssertFalse(yesterday.isSelected)
        yesterday.tap()
        XCTAssertTrue(yesterday.isSelected, "the tapped day is not selected")
        attach("history-yesterday")

        // Yesterday's newest play: 22:03, Lanterns (fixture row 6).
        let play = app.buttons["history-play-00000000-0000-0000-0000-000000009006"]
        XCTAssertTrue(waitHittable(play, timeout: 10), "no play button")
        XCTAssertGreaterThanOrEqual(play.frame.height, 44)
        XCTAssertTrue(play.label.contains("Lanterns"), "label was \(play.label)")
        XCTAssertTrue(play.label.contains("iPhone"), "label was \(play.label)")
        play.tap()
        XCTAssertTrue(app.buttons["song-row-album"].waitForExistence(timeout: 10), "the song page did not open")
        attach("song-page-from-history")
    }

    func testScrollingTheStripToItsOldestDayLoadsTheFourteenBefore() {
        let app = launch("history-flow")
        let entry = app.buttons["stats-history"]
        XCTAssertTrue(waitHittable(entry, timeout: 20))
        entry.tap()
        let today = app.buttons["history-day-\(day(0))"]
        XCTAssertTrue(waitHittable(today, timeout: 15))
        XCTAssertFalse(app.buttons["history-day-\(day(15))"].exists, "an older window was read before scrolling")
        var tries = 0
        while !app.buttons["history-day-\(day(15))"].exists && tries < 6 {
            // The strip sits about a third of the way down the screen.
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.28))
            from.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.28)), withVelocity: .fast, thenHoldForDuration: 0)
            tries += 1
        }
        attach("history-strip-after-swipes")
        XCTAssertTrue(app.buttons["history-day-\(day(15))"].waitForExistence(timeout: 5), "no older days after scrolling to the oldest")
        attach("history-strip-older")
    }

    func testTheSongPagesLastPlayedLineKeepsA44PointTarget() {
        let app = launch("song-page")
        let line = app.buttons["song-last-played"]
        XCTAssertTrue(line.waitForExistence(timeout: 20), "no Last played button")
        XCTAssertGreaterThanOrEqual(line.frame.height, 44)
        XCTAssertTrue(line.label.hasPrefix("Last played"), "label was \(line.label)")
    }
}
