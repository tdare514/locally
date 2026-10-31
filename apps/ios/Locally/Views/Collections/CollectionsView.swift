import SwiftUI

/// Pushes the Collections screen onto the Library's stack.
struct CollectionsRoute: Hashable {}

/// Pushes one collection's queue.
struct CollectionRoute: Hashable {
    let id: UUID
    /// Opens the page in edit mode ("Edit collection" on the record player, #352).
    var startsEditing = false
}

/// The Collections screen (`docs/plans/339-collections.md`): the record player (#352, the default) or the List view
/// (#350: a search field, a row per collection, and "New collection"). The choice, and Picture disc / Black vinyl, are
/// remembered per device.
struct CollectionsView: View {
    let model: CollectionsModel
    var onOpen: (UUID) -> Void
    /// "Edit collection" on the record player: that collection's page, in edit mode.
    var onEdit: (UUID) -> Void = { _ in }
    /// Opens the wheel on this collection (the debug gallery's browsing frame); otherwise on the playing one.
    var startsOn: UUID?
    @Environment(\.playback) private var playback
    @AppStorage(CollectionsViewPrefs.viewKey) private var viewRaw = CollectionsViewMode.default.rawValue
    @AppStorage(CollectionsViewPrefs.recordKey) private var recordRaw = SpinningRecord.default.rawValue

    @State private var query = ""
    /// The collection builder (#366): "New collection", or "Add music" on an empty collection in the record player.
    @State private var builder: BuilderTarget?

    private var matching: [MusicCollection] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return model.collections }
        return model.collections.filter { $0.name.lowercased().contains(needle) }
    }

    private var mode: Binding<CollectionsViewMode> {
        Binding(get: { CollectionsViewMode(storedRaw: viewRaw) }, set: { viewRaw = $0.rawValue })
    }

    private var record: Binding<SpinningRecord> {
        Binding(get: { SpinningRecord(storedRaw: recordRaw) }, set: { recordRaw = $0.rawValue })
    }

    /// The record player shows once there are collections to put on the wheel.
    private var showsPlayer: Bool {
        mode.wrappedValue == .player && model.isLoaded && model.readFailure == nil && !model.collections.isEmpty
    }

    /// The collection the player's queue came from: the wheel opens on it.
    private var playingCollectionID: UUID? {
        guard let context = playback?.queue?.context, context.kind == .collection else { return nil }
        return context.id
    }

    private var hasCollections: Bool { model.isLoaded && model.readFailure == nil && !model.collections.isEmpty }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if showsPlayer {
                CollectionsPlayerView(
                    model: model, mode: mode, record: record, startsOn: startsOn ?? playingCollectionID,
                    onEdit: onEdit, onNew: { builder = .new }, onAddMusic: { builder = .addMusic($0) }
                )
            } else {
                listScroll
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { model.reload() }
        .collectionBuilder($builder, model: model, onDone: onOpen)
    }

    private var listScroll: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    CollectionsTitleRow(count: hasCollections ? model.collections.count : nil)
                    if hasCollections { controlsRow }
                    if !model.isLoaded {
                        loadingRows
                    } else if let failure = model.readFailure {
                        ReadFailureView(message: failure) { model.reload() }
                    } else if model.collections.isEmpty {
                        emptyState
                    } else {
                        searchField
                        if matching.isEmpty {
                            Text(Copy.Collections.noMatches(query))
                                .themeFont(.body)
                                .foregroundStyle(Theme.secondaryText)
                                .frame(maxWidth: .infinity)
                                .padding(.top, Theme.Library.noMatchesTopPadding)
                        }
                        LazyVStack(spacing: 8) {
                            ForEach(matching) { collection in
                                CollectionRow(model: model, collection: collection) { onOpen(collection.id) }
                            }
                        }
                    }
                }
                .padding(.horizontal, Theme.Spacing.listPagePadding)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.immediately)
    }

    /// The mode toggle at the left and "New collection" at the right; stacked when they don't fit side by side.
    private var controlsRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Theme.Library.headerControlGap) {
                CollectionsModeSwitches(mode: mode, record: record)
                Spacer(minLength: Theme.Library.headerControlGap)
                newButton
            }
            VStack(alignment: .leading, spacing: Theme.Library.headerControlGap) {
                CollectionsModeSwitches(mode: mode, record: record)
                newButton
            }
        }
    }

    private var newButton: some View {
        Button {
            builder = .new
        } label: {
            Text(Copy.Collections.newCollection)
        }
        .buttonStyle(CollectionPillButtonStyle())
    }

    /// No collections: one empty record, the plan's line, and the button.
    private var emptyState: some View {
        VStack(spacing: 20) {
            CollectionCoverView(releaseIDs: [], side: 120)
            Text(Copy.Collections.emptyLine)
                .themeFont(.body)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
            Button {
                builder = .new
            } label: {
                Text(Copy.Collections.newCollection)
            }
            .buttonStyle(CollectionPillButtonStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    /// Quiet placeholders in the rows' final shape, for the moment before the store is read; no spinner.
    private var loadingRows: some View {
        VStack(spacing: 8) {
            ForEach(0..<4, id: \.self) { _ in
                RoundedRectangle(cornerRadius: Theme.Radius.card)
                    .fill(Theme.Immersive.panelFill)
                    .frame(height: Theme.Library.thumbnailSize + 20)
            }
        }
        .accessibilityHidden(true)
    }

    private var searchField: some View {
        HStack(spacing: Theme.Library.headerControlGap) {
            LocallyIcon(.search, size: 22, relativeTo: .body)
                .foregroundStyle(Theme.secondaryText)
            TextField("", text: $query, prompt: Text(Copy.Collections.searchPlaceholder).foregroundColor(Theme.textDim))
                .themeFont(.body)
                .lineLimit(1)
                .foregroundStyle(Theme.primaryText)
                .submitLabel(.search)
                .autocorrectionDisabled()
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.secondaryText)
                        .frame(minWidth: 44, minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Copy.Library.clearSearch)
            }
        }
        .padding(.horizontal, Theme.Library.searchPaddingH)
        .padding(.vertical, Theme.Library.searchPaddingV)
        .frame(minHeight: Theme.Library.searchMinHeight)
        .background(Capsule().fill(Theme.Immersive.panelFill))
        .overlay(Capsule().stroke(Theme.Immersive.panelStroke, lineWidth: 1))
    }
}

