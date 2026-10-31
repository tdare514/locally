import XCTest

/// #423: hitches and time to first content on the four slow screens, over the `perf-*` galleries' large seeded
/// library (DEBUG builds). On demand, like the other UI tests, and not in CI:
///
///     xcodebuild test -scheme LocallyUITests -destination 'platform=iOS Simulator,id=<UDID>' \
///       -only-testing:LocallyUITests/PerformanceUITests
///
/// Each screen scrolls (or turns the wheel) the same fixed amount per iteration, five iterations, and reports hitch
/// time ratio and hitch count on a device, and the app's CPU time and the gesture's wall time everywhere (the
/// simulator records no hitches); each first-content test relaunches the gallery per iteration and reads the app's
/// `PerfSignpost` intervals. Compare medians on the same simulator and build configuration.
final class PerformanceUITests: XCTestCase {
    private static let subsystem = "com.tdare.locally"
    private static let category = "perf"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func app(_ gallery: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-componentGallery", gallery]
        return app
    }

    /// Five iterations, each stopped by the block once its gesture has settled.
    private var options: XCTMeasureOptions {
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        options.invocationOptions = [.manuallyStop]
        return options
    }

    /// Hitches while scrolling (UIKit's scroll signposts), and, on iOS 26, hitches of every frame in the app. The
    /// simulator records neither (Xcode 26.6, iOS 26.5 simulator: no hitch values in the result), so the app's CPU
    /// time and the gesture's wall time over the same fixed gesture stand in there; on a device all four report.
    private func hitchMetrics(_ app: XCUIApplication, scrolling: Bool) -> [XCTMetric] {
        var metrics: [XCTMetric] = scrolling ? [XCTOSSignpostMetric.scrollingAndDecelerationMetric] : []
        if #available(iOS 26.0, *) { metrics.append(XCTHitchMetric(application: app)) }
        metrics.append(XCTCPUMetric(application: app))
        metrics.append(XCTClockMetric())
        return metrics
    }

    private func signpost(_ name: String) -> XCTMetric {
        XCTOSSignpostMetric(subsystem: Self.subsystem, category: Self.category, name: name)
    }

    /// Launches once so a first launch can write the seeded covers, then waits for the screen.
    private func launchSeeded(_ app: XCUIApplication, ready: (XCUIApplication) -> XCUIElement) {
        app.launch()
        XCTAssertTrue(ready(app).waitForExistence(timeout: 180))
        sleep(3)
    }

    /// Relaunches per iteration and reads `<screen>-load` and `<screen>-first-cover`.
    private func measureFirstContent(_ gallery: String, screen: String, ready: @escaping (XCUIApplication) -> XCUIElement) {
        let app = app(gallery)
        launchSeeded(app, ready: ready)
        app.terminate()
        measure(metrics: [signpost("\(screen)-load"), signpost("\(screen)-first-cover")], options: options) {
            app.launch()
            XCTAssertTrue(ready(app).waitForExistence(timeout: 60))
            sleep(3)
            stopMeasuring()
            app.terminate()
        }
    }

    /// Three fast flicks up, measured; then back to the top, not measured.
    private func measureScroll(_ app: XCUIApplication, _ target: XCUIElement) {
        measure(metrics: hitchMetrics(app, scrolling: true), options: options) {
            for _ in 0..<3 { target.swipeUp(velocity: .fast) }
            sleep(2)
            stopMeasuring()
            for _ in 0..<5 { target.swipeDown(velocity: .fast) }
            sleep(1)
        }
    }

    // MARK: Library

    func testLibraryScroll() {
        let app = app("perf-library")
        launchSeeded(app) { $0.scrollViews.firstMatch }
        measureScroll(app, app.scrollViews.firstMatch)
    }

    func testLibraryFirstContent() {
        measureFirstContent("perf-library", screen: "library") { $0.scrollViews.firstMatch }
    }

    // MARK: Stats

    func testStatsScroll() {
        let app = app("perf-stats")
        launchSeeded(app) { $0.scrollViews.firstMatch }
        measureScroll(app, app.scrollViews.firstMatch)
    }

    func testStatsFirstContent() {
        measureFirstContent("perf-stats", screen: "stats") { $0.scrollViews.firstMatch }
    }

    // MARK: Collections record player

    private static func wheel(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "collections-wheel").firstMatch
    }

    /// Three fast drags up the wheel's cover column, measured with every frame's hitches; then three back, not measured.
    func testPlayerWheel() {
        let app = app("perf-player")
        launchSeeded(app) { Self.wheel($0) }
        let wheel = Self.wheel(app)
        func turn(up: Bool) {
            let low = wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.8))
            let high = wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.2))
            (up ? low : high).press(forDuration: 0.05, thenDragTo: up ? high : low, withVelocity: .fast, thenHoldForDuration: 0)
        }
        measure(metrics: hitchMetrics(app, scrolling: false), options: options) {
            for _ in 0..<3 { turn(up: true) }
            sleep(2)
            stopMeasuring()
            for _ in 0..<3 { turn(up: false) }
            sleep(1)
        }
    }

    func testPlayerFirstContent() {
        measureFirstContent("perf-player", screen: "player") { Self.wheel($0) }
    }

    // MARK: Release page

    func testReleaseScroll() {
        let app = app("perf-release")
        launchSeeded(app) { $0.collectionViews.firstMatch }
        measureScroll(app, app.collectionViews.firstMatch)
    }

    func testReleaseFirstContent() {
        measureFirstContent("perf-release", screen: "release") { $0.collectionViews.firstMatch }
    }
}
