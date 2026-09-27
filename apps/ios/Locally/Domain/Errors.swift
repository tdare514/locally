import Foundation

/// Errors surfaced to the UI, each carrying a user-facing message so call
/// sites can show them directly without a separate mapping step.
enum LocallyError: LocalizedError {
    /// The picked/imported file could not be read or copied into the app's
    /// working area.
    case importFailed(String)
    /// Converting a file to AAC m4a failed.
    case transcodeFailed(String)
    /// Writing tags (ID3 or iTunes atoms) into a file failed.
    case taggingFailed(String)
    /// The Spotify folder's security-scoped bookmark is missing or stale
    /// (e.g. after Spotify was reinstalled or Local Files was turned off).
    case folderLost
    /// No Spotify folder has been chosen yet.
    case folderNotConnected
    /// Reading or writing the on-device library index failed.
    case libraryFailed(String)
    /// A track's file is no longer at its recorded path (e.g. removed
    /// outside the app) when an edit tries to re-tag it in place.
    case fileMissing(String)
    /// A track's recorded path resolved to somewhere outside the connected
    /// Spotify folder; refused rather than deleting or rewriting it.
    case pathOutsideFolder
    /// StoreKit couldn't complete a purchase, restore, or product load.
    case purchaseFailed(String)

    var errorDescription: String? {
        switch self {
        case .importFailed(let detail):
            return "Couldn't import that file. \(detail)"
        case .transcodeFailed(let detail):
            return "Couldn't convert that file. \(detail)"
        case .taggingFailed(let detail):
            return "Couldn't write the song's details. \(detail)"
        case .folderLost:
            return Copy.Settings.folderLost
        case .folderNotConnected:
            return "Connect Spotify's folder first."
        case .libraryFailed(let detail):
            return "Couldn't update your library. \(detail)"
        case .fileMissing(let name):
            return "Couldn't find \"\(name)\" any more. It may have been moved or deleted outside Locally."
        case .pathOutsideFolder:
            return "That file isn't inside Spotify's folder."
        case .purchaseFailed(let detail):
            return "Couldn't complete that purchase. \(detail)"
        }
    }
}
