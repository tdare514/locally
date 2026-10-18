import XCTest

/// Artist links stay in the app (#288): the `openURL` interception pushes the artist page instead
/// of handing the private URL to the system. Runs over the component gallery's seeded library
/// (DEBUG builds), so it needs no account, files or network.
final class ArtistLinksUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-componentGallery", "library-sort-menu"]
        app.launch()
    }

    private func title(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
        let element = app.staticTexts["artist-page-title"]
        XCTAssertTrue(element.waitForExistence(timeout: 10), "no artist page", file: file, line: line)
        XCTAssertEqual(element.label, text, file: file, line: line)
        XCTAssertEqual(app.state, .runningForeground, file: file, line: line)
    }

    private func openArtists(_ name: String) {
        let artists = app.buttons["Artists"]
        XCTAssertTrue(artists.waitForExistence(timeout: 15))
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "\(name),")).firstMatch
        // A cold first launch can take the tap before the header responds, so tap until the
        // Artists list shows, then scroll: the list is lazy and builds rows as they come on screen.
        var taps = 0
        while !row.waitForExistence(timeout: 3) && taps < 3 {
            if artists.isHittable { artists.tap() }
            taps += 1
        }
        scrollTo(row)
        row.tap()
        title(name)
    }

    private func scrollTo(_ element: XCUIElement) {
        var tries = 0
        while !(element.exists && element.isHittable) && tries < 8 {
            app.swipeUp()
            tries += 1
        }
        XCTAssertTrue(element.isHittable, "\(element) not reachable")
    }

    func testFeaturedNameLinkOpensThatArtistAndBackReturns() {
        openArtists("Mira Valdane")
        let link = app.links["Okoro"].firstMatch
        scrollTo(link)
        link.tap()
        title("Okoro")
        app.navigationBars.buttons.firstMatch.tap()
        title("Mira Valdane")
    }

    func testReleasePageArtistLinkOpensTheArtistPage() {
        openArtists("Okoro")
        let tile = app.staticTexts["Tidelines"].firstMatch
        scrollTo(tile)
        tile.tap()
        let open = app.buttons["Open Okoro"]
        XCTAssertTrue(open.waitForExistence(timeout: 10), "release page has no artist link")
        open.tap()
        title("Okoro")
        XCTAssertFalse(open.exists, "still on the release page")
    }
}
