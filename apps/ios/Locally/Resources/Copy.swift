import Foundation

/// Every user-facing string in the app, grouped by screen, so copy stays in
/// one reviewable place and the tone (second person, present tense, one
/// idea per sentence, no exclamation marks) stays consistent. Text mirrors
/// `docs/ios-plan.md`'s "In-app copy" section verbatim.
enum Copy {
    enum StoreError {
        static let title = "Locally can't open its library"
        static let body = "Locally couldn't open the index of your releases. Your music files in the Spotify folder are untouched."
        static let tryAgain = "Try again"
        static let reset = "Reset library index"
        static let resetTitle = "Reset the library index?"
        static let resetConfirm = "Reset"
        static let resetCancel = "Cancel"
        static let resetMessage = "Your list of releases in Locally will be empty afterwards. Your music files stay in the Spotify folder and Spotify still plays them. The old index is kept as a backup in the app's storage."
        static func detail(_ text: String) -> String { "Details: \(text)" }
    }

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

    /// The immersive release look's reusable components (not yet on a screen).
    enum Immersive {
        static let addCoverArt = "Add cover art"
        /// Accessibility label of the sleeve once it has a cover.
        static let changeCoverArt = "Change cover art"
        static let savedToLibrary = "Saved to your library"
        static let unsavedChanges = "Unsaved changes"
        /// The cover-source choices shown when the sleeve is tapped.
        static let coverFromPhotos = "Photos"
        static let coverFromFiles = "Files"
    }

    enum Import {
        static let title = "Import"
        static let pickFile = "Choose a file"
        /// The invitation's button and hint (#205).
        static let addTrack = "Add a track"
        static let addTrackHint = "or add audio from Files"
        static let fieldTitle = "Title"
        static let fieldArtist = "Artist"
        static let fieldAlbumTitle = "Album title"
        /// A failed send's message cut short at large text sizes: the link under it, and the
        /// sheet that shows the whole message.
        static let sendErrorDetails = "Details"
        static let sendErrorTitle = "Why it didn't send"
        static let albumPlaceholder = "Same as the single name"
        static let singlePlaceholder = "Enter single name"
        static let albumNamePlaceholder = "Enter album name"
        static let artistPlaceholder = "Enter artist name"
        static let yearPlaceholder = "Enter year"
        static let genrePlaceholder = "Enter genre"
        static let fieldAlbum = "Album"
        /// The title field's placeholder, by the kind of release.
        static func titlePlaceholder(for kind: ReleaseKind) -> String {
            kind == .album ? albumNamePlaceholder : singlePlaceholder
        }
        static let fieldYear = "Year"
        static let fieldGenre = "Genre"
        static let cover = "Cover"
        /// The cover picker panel's caption before an image is chosen. Matches
        /// `docs/design.md`'s "Cover picker" component, iOS wording.
        static let coverCaption = "Tap to choose a cover"
        /// The hint under the cover drop zone, verbatim from `docs/design.md`'s
        /// "Cover drop zone" component.
        static let coverHint = "Square artwork works best"
        static let coverFromPhotos = "Photos"
        static let coverFromFiles = "Files"
        static let coverDialogTitle = "Add a cover"
        static let removeCover = "Remove cover"
        /// The cover sheet's heading over the row of covers already in the library.
        static let recentCovers = "Recent covers"
        /// VoiceOver label of one recent cover: the release it came from.
        static func recentCoverLabel(title: String, artist: String) -> String {
            artist.isEmpty ? title : "\(title), \(artist)"
        }
        /// The hint read after the record sleeve's own label.
        static let sleeveHint = "Choose a cover from Photos or Files"
        /// The section title over an album's track rows, and the release
        /// detail's Tracks section.
        static let tracks = "Tracks"
        /// The quiet heading over a disc's tracks, shown only when a release has more than one disc.
        static func disc(_ number: Int) -> String { "Disc \(number)" }
        /// A file row's caption under its title, per `docs/design.md`'s
        /// "Editor / release detail" component.
        static let audioFile = "Audio file"
        static let send = "Send to Spotify"
        static let sending = "Sending…"
        static let sentTitle = "Sent"
        static let sentSingleBody = "Your track has been sent to Spotify."
        static let sentAlbumBody = "Your album has been sent to Spotify."
        static let sentSingleHint = "It's in Your Library, under Local Files."
        static let sentAlbumHint = "To play it as an album, make it a playlist from its page in your library."
        static let openInSpotify = "Open in Spotify"
        static let albumNotice = "Spotify doesn't group your own files into albums. After you send, we'll show you how to make a playlist of these tracks."
        static let albumCoverPrompt = "Pick the cover that'll be applied to all of these tracks."
        static let afterEdit = "Updated. Spotify shows a new cover right away, but keeps the old name until it rescans. In Spotify, open Settings, then Local Files, switch it off and on again, and the new details appear."
        static let kindSingle = "Single"
        static let kindAlbum = "Album"
        static let noTracksYet = "No tracks yet"
        /// The line under `noTracksYet` in the empty-tracks silhouette.
        static let noTracksHint = "Add audio files and they'll appear here."
        /// Shown under the Tracks header once there are 2+ rows to reorder;
        /// `.onMove` supports long-press drag without an Edit mode on iOS 16+.
        static let reorderHint = "Hold and drag a track to reorder."
        static let track = "Enter track name"
        /// The VoiceOver label of a track row's replace button.
        static func replaceTrack(_ title: String) -> String {
            let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
            return "Replace \(name.isEmpty ? track.lowercased() : name)"
        }

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
        /// Section labels for the split list, with the item count.
        static let singlesSection = "Singles"
        static let albumsSection = "Albums"
        static func sectionCount(_ count: Int) -> String { "\(count)" }
        /// The section headers' accessibility value and hint.
        static let sectionExpanded = "Expanded"
        static let sectionCollapsed = "Collapsed"
        static let sectionHint = "Double tap to fold or open this section"
        /// Album row subtitle: "artist · 4 tracks".
        static func albumSubtitle(artist: String, tracks: Int) -> String {
            "\(artist) · \(trackCount(tracks))"
        }
        /// The list / cover toggle and cover size control in the header.
        static let searchPlaceholder = "Search title, artist, genre or track"
        static let clearSearch = "Clear search"
        static func noMatches(_ query: String) -> String { "No matches for \u{201C}\(query)\u{201D}" }
        static let layoutList = "List"
        static let layoutCovers = "Covers"
        static let layoutLabel = "Library view"
        static let coverSizeLabel = "Cover size"
        static let sizeSmall = "Small"
        static let sizeMedium = "Medium"
        static let sizeLarge = "Large"
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

