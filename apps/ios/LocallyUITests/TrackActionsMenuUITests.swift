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

    // MARK: Part B (#364): the menu on the release page, the Library and Stats. The gallery cases `track-menu-*` run a
    // player on fakes, so Play next shows its toast without touching audio.

    private func launch(_ name: String) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-componentGallery", name]
        app.launch()
        return app
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    func testLongPressOnAReleaseTrackShowsTheActionsAndEditEntersEditMode() throws {
        let app = launch("track-menu-release")
        let row = app.descendants(matching: .any)["track-row-2"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no track-row-2")
        row.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Play next"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Add to queue"].exists)
        XCTAssertTrue(app.buttons["Add to collection"].exists)
        // The page's own toolbar also has an Edit button, at the top; the menu's is lower down.
        let edits = app.buttons.matching(identifier: "Edit").allElementsBoundByIndex
        let edit = try XCTUnwrap(edits.first { $0.frame.minY > 150 }, "no Edit in the menu")
        XCTAssertTrue(app.buttons["Go to artist"].exists)
        XCTAssertFalse(app.buttons["Go to album"].exists, "the page is the album")
        attach("release-track-menu")
        // Let the menu finish opening before the tap, or the tap only dismisses it.
        sleep(1)
        edit.tap()
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 5), "the page is not in edit mode")
        XCTAssertTrue(app.descendants(matching: .any)["reorder-hint"].waitForExistence(timeout: 5))
    }

    func testTheReleaseTrackMenuAtAccessibility3() {
        let app = launch("track-menu-release-ax3")
        let row = app.descendants(matching: .any)["track-row-2"].firstMatch
        XCTAssertTrue(app.descendants(matching: .any)["track-row-1"].firstMatch.waitForExistence(timeout: 20))
        var tries = 0
        while !(row.exists && row.isHittable) && tries < 6 {
            app.swipeUp()
            tries += 1
        }
        XCTAssertTrue(row.isHittable, "no track-row-2")
        row.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Play next"].waitForExistence(timeout: 5))
        attach("release-track-menu-ax3")
    }

    func testLongPressOnALibraryTileShowsPlayNextAndItsToast() {
        let app = launch("track-menu-library")
        let tile = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Low Tide")).firstMatch
        XCTAssertTrue(tile.waitForExistence(timeout: 20), "no Library tile")
        tile.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Play next"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Edit"].exists)
        XCTAssertFalse(app.buttons["Go to album"].exists)
        attach("library-tile-menu")
        app.buttons["Play next"].tap()
        let toast = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Playing next")).firstMatch
        XCTAssertTrue(toast.waitForExistence(timeout: 5), "no Playing next toast")
    }

    func testLongPressOnAStatsTrackRowShowsGoToAlbumAndItOpensTheRelease() {
        let app = launch("track-menu-stats")
        // The ranked list's row (full width), not the fan's sleeve of the same song.
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
        row.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Go to album"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Go to artist"].exists)
        XCTAssertTrue(app.buttons["Edit"].exists)
        attach("stats-track-menu")
        app.buttons["Go to album"].tap()
        let opened = app.descendants(matching: .any)["track-row-2"].firstMatch
        XCTAssertTrue(opened.waitForExistence(timeout: 10), "the release page did not open")
    }
}
