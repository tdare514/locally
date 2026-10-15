import Foundation

/// What the Settings account card shows (#160): signed in, the account and when it last synced;
/// signed out, the sign-in form instead. Kept apart from the view so the text can be tested.
enum SettingsHeroState: Equatable {
    case signedOut
    case signedIn(email: String, deviceName: String?, initial: String?, lastRunAt: Date?)

    init(_ status: SyncStatus) {
        guard status.signedIn else {
            self = .signedOut
            return
        }
        let email = status.email ?? ""
        self = .signedIn(
            email: email,
            deviceName: status.deviceName,
            initial: Self.initial(ofEmail: email),
            lastRunAt: status.lastRunAt
        )
    }

    /// The avatar stand-in until there is a user profile (#199): the first letter or digit of the
    /// email, upper-cased; nil when there is none, so the avatar shows the listener mark instead.
    static func initial(ofEmail email: String) -> String? {
        email.first(where: { $0.isLetter || $0.isNumber }).map { String($0).uppercased() }
    }

    /// The pill text: "Synced 2 min ago", "Synced just now" inside the first minute (and for a
    /// clock a little ahead of this phone), or "Not synced yet".
    static func syncedText(lastRunAt: Date?, now: Date, locale: Locale = .current) -> String {
        guard let lastRunAt else { return Copy.Sync.neverSyncedPill }
        if now.timeIntervalSince(lastRunAt) < 60 { return Copy.Sync.syncedJustNow }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = locale
        formatter.unitsStyle = .short
        // `.short` writes "2 min. ago"; the pill reads "2 min ago".
        let relative = formatter.localizedString(for: lastRunAt, relativeTo: now).replacingOccurrences(of: ".", with: "")
        return Copy.Sync.syncedPill(relative)
    }
}
