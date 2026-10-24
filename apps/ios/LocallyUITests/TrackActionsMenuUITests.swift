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

    private func launch(_ name: String, extra: [String] = []) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-componentGallery", name] + extra
        app.launch()
        return app
    }

    /// Waits for `element` to be hittable (a menu that is still opening is not).
    private func waitHittable(_ element: XCUIElement, timeout: TimeInterval = 5) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
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
        XCTAssertTrue(waitHittable(edit), "the menu's Edit never became hittable")
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

    // MARK: Review fixes (#364): one Library sheet host, Edit scroll without a timer, Stats row actions

    /// Add to collection from an Albums tile and Share from a Singles tile: each sheet shows once and dismisses.
    func testTheLibraryShowsOneSheetEachForAddToCollectionAndShare() {
        // Both sections open (the fold is remembered between runs, so the launch forces it): the old double presenters clash.
        let app = launch("track-menu-library", extra: ["-locally.library.singlesCollapsed", "NO", "-locally.library.albumsCollapsed", "NO"])
        let album = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Low Tide")).firstMatch
        XCTAssertTrue(album.waitForExistence(timeout: 20), "no Albums tile")
        album.press(forDuration: 1.2)
        let add = app.buttons["Add to collection"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        XCTAssertTrue(waitHittable(add))
        add.tap()
        let addTitle = app.navigationBars["Add to collection"]
        XCTAssertTrue(addTitle.waitForExistence(timeout: 5), "no Add to collection sheet")
        XCTAssertEqual(app.navigationBars.matching(identifier: "Add to collection").count, 1, "the sheet is presented twice")
        attach("library-add-sheet")
        app.buttons["Cancel"].firstMatch.tap()
        XCTAssertTrue(waitGone(addTitle), "the Add to collection sheet did not dismiss")

        let single = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Kitchen Radio")).firstMatch
        // Pressing the Albums tile scrolled the page down; the Singles tiles are above.
        var tries = 0
        while !(single.exists && single.isHittable) && tries < 6 {
            app.swipeDown()
            tries += 1
        }
        XCTAssertTrue(single.isHittable, "no Singles tile")
        single.press(forDuration: 1.2)
        let share = app.buttons["Share"]
        XCTAssertTrue(share.waitForExistence(timeout: 5))
        XCTAssertTrue(waitHittable(share))
        share.tap()
        let shareMarker = app.staticTexts["Sign in to share"]
        XCTAssertTrue(shareMarker.waitForExistence(timeout: 5), "no Share sheet")
        XCTAssertEqual(app.staticTexts.matching(identifier: "Sign in to share").count, 1, "the sheet is presented twice")
        attach("library-share-sheet")
        app.swipeDown(velocity: .fast)
        XCTAssertTrue(waitGone(shareMarker), "the Share sheet did not dismiss")
        XCTAssertTrue(waitHittable(single), "the Library is not back after the sheets")
    }

    private func waitGone(_ element: XCUIElement, timeout: TimeInterval = 8) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    /// Long-press the last song of a long album (off screen at first), choose Edit: its edit field must be reachable.
    private func checkEditScrollsToTheLastSong(_ name: String) throws {
        let app = launch(name)
        XCTAssertTrue(app.descendants(matching: .any)["track-row-1"].firstMatch.waitForExistence(timeout: 20))
        let last = app.descendants(matching: .any)["track-row-14"].firstMatch
        var tries = 0
        while !(last.exists && last.isHittable) && tries < 12 {
            app.swipeUp()
            tries += 1
        }
        XCTAssertTrue(last.isHittable, "the last song never came into view")
        last.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Play next"].waitForExistence(timeout: 5))
        let edit = try XCTUnwrap(app.buttons.matching(identifier: "Edit").allElementsBoundByIndex.first { $0.frame.minY > 150 }, "no Edit in the menu")
        XCTAssertTrue(waitHittable(edit))
        edit.tap()
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 5), "the page is not in edit mode")
        let field = app.textFields.matching(NSPredicate(format: "value == %@", "Song 14")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "no edit field for the last song")
        XCTAssertTrue(waitHittable(field, timeout: 8), "the last song's edit field is not on screen")
        attach("edit-scroll-\(name)")
    }

    func testEditOnTheLastSongOfALongAlbumScrollsToItsField() throws {
        try checkEditScrollsToTheLastSong("track-menu-edit-scroll")
    }

    func testEditOnTheLastSongOfALongAlbumScrollsToItsFieldAtAccessibility3() throws {
        try checkEditScrollsToTheLastSong("track-menu-edit-scroll-ax3")
    }
}