    enum Release {
        static let edit = "Edit"
        static let cancel = "Cancel"
        static let notSet = "Not set"
        static let reviewTitle = "Check your changes"
        static let save = "Save"
        static let keepEditing = "Keep editing"
        static let trackOrderChanged = "Track order changed"
        static let cover = "Cover"
        /// VoiceOver for the review sheet's cover row.
        static let coverChanged = "Cover changed"
        static let discardTitle = "Discard your changes?"
        static let discard = "Discard"
        static let keepEditingDiscard = "Keep editing"
        /// VoiceOver for a review row's old and new value.
        static func changedFrom(_ old: String, to new: String) -> String { "Was \(old), now \(new)" }
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
        /// Hint under the Tracks header when there are 2+ tracks, since the
        /// compact layout dropped the Edit-mode toolbar button.
        static let reorderHint = "Hold and drag a track to reorder."
        /// Under a track row: its total Spotify plays across devices.
        static func playCount(_ count: Int) -> String {
            count == 1 ? "1 play" : "\(count) plays"
        }
        /// Under the tracks when any has plays: the totals add up every signed-in device.
        static let playsAcrossDevices = "Plays are counted across all your devices."
        /// Shown on an adopted release's page: its files stay on the Mac.
        static let adoptedNote = "In your Mac's Spotify folder"
        static let saveChanges = "Save changes"
        static let saving = "Saving…"
        static let replaceCover = "Replace cover"
        static let delete = "Delete"
        static let deleteConfirmTitle = "Delete this release?"
        static let deleteConfirmAction = "Delete release"
        static let deleteConfirmCancel = "Cancel"
        static let makeItAPlaylist = "Make it a playlist"
        /// The iPhone steps under "Make it a playlist". Per-track, because Local
        /// Files on iPhone has no multi-select as far as we know: UNVERIFIED as of
        /// 2026-09-28 against a real phone (docs/plans/21-make-it-a-playlist.md,
        /// "Check first" 2). If multi-select is confirmed, shorten this to a single
        /// select-then-Add-to-playlist instruction and note the iOS/Spotify version here.
        static func makeItAPlaylistSteps(albumTitle: String) -> String {
            "Open Spotify, then Your Library, then Local Files. On the first track tap the three dots, Add to playlist, New playlist, paste the name. For each other track: three dots, Add to playlist, \(albumTitle)."
        }
        /// Always shown under the steps.
        static let makeItAPlaylistFallback = "If Add to playlist is missing, update Spotify and open it again."
        /// The button that copies the album title to the pasteboard, and its
        /// two-second confirmation.
        static let copyTitle = "Copy"
        static let copied = "Copied"
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
        static let motionSection = "Motion"
        static let keepBackdropsMoving = "Keep backgrounds moving"
        static let keepBackdropsMovingHintReduced = "Your iPhone has Reduce Motion on, so Locally holds its backgrounds still. Turn this on to let them drift slowly anyway."
        static let keepBackdropsMovingHint = "Backgrounds drift slowly. With Reduce Motion on, this keeps them moving."
        static let keepBackdropsMovingHintKept = "Your iPhone has Reduce Motion on. Locally's backgrounds still drift slowly while this is on."
        static let appIconFailed = "Couldn't change the icon. Try again."
        static let title = "Settings"
        static let folderConnected = "Spotify's folder is connected."
        static let folderNotConnected = "Spotify's folder isn't connected."
        static let folderSection = "Spotify folder"
        static let purchaseSection = "Purchase"
        static let reconnect = "Reconnect"
        static let folderLost = "We can't reach Spotify's folder any more. This happens after Spotify is reinstalled or Local Files is turned off. Tap to reconnect."
        static let about = "About"
        static let trademarkLine = "Locally is an independent app. Spotify is a trademark of Spotify AB. This app is not affiliated with, endorsed by or sponsored by Spotify."
        static let version = "Version"
    }

