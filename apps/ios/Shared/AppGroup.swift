import Foundation

/// The App Group id shared by the main app and the "Send to Locally" share
/// extension, so both can read and write the same Inbox folder in the
/// group's container. Compiled into both targets so they can never drift.
enum AppGroup {
    static let identifier = "group.com.tdare.locally"
}
