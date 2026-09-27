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
        static let title = "Import"
        /// The page subtitle shown under the title, per `docs/design.md`'s
        /// "Page header" component — matches the web app's Import view.
        static let subtitle = "Add a song or album to your Spotify library."
        /// The eyebrow shown above the title on the Import screen, per
        /// `docs/design.md`'s "Page header" component.
        static let eyebrow = "Local library"
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
        /// The cover picker panel's caption before an image is chosen. Matches
        /// `docs/design.md`'s "Cover picker" component, iOS wording.
        static let coverCaption = "Tap to choose a cover"
        /// The hint under the cover drop zone, verbatim from `docs/design.md`'s
        /// "Cover drop zone" component.
        static let coverHint = "Square artwork works best"
        /// The file chooser panel's caption before a file is chosen. Matches
        /// `docs/design.md`'s "Drop zone / file chooser" component, iOS wording.
        static let fileCaption = "Tap to choose a file"
        /// The muted hint under the single-track file chooser, verbatim from
        /// `docs/design.md`'s "Drop zone / file chooser" component.
        static let singleFileHint = "Singles are one file. Switch to Album for multiple."
        /// The section title over an album's track rows, and the release
        /// detail's Tracks section.
        static let tracks = "Tracks"
        /// A file row's caption under its title, per `docs/design.md`'s
        /// "Editor / release detail" component.
        static let audioFile = "Audio file"
        static let send = "Send to Spotify"
        static let sending = "Sending…"
        static let doneSingle = "Sent. Open Spotify, then Your Library, then Local Files to play it."
        static let openSpotify = "Open Spotify"

        /// Matches `docs/ios-plan.md`'s "Done (album)" copy verbatim, naming the actual
        /// album title rather than the generic phrase a plain constant would need.
        static func doneAlbum(albumTitle: String) -> String {
            "Sent. To hear it as an album, make it a playlist: in Spotify open Local Files, select these tracks, then Add to playlist, New playlist, and name it \(albumTitle)."
        }
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
        /// The header row's eyebrow, per `docs/design.md`'s "Library list" component.
        static let eyebrow = "Your collection"
        /// The header row's title, replacing the generic nav title in-content.
        static let allMusic = "All music"
        static let title = "Your library"
        static let single = "Single"
        static let album = "Album"
        /// The header row's right-aligned meta, e.g. "7 tracks".
        static func trackCount(_ count: Int) -> String {
            count == 1 ? "1 track" : "\(count) tracks"
        }
        /// The sticky-footer button that switches to the Add a song tab.
        static let addASong = "Add a song"

        /// The empty library doubles as onboarding: it explains what Locally
        /// does (files go from here into Spotify) and offers the first import.
        static let emptyEyebrow = "Your library"
        static let emptyTitle = "Nothing here yet"
        static let emptyBody = "Songs you add here are tagged with your cover and details, then sent into Spotify's Local Files."
        static let addFirstSingle = "Add your first single"
        static let makeAnAlbum = "Make an album"
        /// Captions under the two tiles in the empty state's diagram.
        static let diagramLocally = "Locally"
        static let diagramSpotify = "Spotify"
    }

    enum Detail {
        /// The eyebrow over the release detail's metadata section.
        static let detailsEyebrow = "Details"
        /// The metadata section's title.
        static let metadata = "Metadata"
        /// The metadata section's right-aligned meta.
        static let tapToEdit = "Tap to edit"
        /// The pill overlay on the release detail's big cover.
        static let edit = "Edit"
        static let saveChanges = "Save changes"
        static let saving = "Saving…"
        static let replaceCover = "Replace cover"
        static let delete = "Delete"
        static let deleteConfirmTitle = "Delete this release?"
        static let deleteConfirmAction = "Delete release"
        static let deleteConfirmCancel = "Cancel"
        static let makeItAPlaylist = "Make it a playlist"
        /// The Tracks section's right-aligned meta, e.g. "1 file".
        static func fileCount(_ count: Int) -> String {
            count == 1 ? "1 file" : "\(count) files"
        }
    }

    enum Cover {
        static let cropTitle = "Crop cover"
        static let square = "Square"
        static let original = "Original"
        static let squareHint = "Spotify shows covers as a square."
        static let done = "Done"
        static let cancel = "Cancel"
    }

    enum Settings {
        static let appIcon = "App icon"
        static let appIconHint = "Pick the icon shown on your Home Screen."
        static let iconNames: [String: String] = [
            "AppIcon": "Solid",
            "AppIcon-Line": "Line art",
        ]
        static let appIconFailed = "Couldn't change the icon. Try again."
        static let title = "Settings"
        static let folderConnected = "Spotify's folder is connected."
        static let folderNotConnected = "Spotify's folder isn't connected."
        static let reconnect = "Reconnect"
        static let folderLost = "We can't reach Spotify's folder any more. This happens after Spotify is reinstalled or Local Files is turned off. Tap to reconnect."
        static let about = "About"
        static let trademarkLine = "Locally is an independent app. Spotify is a trademark of Spotify AB. This app is not affiliated with, endorsed by or sponsored by Spotify."
        static let version = "Version"
    }

    enum Inbox {
        static func waitingBanner(count: Int) -> String {
            count == 1 ? "1 song is waiting to be tagged." : "\(count) songs are waiting to be tagged."
        }
        static let dismiss = "Dismiss"
        static func waitingChip(count: Int) -> String { "\(count) waiting" }
        static let addAsSingles = "Add as singles"
        static let makeAnAlbum = "Make an album"
    }

    enum Purchase {
        static let title = "Locally Full"
        static let body = "A one-time purchase, no subscription. It supports development and unlocks upcoming features as they arrive."
        static let rowTitle = "Locally Full"
        static let unlocked = "Unlocked"
        static let buy = "Buy"
        static let restore = "Restore purchase"
        static let close = "Close"

        static func buyLabel(price: String?) -> String {
            guard let price else { return buy }
            return "\(buy) – \(price)"
        }
    }

    enum Sync {
        static let cardTitle = "Sync with your Mac"
        static let cardBody = "Keep this phone's library and your Mac's Locally library in step."
        static let emailFieldLabel = "Email"
        static let emailPlaceholder = "you@example.com"
        static let sendCode = "Send code"
        static let sending = "Sending…"
        static let codeFieldLabel = "Code"
        static let codePlaceholder = "6-digit code"
        static let codeSentTo = "We sent a 6-digit code to"
        static let useDifferentEmail = "Use a different email"
        static let signIn = "Sign in"
        static let signingIn = "Signing in…"
        static let signOut = "Sign out"
        static let syncNow = "Sync now"
        static let syncing = "Syncing…"
        static let deviceLabel = "Device"
        static let storageLabel = "Storage"
        static let mergeNotice = "Songs already on both your Mac and this phone before you signed in are kept as two separate releases, not merged."
        static let serverAddress = "Server address (development)"
        static let serverAddressHint = "Point this at your Mac's address on the same network, e.g. http://192.168.1.23:4000, so this simulator or phone can reach it."

        static func lastSynced(_ relativeTime: String) -> String { "Last synced \(relativeTime)." }
        static let neverSynced = "Not synced yet."

        static func quota(usedMB: Int, limitMB: Int) -> String { "\(usedMB) MB of \(limitMB) MB used" }

        static func pendingFromMac(count: Int) -> String {
            count == 1 ? "1 song from your Mac" : "\(count) songs from your Mac"
        }
        static let sendToSpotify = "Send to Spotify"
        static let sendAll = "Send all"
        static let downloading = "Downloading…"
    }
}