    /// Messages carried by `LocallyError` from the tag writers and transcoder.
    enum FileErrors {
        static let coverTooLargeForMp3 = "That cover is too large to store in an mp3."
        static let existingTagTooLarge = "This file's tags are too large to edit."
        static let cannotTagFile = "This device can't tag that file."
        static let cannotConvertFile = "This device can't convert that file."
        static let unexpectedExportState = "Unexpected export state."
        static let taggedFileMissing = "The tagged file didn't land in place."
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
        static let deleteAccountButton = "Delete sync account…"
        static let deleteAccountTitle = "Delete your sync account?"
        static let deleteAccountMessage = "This removes your account and every release and file Locally has stored in the cloud for it. Your music on your iPhone and on your Mac stays where it is. Other devices signed in to this account are signed out."
        static let deleteAccountConfirm = "Delete account"
        static let deleteAccountCancel = "Cancel"
        static let syncNow = "Sync now"
        static let syncing = "Syncing…"
        static let deviceLabel = "Device"
        static let storageLabel = "Storage"
        static let mergeNotice = "Songs already on both your Mac and this phone before you signed in are kept as two separate releases, not merged."
        static let serverAddress = "Server address (development)"
        static let serverAddressHint = "Point this at your Mac's address on the same network, e.g. http://192.168.1.23:4000, so this simulator or phone can reach it."

        /// The account card's pill: "Synced 2 min ago".
        static func syncedPill(_ relativeTime: String) -> String { "Synced \(relativeTime)" }
        static let syncedJustNow = "Synced just now"
        static let neverSyncedPill = "Not synced yet"

        static func quota(usedMB: Int, limitMB: Int) -> String { "\(usedMB) MB of \(limitMB) MB used" }

        /// The toast's title: it lists releases from any of the owner's devices (#185).
        static let fromYourDevices = "From your devices"
        static func pendingFromDevices(count: Int) -> String {
            count == 1 ? "1 song from your devices" : "\(count) songs from your devices"
        }
        /// The small label under a pending release: where it came from. Anything not
        /// known by name, such as a client newer than this build, is "another device".
        static func originLabel(_ origin: String) -> String {
            switch origin {
            case "mac": "from your Mac"
            case "web": "from the web"
            default: "from another device"
            }
        }
        static let sendToSpotify = "Send to Spotify"
        static let sendAll = "Send all"
        static let downloading = "Downloading…"

