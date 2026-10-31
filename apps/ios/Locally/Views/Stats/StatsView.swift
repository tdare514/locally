import SwiftUI

/// The Stats tab (#204): builds the page's model from the app container once it is there, then
/// shows `StatsView`. The component gallery builds `StatsView` directly with sample data.
struct StatsTab: View {
    @Environment(\.appContainer) private var container
    @Binding var selectedTab: RootView.Tab
    @Binding var librarySearchRequest: String?

    @State private var model: StatsViewModel?
    @State private var covers: StatsCoverCache?

    var body: some View {
        Group {
            if let model, let covers {
                StatsView(model: model, cache: covers, selectedTab: $selectedTab, librarySearchRequest: $librarySearchRequest)
            } else {
                Color.clear
            }
        }
        .task {
            guard model == nil, let container else { return }
            let store = container.coverStore
            let library = container.library
            covers = StatsCoverCache(loader: { store.load($0) })
            model = StatsViewModel(stats: container.playStats, releases: { (try? library.all()) ?? [] })
        }
    }
}

/// The Stats page, in the iPhone's "glass groups" language (#160): the Mac's approved page (#145)
/// ported to a column. Top to bottom: the title, a one-line digest, the period row (arrows either side of the period pill),
/// the Tracks / Albums / Artists switch, the five-sleeve fan, then everyone ranked from number one
/// as a list or as the sorted grid. The backdrop takes its colours from the cover of number one.
struct StatsView: View {
    @State private var model: StatsViewModel
    let cache: StatsCoverCache
    @Binding var selectedTab: RootView.Tab
    @Binding var librarySearchRequest: String?

