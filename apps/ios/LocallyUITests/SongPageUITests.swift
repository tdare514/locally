import XCTest

/// The song page's three entry points and its Edit and Album links (#365), over the component gallery's seeded data
/// (DEBUG builds). On demand, like the other UI tests.
final class SongPageUITests: XCTestCase {
    private func launch(_ name: String) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-componentGallery", name]
        app.launch()
        return app
    }

    private func waitHittable(_ element: XCUIElement, timeout: TimeInterval = 8) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// The song page is up when its Album row (the first row of the panel) exists and the song's title is the hero.
    private func assertSongPage(_ app: XCUIApplication, title: String) {
        let albumRow = app.buttons["song-row-album"]
        XCTAssertTrue(albumRow.waitForExistence(timeout: 10), "the song page did not open")
        XCTAssertTrue(app.staticTexts[title].firstMatch.exists, "the song page shows no title \(title)")
    }

    func testTappingASongsTitleOnTheReleasePageOpensTheSongPage() {
        let app = launch("track-menu-release")
        let title = app.staticTexts["track-title-2"]
        XCTAssertTrue(waitHittable(title, timeout: 20), "no title on track 2")
        title.tap()
        assertSongPage(app, title: "Orange Streetlight")
        attach("song-page-from-title")
    }

    func testSongInfoInTheLongPressMenuOpensTheSongPage() {
        let app = launch("track-menu-release")
        let row = app.descendants(matching: .any)["track-row-2"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no track-row-2")
        row.press(forDuration: 1.2)
        let info = app.buttons["Song info"]
        XCTAssertTrue(info.waitForExistence(timeout: 5), "no Song info in the menu")
        XCTAssertTrue(waitHittable(info))
        attach("song-info-menu")
        info.tap()
        assertSongPage(app, title: "Orange Streetlight")
    }

    func testATapOnAStatsTrackRowOpensTheSongPageAndItsAlbumRowOpensTheRelease() {
        let app = launch("track-menu-stats")
        let rows = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Orange Streetlight"))
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 20), "no Stats row")
        var tries = 0
        while !rows.allElementsBoundByIndex.contains(where: { $0.isHittable && $0.frame.width > 300 }) && tries < 6 {
            app.swipeUp()
            tries += 1
        }
        guard let row = rows.allElementsBoundByIndex.first(where: { $0.isHittable && $0.frame.width > 300 }) else {
            return XCTFail("no hittable Stats list row")
        }
        // Over the cover: the blank middle of a Stats row does not take a synthesised tap.
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5)).tap()
        let albumRow = app.buttons["song-row-album"]
        XCTAssertTrue(albumRow.waitForExistence(timeout: 10), "the song page did not open")
        // The panel sits under the hero: scroll until its Album row is on screen.
        tries = 0
        while !albumRow.isHittable && tries < 6 {
            app.swipeUp()
            tries += 1
        }
        XCTAssertTrue(waitHittable(albumRow), "the Album row never came into view")
        attach("song-page-from-stats")
        albumRow.tap()
        let opened = app.descendants(matching: .any)["track-row-2"].firstMatch
        XCTAssertTrue(opened.waitForExistence(timeout: 10), "the release page did not open")
    }

    func testEditOnTheSongPageOpensTheReleaseInEditModeAtThatSong() {
        let app = launch("track-menu-release")
        let title = app.staticTexts["track-title-2"]
        XCTAssertTrue(waitHittable(title, timeout: 20), "no title on track 2")
        title.tap()
        let edit = app.buttons["Edit"].firstMatch
        XCTAssertTrue(waitHittable(edit, timeout: 10), "no Edit on the song page")
        edit.tap()
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 5), "the release is not in edit mode")
        let field = app.textFields.matching(NSPredicate(format: "value == %@", "Orange Streetlight")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "no edit field for the song")
        XCTAssertTrue(waitHittable(field), "the song's edit field is not on screen")
    }
}