        /// The Library's "From your devices" tray (#269), worded as the Mac's tray is.
        static func trayButtonLabel(count: Int) -> String { "From your devices, \(count) waiting" }
        static let trayClose = "Close"
        static func sendTitleToSpotify(_ title: String) -> String { "Send \(title) to Spotify" }
        static func trackCount(_ count: Int) -> String { count == 1 ? "1 track" : "\(count) tracks" }
        static let couldntSend = "Couldn't send this yet."
        static let tryAgain = "Try again"
        static let failedHint = "Sending didn't finish. Try again."

        static func queueFailed(_ detail: String) -> String { "Couldn't queue a change to sync: \(detail)" }
        static func libraryUnreadable(_ detail: String) -> String { "Couldn't read your library to sync: \(detail)" }
        static func applyRemoteFailed(_ detail: String) -> String { "Couldn't apply a change from another device: \(detail)" }
        static func signOutCleanupFailed(_ detail: String) -> String { "Signed out, but couldn't clear queued sync changes: \(detail)" }
    }

    /// The Stats tab (#204). The period, digest and date wording ports `apps/web/src/lib/stats-copy.ts`
    /// string for string, so the phone and the Mac say the same thing.
    enum Stats {
        static let title = "Stats"
        static let tabLabel = "Stats"
        static let coverage = "Collected across all your devices."
        static let signedOutTitle = "Your plays live on your Mac"
        static let signedOutBody = "Locally counts the songs you play in Spotify on your Mac. Sign in on both to see them here."
        static let signedOutAction = "Sign in"
        static let noPlays = "Plays show up here once Locally on your Mac has counted some. Turn on play counting in its Settings."
        static let failed = "Couldn't load your plays. Pull down to try again."
        static let busy = "Couldn't load your plays just now. Try again in a few minutes."

        static let tracksTab = "Tracks"
        static let albumsTab = "Albums"
        static let artistsTab = "Artists"
        static let showTopLabel = "Show top"
        static let timeFrameLabel = "Time frame"
        static let layoutLabel = "Layout"
        static let listLayout = "List"
        static let gridLayout = "Grid"
        static let sortLabel = "Sort by"
        static let sortPlays = "Most played"
        static let sortName = "Name"
        static let sortRecent = "Recent"
        static let gridHint = "Ranked by plays, left to right. Bigger covers have more plays."
        static let loadingLabel = "Loading your plays"
        static let lastPlayedHeading = "Last played"

        /// "Your tracks", the heading over the list.
        static func yourHeading(_ noun: String) -> String { "Your \(noun)" }
        /// "Previous week": the stepper's buttons, named for the period they move by.
        static func previousLabel(_ kind: StatsPeriodKind) -> String { "Previous \(stepNoun(kind))" }
        static func nextLabel(_ kind: StatsPeriodKind) -> String { "Next \(stepNoun(kind))" }
        private static func stepNoun(_ kind: StatsPeriodKind) -> String {
            switch kind {
            case .today: return "day"
            case .week: return "week"
            case .month: return "month"
            case .year: return "year"
            case .all: return "period"
            }
        }
        /// "Your top 5 tracks, most played first": names the fan for screen readers.
        static func fanLabel(count: Int, noun: String) -> String { "Your top \(count) \(noun), most played first" }
        /// A sleeve's or row's spoken name: "1, Night Bus to Nowhere, 48 plays".
        static func itemLabel(rank: Int, title: String, plays: Int) -> String { "\(rank), \(title), \(playsCount(plays))" }

        /// The period control's options, shortest first.
        static let periodOptions: [(kind: StatsPeriodKind, label: String)] = [
            (.today, "Today"),
            (.week, "This week"),
            (.month, "This month"),
            (.year, "This year"),
            (.all, "All time"),
        ]

        /// The same options with the short labels the iPhone's narrow control fits; the stepper below
        /// the control still says "This week".
        static let periodShortOptions: [(kind: StatsPeriodKind, label: String)] = [
            (.today, "Today"),
            (.week, "Week"),
            (.month, "Month"),
            (.year, "Year"),
            (.all, "All time"),
        ]

        private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        private static let monthsLong = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ]
        private static let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