/// One collection in the list: its cover, name and track count. The whole row is one button of at least 44 pt.
struct CollectionRow: View {
    let model: CollectionsModel
    let collection: MusicCollection
    var onOpen: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let count = model.trackCount(of: collection)
        let seconds = model.playableDuration(of: collection)
        let length = TrackLength.format(seconds)
        Button(action: onOpen) {
            HStack(spacing: 12) {
                CollectionCoverView(releaseIDs: model.coverReleaseIDs(of: collection))
                VStack(alignment: .leading, spacing: 2) {
                    Text(collection.name)
                        .themeFont(.rowTitle)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    Text(subtitle(count: count, length: length))
                        .themeFont(.rowSubtitle)
                        .foregroundStyle(Theme.secondaryText)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                LocallyIcon(.chevronRight, size: 20, relativeTo: .footnote)
                    .foregroundStyle(Theme.textDim)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: Theme.Radius.card).fill(Theme.Immersive.panelFill))
            .contentShape(.rect(cornerRadius: Theme.Radius.card))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Copy.Collections.rowLabel(name: collection.name, tracks: count, length: TrackLength.spokenTotal(seconds)))
    }

    /// "8 tracks · 32:10": the count, then the length of the tracks this phone can play.
    private func subtitle(count: Int, length: String?) -> String {
        [Copy.Collections.trackCount(count), length].compactMap { $0 }.joined(separator: " \u{00B7} ")
    }
}

/// The collections could not be read: the reason and Try again, in place of the empty state.
struct ReadFailureView: View {
    let message: String
    /// The slim form for a row (the Library's Collections row): the line and Try again side by side.
    var compact = false
    var onRetry: () -> Void

    var body: some View {
        if compact {
            compactBody
        } else {
            fullBody
        }
    }

    private var compactBody: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                Text(Copy.Collections.readFailed)
                    .themeFont(.meta)
                    .foregroundStyle(Theme.primaryText)
                Text(message)
                    .themeFont(.meta)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onRetry) { Text(Copy.Collections.tryAgain) }
                .buttonStyle(CollectionPillButtonStyle())
        }
        .accessibilityElement(children: .contain)
        .onAppear { AccessibilityNotification.Announcement("\(Copy.Collections.readFailed) \(Copy.Collections.tryAgain)").post() }
    }

    private var fullBody: some View {
        VStack(spacing: 16) {
            Text(Copy.Collections.readFailed)
                .themeFont(.body)
                .foregroundStyle(Theme.primaryText)
                .multilineTextAlignment(.center)
            Text(message)
                .themeFont(.rowSubtitle)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
            Button(action: onRetry) { Text(Copy.Collections.tryAgain) }
                .buttonStyle(CollectionPillButtonStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
        .accessibilityElement(children: .contain)
        .onAppear { AccessibilityNotification.Announcement("\(Copy.Collections.readFailed) \(Copy.Collections.tryAgain)").post() }
    }
}

/// The Primary pill at a compact width with a 44 pt hit area (the shared compact pill is 36 pt tall).
struct CollectionPillButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .themeFont(.primaryButton)
            .foregroundStyle(Theme.onAccent)
            .multilineTextAlignment(.center)
            .padding(.horizontal, Theme.Spacing.primaryButtonH)
            .frame(minHeight: 44)
            .background(Theme.accent)
            .clipShape(Capsule())
            .contentShape(Capsule())
            .opacity(isEnabled ? 1 : 0.5)
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
    }
}
