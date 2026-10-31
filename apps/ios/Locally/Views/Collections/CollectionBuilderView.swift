import Observation
import SwiftUI

/// Where the builder opens from: a new collection, or "Add music" on an existing one (#366).
enum BuilderTarget: Identifiable, Hashable {
    case new
    case addMusic(UUID)

    var id: String {
        switch self {
        case .new: "new"
        case .addMusic(let id): "add-\(id.uuidString)"
        }
    }

    var collectionID: UUID? {
        if case .addMusic(let id) = self { id } else { nil }
    }
}

extension View {
    /// Presents the builder as a full-screen cover; `onDone` gets the new (or extended) collection's id.
    func collectionBuilder(_ target: Binding<BuilderTarget?>, model: CollectionsModel, onDone: @escaping (UUID) -> Void) -> some View {
        fullScreenCover(item: target) { target in
            CollectionBuilderView(model: model, addingTo: target.collectionID, onDone: onDone)
        }
    }
}

// MARK: - Covers

/// The builder's covers: read off the main thread through the Stats cover cache.
@MainActor
@Observable
final class BuilderArt {
    private(set) var images: [UUID: UIImage] = [:]
    @ObservationIgnored private var cache: StatsCoverCache?

    func configure(store: CoverStore?) {
        guard cache == nil, let store else { return }
        cache = StatsCoverCache(loader: { store.load($0) })
    }

    func load(_ id: UUID) async {
        guard images[id] == nil, let cache, let image = await cache.image(for: id) else { return }
        images[id] = image
    }

    /// The wash and the sleeve's art for these releases (the first four, in order).
    func sleeve(for ids: [UUID]) async -> (mosaic: UIImage?, palette: AmbientPalette?) {
        guard let cache, let first = ids.first else { return (nil, nil) }
        var covers: [UIImage] = []
        for id in ids { if let image = await cache.image(for: id) { covers.append(image) } }
        let data = await cache.data(for: first)
        let palette = await Task.detached(priority: .utility) { ArtworkPalette.palette(forCover: data) }.value
        return (BuilderMosaic.image(covers), palette)
    }
}

/// The covers as one square by the saved collection's rule (`CollectionCoverView.tiles`): one whole, or a 2x2 of four.
enum BuilderMosaic {
    static func image(_ covers: [UIImage]) -> UIImage? {
        let covers = CollectionCoverView.tiles(covers)
        guard !covers.isEmpty else { return nil }
        let side = Theme.Builder.mosaicSide
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { context in
            let half = side / 2
            let rects: [CGRect]
            if covers.count == 1 {
                rects = [CGRect(x: 0, y: 0, width: side, height: side)]
            } else {
                rects = [CGRect(x: 0, y: 0, width: half, height: half), CGRect(x: half, y: 0, width: half, height: half), CGRect(x: 0, y: half, width: half, height: half), CGRect(x: half, y: half, width: half, height: half)]
            }
            for (image, rect) in zip(covers, rects) {
                context.cgContext.saveGState()
                context.cgContext.clip(to: rect)
                let scale = max(rect.width / image.size.width, rect.height / image.size.height)
                let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                image.draw(in: CGRect(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width, height: size.height))
                context.cgContext.restoreGState()
                // A hairline between tiles, like the cover grid.
                context.cgContext.setStrokeColor(UIColor.black.withAlphaComponent(0.35).cgColor)
                context.cgContext.stroke(rect, width: 2)
            }
        }
    }
}

// MARK: - The screen