        private static func parts(_ day: String) -> (year: Int, month: Int, date: Int) {
            let p = day.split(separator: "-").map { Int($0) ?? 0 }
            guard p.count == 3 else { return (0, 0, 1) }
            return (p[0], p[1] - 1, p[2])
        }

        /// "15 Oct", or "15 Oct 2025" when the year is not today's.
        static func shortDay(_ day: String, today: String) -> String {
            let d = parts(day)
            let base = "\(d.date) \(months[min(max(d.month, 0), 11)])"
            return d.year == parts(today).year ? base : "\(base) \(d.year)"
        }

        /// Plays with thousands separators. en-US on purpose, so the digits do not depend on the phone's region.
        static func formatCount(_ n: Int) -> String {
            let formatter = NumberFormatter()
            formatter.numberStyle = .decimal
            formatter.locale = Locale(identifier: "en_US")
            return formatter.string(from: NSNumber(value: n)) ?? String(n)
        }

        /// "1 play", "1,204 plays".
        static func playsCount(_ n: Int) -> String {
            n == 1 ? "1 play" : "\(formatCount(n)) plays"
        }

        /// "Today", "Last week", "3 months ago": the name of a period on the control.
        static func periodLabel(_ selection: PeriodSelection) -> String {
            let back = selection.back
            switch selection.kind {
            case .all: return "All time"
            case .today: return back == 0 ? "Today" : back == 1 ? "Yesterday" : "\(back) days ago"
            case .week: return back == 0 ? "This week" : back == 1 ? "Last week" : "\(back) weeks ago"
            case .month: return back == 0 ? "This month" : back == 1 ? "Last month" : "\(back) months ago"
            case .year: return back == 0 ? "This year" : back == 1 ? "Last year" : "\(back) years ago"
            }
        }

        /// The same period inside a sentence: "this week", "last month".
        static func periodWhen(_ selection: PeriodSelection) -> String {
            if selection.kind == .all { return "so far" }
            let label = periodLabel(selection)
            return label.prefix(1).lowercased() + label.dropFirst()
        }

        /// The dates under the period's name: "12 to 18 Oct", "September 2026", "2026".
        static func periodDetail(_ selection: PeriodSelection, range: DayRange, today: String) -> String {
            let from = parts(range.from)
            let to = parts(range.to)
            switch selection.kind {
            case .all:
                return "Everything counted"
            case .today:
                return "\(weekdays[PlayPeriods.weekday(of: range.from)]) \(shortDay(range.from, today: today))"
            case .week:
                if range.from == range.to { return shortDay(range.from, today: today) }
                return from.month == to.month && from.year == to.year
                    ? "\(from.date) to \(shortDay(range.to, today: today))"
                    : "\(shortDay(range.from, today: today)) to \(shortDay(range.to, today: today))"
            case .month:
                return "\(monthsLong[min(max(from.month, 0), 11)]) \(from.year)"
            case .year:
                return String(from.year)
            }
        }

        /// "You played your tracks 121 times this week, mostly Night Bus to Nowhere."
        static func digestSentence(_ selection: PeriodSelection, total: Int, topTrack: String?) -> String {
            guard total > 0, let topTrack else {
                return selection.kind == .all ? "No plays counted yet." : emptyPeriodLine(selection)
            }
            let times = total == 1 ? "time" : "times"
            return selection.kind == .all
                ? "You have played your tracks \(formatCount(total)) \(times) so far, mostly \(topTrack)."
                : "You played your tracks \(formatCount(total)) \(times) \(periodWhen(selection)), mostly \(topTrack)."
        }

        /// The quiet line for a period with no plays (when plays exist from before it).
        static func emptyPeriodLine(_ selection: PeriodSelection) -> String {
            let when = periodWhen(selection)
            return selection.back == 0 ? "No plays yet \(when)." : "No plays \(when)."
        }

        /// The "last played" column: "Today", "Yesterday", "3 days ago", then the date; a dash when no day is known.
        static func lastPlayedLabel(_ day: String?, today: String) -> String {
            guard let day, !day.isEmpty else { return "–" }
            if day >= today { return "Today" }
            if day == PlayPeriods.addDays(today, -1) { return "Yesterday" }
            for n in 2...6 where day == PlayPeriods.addDays(today, -n) { return "\(n) days ago" }
            return shortDay(day, today: today)
        }
    }
}
