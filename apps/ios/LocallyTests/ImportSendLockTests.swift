import Testing
@testable import Locally

/// `ImportSendLock` (#205): when the Single / Album switch is off.
struct ImportSendLockTests {
    private func locked(loading: Bool = false, sending: Bool = false, holding: Bool = false) -> Bool {
        ImportSendLock.isLocked(isLoadingTags: loading, isSending: sending, holdingForSent: holding)
    }

    @Test func openWhenNothingIsHappening() {
        #expect(!locked())
    }

    @Test func lockedWhileFilesLoad() {
        #expect(locked(loading: true))
    }

    @Test func lockedWhileSending() {
        #expect(locked(sending: true, holding: true))
    }

    @Test func lockedFromTheTapBeforeTheSendStarts() {
        // Send tapped: held, but the model is not sending yet.
        #expect(locked(sending: false, holding: true))
    }

    @Test func lockedWhileTheSentCardIsUp() {
        // The model has finished sending; the hold stays until the Sent card has closed.
        #expect(locked(loading: false, sending: false, holding: true))
    }

    @Test func openAgainAfterTheCardClosesOrTheSendFails() {
        #expect(!locked(holding: false))
    }
}
