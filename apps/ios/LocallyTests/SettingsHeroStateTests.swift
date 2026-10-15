import Foundation
import Testing
@testable import Locally

/// The Settings account card (#160): signed in or out, the avatar's initial, and the
/// "Synced 2 min ago" pill text.
struct SettingsHeroStateTests {
    private let english = Locale(identifier: "en_US")
    private let now = Date(timeIntervalSinceReferenceDate: 800_000_000)

    @Test func signedOutOffersSignInEvenWithAStaleEmail() {
        let status = SyncStatus(signedIn: false, email: "old@example.com", deviceName: "iPhone 17")
        #expect(SettingsHeroState(status) == .signedOut)
    }

    @Test func signedInCarriesTheAccountAndTheLastRun() {
        let lastRun = now.addingTimeInterval(-120)
        let status = SyncStatus(signedIn: true, email: "sample@example.com", deviceName: "iPhone 17", lastRunAt: lastRun)
        #expect(SettingsHeroState(status) == .signedIn(
            email: "sample@example.com", deviceName: "iPhone 17", initial: "S", lastRunAt: lastRun
        ))
    }

    @Test func signedInWithoutAnEmailHasNoInitial() {
        let status = SyncStatus(signedIn: true)
        #expect(SettingsHeroState(status) == .signedIn(email: "", deviceName: nil, initial: nil, lastRunAt: nil))
    }

    @Test(arguments: [
        ("sample@example.com", "S"),
        ("émile@example.com", "É"),
        ("42@example.com", "4"),
        (".dot@example.com", "D"),
    ])
    func theInitialIsTheFirstLetterOrDigitUpperCased(email: String, expected: String) {
        #expect(SettingsHeroState.initial(ofEmail: email) == expected)
    }

    @Test(arguments: ["", "@.-_"])
    func noLetterOrDigitMeansNoInitial(email: String) {
        #expect(SettingsHeroState.initial(ofEmail: email) == nil)
    }

    @Test func neverSyncedSaysSo() {
        #expect(SettingsHeroState.syncedText(lastRunAt: nil, now: now, locale: english) == "Not synced yet")
    }

    @Test(arguments: [0.0, 5, 59, -30])
    func underAMinuteIsJustNow(secondsAgo: Double) {
        let text = SettingsHeroState.syncedText(lastRunAt: now.addingTimeInterval(-secondsAgo), now: now, locale: english)
        #expect(text == "Synced just now")
    }

    @Test(arguments: [
        (60.0, "Synced 1 min ago"),
        (120.0, "Synced 2 min ago"),
        (3 * 3600.0, "Synced 3 hr ago"),
        (2 * 86_400.0, "Synced 2 days ago"),
    ])
    func olderRunsReadAsAShortRelativeTime(secondsAgo: Double, expected: String) {
        let text = SettingsHeroState.syncedText(lastRunAt: now.addingTimeInterval(-secondsAgo), now: now, locale: english)
        #expect(text == expected)
    }
}
