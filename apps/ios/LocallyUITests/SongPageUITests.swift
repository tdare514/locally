import XCTest

/// The song page's three entry points and its Edit and Album links (#365), over the component gallery's seeded data
/// (DEBUG builds). On demand, like the other UI tests.
final class SongPageUITests: XCTestCase {
    private func launch(_ name: String, extraArguments: [String] = []) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-componentGallery", name] + extraArguments
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
        let title = app.buttons["track-title-2"]
        XCTAssertTrue(waitHittable(title, timeout: 20), "no title button on track 2")
        XCTAssertEqual(title.label, "Orange Streetlight")
        XCTAssertGreaterThanOrEqual(title.frame.height, 44, "the song page target is under 44 pt")
        attach("release-rows")
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.25)).tap()
        assertSongPage(app, title: "Orange Streetlight")
        attach("song-page-from-title")
    }

    func testTheSongRowTargetStaysAtLeast44PointsAtAnAccessibilitySize() {
        let app = launch("track-menu-release", extraArguments: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL"])
        let title = app.buttons["track-title-2"]
        XCTAssertTrue(waitHittable(title, timeout: 20), "no title button on track 2")
        XCTAssertGreaterThanOrEqual(title.frame.height, 44, "the song page target is under 44 pt")
        attach("release-rows-ax")
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.25)).tap()
        assertSongPage(app, title: "Orange Streetlight")
    }

    func testAnArtistLinkOnAReleaseRowStillOpensTheArtist() {
        let app = launch("track-menu-release")
        let row = app.descendants(matching: .any)["track-row-2"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no track-row-2")
        let link = row.links.firstMatch
        XCTAssertTrue(link.waitForExistence(timeout: 5), "no artist link in row 2")
        link.tap()
        attach("artist-from-row-link")
        XCTAssertFalse(app.buttons["song-row-album"].waitForExistence(timeout: 3), "the song page opened instead of the artist")
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

    /// The ranked list's row for the song (full width), not the fan's sleeve of the same song.
    private func statsRow(_ app: XCUIApplication) -> XCUIElement? {
        let rows = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Orange Streetlight"))
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 20), "no Stats row")
        var tries = 0
        while !rows.allElementsBoundByIndex.contains(where: { $0.isHittable && $0.frame.width > 300 }) && tries < 6 {
            app.swipeUp()
            tries += 1
        }
        return rows.allElementsBoundByIndex.first(where: { $0.isHittable && $0.frame.width > 300 })
    }

    /// Over the song's title: after the rank and the cover, left of the numbers (the title text is hidden from
    /// accessibility, so the row is found by its label and the title by its place).
    private func overTitle(_ row: XCUIElement) -> XCUICoordinate {
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.35))
    }

    func testALongPressOnAStatsTrackRowsTitleStillOpensTheMenu() {
        let app = launch("track-menu-stats")
        guard let row = statsRow(app) else { return XCTFail("no hittable Stats list row") }
        overTitle(row).press(forDuration: 1.2)
        let goToAlbum = app.buttons["Go to album"]
        XCTAssertTrue(goToAlbum.waitForExistence(timeout: 5), "the long-press on the title opened no menu")
        XCTAssertTrue(waitHittable(goToAlbum))
    }

    func testATapOnAStatsTrackRowOpensTheSongPageAndItsAlbumRowOpensTheRelease() {
        let app = launch("track-menu-stats")
        guard let row = statsRow(app) else { return XCTFail("no hittable Stats list row") }
        // On the title: a tap on the row's text reaches the row's button.
        overTitle(row).tap()
        let albumRow = app.buttons["song-row-album"]
        XCTAssertTrue(albumRow.waitForExistence(timeout: 10), "the song page did not open")
        // The panel sits under the hero: scroll until its Album row is on screen.
        var tries = 0
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
        let title = app.buttons["track-title-2"]
        XCTAssertTrue(waitHittable(title, timeout: 20), "no title button on track 2")
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.25)).tap()
        let edit = app.buttons["Edit"].firstMatch
        XCTAssertTrue(waitHittable(edit, timeout: 10), "no Edit on the song page")
        edit.tap()
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 5), "the release is not in edit mode")
        let field = app.textFields.matching(NSPredicate(format: "value == %@", "Orange Streetlight")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "no edit field for the song")
        XCTAssertTrue(waitHittable(field), "the song's edit field is not on screen")
    }

    /// Edit, save, back: the song page and the next Edit read the saved release, not the one the page was pushed with.
    func testASavedEditShowsOnTheSongPageAndInTheNextEdit() {
        let app = launch("song-page-edit-save")
        let title = app.buttons["track-title-2"]
        XCTAssertTrue(waitHittable(title, timeout: 20), "no title button on track 2")
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.25)).tap()
        let marker = "Renamed"
        openEdit(app)
        let field = app.textFields["Title"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "no release title field")
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        field.typeText(" \(marker)")
        app.keyboards.buttons["Done"].firstMatch.tap()
        let save = app.buttons["Save changes"]
        XCTAssertTrue(save.waitForExistence(timeout: 5), "no Save changes")
        save.tap()
        let confirm = app.buttons["Save"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "no review sheet")
        confirm.tap()
        XCTAssertTrue(waitGone(app.buttons["Save changes"]), "still in edit mode")
        // Back to the song page: its Album row shows the new title.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let albumRow = app.buttons["song-row-album"]
        XCTAssertTrue(albumRow.waitForExistence(timeout: 10), "did not return to the song page")
        let renamed = NSPredicate(format: "label CONTAINS %@", marker)
        XCTAssertTrue(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: renamed, object: albumRow)], timeout: 8) == .completed,
                      "the song page still shows the old title: \(albumRow.label)")
        attach("song-page-after-edit")
        // Edit again: the field holds the saved title.
        openEdit(app)
        let again = app.textFields["Title"].firstMatch
        XCTAssertTrue(again.waitForExistence(timeout: 10), "no release title field on the second edit")
        let value = (again.value as? String) ?? ""
        XCTAssertTrue(value.contains(marker), "the second edit shows the old title: \(value)")
    }

    private func openEdit(_ app: XCUIApplication) {
        let edit = app.buttons["Edit"].firstMatch
        XCTAssertTrue(waitHittable(edit, timeout: 10), "no Edit on the song page")
        edit.tap()
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 5), "the release is not in edit mode")
    }

    private func waitGone(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }
}
