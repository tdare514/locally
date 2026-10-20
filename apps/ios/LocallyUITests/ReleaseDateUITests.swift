import XCTest

/// The Release date field on the release page (#221): typed dates save and show in view mode, and an
/// impossible date blocks Save. Runs over the component gallery's `release-date-save` case (DEBUG
/// builds): a release whose track is a scratch file, saved with a tag writer that writes nothing, in en-GB.
final class ReleaseDateUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-componentGallery", "release-date-save", "-AppleLocale", "en_GB", "-AppleLanguages", "(en-GB)"]
        app.launch()
    }

    private var dateField: XCUIElement { app.textFields["Release date"] }

    /// Replaces the field's text.
    private func type(_ text: String) {
        XCTAssertTrue(dateField.waitForExistence(timeout: 15), "no Release date field")
        // The field wraps, so a tap puts the caret where it lands: tap its trailing end so the
        // deletes below reach every character.
        dateField.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        let current = (dateField.value as? String) ?? ""
        dateField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count) + text)
    }

    private func finishTyping() {
        // Return ends editing, as the keyboard's Done does.
        app.keyboards.buttons["Done"].firstMatch.tap()
    }

    private func saveAndReview() {
        let save = app.buttons["Save changes"]
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        XCTAssertTrue(save.isEnabled)
        save.tap()
        let confirm = app.buttons["Save"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "no review sheet")
        confirm.tap()
    }

    private func viewModeReads(_ value: String, file: StaticString = #filePath, line: UInt = #line) {
        let row = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH 'Release date' AND label ENDSWITH %@", value)).firstMatch
        let text = app.staticTexts.matching(NSPredicate(format: "label ==[c] %@", value)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10) || text.waitForExistence(timeout: 5), "view mode does not read \(value)", file: file, line: line)
        XCTAssertFalse(app.buttons["Save changes"].exists, "still in edit mode", file: file, line: line)
    }

    func testAYearAloneSavesAndViewModeReadsIt() {
        type("1999")
        finishTyping()
        saveAndReview()
        viewModeReads("1999")
    }

    func testAFullDateSavesAndViewModeReadsItFormatted() {
        type("03/04/2001")
        finishTyping()
        // Leaving the field rewrites a readable date as it is written everywhere else.
        XCTAssertEqual(dateField.value as? String, "3 April 2001")
        saveAndReview()
        viewModeReads("3 April 2001")
    }

    func testAnImpossibleDateShowsItsMessageAndBlocksSave() {
        type("31/02/2024")
        finishTyping()
        XCTAssertTrue(app.staticTexts["That date doesn't exist"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Save changes"].isEnabled)
    }
}
