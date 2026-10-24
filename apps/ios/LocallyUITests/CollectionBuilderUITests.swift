import XCTest

/// The collection builder (#366), over the component gallery's seeded library (DEBUG builds). On demand, like the other UI tests.
final class CollectionBuilderUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    private func launch(_ gallery: String) {
        app.launchArguments = ["-componentGallery", gallery]
        app.launch()
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /// The song's row: one button whose label starts with the title.
    private func row(_ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "\(title),")).firstMatch
    }

    /// Finds a song with the search pill, taps it and clears the search.
    private func pick(_ title: String) {
        let search = app.textFields["builder-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText(title)
        let song = row(title)
        XCTAssertTrue(song.waitForExistence(timeout: 10), "no row for \(title)")
        song.tap()
        XCTAssertTrue(app.buttons["Clear search"].waitForExistence(timeout: 5))
        app.buttons["Clear search"].tap()
    }

    /// The tracks count line on the collection's page ("3 tracks").
    private var trackCount: Int? {
        let line = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "\\d+ tracks?.*")).firstMatch
        guard line.waitForExistence(timeout: 10) else { return nil }
        return Int(line.label.prefix { $0.isNumber })
    }

    /// From the Collections screen (never the Library): New collection, a name, three songs, Done. The new collection opens with three tracks.
    func testMakingACollectionOfThreeSongsOpensIt() {
        launch("builder-new-flow")
        let new = app.buttons["New collection"]
        XCTAssertTrue(new.waitForExistence(timeout: 15))
        new.tap()

        let name = element("builder-name")
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.tap()
        name.typeText("Road trip\n")

        for title in ["Afterglow", "Kitchen Radio", "Cold Coffee"] { pick(title) }
        XCTAssertTrue(app.staticTexts["builder-summary"].label.hasPrefix("3 songs"), app.staticTexts["builder-summary"].label)

        let done = element("builder-done")
        XCTAssertEqual(done.label, "Done, 3 songs")
        done.tap()

        XCTAssertTrue(app.staticTexts["collection-queue-title"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.staticTexts["collection-queue-title"].label, "Road trip")
        XCTAssertEqual(trackCount, 3)
        XCTAssertFalse(app.tabBars.buttons.firstMatch.exists, "the Library tab should never have been on screen")
    }

    /// "Add music" on a seeded collection adds two songs and the count grows by two.
    func testAddMusicAddsTwoSongsAndTheCountGrows() {
        launch("builder-add-music-flow")
        let before = trackCount
        XCTAssertNotNil(before)
        let add = element("collection-add-music")
        XCTAssertTrue(add.waitForExistence(timeout: 15))
        add.tap()

        for title in ["Kitchen Radio", "Slow Fires"] { pick(title) }
        let done = element("builder-done")
        XCTAssertEqual(done.label, "Done, 2 songs")
        done.tap()

        XCTAssertTrue(add.waitForExistence(timeout: 15))
        XCTAssertEqual(trackCount, (before ?? 0) + 2)
    }
}
