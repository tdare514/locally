import Foundation

/// Pure naming rules for files the "Send to Locally" share extension stages
/// into the App Group's shared Inbox folder, compiled into both the app and
/// the extension so they always agree on the on-disk format. Kept free of
/// any `FileManager`/App Group access so it can be unit tested without a
/// container.
enum InboxFileNaming {
    /// The on-disk name a shared file is given inside the Inbox folder:
    /// `"<uuid>-<original name>"`. The uuid keeps two shares of a
    /// same-named file from colliding; the original name is kept verbatim
    /// (not sanitised) since it never leaves the Inbox folder as-is — the
    /// app re-derives its own filename via `ReleaseLayout` once imported.
    static func fileName(id: UUID, originalName: String) -> String {
        "\(id.uuidString)-\(originalName)"
    }

    /// A canonical UUID string (`8-4-4-4-12` hex digits) is always exactly
    /// this many characters, and — critically — contains dashes of its own,
    /// so the separator before the original name can't be found with a
    /// plain "first dash" search.
    private static let uuidStringLength = 36

    /// Recovers the original file name from an Inbox file name, if it
    /// matches the `"<uuid>-<original name>"` format produced by
    /// `fileName`. Returns `nil` for anything else (a hidden file, a name
    /// with no uuid prefix, or one with nothing after the separator), so
    /// callers can filter out files that don't belong to this scheme
    /// without guessing at their shape.
    static func originalName(fromInboxFileName name: String) -> String? {
        guard name.count > uuidStringLength + 1 else { return nil }
        let idPart = String(name.prefix(uuidStringLength))
        guard UUID(uuidString: idPart) != nil else { return nil }
        let separatorIndex = name.index(name.startIndex, offsetBy: uuidStringLength)
        guard name[separatorIndex] == "-" else { return nil }
        let rest = name[name.index(after: separatorIndex)...]
        guard !rest.isEmpty else { return nil }
        return String(rest)
    }
}
