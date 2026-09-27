import Foundation

/// Every user-facing string in the app, grouped by screen, so copy stays in
/// one reviewable place and the tone (second person, present tense, one
/// idea per sentence, no exclamation marks) stays consistent. Text mirrors
/// `docs/ios-plan.md`'s "In-app copy" section verbatim.
enum Copy {
    enum Onboarding {
        static let welcomeTitle = "Welcome to Locally"
        static let welcomeBody = "Add your own songs to Spotify with the cover and details you choose. This app is independent and is not made by or connected to Spotify."
        static let premium = "This app works with Spotify Premium on iPhone. Sign in to Spotify on this phone before you continue."
        static let localFilesTitle = "Turn on Local Files"
        static let localFilesBody = "To save songs into Spotify, turn on Local Files: open Spotify, tap Settings, then Local Files, then switch it on. Spotify will create a folder for them in your Files app."
        static let folderAccessTitle = "Connect Spotify's folder"
        static let folderAccessBody = "Allow us to move the songs you tag here into that folder. Pick On My iPhone, then Spotify, then tap Open. You only do this once."
        static let chooseFolder = "Choose folder"
        static let confirmationTitle = "Connected"
        static let confirmationBody = "Connected. Songs you send from here will appear in Spotify under Your Library, then Local Files."
        static let next = "Next"
        static let getStarted = "Get started"
    }

    enum Import {
        static let title = "Add a song"
        static let pickFile = "Choose a file"
        static let chooseFiles = "Choose files"
        static let fieldTitle = "Title"
        static let fieldArtist = "Artist"
        static let fieldAlbum = "Album"
        static let fieldAlbumTitle = "Album title"
        static let albumPlaceholder = "Same as track title"
        static let fieldYear = "Year"
        static let fieldGenre = "Genre"
        static let cover = "Cover"
        static let send = "Send to Spotify"
        static let sending = "Sending…"
        static let doneSingle = "Sent. Open Spotify, then Your Library, then Local Files to play it."
        static let doneAlbum = "Sent. To hear it as an album, make it a playlist: in Spotify open Local Files, select these tracks, then Add to playlist, New playlist, and name it the album title."
        static let openSpotify = "Open Spotify"
        static let addAnother = "Add another"
        static let albumExplainer = "Spotify can't create albums from your own files, so we'll set these up to become a playlist. They'll share this cover, artist and album name."
        static let albumCoverPrompt = "Pick the cover that'll be applied to all of these tracks."
        static let afterEdit = "Updated. Spotify shows a new cover right away, but keeps the old name until it rescans. In Spotify, open Settings, then Local Files, switch it off and on again, and the new details appear."
        static let kindSingle = "Single"
        static let kindAlbum = "Album"
        static let noTracksYet = "No tracks yet."
        static let track = "Track"

        static func taggingProgress(done: Int, total: Int) -> String {
            "Tagging and moving \(done) of \(total)"
        }
    }

    enum Library {
        static let title = "Your library"
        static let empty = "Nothing added yet."
        static let single = "Single"
        static let album = "Album"
    }

    enum Detail {
        static let saveChanges = "Save changes"
        static let saving = "Saving…"
        static let replaceCover = "Replace cover"
        static let delete = "Delete"
        static let deleteConfirmTitle = "Delete this release?"
        static let deleteConfirmAction = "Delete release"
        static let deleteConfirmCancel = "Cancel"
        static let makeItAPlaylist = "Make it a playlist"
    }

    enum Settings {
        static let title = "Settings"
        static let folderConnected = "Spotify's folder is connected."
        static let folderNotConnected = "Spotify's folder isn't connected."
        static let reconnect = "Reconnect"
        static let folderLost = "We can't reach Spotify's folder any more. This happens after Spotify is reinstalled or Local Files is turned off. Tap to reconnect."
        static let about = "About"
        static let trademarkLine = "Locally is an independent app. Spotify is a trademark of Spotify AB. This app is not affiliated with, endorsed by or sponsored by Spotify."
        static let version = "Version"
    }
}
