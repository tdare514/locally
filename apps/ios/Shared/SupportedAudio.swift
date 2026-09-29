import Foundation

/// File extensions the import path accepts. mp3 and m4a pass through
/// `AVTranscoder`; wav, flac and aiff/aif are converted to m4a. Compiled into
/// both the app and the share extension so they can never disagree about
/// what is worth copying into the Inbox.
enum SupportedAudio {
    static let extensions: Set<String> = ["mp3", "m4a", "wav", "flac", "aiff", "aif"]

    /// The subset `AVTranscoder` hands to the tag writers untouched; every
    /// other supported extension is converted to m4a first. Kept here, next
    /// to `extensions`, so the two lists cannot drift apart.
    static let passthrough: Set<String> = ["mp3", "m4a"]

    /// True when `fileName` has an extension (case-insensitive) on the list.
    static func isSupported(fileName: String) -> Bool {
        let ext = (fileName as NSString).pathExtension.lowercased()
        return !ext.isEmpty && extensions.contains(ext)
    }

    /// For user-facing messages: "mp3, m4a, wav, flac or aiff".
    static let readableList = "mp3, m4a, wav, flac or aiff"
}