    @State private var path = NavigationPath()
    /// The sheets the ranked rows' and tiles' long-press menu raises (#364).
    @State private var trackSheets = TrackActionSheets()
    /// The sleeve a tap has lifted; the next tap on it opens it.
    @State private var armed: Int?
    @State private var palette: AmbientPalette?
    @State private var periodOpen = false
    /// The component gallery opens the period pop-up once the page is up.
    private let openPeriodOnAppear: Bool
    @State private var isLowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isTabSelected) private var isTabSelected
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(BackdropMotion.keepMovingKey) private var keepBackdropsMoving = false

    private static var edgeFade: CGFloat { 22 }
    private static var maxBottomFade: CGFloat { 90 }

    @Environment(SyncStatus.self) private var syncStatus

    init(model: StatsViewModel, cache: StatsCoverCache, selectedTab: Binding<RootView.Tab>, librarySearchRequest: Binding<String?>, periodOpen: Bool = false) {
        openPeriodOnAppear = periodOpen
        _model = State(initialValue: model)
        self.cache = cache
        _selectedTab = selectedTab
        _librarySearchRequest = librarySearchRequest
    }

    private struct FanKey: Hashable {
        var tab: StatsKind
        var period: StatsPeriodKind
        var back: Int
    }

    private var fanKey: FanKey {
        FanKey(tab: model.tab, period: model.displayed.kind, back: model.displayed.back)
    }

    private var motionActive: Bool {
        BackdropMotion.isActive(scenePhase: scenePhase, isTabSelected: isTabSelected, isLowPowerMode: isLowPowerMode)
    }

    private var leadOwner: UUID? {
        guard model.phase == .ready, let lead = model.items.first else { return nil }
        return model.coverOwner(of: lead)
    }

    var body: some View {
        NavigationStack(path: $path) {
            GeometryReader { geo in
                ZStack {
                    backdrop
                    ScrollView {
                        let room = max(geo.size.width - Theme.Stats.gutter * 2, 0)
                        VStack(alignment: .leading, spacing: 20) {
                            content(room: room)
                        }
                        .padding(.horizontal, Theme.Stats.gutter)
                        .padding(.top, Self.edgeFade)
                        .padding(.bottom, Self.edgeFade + 40)
                        .frame(maxWidth: .infinity)
                        // A tap on nothing puts a lifted sleeve back.
                        .background { Color.clear.contentShape(Rectangle()).onTapGesture { armed = nil } }
                    }
                    .scrollIndicators(.hidden)
                    .scrollBounceBehavior(.always)
                    .refreshable { await model.read(force: true) }
                    .mask(edgeMask(bottom: min(max(Self.edgeFade, geo.safeAreaInsets.bottom), Self.maxBottomFade)))
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            // As Settings: the backdrop runs under the tab bar.
            .toolbarBackground(.hidden, for: .tabBar)
            .navigationDestination(for: Release.self) { release in
                ReleaseDetailView(release: release)
            }
            .navigationDestination(for: ReleaseTrackRoute.self) { route in
                ReleaseDetailView(release: route.release, highlightTrackID: route.trackId)
            }
            .navigationDestination(for: ReleaseEditRoute.self) { route in
                ReleaseDetailView(release: route.release, startsEditing: true, scrollsToTrackID: route.trackId)
            }
            .navigationDestination(for: SongRoute.self) { route in
                SongPageDestination(route: route) { path.append($0) }
            }
            .navigationDestination(for: ArtistRoute.self) { route in
                ArtistPageView(route: route)
            }
            .navigationDestination(for: HistoryRoute.self) { route in
                HistoryDestination(route: route)
            }
        }
        // Every artist name opens that artist's page (#288); put on the stack so pushed pages inherit it.
        .artistLinks { path.append($0) }
        .environment(\.openSong, { path.append($0) })
        .task(id: isTabSelected) {
            if isTabSelected { await model.read() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, isTabSelected { Task { await model.read() } }
        }
        .onChange(of: fanKey) { _, _ in armed = nil }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange).receive(on: DispatchQueue.main)) { _ in
            isLowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
        }
        .task(id: leadOwner) { await loadPalette() }
    }

    // MARK: Backdrop

    @ViewBuilder
    private var backdrop: some View {
        ZStack {
            if let palette {
                ArtworkBackdrop(palette: palette)
                    .transition(.opacity)
                scrim
            } else {
                StudioBackdrop()
                    .transition(.opacity)
            }
        }
        .animation(
            BackdropMotion.reducesMotion(systemReduceMotion: reduceMotion, keepMoving: keepBackdropsMoving)
                ? nil : .easeInOut(duration: Theme.Immersive.backdropCrossFade),
            value: palette != nil
        )
    }

    /// Port of `.st-scrim`: a darkening over the cover-colour wash, strongest at the top where the
    /// title and digest sit, so the greys keep 4.5:1 on the brightest wash a pale cover gives.
    private var scrim: some View {
        LinearGradient(
            stops: [
                .init(color: .black.opacity(0.5), location: 0),
                .init(color: .black.opacity(0.3), location: 0.45),
                .init(color: .black.opacity(0), location: 0.9),
            ],
            startPoint: .top, endPoint: .bottom
        )
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func loadPalette() async {
        guard let owner = leadOwner else { palette = nil; return }
        let data = await cache.data(for: owner)
        guard let data else { palette = nil; return }
        let derived = await Task.detached(priority: .utility) { ArtworkPalette.palette(forCover: data) }.value
        palette = derived
    }

    private func edgeMask(bottom: CGFloat) -> some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
                .frame(height: Self.edgeFade)
            Rectangle().fill(.black)
            LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: bottom)
        }
    }

    // MARK: Content

    @ViewBuilder
    private func content(room: CGFloat) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Text(Copy.Stats.title)
                .font(Theme.ScaledFont.largeTitle)
                .foregroundStyle(Theme.primaryText)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            if model.phase != .signedOut { historyButton }
        }
        .padding(.horizontal, 6)

        if model.phase == .signedOut {
            signedOutCard
        } else {
            if model.showsControls {
                if !model.digest.isEmpty {
                    digestText(model.digest)
                        .foregroundStyle(Theme.primaryText.opacity(0.88))
                } else if model.phase == .loading {
                    // Holds the digest's lines while the first read runs, so the controls don't drop when it arrives
                    // (#423). A typical sentence at the reader's text size sets the room.
                    digestText(Copy.Stats.digestSentence(model.displayed, total: 1_000, topTrack: "A track title"))
                        .foregroundStyle(Color.white.opacity(0.06))
                        .redacted(reason: .placeholder)
                        .accessibilityHidden(true)
                }
                VStack(alignment: .trailing, spacing: 0) {
                    controlsRow
                    stepperRow
                }
                .task {
                    guard openPeriodOnAppear else { return }
                    try? await Task.sleep(for: .seconds(1.5))
                    periodOpen = true
                }
            }
            Group {
                switch model.phase {
                case .loading:
                    skeleton(room: room)
                case .ready:
                    ready(room: room)
                case .quiet, .signedOut:
                    EmptyView()
                case .noPlays:
                    messageCard(Copy.Stats.noPlays)
                case .failed:
                    messageCard(Copy.Stats.failed)
                case .busy:
                    messageCard(Copy.Stats.busy)
                }
            }
            .opacity(model.isRefreshing ? 0.6 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: model.isRefreshing)

            if model.phase == .ready || model.phase == .quiet {
                Text("\(Copy.Stats.playsSource). \(Copy.Stats.coverage)")
                    .font(Theme.ScaledFont.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 6)
            }
        }
    }

    private var signedOutCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Text(Copy.Stats.signedOutTitle)
                    .font(Theme.ScaledFont.headline)
                    .foregroundStyle(Theme.primaryText)
                    .accessibilityAddTraits(.isHeader)
                if syncStatus.signInAgainNotice {
                    Text(Copy.Sync.signInAgain)
                        .font(Theme.ScaledFont.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(Copy.Stats.signedOutBody)
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                Button(Copy.Stats.signedOutAction) { selectedTab = .settings }
                    .buttonStyle(MainButtonStyle())
                    .padding(.top, 6)
            }
            .padding(16)
        }
    }

    private func messageCard(_ text: String) -> some View {
        GlassCard {
            Text(text)
                .font(Theme.ScaledFont.subheadline)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(16)
        }
    }

    // MARK: Controls

    /// The #1 cover's colour, as the page wash; the accent when there is no cover (as Import does).
    private var tint: Color {
        palette.map { ArtworkBackdrop.color(hex: $0.primary) } ?? Theme.accent
    }

    private var periodPill: some View {
        StatsPeriodPill(
            current: model.period.kind,
            title: Copy.Stats.periodLabel(model.period),
            detail: periodDetail,
            showsDetail: false,
            tint: tint, isPresented: $periodOpen
        ) { model.selectKind($0) }
    }

    private var periodDetail: String {
        Copy.Stats.periodDetail(model.period, range: model.range, today: model.today)
    }

    private var backButton: some View {
        stepButton(.chevronRight, mirrored: true, label: Copy.Stats.previousLabel(model.period.kind), enabled: model.canStepBack) { model.stepBack() }
    }

    private var forwardButton: some View {
        stepButton(.chevronRight, label: Copy.Stats.nextLabel(model.period.kind), enabled: model.canStepForward) { model.stepForward() }
    }

    /// The tabs at the left and the period at the right, on one row like the Library's toolbar (#444): the tabs as
    /// words in the slim compact switch, so both fit a 375 pt screen. When they don't (large text, or a long "12 weeks
    /// ago"), the tabs take their own row with their icons, scrolling if need be, and the period sits under them.
    private var controlsRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 0) {
                tabPicker(icons: false, compact: true).fixedSize(horizontal: true, vertical: false)
                Spacer(minLength: 12)
                periodPill.fixedSize()
            }
            VStack(alignment: .trailing, spacing: 12) {
                tabPicker(icons: true, compact: false).frame(maxWidth: .infinity, alignment: .leading)
                periodPill
            }
        }
    }

    /// The period's dates under the pill, with ‹ › stepping a period back and forward (#444). The pill reads the dates
    /// out, so the line itself is hidden from VoiceOver.
    private var stepperRow: some View {
        HStack(spacing: 0) {
            if model.showsStepper { backButton }
            Text(periodDetail)
                .font(.footnote)
                .foregroundStyle(Theme.secondaryText)
                .contentTransition(.opacity)
                .accessibilityHidden(true)
                .padding(.horizontal, model.showsStepper ? 0 : 6)
            if model.showsStepper { forwardButton }
        }
        .frame(minHeight: Theme.Stats.minTarget)
    }

    private func stepButton(_ icon: LocallyIcon.Name, mirrored: Bool = false, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            LocallyIcon(icon, size: 18, scaled: false, mirrored: mirrored)
        }
        .buttonStyle(IconButtonStyle())
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    /// The way into History (#399): a plain icon button like the stepper's, at the title's trailing edge.
    private var historyButton: some View {
        Button { path.append(HistoryRoute()) } label: {
            Image(systemName: "clock.arrow.circlepath").font(.system(size: 20, weight: .semibold))
        }
        .buttonStyle(IconButtonStyle())
        .accessibilityLabel(Copy.History.entryLabel)
        .accessibilityHint(Copy.History.entryHint)
        .accessibilityIdentifier("stats-history")
    }

    private func tabPicker(icons: Bool, compact: Bool) -> some View {
        SlimSwitch(
            options: [
                (value: StatsKind.tracks, icon: icons ? "music.note" : nil, label: Copy.Stats.tracksTab),
                (.albums, icons ? "rectangle.stack.fill" : nil, Copy.Stats.albumsTab),
                (.artists, icons ? LocallyIcon.Name.person.rawValue : nil, Copy.Stats.artistsTab),
            ],
            selection: Binding(get: { model.tab }, set: { model.selectTab($0) }),
            compact: compact, overflow: .scroll
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Copy.Stats.showTopLabel)
    }

    // MARK: Ready

    private var noun: String {
        switch model.tab {
        case .tracks: return Copy.Stats.tracksTab.lowercased()
        case .albums: return Copy.Stats.albumsTab.lowercased()
        case .artists: return Copy.Stats.artistsTab.lowercased()
        }
    }

    @ViewBuilder
    private func ready(room: CGFloat) -> some View {
        let items = model.items
        if !items.isEmpty {
            let top = Array(items.prefix(FanLayout.maxCount))
            StatsFan(
                items: top, disc: model.tab == .artists, width: room,
                label: Copy.Stats.fanLabel(count: top.count, noun: noun), cache: cache,
                ownerOf: { model.coverOwner(of: $0) }, isMotionActive: motionActive,
                isScreenActive: scenePhase == .active && isTabSelected,
                requestKey: "\(model.tab.rawValue)-\(model.period.kind.rawValue)-\(model.period.back)",
                armed: $armed, onOpen: open
            )
            .id(fanKey)
            .frame(maxWidth: .infinity)

            VStack(alignment: .leading, spacing: 12) {
                Text(Copy.Stats.yourHeading(noun))
                    .font(.system(.title3, weight: .semibold))
                    .foregroundStyle(Theme.primaryText)
                    .padding(.horizontal, 6)
                    .accessibilityAddTraits(.isHeader)
                listControls
                if model.layout == .list {
                    StatsList(
                        items: model.listed, sort: model.sort, today: model.today, round: model.tab == .artists, cache: cache,
                        ownerOf: { model.coverOwner(of: $0) },
                        label: "\(Copy.Stats.yourHeading(noun)), \(sortPhrase)", onOpen: openListed, actions: itemActions
                    )
                } else {
                    StatsSea(
                        items: model.listed, sort: model.sort, width: room, round: model.tab == .artists, cache: cache,
                        ownerOf: { model.coverOwner(of: $0) },
                        label: "\(Copy.Stats.yourHeading(noun)), \(sortPhrase)", onOpen: openListed, actions: itemActions
                    )
                }
            }
            .trackActionSheets(trackSheets)
            .id("list-\(model.layout.rawValue)-\(model.tab.rawValue)-\(model.displayed.kind.rawValue)-\(model.displayed.back)")
        }
    }

    private var sortPhrase: String {
        switch model.sort {
        case .plays: return "most played first"
        case .minutes: return "most minutes first"
        case .name: return "by name"
        case .recent: return "most recent first"
        }
    }

    private var sortLabel: String {
        switch model.sort {
        case .plays: return Copy.Stats.sortPlays
        case .minutes: return Copy.Stats.sortMinutes
        case .name: return Copy.Stats.sortName
        case .recent: return Copy.Stats.sortRecent
        }
    }

    private var listControls: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                sortMenu
                Spacer(minLength: 0)
                layoutPill
            }
            VStack(alignment: .leading, spacing: 12) {
                sortMenu
                layoutPill
            }
        }
    }

    private var sortMenu: some View {
        Menu {
            Picker(Copy.Stats.sortLabel, selection: Binding(get: { model.sort }, set: { model.selectSort($0) })) {
                Text(Copy.Stats.sortPlays).tag(StatsSort.plays)
                Text(Copy.Stats.sortMinutes).tag(StatsSort.minutes)
                Text(Copy.Stats.sortName).tag(StatsSort.name)
                Text(Copy.Stats.sortRecent).tag(StatsSort.recent)
            }
        } label: {
            HStack(spacing: 6) {
                Text(sortLabel)
                Image(systemName: "chevron.up.chevron.down").font(.caption.weight(.semibold))
            }
            .font(.system(.footnote, weight: .semibold))
            .foregroundStyle(Theme.primaryText)
            .padding(.horizontal, 14)
            .frame(minHeight: Theme.Stats.minTarget)
            .background(Theme.elevated, in: Capsule())
            .contentShape(Capsule())
        }
        .accessibilityLabel("\(Copy.Stats.sortLabel), \(sortLabel)")
    }

    private var layoutPill: some View {
        SlimSwitch(
            options: [(value: StatsLayout.list, icon: "Icon/List", label: Copy.Stats.listLayout), (.grid, "Icon/Grid", Copy.Stats.gridLayout)],
            selection: Binding(get: { model.layout }, set: { model.selectLayout($0) }),
            compact: true, overflow: .stack
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Copy.Stats.layoutLabel)
    }

    // MARK: Loading

    private func digestText(_ text: String) -> some View {
        Text(text)
            .font(.system(.title3, weight: .semibold))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 6)
    }

    private func skeleton(room: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            StatsFanSkeleton(width: room)
                .frame(maxWidth: .infinity)
            VStack(spacing: 0) {
                ForEach(0..<4, id: \.self) { _ in
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: Theme.Radius.thumbnail, style: .continuous).fill(Color.white.opacity(0.06))
                            .frame(width: Theme.Stats.rowCover, height: Theme.Stats.rowCover)
                        VStack(alignment: .leading, spacing: 6) {
                            Capsule().fill(Color.white.opacity(0.06)).frame(width: 150, height: 14)
                            Capsule().fill(Color.white.opacity(0.04)).frame(width: 100, height: 12)
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(minHeight: 64)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Copy.Stats.loadingLabel)
    }

    // MARK: Opening

    /// The long-press menu of a ranked track or album (#364); an artist has none. A track also offers Go to album.
    private func itemActions(_ item: StatItem) -> TrackActions? {
        guard let releaseId = item.releaseId, let release = model.releases.first(where: { $0.id == releaseId }) else { return nil }
        let target: TrackActionsTarget = item.trackId.map { .track(releaseId: releaseId, trackId: $0) } ?? .release(releaseId)
        return trackSheets.actions(for: target, release: release, goToAlbum: item.trackId != nil) { path.append($0) }
    }

    /// A tap on a list row or a tile: a track opens its song page (#365), the rest as `open`. The fan keeps `open`.
    private func openListed(_ item: StatItem) {
        if let trackId = item.trackId, let releaseId = item.releaseId,
           let release = model.releases.first(where: { $0.id == releaseId }) {
            path.append(SongRoute(release: release, trackId: trackId))
        } else {
            open(item)
        }
    }

    private func open(_ item: StatItem) {
        model.open(
            item,
            openRelease: { release in
                if let trackId = item.trackId { path.append(ReleaseTrackRoute(release: release, trackId: trackId)) } else { path.append(release) }
            },
            openArtist: { path.append(ArtistRoute(key: $0)) }
        )
    }
}
