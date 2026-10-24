#if DEBUG
import SwiftUI

/// #366: the real collection builder over the Collections gallery's seeded library (eight releases and the Mac-only
/// "Harbour Sessions"), plus the two UI-test hosts. Nothing here signs in or syncs.
struct CollectionBuilderGallery: View {
    static let names = [
        "builder-empty", "builder-picks", "builder-search", "builder-add-music", "builder-ax3", "builder-ax5", "builder-narrow", "builder-full",
        "builder-new-flow", "builder-add-music-flow",
    ]

    let name: String
    @State private var built: (container: AppContainer, model: CollectionsModel)

    init(name: String) {
        self.name = name
        _built = State(initialValue: CollectionsGallery.container(seed: name != "builder-new-flow"))
    }

    private var model: CollectionsModel { built.model }

    /// A song of the seeded sample releases, by release number (0-based) and track.
    private func song(_ release: Int, _ track: Int = 0) -> BuilderPick {
        let item = StatsGallery.releases[release]
        return BuilderPick(releaseID: item.id, trackID: item.tracks[track].id)
    }

    private func draft(picks: [BuilderPick] = [], query: String = "", name: String = "Rainy Sunday") -> BuilderDraft {
        let draft = CollectionBuilderView.makeDraft(model: model, addingTo: nil)
        draft.name = name
        draft.query = query
        for pick in picks { draft.toggle(pick) }
        return draft
    }

    /// "Late drives" with two new songs picked.
    private func addMusicDraft() -> BuilderDraft {
        let draft = CollectionBuilderView.makeDraft(model: model, addingTo: CollectionsGallery.queueID)
        for pick in [song(5), song(6)] { draft.toggle(pick) }
        return draft
    }

    /// The Mac-only "Harbour Sessions" songs (first in the list, adopted) and the sample "Night Bus" release, so picks show on the shelf and in the list.
    private var harbour: [BuilderPick] {
        let release = model.releases.values.first { $0.source == .adopted }
        return (release?.tracks ?? []).map { BuilderPick(releaseID: release?.id ?? UUID(), trackID: $0.id) }
    }
    private var threeSongs: [BuilderPick] { [song(1)] + harbour }
    private var withRelease: [BuilderPick] { [song(1)] + harbour + [BuilderPick(releaseID: StatsGallery.releases[7].id)] }

    /// A draft whose limit is exactly its picks, so it is full.
    private var fullDraft: BuilderDraft {
        let releases = CollectionBuilderView.makeDraft(model: model, addingTo: nil).releases
        let draft = BuilderDraft(releases: releases, name: "Rainy Sunday", limit: withRelease.count)
        for pick in withRelease { draft.toggle(pick) }
        return draft
    }

    private func builder(_ draft: BuilderDraft, addingTo: UUID? = nil) -> some View {
        CollectionBuilderView(model: model, addingTo: addingTo, draft: draft, autofocuses: false) { _ in }
    }

    var body: some View {
        IconsGallery.environment(content, built.container)
    }

    @ViewBuilder
    private var content: some View {
        switch name {
        case "builder-empty":
            builder(draft(name: ""))
        case "builder-picks":
            builder(draft(picks: withRelease))
        case "builder-search":
            builder(draft(picks: threeSongs, query: "night"))
        case "builder-add-music":
            builder(addMusicDraft(), addingTo: CollectionsGallery.queueID)
        case "builder-ax3":
            builder(draft(picks: withRelease)).dynamicTypeSize(.accessibility3)
        case "builder-ax5":
            builder(draft(picks: withRelease)).dynamicTypeSize(.accessibility5)
        case "builder-narrow":
            builder(draft(picks: withRelease)).frame(width: 320)
        case "builder-full":
            builder(fullDraft)
        case "builder-new-flow":
            BuilderFlowHost(model: model)
        case "builder-add-music-flow":
            NavigationStack { CollectionDetailView(model: model, id: CollectionsGallery.queueID) }
        default:
            EmptyView()
        }
    }
}

/// The real Collections screen with the Library's routes for a new collection, so the UI test never visits the Library.
private struct BuilderFlowHost: View {
    let model: CollectionsModel
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            CollectionsView(model: model, onOpen: { path.append(CollectionRoute(id: $0)) })
                .navigationDestination(for: CollectionRoute.self) { route in
                    CollectionDetailView(model: model, id: route.id, startsEditing: route.startsEditing)
                }
        }
    }
}
#endif
