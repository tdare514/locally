import SwiftUI

// The long-press menu on a song or a release (#364): a row of icon actions on top (Play next, Add to queue,
// Add to collection, Share), then Edit, Go to album, Go to artist and Song info below when the row offers them.
// The same actions are VoiceOver custom actions on the row. Reusable: the row says what it can do, by passing
// a closure; a nil closure hides that item.

/// What the menu acts on.
enum TrackActionsTarget: Hashable {
    case track(releaseId: UUID, trackId: UUID)
    case release(UUID)

    var releaseId: UUID {
        switch self {
        case .track(let releaseId, _): releaseId
        case .release(let id): id
        }
    }
}

@MainActor
struct TrackActions {
    let target: TrackActionsTarget
    /// The release the target belongs to (its tracks are what get queued).
    let release: Release
    var addToCollection: (() -> Void)?
    var share: (() -> Void)?
    var edit: (() -> Void)?
    var goToAlbum: (() -> Void)?
    var goToArtist: (() -> Void)?
    var songInfo: (() -> Void)?

    /// The queue items the target stands for, in play order, and the line the toast shows for them.
    var queueItems: [QueueItem] {
        switch target {
        case .track(let releaseId, let trackId):
            [QueueItem(releaseId: releaseId, trackId: trackId)]
        case .release(let id):
            PlaybackService.playOrder(release).map { QueueItem(releaseId: id, trackId: $0.id) }
        }
    }

    var subject: String {
        switch target {
        case .track(_, let trackId):
            release.tracks.first { $0.id == trackId }?.title ?? release.title
        case .release:
            release.tracks.count == 1 ? (release.tracks.first?.title ?? release.title) : Copy.TrackActions.songCount(release.tracks.count)
        }
    }

    /// Queues the target and returns the toast for it. Split from the view so tests can call it.
    @MainActor
    func queue(_ playback: PlaybackService, next: Bool, cover: Data?) -> QueueToastMessage? {
        let outcome = next
            ? playback.playNext(queueItems, releases: [release])
            : playback.addToQueue(queueItems, releases: [release])
        return QueueToastMessage.make(outcome, next: next, subject: subject, cover: cover)
    }
}

/// Which halves of the menu a row gets: a row whose tap target is a separate button (Stats) puts the
/// VoiceOver actions on that button and keeps the long-press menu on the row.
enum TrackActionsPart { case both, menu, accessibility }

private struct TrackActionsModifier: ViewModifier {
    let actions: TrackActions
    var part: TrackActionsPart = .both
    @Environment(\.playback) private var playback
    @Environment(\.queueToast) private var toast
    @Environment(\.appContainer) private var container

    @ViewBuilder
    func body(content: Content) -> some View {
        switch part {
        case .both: content.contextMenu { menu }.accessibilityActions { voiceOver }
        case .menu: content.contextMenu { menu }
        case .accessibility: content.accessibilityActions { voiceOver }
        }
    }

    @ViewBuilder private var menu: some View {
        // The icon row: a ControlGroup at the top of a context menu draws as a row of icons.
        ControlGroup {
            Button(Copy.TrackActions.playNext, systemImage: "text.line.first.and.arrowtriangle.forward") { queue(next: true) }
            Button(Copy.TrackActions.addToQueue, systemImage: "text.line.last.and.arrowtriangle.forward") { queue(next: false) }
            if let add = actions.addToCollection {
                Button(Copy.TrackActions.addToCollection, systemImage: "text.badge.plus", action: add)
            }
            if let share = actions.share {
                Button(Copy.TrackActions.share, systemImage: "square.and.arrow.up", action: share)
            }
        }
        if let edit = actions.edit { Button(Copy.TrackActions.edit, systemImage: "pencil", action: edit) }
        if let go = actions.goToAlbum { Button(Copy.TrackActions.goToAlbum, systemImage: "square.stack", action: go) }
        if let go = actions.goToArtist { Button(Copy.TrackActions.goToArtist, systemImage: "person.crop.circle", action: go) }
        if let info = actions.songInfo { Button(Copy.TrackActions.songInfo, systemImage: "info.circle", action: info) }
    }

    @ViewBuilder private var voiceOver: some View {
        Button(Copy.TrackActions.playNext) { queue(next: true) }
        Button(Copy.TrackActions.addToQueue) { queue(next: false) }
        if let add = actions.addToCollection { Button(Copy.TrackActions.addToCollection, action: add) }
        if let share = actions.share { Button(Copy.TrackActions.share, action: share) }
        if let edit = actions.edit { Button(Copy.TrackActions.edit, action: edit) }
        if let go = actions.goToAlbum { Button(Copy.TrackActions.goToAlbum, action: go) }
        if let go = actions.goToArtist { Button(Copy.TrackActions.goToArtist, action: go) }
        if let info = actions.songInfo { Button(Copy.TrackActions.songInfo, action: info) }
    }

    private func queue(next: Bool) {
        guard let playback else { return }
        let cover = container?.coverStore.load(actions.release.id)
        if let message = actions.queue(playback, next: next, cover: cover) { toast?.show(message) }
    }
}

extension View {
    /// Adds the long-press menu and the VoiceOver actions for `actions`.
    func trackActions(_ actions: TrackActions, part: TrackActionsPart = .both) -> some View {
        modifier(TrackActionsModifier(actions: actions, part: part))
    }
}

extension View {
    /// Same, for a row whose release may not be loaded: no release, no menu.
    @ViewBuilder
    func trackActions(_ actions: TrackActions?, part: TrackActionsPart = .both) -> some View {
        if let actions { trackActions(actions, part: part) } else { self }
    }
}
