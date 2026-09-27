import Foundation

/// Every user-facing string in the app, grouped by screen, so copy stays in
/// one reviewable place and the tone (second person, present tense, one
/// idea per sentence, no exclamation marks) stays consistent. Text mirrors
/// `docs/ios-plan.md`'s "In-app copy" section verbatim.
enum Copy {
    enum Onboarding {
        static let welcomeTitle = "Welcome to Locally"
        static let welcomeBody = "Add your own songs to Spotify with the cover and details you choose. This app is independent and is not made by or connected to Spotify."
        static let premium = "This works with Spotify Premium. Free-account support is being explored."
        static let localFilesTitle = "Turn on Local Files"
        static let localFilesBody = "To save songs into Spotify, turn on Local Files: open Spotify, tap Settings, then Local Files, then switch it on. Spotify will create a folder for them in your Files app."
        static let folderAccessTitle = "Connect Spotify's folder"
        static let folderAccessBody = "Allow us to move the songs you tag here into that folder. Pick On My iPhone, then Spotify, then tap Open. You only do this once."
        static let chooseFolder = "Choose folder"
        static let confirmationTitle = "You're set"
        static let confirmationBody = "Spotify's folder is connected. You can start adding songs."
        static let next = "Next"
        static let getStarted = "Get started"
    }

    enum Import {
        static let title = "Add a song"
        static let pickFile = "Choose a file"
        static let fieldTitle = "Title"
        static let fieldArtist = "Artist"
        static let fieldAlbum = "Album"
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
        static let afterEdit = "Updated. Spotify will show the new details next time it opens. If they don't appear, close Spotify fully and open it again."
    }

    enum Library {
        static let title = "Your library"
        static let empty = "Nothing added yet."
        static let single = "Single"
        static let album = "Album"
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
