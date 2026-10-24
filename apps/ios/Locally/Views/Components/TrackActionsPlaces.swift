import SwiftUI

// Where the long-press menu (#364) is wired outside the release page: the rules for which items a release or a
// song offers, the sheets the items raise (Add to collection, Share) and the pages Edit and Go to album open.

/// A release opened in edit mode (#364), scrolled to one song when `trackId` is set. A plain `Release` push opens
/// the page in view mode; `ReleaseTrackRoute` opens it in view mode at a song.
struct ReleaseEditRoute: Hashable {
    let release: Release
    var trackId: UUID?
}

/// Pure rules for which menu items apply to a release or song.
enum TrackActionRules {
    /// The phone can edit its own releases; an adopted (details-only) one waits on #285/#332.
    static func canEdit(_ release: Release) -> Bool { !release.isAdopted }

    /// Mirrors the release page: a release shares unless adopted or received without reshare; a song shares
    /// only from a release that is the user's own.
    static func canShare(_ release: Release, target: TrackActionsTarget) -> Bool {
        switch target {
        case .release: !release.isAdopted && release.sharedFrom?.allowReshare != false
        case .track: !release.isAdopted && release.sharedFrom == nil
        }
    }

    /// The artist page for a release's main artist (an "A feat. B" artist counts for A), or nil with no name.
    static func artistRoute(for release: Release) -> ArtistRoute? {
        let key = ArtistNames.artistKey(ArtistNames.splitArtistFeaturing(release.artist).artist)
        return key.isEmpty ? nil : ArtistRoute(key: key)
    }

    /// The line the share sheet names: the release title, or the song's title (a single is its title).
    static func shareSubject(_ release: Release, target: TrackActionsTarget) -> String {
        switch target {
        case .release: release.title
        case .track(_, let trackId):
            release.kind == .single ? release.title : (release.tracks.first { $0.id == trackId }?.title ?? release.title)
        }
    }
}

/// What a row asked for that needs a sheet. Owned by the screen that shows the rows.
struct TrackShareRequest: Identifiable {
    let id = UUID()
    let release: Release
    let trackId: UUID?
    let subject: String
}

@MainActor @Observable
final class TrackActionSheets {
    var add: AddToCollectionTarget?
    var share: TrackShareRequest?

    /// The menu for `target` on a screen that shows releases in a list or grid. `open` pushes a route onto that
    /// screen's navigation path. Each item is set only when it does something there.
    func actions(
        for target: TrackActionsTarget, release: Release, goToAlbum: Bool,
        open: @escaping (any Hashable) -> Void
    ) -> TrackActions {
        let item: CollectionItem
        let trackId: UUID?
        switch target {
        case .track(let releaseId, let id):
            item = .track(releaseId: releaseId, trackId: id)
            trackId = id
        case .release(let id):
            item = .release(id)
            trackId = nil
        }
        var actions = TrackActions(target: target, release: release)
        actions.addToCollection = { [weak self] in self?.add = AddToCollectionTarget(items: [item]) }
        if TrackActionRules.canShare(release, target: target) {
            let subject = TrackActionRules.shareSubject(release, target: target)
            actions.share = { [weak self] in self?.share = TrackShareRequest(release: release, trackId: trackId, subject: subject) }
        }
        if TrackActionRules.canEdit(release) {
            actions.edit = { open(ReleaseEditRoute(release: release, trackId: trackId)) }
        }
        if goToAlbum, let trackId {
            actions.goToAlbum = { open(ReleaseTrackRoute(release: release, trackId: trackId)) }
        }
        if let route = TrackActionRules.artistRoute(for: release) {
            actions.goToArtist = { open(route) }
        }
        return actions
    }
}

private struct TrackActionSheetsModifier: ViewModifier {
    @Bindable var sheets: TrackActionSheets
    @Environment(\.appContainer) private var container
    @State private var collections: CollectionsModel?

    func body(content: Content) -> some View {
        content
            .task { if collections == nil { collections = container?.makeCollectionsModel() } }
            .sheet(item: $sheets.add) { target in
                if let collections {
                    AddToCollectionSheet(model: collections, items: target.items) { sheets.add = nil }
                }
            }
            .sheet(item: $sheets.share) { request in
                if let container {
                    ShareSheet(
                        model: ShareSheetModel(
                            releaseId: request.release.id, subject: request.subject, trackIds: request.trackId.map { [$0] },
                            isSignedIn: container.syncAccount.deviceToken != nil, api: container.syncApi,
                            groupStore: UserDefaultsShareGroupStore(), reshareShareId: request.release.sharedFrom?.shareId),
                        coverImage: container.coverStore.load(request.release.id).flatMap(UIImage.init(data:))
                    ) { sheets.share = nil }
                }
            }
    }
}

extension View {
    /// Presents the sheets the long-press menu's Add to collection and Share raise.
    func trackActionSheets(_ sheets: TrackActionSheets) -> some View {
        modifier(TrackActionSheetsModifier(sheets: sheets))
    }
}