/// Makes a collection on one screen (#366, the owner's variant 1b), or adds music to an existing one: the sleeve with
/// its name, the picks in a crate, the library's Releases shelf and Songs list, and a floating search and Done.
struct CollectionBuilderView: View {
    let model: CollectionsModel
    /// Set for "Add music": the collection that gets the picks, with its name fixed.
    let collectionID: UUID?
    let onDone: (UUID) -> Void
    /// The name field takes the keyboard on a new collection; the gallery's frames turn it off.
    private let autofocuses: Bool
    /// A gallery frame hands over a draft that already has picks; the app builds its own.
    @State private var draft: BuilderDraft
    @State private var art = BuilderArt()
    @State private var mosaic: UIImage?
    @State private var palette: AmbientPalette?
    @State private var isConfirmingDiscard = false
    @State private var saveFailed = false
    /// The save would have dropped picks, so nothing was saved.
    @State private var saveShort = false
    @FocusState private var nameFocused: Bool

    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.appContainer) private var container

    init(model: CollectionsModel, addingTo collectionID: UUID? = nil, draft: BuilderDraft? = nil, autofocuses: Bool = true, onDone: @escaping (UUID) -> Void) {
        self.model = model
        self.autofocuses = autofocuses
        self.collectionID = collectionID
        self.onDone = onDone
        _draft = State(initialValue: draft ?? Self.makeDraft(model: model, addingTo: collectionID))
    }

    /// The library's releases, newest first, and, for "Add music", what the collection already holds.
    static func makeDraft(model: CollectionsModel, addingTo collectionID: UUID?) -> BuilderDraft {
        let releases = model.releases.values.sorted { $0.updatedAt != $1.updatedAt ? $0.updatedAt > $1.updatedAt : $0.title < $1.title }
        guard let collectionID, let collection = model.collection(collectionID) else { return BuilderDraft(releases: releases) }
        return BuilderDraft(releases: releases, name: collection.name, existing: collection.items)
    }

    private var large: Bool { dynamicTypeSize.isAccessibilitySize }
    private var pad: CGFloat { Theme.Spacing.pagePadding }
    private var title: String { draft.isNew ? Copy.CollectionBuilder.newTitle : Copy.CollectionBuilder.addMusicTitle }
    private var failureTitle: String { draft.isNew ? Copy.Collections.createFailed : Copy.Collections.addFailed(to: draft.name) }

    var body: some View {
        ZStack {
            backdrop
            ScrollView {
                VStack(spacing: 0) {
                    header
                    BuilderSleeve(draft: draft, mosaic: mosaic, size: large ? Theme.Builder.sleeveAccessibility : Theme.Builder.sleeve, focused: $nameFocused)
                        .padding(.top, large ? 14 : 4)
                        .padding(.bottom, 16)
                    picksBar.padding(.horizontal, pad)
                    if draft.isFull {
                        Text(Copy.CollectionBuilder.full)
                            .font(Theme.ScaledFont.caption)
                            .foregroundStyle(Theme.secondaryText)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, pad)
                            .padding(.top, 2)
                            .accessibilityIdentifier("builder-full")
                    }
                    library
                }
                .padding(.bottom, 12)
            }
            .scrollDismissesKeyboard(.immediately)
        }
        .safeAreaInset(edge: .bottom) { bottomBar }
        .sensoryFeedback(.selection, trigger: draft.picks)
        .task { art.configure(store: container?.coverStore) }
        .task(id: draft.mosaicReleaseIDs) {
            art.configure(store: container?.coverStore)
            let result = await art.sleeve(for: draft.mosaicReleaseIDs)
            mosaic = result.mosaic
            palette = result.palette
        }
        .task {
            // The name field takes the keyboard once the cover is up, only for a new collection.
            guard autofocuses, draft.isNew, draft.name.isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(450))
            nameFocused = true
        }
        .confirmationDialog(draft.isNew ? Copy.CollectionBuilder.discardTitle : Copy.CollectionBuilder.discardAdditionsTitle, isPresented: $isConfirmingDiscard, titleVisibility: .visible) {
            Button(Copy.CollectionBuilder.discard, role: .destructive) { dismiss() }
            Button(Copy.CollectionBuilder.keepEditing, role: .cancel) {}
        }
        .alert(failureTitle, isPresented: $saveFailed) {
            if !saveShort { Button(Copy.Collections.tryAgain) { finish() } }
            Button(saveShort ? Copy.CollectionBuilder.ok : Copy.Collections.cancel, role: .cancel) {}
        } message: {
            if saveShort { Text(Copy.CollectionBuilder.notAllSaved) }
        }
    }

    // MARK: Page

    /// One continuous wash: the cover's colours run down the page and fade to near-black, so no edge shows.
    private var backdrop: some View {
        ZStack {
            Theme.background
            ArtworkBackdrop(palette: palette ?? AmbientPalette(primary: "#3b2a7a", secondary: "#143a78", deep: "#080a1c"))
            LinearGradient(stops: [
                .init(color: .black.opacity(0.3), location: 0),
                .init(color: .black.opacity(0.32), location: 0.15),
                .init(color: .black.opacity(0.4), location: 0.3),
                .init(color: .black.opacity(0.62), location: 0.45),
                .init(color: .black.opacity(0.88), location: 0.58),
                .init(color: .black.opacity(0.94), location: 0.7),
                .init(color: .black.opacity(0.96), location: 1),
            ], startPoint: .top, endPoint: .bottom)
                .allowsHitTesting(false)
        }
        .ignoresSafeArea()
    }

    private var header: some View {
        HStack {
            Text(title)
                .font(Theme.ScaledFont.headline)
                .foregroundStyle(Theme.primaryText)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(.body, weight: .bold))
                    .foregroundStyle(Theme.danger)
                    .frame(width: Theme.Builder.control, height: Theme.Builder.control)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(Copy.CollectionBuilder.close)
            .accessibilityIdentifier("builder-close")
        }
        .padding(.horizontal, pad)
    }

    private var picksBar: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                BuilderCrate(draft: draft, art: art)
                Spacer(minLength: 0)
                summary.multilineTextAlignment(.trailing)
            }
            VStack(alignment: .leading, spacing: 4) {
                BuilderCrate(draft: draft, art: art)
                summary
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var summary: some View {
        Text(draft.summary)
            .font(Theme.ScaledFont.subheadline)
            .foregroundStyle(Theme.secondaryText)
            .accessibilityIdentifier("builder-summary")
    }

    @ViewBuilder
    private var library: some View {
        let releases = draft.releaseMatches
        let songs = draft.songMatches
        VStack(spacing: 6) {
            if releases.isEmpty && songs.isEmpty {
                Text(Copy.Collections.noMatches(draft.query))
                    .font(Theme.ScaledFont.rowTitle)
                    .foregroundStyle(Theme.secondaryText)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 24)
            }
            if !releases.isEmpty {
                sectionTitle(Copy.CollectionBuilder.releases).padding(.horizontal, pad).padding(.top, 14)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 14) {
                        ForEach(releases) { release in
                            BuilderShelfCover(draft: draft, art: art, release: release, side: large ? Theme.Builder.shelfCoverLarge : Theme.Builder.shelfCover)
                        }
                    }
                    .padding(.horizontal, pad)
                    .padding(.top, 8)
                    .padding(.bottom, 14)
                }
                .scrollClipDisabled()
            }
            if !songs.isEmpty {
                sectionTitle(Copy.CollectionBuilder.songs).padding(.horizontal, pad).padding(.top, 6)
                LazyVStack(spacing: 2) {
                    ForEach(songs, id: \.track.id) { entry in
                        BuilderSongRow(draft: draft, art: art, release: entry.release, track: entry.track)
                    }
                }
                .padding(.horizontal, max(0, pad - 10))
            }
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(Theme.ScaledFont.sectionTitle)
            .foregroundStyle(Theme.secondaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }

    /// The Done capsule: the main action, labelled (rule 3).
    private var doneButton: some View {
        Button(Copy.CollectionBuilder.done, action: finish)
            .buttonStyle(MainButtonStyle(isFullWidth: false))
            .disabled(!draft.canFinish)
            .accessibilityLabel(Copy.CollectionBuilder.doneLabel(draft.songCount))
            .accessibilityIdentifier("builder-done")
    }

    /// The search pill and Done float over the page; at large text they stack, the pill full width and the Done capsule under it.
    private var bottomBar: some View {
        @Bindable var draft = draft
        return Group {
            if large {
                VStack(alignment: .trailing, spacing: 10) {
                    BuilderSearchPill(text: $draft.query)
                    doneButton
                }
            } else {
                HStack(spacing: 10) {
                    BuilderSearchPill(text: $draft.query)
                    doneButton
                }
            }
        }
        .padding(.horizontal, pad)
        .padding(.top, 44)
        .padding(.bottom, 6)
        .background {
            LinearGradient(stops: [.init(color: .black.opacity(0), location: 0), .init(color: .black.opacity(0.92), location: 0.4), .init(color: .black.opacity(0.95), location: 1)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
        }
    }

    // MARK: Actions

    /// Asks only when a name is typed or something is picked.
    private func close() {
        if draft.hasChanges { isConfirmingDiscard = true } else { dismiss() }
    }

    /// Creates the collection (or adds to the existing one), then hands its id to the screen that opens it. A save
    /// that fails keeps the builder open.
    private func finish() {
        guard draft.canFinish else { return }
        saveShort = false
        let items = draft.items
        do {
            let id: UUID?
            if let collectionID {
                // Everything picked must land: check before saving, and again against what was added.
                let held = model.collection(collectionID)?.items ?? []
                guard CollectionEdit.appended(held, items).added == items.count else { return failShort() }
                let added = try model.add(items, to: collectionID)
                guard added == items.count else { return failShort() }
                id = collectionID
            } else {
                guard CollectionEdit.appended([], items).added == items.count else { return failShort() }
                id = try model.create(name: draft.name, items: items)
            }
            guard let id else { return }
            dismiss()
            onDone(id)
        } catch {
            saveFailed = true
            AccessibilityNotification.Announcement("\(failureTitle) \(Copy.Collections.tryAgain)").post()
        }
    }

    private func failShort() {
        saveShort = true
        saveFailed = true
        AccessibilityNotification.Announcement("\(failureTitle) \(Copy.CollectionBuilder.notAllSaved)").post()
    }
}

// MARK: - Parts

/// A cover square with its own corner radius, or the double note when there is no art.
private struct BuilderCover: View {
    let art: BuilderArt
    let id: UUID
    let side: CGFloat
    let radius: CGFloat

    var body: some View {
        Color.clear
            .frame(width: side, height: side)
            .overlay {
                if let image = art.images[id] {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    NoCoverArt()
                }
            }
            .clipShape(.rect(cornerRadius: radius, style: .continuous))
            .task(id: id) { await art.load(id) }
            .accessibilityHidden(true)
    }
}

/// The record sleeve with the collection's name typed on it (fixed text for "Add music").
private struct BuilderSleeve: View {
    let draft: BuilderDraft
    let mosaic: UIImage?
    let size: CGFloat
    var focused: FocusState<Bool>.Binding

    private var hasArt: Bool { mosaic != nil }

    var body: some View {
        ZStack(alignment: .leading) {
            RecordSleeve(cover: mosaic, size: size, showsAddCaption: false) {}
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            ZStack(alignment: .bottom) {
                LinearGradient(colors: [.clear, .black.opacity(hasArt ? 0.8 : 0.35)], startPoint: .center, endPoint: .bottom)
                nameText
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .foregroundStyle(Color.white)
                    .multilineTextAlignment(.center)
                    .shadow(color: .black.opacity(hasArt ? 0.6 : 0), radius: 6, y: 1)
                    // A word of the name must fit the sleeve, so it is never split.
                    .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                    .padding(14)
            }
            .frame(width: size, height: size)
            .clipShape(.rect(cornerRadius: Theme.Immersive.sleeveCornerRadius, style: .continuous))
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var nameText: some View {
        @Bindable var draft = draft
        if draft.isNew {
            TextField("", text: $draft.name, prompt: Text(Copy.CollectionBuilder.namePlaceholder).foregroundColor(.white.opacity(0.7)), axis: .vertical)
                .accessibilityLabel(Copy.CollectionBuilder.nameLabel)
                .lineLimit(1...3)
                .focused(focused)
                .submitLabel(.done)
                .accessibilityIdentifier("builder-name")
                .onChange(of: draft.name) { _, value in
                    if value.contains(where: \.isNewline) {
                        draft.name = String(value.filter { !$0.isNewline })
                        focused.wrappedValue = false
                    }
                }
        } else {
            Text(draft.name)
        }
    }
}

/// The picks as overlapping mini sleeves, tilted the other way each time. No panel, no border.
private struct BuilderCrate: View {
    let draft: BuilderDraft
    let art: BuilderArt

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let side = Theme.Builder.crateCover
        let picks = Array(draft.picks.prefix(Theme.Builder.crateShown))
        let extra = draft.picks.count - picks.count
        HStack(spacing: -Theme.Builder.crateOverlap) {
            if picks.isEmpty {
                ForEach(0..<3, id: \.self) { index in
                    RoundedRectangle(cornerRadius: Theme.Radius.thumbnail, style: .continuous)
                        .fill(Color(white: 0.13))
                        .frame(width: side, height: side)
                        .rotationEffect(.degrees(index.isMultiple(of: 2) ? -4 : 4))
                }
            }
            ForEach(Array(picks.enumerated()), id: \.element) { index, pick in
                BuilderCover(art: art, id: pick.releaseID, side: side, radius: Theme.Radius.thumbnail)
                    .shadow(color: .black.opacity(0.45), radius: 6, x: 2, y: 3)
                    .rotationEffect(.degrees(index.isMultiple(of: 2) ? -4 : 4))
                    .zIndex(Double(index))
                    .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
            }
            if extra > 0 {
                Text("+\(extra)")
                    .font(Theme.ScaledFont.pill)
                    .foregroundStyle(Theme.primaryText)
                    .frame(width: side, height: side)
                    .zIndex(Double(Theme.Builder.crateShown))
            }
        }
        .padding(.vertical, 6)
        .animation(Theme.Builder.ease, value: draft.picks)
        .accessibilityHidden(true)
    }
}

/// A filled accent circle with a black check (accent marks the selected item, rule 1); a dim one for
/// what the collection already holds. No glow.
private struct BuilderPickedDot: View {
    let size: CGFloat
    var dimmed = false

    var body: some View {
        ZStack {
            Circle().fill(dimmed ? Color.white.opacity(0.22) : Theme.accent)
            Image(systemName: "checkmark")
                .font(.system(size: size * 0.46, weight: .bold))
                // Black on accent is 5.25:1; white would be 4.0:1 (rule 11).
                .foregroundStyle(dimmed ? Color.white.opacity(0.7) : Color.black)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

private struct BuilderPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(reduceMotion ? nil : Theme.Builder.ease, value: configuration.isPressed)
    }
}

/// Shelf text: wraps to `lines` lines and cuts the tail. Held to accessibility1 so a word still fits a 112 pt cover:
/// SwiftUI splits a word that is wider than its line ("Har-"), and there is no switch for hyphenation.
private struct BuilderWrappedText: View {
    let text: String
    let lines: Int

    var body: some View {
        Text(text)
            .lineLimit(lines)
            .truncationMode(.tail)
            .multilineTextAlignment(.leading)
            .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    }
}

/// A release on the shelf: one cover, one tap adds or removes the whole release.
private struct BuilderShelfCover: View {
    let draft: BuilderDraft
    let art: BuilderArt
    let release: Release
    let side: CGFloat

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var pick: BuilderPick { BuilderPick(releaseID: release.id) }
    private var state: BuilderRowState { draft.state(of: pick) }
    private var isOn: Bool { state != .off }
    private var blocked: Bool { state == .off && !draft.canPick(pick) }

    private var label: String {
        var parts = [release.title, release.artist]
        if release.source == .adopted { parts.append(Copy.Collections.onYourMac) }
        if state == .existing { parts.append(Copy.CollectionBuilder.inCollection.lowercased()) }
        else if isOn { parts.append(Copy.CollectionBuilder.added.lowercased()) }
        else if blocked { parts.append(Copy.CollectionBuilder.fullShort) }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        let lines = dynamicTypeSize.isAccessibilitySize ? 2 : 1
        Button { draft.toggle(pick) } label: {
            VStack(alignment: .leading, spacing: 8) {
                BuilderCover(art: art, id: release.id, side: side, radius: Theme.Builder.shelfRadius)
                    .shadow(color: .black.opacity(0.4), radius: 10, y: 6)
                    .overlay {
                        if state == .on {
                            RoundedRectangle(cornerRadius: Theme.Builder.shelfRadius, style: .continuous)
                                .strokeBorder(Theme.accent, lineWidth: 2)
                                .transition(.opacity)
                        }
                    }
                    .overlay(alignment: .topTrailing) {
                        if isOn {
                            BuilderPickedDot(size: Theme.Builder.shelfDot, dimmed: state == .existing)
                                .padding(8)
                                .transition(reduceMotion ? .opacity : .scale(scale: 0.5).combined(with: .opacity))
                        }
                    }
                BuilderWrappedText(text: release.title, lines: lines)
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(Theme.primaryText)
                BuilderWrappedText(text: release.artist, lines: lines)
                    .font(.system(.footnote))
                    .foregroundStyle(Theme.secondaryText)
            }
            .frame(width: side, alignment: .topLeading)
            .opacity(blocked ? 0.45 : 1)
            .contentShape(Rectangle())
            .animation(Theme.Builder.ease, value: state)
        }
        .buttonStyle(BuilderPressStyle())
        .disabled(state == .existing || blocked)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityHint(isOn ? "" : (blocked ? Copy.CollectionBuilder.full : Copy.CollectionBuilder.add(release.title)))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// A song on the backdrop: no box, no separator; a picked one gets a faint wash of its cover.
private struct BuilderSongRow: View {
    let draft: BuilderDraft
    let art: BuilderArt
    let release: Release
    let track: Track

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var pick: BuilderPick { BuilderPick(releaseID: release.id, trackID: track.id) }
    private var state: BuilderRowState { draft.state(of: pick) }
    private var isOn: Bool { state != .off }
    private var blocked: Bool { state == .off && !draft.canPick(pick) }
    private var isAdopted: Bool { release.source == .adopted }

    private var subtitle: String {
        state == .existing ? Copy.CollectionBuilder.inCollection : "\(release.artist) \u{00B7} \(release.title)"
    }

    private var label: String {
        var parts = [track.title, release.artist, release.title]
        if isAdopted { parts.append(Copy.Collections.onYourMac) }
        if state == .existing { parts.append(Copy.CollectionBuilder.inCollection.lowercased()) }
        else if isOn { parts.append(Copy.CollectionBuilder.added.lowercased()) }
        else if blocked { parts.append(Copy.CollectionBuilder.fullShort) }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        let wraps = dynamicTypeSize.isAccessibilitySize
        Button { draft.toggle(pick) } label: {
            HStack(spacing: 14) {
                BuilderCover(art: art, id: release.id, side: Theme.Builder.songCover, radius: Theme.Builder.songRadius)
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.title)
                        .font(.system(.body, weight: .semibold))
                        .foregroundStyle(Theme.primaryText)
                        .multilineTextAlignment(.leading)
                    // One line at default sizes, cut at the tail; it wraps at accessibility sizes.
                    Text(subtitle)
                        .font(Theme.ScaledFont.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(wraps ? nil : 1)
                        .truncationMode(.tail)
                        .multilineTextAlignment(.leading)
                    if isAdopted {
                        Label(Copy.Collections.onYourMac, systemImage: "desktopcomputer")
                            .font(Theme.ScaledFont.caption)
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                Spacer(minLength: 0)
                control
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: Theme.Builder.songMinHeight, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .fill(Color.white.opacity(state == .on ? 0.08 : 0))
            }
            .opacity(blocked ? 0.45 : 1)
            .contentShape(Rectangle())
            .animation(Theme.Builder.ease, value: state)
        }
        .buttonStyle(BuilderPressStyle())
        .disabled(state == .existing || state == .viaRelease || blocked)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityHint(isOn ? "" : (blocked ? Copy.CollectionBuilder.full : Copy.CollectionBuilder.add(track.title)))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    /// The trailing round +, which fills with the accent and a check when picked.
    @ViewBuilder
    private var control: some View {
        let size = Theme.Builder.songDot
        if isOn {
            BuilderPickedDot(size: size, dimmed: state != .on)
                .transition(reduceMotion ? .opacity : .scale(scale: 0.5).combined(with: .opacity))
        } else {
            ZStack {
                Circle().strokeBorder(Color.white.opacity(0.35), lineWidth: 1)
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(blocked ? 0.35 : 0.7))
            }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
        }
    }
}

/// The frosted search pill: a hairline, no heavy rim.
private struct BuilderSearchPill: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.secondaryText)
                .accessibilityHidden(true)
            TextField("", text: $text, prompt: Text(Copy.CollectionBuilder.searchPlaceholder).foregroundColor(Theme.secondaryText))
                .font(Theme.ScaledFont.input)
                .foregroundStyle(Theme.primaryText)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .accessibilityLabel(Copy.CollectionBuilder.searchLabel)
                .accessibilityIdentifier("builder-search")
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.secondaryText)
                        .frame(width: Theme.Builder.control, height: Theme.Builder.control)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Copy.CollectionBuilder.clearSearch)
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, text.isEmpty ? 16 : 2)
        .frame(minHeight: Theme.Builder.searchMinHeight)
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                Color.black.opacity(0.45)
            }
            .clipShape(Capsule())
        }
        .overlay { Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5) }
    }
}
