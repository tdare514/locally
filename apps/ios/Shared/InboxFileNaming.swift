import Foundation

/// Pure naming rules for files the "Send to Locally" share extension stages
/// into the App Group's shared Inbox folder, compiled into both the app and
/// the extension so they always agree on the on-disk format. Kept free of
/// any `FileManager`/App Group access so it can be unit tested without a
/// container.
enum InboxFileNaming {
    /// The name of the Inbox folder inside the App Group container. The
    /// extension writes there and the app reads there, so both use this.
    static let folderName = "Inbox"

    /// APFS refuses a file name longer than this many UTF-8 bytes.
    static let maxFileNameBytes = 255

    /// The on-disk name a shared file is given inside the Inbox folder:
    /// `"<uuid>-<original name>"`. The uuid keeps two shares of a
    /// same-named file from colliding; the original name is kept verbatim
    /// (not sanitised) since it never leaves the Inbox folder as-is — the
    /// app re-derives its own filename via `ReleaseLayout` once imported.
    /// An original name too long to fit beside the uuid loses characters
    /// from the end of its stem; the extension is kept, since the app
    /// allow-lists files by it.
    static func fileName(id: UUID, originalName: String) -> String {
        let prefix = "\(id.uuidString)-"
        let budget = maxFileNameBytes - prefix.utf8.count
        guard originalName.utf8.count > budget else { return prefix + originalName }

        let ext = (originalName as NSString).pathExtension
        let suffix = ext.isEmpty ? "" : ".\(ext)"
        guard suffix.utf8.count < budget else {
            return prefix + truncated(originalName, toBytes: budget)
        }
        let stem = String(originalName.dropLast(suffix.count))
        return prefix + truncated(stem, toBytes: budget - suffix.utf8.count) + suffix
    }

    /// Drops whole characters from the end until `text` fits in `bytes`
    /// UTF-8 bytes, so a multi-byte character is never split.
    private static func truncated(_ text: String, toBytes bytes: Int) -> String {
        var result = Substring(text)
        while result.utf8.count > bytes { result = result.dropLast() }
        return String(result)
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
