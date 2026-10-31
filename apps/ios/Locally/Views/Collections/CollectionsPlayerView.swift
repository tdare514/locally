import SwiftUI

/// The Collections screen as a record player (#352, plan `docs/plans/339-collections.md`): the half wheel across the
/// screen with the playing record turning in its hub, the count and "+" under it, now playing, then the front
/// collection's queue in one column. The page scrolls from anywhere but the wheel, where a vertical drag turns it.
struct CollectionsPlayerView: View {
    let model: CollectionsModel
    @Binding var mode: CollectionsViewMode
    @Binding var record: SpinningRecord
    /// "Edit collection": opens the collection's page in edit mode.
    var onEdit: (UUID) -> Void
    var onNew: () -> Void
    /// "Add music" on an empty collection: opens the builder on that collection.
    var onAddMusic: (UUID) -> Void

    @Environment(\.playback) private var playback
    @Environment(\.appContainer) private var container
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isTabSelected) private var isTabSelected
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

    @State private var frontID: UUID?
    @State private var isGuideOpen = false
    /// The wash: the front collection's first cover, as the release page and the library sky take theirs.
    @State private var palette: AmbientPalette?
    @State private var isScreenShowing = true
    @State private var isWheelInView = true
    @State private var isLowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled

    init(
        model: CollectionsModel, mode: Binding<CollectionsViewMode>, record: Binding<SpinningRecord>, startsOn playingID: UUID?,
        onEdit: @escaping (UUID) -> Void, onNew: @escaping () -> Void, onAddMusic: @escaping (UUID) -> Void
    ) {
        self.model = model
        _mode = mode
        _record = record
        self.onEdit = onEdit
        self.onNew = onNew
        self.onAddMusic = onAddMusic
        _frontID = State(initialValue: playingID.flatMap { id in model.collections.contains { $0.id == id } ? id : nil } ?? model.collections.first?.id)
    }

    /// The collection the player's queue came from, when it is a collection.
    private var playingID: UUID? {
        guard let context = playback?.queue?.context, context.kind == .collection else { return nil }
        return context.id
    }

    private var reduceMotion: Bool {
        #if DEBUG
        systemReduceMotion || UserDefaults.standard.bool(forKey: WheelMotion.debugReduceMotionKey)
        #else
        systemReduceMotion
        #endif
    }

    private var isAnimated: Bool {
        WheelMotion.isAnimated(scenePhase: scenePhase, isScreenShowing: isTabSelected && isScreenShowing, isLowPowerMode: isLowPowerMode, isInView: isWheelInView, reduceMotion: reduceMotion)
    }

    static let queueID = "front-queue"
    static let nowPlayingID = "now-playing"
    static let scrollSpace = "collections-player-scroll"

    /// The scroll view's visible height as the wheel sees it: the window's, the scroll view being the page.
    static func visibleHeight(of proxy: GeometryProxy) -> CGFloat {
        proxy.bounds(of: .named(scrollSpace))?.height ?? .infinity
    }
    #if DEBUG
    static let debugScrollKey = "debugPlayerScrollToQueue"
    #endif

    private var frontCoverID: UUID? { frontID.flatMap { model.summary($0)?.coverReleaseIDs.first } }

    private func loadPalette() async {
        guard let id = frontCoverID, let store = container?.coverStore else { palette = nil; return }
        palette = await Task.detached(priority: .utility) { ArtworkPalette.palette(forCover: store.load(id)) }.value
    }

    /// The cover's colour for the controls: the same palette as the backdrop, else the accent.
    private var tint: Color { palette.map { Theme.coverGlowColors($0)[0] } ?? Theme.accent }

    private var frontIndex: Int { frontID.flatMap { id in model.summaries.firstIndex { $0.id == id } } ?? 0 }

    var body: some View {
        let playingID = playingID
        let isPlaying = playback?.isPlaying ?? false
        let front = frontID.flatMap { model.collection($0) }
        let frontControl = frontID.map { CollectionPlayControl(model: model, id: $0, playback: playback) }
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(Copy.Collections.eyebrow(model.collections.count))
                        .themeFont(.meta)
                        .foregroundStyle(Theme.secondaryText)
                    Text(Copy.Collections.title)
                        .themeFont(.pageTitle)
                        .foregroundStyle(Theme.primaryText)
                        .accessibilityAddTraits(.isHeader)
                    CollectionsModeSwitches(mode: $mode, record: $record)
                }
                .padding(.horizontal, Theme.Spacing.listPagePadding)
                .padding(.top, 12)

                RecordWheelView(
                    summaries: model.summaries, frontID: $frontID, playingID: playingID, isPlaying: isPlaying,
                    hubReleaseID: playback?.currentItem?.releaseId, style: record,
                    spins: WheelMotion.spins(isPlaying: isPlaying, isAnimated: isAnimated), animates: isAnimated,
                    activateLabel: activateLabel(front: front, isPlaying: isPlaying), onActivate: { frontControl?.togglePlay() }
                )
                .trackingScrollVisibility($isWheelInView)
                .padding(.top, 8)

                countRow
                    .padding(.horizontal, Theme.Spacing.listPagePadding)

                CollectionNowPlayingView(
                    playback: playback, sourceName: playingID.flatMap { model.summary($0)?.name },
                    backTo: playingID.flatMap { $0 == frontID ? nil : model.summary($0)?.name },
                    tint: tint, onBack: { frontID = playingID }
                )
                .padding(.horizontal, Theme.Spacing.listPagePadding)
                .padding(.top, 20)
                .id(Self.nowPlayingID)

                if let front {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        CollectionQueueHeader(model: model, collection: front, showsCover: false, showsLength: true) { onEdit(front.id) }
                        CollectionQueueRows(model: model, collection: front, layout: .page, isGuideOpen: $isGuideOpen, onAddMusic: { onAddMusic(front.id) })
                    }
                    .padding(.horizontal, Theme.Spacing.listPagePadding)
                    .padding(.top, 24)
                    .id(Self.queueID)
                }
            }
            .padding(.bottom, 24)
        }
        .coordinateSpace(name: Self.scrollSpace)
        .background {
            ArtworkBackdrop(palette: palette ?? .neutral)
                .environment(\.isTabSelected, isTabSelected && isScreenShowing)
                .overlay { Color.black.opacity(Theme.Immersive.playerScrimOpacity).ignoresSafeArea() }
        }
        .task(id: frontCoverID) { await loadPalette() }
        #if DEBUG
        .task {
            // Debug gallery only: bring the queue into view (the won't-play frame).
            guard let target = UserDefaults.standard.string(forKey: Self.debugScrollKey), !target.isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(600))
            withAnimation(nil) { proxy.scrollTo(target, anchor: .top) }
        }
        #endif
        }
        .onAppear { isScreenShowing = true }
        .onDisappear { isScreenShowing = false }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange).receive(on: DispatchQueue.main)) { _ in
            isLowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
        }
    }

    /// "Play Late drives" / "Pause Late drives": the same state as the row's tag and the spoken value.
    private func activateLabel(front: MusicCollection?, isPlaying: Bool) -> String {
        guard let front else { return Copy.Collections.play }
        return front.id == playingID && isPlaying ? Copy.Collections.pauseRow(front.name) : Copy.Collections.playRow(front.name)
    }

    /// "1 of 24" and the + that makes a collection, under the wheel at its left. The caption stops growing at XXXL like the wheel.
    private var countRow: some View {
        HStack(spacing: 12) {
            (Text("\(frontIndex + 1)").bold().foregroundStyle(Theme.primaryText)
                + Text(" of \(model.collections.count)").foregroundStyle(Theme.secondaryText))
                .themeFont(.body)
                .accessibilityLabel(RecordWheel.hubCount(frontIndex, model.collections.count))
            Button(action: onNew) {
                LocallyIcon(.plus, size: 22, relativeTo: .body)
            }
            .buttonStyle(IconButtonStyle())
            .accessibilityLabel(Copy.Collections.newCollectionLabel)
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
}

extension View {
    /// Tells `isInView` whether this view is on screen in its scroll view. `onGeometryChange` (back-deployed to iOS 16)
    /// reduces the frame to one Bool, so only an in / out change reaches the state, never every scroll tick. It
    /// compares the view's frame with the scroll view's visible bounds (the whole frame when it isn't in one).
    func trackingScrollVisibility(_ isInView: Binding<Bool>) -> some View {
        onGeometryChange(for: Bool.self) { proxy in
            let frame = proxy.frame(in: .named(CollectionsPlayerView.scrollSpace))
            return frame.maxY > 0 && frame.minY < CollectionsPlayerView.visibleHeight(of: proxy)
        } action: { isInView.wrappedValue = $0 }
    }
}
