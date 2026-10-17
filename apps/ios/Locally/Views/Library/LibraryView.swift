import SwiftUI

/// The home tab. Lists everything sent to Spotify so far, newest first;
/// tapping a row or tile opens `ReleaseDetailView` to edit or delete it. A
/// header toggle switches between a list (rows in a translucent panel) and a
/// cover grid with three sizes; both choices persist. Behind a populated
/// library sits the "library sky": an `ArtworkBackdrop` fixed behind the
/// scroll view, coloured by the release last pressed or else the first one on
/// screen, its glows turning as the library scrolls (and letting go of a pressed
/// release once the library has scrolled away from it). With no releases
/// it becomes the onboarding: a diagram of files moving from Locally into
/// Spotify and the two first-import actions.
struct LibraryView: View {
    @Environment(\.appContainer) private var container

    /// Shared with `RootView`'s `TabView` so the "Add a song" actions can
    /// switch to the Import tab.
    @Binding var selectedTab: RootView.Tab
    /// Tells the Import tab which flow to open (single or album).
    @Binding var requestedImportKind: ImportKind?
    /// An artist name the Stats tab wants the library searched for; applied to the search box, then cleared.
    @Binding var librarySearchRequest: String?
    /// The component gallery opens the tray on appear; the app never sets it.
    var openTrayOnAppear = false

    @State private var releases: [Release] = []
    @State private var errorMessage: String?
    /// The search box text; not persisted.
    @State private var query = ""

    @AppStorage(LibraryViewPrefs.layoutKey) private var layout: LibraryLayout = .default
    @AppStorage(LibraryViewPrefs.coverSizeKey) private var coverSize: CoverSize = .default
    @AppStorage(LibraryViewPrefs.singlesCollapsedKey) private var singlesCollapsed = false
    @AppStorage(LibraryViewPrefs.albumsCollapsedKey) private var albumsCollapsed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(SyncStatus.self) private var syncStatus
    /// The "From your devices" tray (#269): open or closed.
    @State private var tray = DevicesTrayModel()
    /// Add all / Try all again runs in flight (#296): each button reads "Adding…" or "Trying…".
    @State private var trayRuns: Set<DevicesTrayRun> = []
    @AccessibilityFocusState private var trayHeadingFocused: Bool
    @AccessibilityFocusState private var cloudButtonFocused: Bool

    /// Scroll distance, read only by `LibrarySky` so scrolling doesn't re-run this body.
    @State private var motion = LibrarySkyMotion()
    /// The release last pressed; it colours the sky until another is pressed or
    /// the library scrolls `pressedSkyReleaseDistance` away from where it was.
    @State private var pressedID: Release.ID?
    /// `motion.offset` when `pressedID` was set.
    @State private var pressOffset: CGFloat = 0
    /// Releases whose row or tile is currently on screen.
    @State private var visibleIDs: Set<Release.ID> = []
    @State private var palettes: [CoverKey: AmbientPalette] = [:]
    /// Decoded covers, read once per `CoverKey` in `load()`.
    @State private var covers: [CoverKey: UIImage] = [:]

    /// A release's cover identity: a replaced cover bumps `updatedAt`.
    private struct CoverKey: Hashable {
        let id: Release.ID
        let updatedAt: Date
    }

    private func key(_ release: Release) -> CoverKey {
        CoverKey(id: release.id, updatedAt: release.updatedAt)
    }

    private static let scrollSpace = "librarySkyScroll"

    private var totalTrackCount: Int {
        releases.reduce(0) { $0 + $1.tracks.count }
    }

    /// `releases` narrowed by the search box; the sections and the sky follow this.
    private var matching: [Release] { LibrarySearch.filter(releases, query: query) }
    private var singles: [Release] { matching.filter { $0.kind == .single } }
    private var albums: [Release] { matching.filter { $0.kind == .album } }

    /// Display order: singles, then albums.
    private var displayOrder: [Release] { singles + albums }

    /// The release whose cover colours the sky.
    private var skyID: Release.ID? {
        if let pressedID, releases.contains(where: { $0.id == pressedID }) { return pressedID }
        return displayOrder.first(where: { visibleIDs.contains($0.id) })?.id ?? displayOrder.first?.id
    }

    private var skyKey: CoverKey? {
        guard let skyID, let release = releases.first(where: { $0.id == skyID }) else { return nil }
        return key(release)
    }

    private var skyPalette: AmbientPalette {
        skyKey.flatMap { palettes[$0] } ?? .neutral
    }

    var body: some View {
        NavigationStack {
            ZStack {
                if releases.isEmpty {
                    Theme.background.ignoresSafeArea()
                    LibraryEmptyState(
                        onAddSingle: { startImport(.single) },
                        onMakeAlbum: { startImport(.album) }
                    )
                    // Songs from another device can arrive before the first one is made here.
                    VStack {
                        HStack { Spacer(); devicesButton }
                        Spacer()
                    }
                    .padding(.horizontal, Theme.Spacing.listPagePadding)
                    .padding(.top, 8)
                } else {
                    LibrarySky(palette: skyPalette, motion: motion)

                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            header
                            if matching.isEmpty {
                                Text(Copy.Library.noMatches(query))
                                    .font(Theme.Font.body)
                                    .foregroundStyle(Theme.secondaryText)
                                    .multilineTextAlignment(.center)
                                    .frame(maxWidth: .infinity)
                                    .padding(.top, Theme.Library.noMatchesTopPadding)
                            }
                            if !singles.isEmpty {
                                section(label: Copy.Library.singlesSection, items: singles, collapsed: $singlesCollapsed)
                            }
                            if !singles.isEmpty, !albums.isEmpty {
                                sectionDivider
                            }
                            if !albums.isEmpty {
                                section(label: Copy.Library.albumsSection, items: albums, collapsed: $albumsCollapsed)
                            }
                        }
                        .padding(.horizontal, Theme.Spacing.listPagePadding)
                        .padding(.top, 12)
                        .padding(.bottom, 24)
                        .background {
                            GeometryReader { geo in
                                Color.clear.preference(
                                    key: LibraryScrollOffsetKey.self,
                                    value: -geo.frame(in: .named(Self.scrollSpace)).minY
                                )
                            }
                        }
                    }
                    .scrollDismissesKeyboard(.immediately)
                    .coordinateSpace(name: Self.scrollSpace)
                    .onPreferenceChange(LibraryScrollOffsetKey.self) { offset in
                        motion.offset = offset
                        if pressedID != nil,
                           abs(offset - pressOffset) > Theme.Library.pressedSkyReleaseDistance {
                            pressedID = nil
                        }
                    }
                }
            }
            .onChange(of: syncStatus.pendingFromMac.count) { _, count in
                tray.pendingCountChanged(to: count)
                // A send that finished (or a retry inside a reconcile) has added a release.
                load()
            }
            .task(id: skyKey) { await ensurePalette(for: skyKey) }
            // No bar on the home screen (the header carries the title); pushed
            // release pages set their own.
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Release.self) { release in
                ReleaseDetailView(release: release)
            }
            // `.onAppear` (not `.task`) so returning from `ReleaseDetailView`
            // after a save/delete re-reads the store and reflects it here.
            .onAppear {
                load()
                if openTrayOnAppear { tray.isOpen = true }
            }
            .onChange(of: librarySearchRequest) { _, name in
                guard let name else { return }
                query = name
                librarySearchRequest = nil
            }
            .stickyFooter(isPresented: !releases.isEmpty) {
                Button(Copy.Library.addASong) { startImport(nil) }
                    .buttonStyle(PrimaryPillButtonStyle())
            }
            // While the tray is open the library behind it is out of VoiceOver's reach.
            .accessibilityHidden(tray.isOpen)
            .overlayPreferenceValue(DevicesTrayAnchorKey.self) { anchor in
                devicesTrayLayer(anchor: anchor)
            }
        }
    }

    private func startImport(_ kind: ImportKind?) {
        requestedImportKind = kind
        selectedTab = .importSong
    }

    @ViewBuilder
    private var header: some View {
        HStack(alignment: .lastTextBaseline) {
            // With a cloud pending the row grows so the count (on the title's baseline) sits at
            // least 10 pt below the 40 pt button; with none it is as before #269.
            VStack(alignment: .leading, spacing: pendingCount > 0 ? 26 : 4) {
                Text(Copy.Library.eyebrow).eyebrow()
                Text(Copy.Library.allMusic)
                    .font(Theme.Font.pageTitle)
                    .foregroundStyle(Theme.primaryText)
            }
            Spacer()
            Text(Copy.Library.trackCount(totalTrackCount))
                .font(Theme.Font.meta)
                .foregroundStyle(Theme.secondaryText)
        }
        .overlay(alignment: .topTrailing) {
            // Top of the visible 40 pt glass level with the eyebrow's top; the 44 pt hit area
            // ends at the 16 pt gutter, so the badge inside it never crosses.
            devicesButton.offset(y: -2)
        }
        searchField
        controls
    }

    // MARK: From your devices (#269)

    private var pendingCount: Int { syncStatus.pendingFromMac.count }

    /// The header's cloud; while the tray is open it is hidden (the layer draws the X) but still
    /// anchors the tray. Nothing is drawn while nothing is pending.
    @ViewBuilder
    private var devicesButton: some View {
        if pendingCount > 0 {
            DevicesTrayButton(count: pendingCount, isOpen: false) { setTray(open: true) }
                .opacity(tray.isOpen ? 0 : 1)
                .accessibilityHidden(tray.isOpen)
                .accessibilityFocused($cloudButtonFocused)
                .anchorPreference(key: DevicesTrayAnchorKey.self, value: .bounds) { $0 }
        }
    }

    private func setTray(open: Bool) {
        withAnimation(reduceMotion ? DevicesTrayMotion.reducedFade : DevicesTrayMotion.open) {
            if open != tray.isOpen { tray.toggle() }
        }
        // VoiceOver goes to the tray's heading on open and back to the cloud on dismissal.
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            if open { trayHeadingFocused = true } else { cloudButtonFocused = true }
        }
    }

    /// Starts a section's run. The button locks at the press; the engine reserves the rows it takes
    /// (ready ones for Add all, the failed ones for Try all again) so none is sent twice.
    private func runTray(_ run: DevicesTrayRun) {
        guard !trayRuns.contains(run), let engine = container?.syncEngine else { return }
        trayRuns.insert(run)
        Task {
            switch run {
            case .addAll: await engine.acceptReadyFromMac()
            case .tryAllAgain: await engine.retryFailedAcceptsFromMac()
            }
            trayRuns.remove(run)
            load()
            // A polite announcement (it waits for VoiceOver to finish what it is saying).
            let text = run == .tryAllAgain && !syncStatus.failedAcceptIds.isEmpty
                ? Copy.Sync.couldntSendThese
                : (run == .addAll ? Copy.Sync.addAllDone : Copy.Sync.tryAllDone)
            var message = AttributedString(text)
            message.accessibilitySpeechAnnouncementPriority = .low
            AccessibilityNotification.Announcement(message).post()
        }
    }

    /// The scrim, the X and the panel, over the library while the tray is open.
    @ViewBuilder
    private func devicesTrayLayer(anchor: Anchor<CGRect>?) -> some View {
        if tray.isOpen, let anchor {
            GeometryReader { geo in
                let frame = geo[anchor]
                let screen = geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom
                let gutter: CGFloat = 16
                let panelWidth = min(300, geo.size.width - gutter * 2)
                ZStack(alignment: .topLeading) {
                    // A tap on the library behind closes it.
                    Color.clear.contentShape(Rectangle())
                        .onTapGesture { setTray(open: false) }
                        .accessibilityHidden(true)
                    DevicesTrayPanel(
                        rows: DevicesTrayModel.rows(
                            pending: syncStatus.pendingFromMac, accepting: syncStatus.acceptingIds,
                            failed: syncStatus.failedAcceptIds),
                        maxHeight: screen * 0.6,
                        headingFocus: $trayHeadingFocused,
                        runs: trayRuns,
                        onSend: { id in
                            Task {
                                await container?.syncEngine.acceptFromMac(id)
                                load()
                            }
                        },
                        onAddAll: { runTray(.addAll) },
                        onTryAllAgain: { runTray(.tryAllAgain) }
                    )
                    .accessibilityAction(.escape) { setTray(open: false) }
                    .frame(width: panelWidth)
                    // Its top-right corner sits under the cloud button, kept inside the gutters.
                    .padding(.leading, max(gutter, min(frame.maxX, geo.size.width - gutter) - panelWidth))
                    .padding(.top, frame.maxY + 8)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.92, anchor: .topTrailing)))
                    DevicesTrayButton(count: pendingCount, isOpen: true) { setTray(open: false) }
                        .position(x: frame.midX, y: frame.midY)
                }
            }
            .transition(.opacity)
            .accessibilityAction(.escape) { setTray(open: false) }
        }
    }

    /// Fake-glass search box filtering the library by title, artist, genre, year and track titles.
    private var searchField: some View {
        HStack(spacing: Theme.Library.headerControlGap) {
            LocallyIcon(.search, size: 22, scaled: false)
                .foregroundStyle(Theme.secondaryText)
            TextField(Copy.Library.searchPlaceholder, text: $query)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.primaryText)
                .submitLabel(.search)
                .autocorrectionDisabled()
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.secondaryText)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Copy.Library.clearSearch)
            }
        }
        .padding(.horizontal, Theme.Library.searchPaddingH)
        .frame(height: Theme.Library.searchHeight)
        .background(Capsule().fill(Theme.Immersive.panelFill))
        .overlay(Capsule().stroke(Theme.Immersive.panelStroke, lineWidth: 1))
    }

    /// The list / covers toggle and, in covers view, the three-step size control.
    private var controls: some View {
        HStack(spacing: Theme.Library.headerControlGap) {
            HStack(spacing: 0) {
                layoutButton(.list, systemImage: "list.bullet", label: Copy.Library.layoutList)
                layoutButton(.covers, systemImage: "square.grid.2x2", label: Copy.Library.layoutCovers)
            }
            .padding(2)
            .background(Capsule().fill(Theme.Immersive.panelFill))
            .overlay(Capsule().stroke(Theme.Immersive.panelStroke, lineWidth: 1))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Copy.Library.layoutLabel)

            Spacer()

            if layout == .covers {
                SegmentedPill(
                    options: [
                        (CoverSize.compact, Copy.Library.sizeSmall),
                        (CoverSize.medium, Copy.Library.sizeMedium),
                        (CoverSize.large, Copy.Library.sizeLarge),
                    ],
                    selection: $coverSize,
                    isCompact: true
                )
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Copy.Library.coverSizeLabel)
            }
        }
    }

    private func layoutButton(_ value: LibraryLayout, systemImage: String, label: String) -> some View {
        let selected = layout == value
        return Button {
            layout = value
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: Theme.Library.toggleIconSize, weight: .semibold))
                .foregroundStyle(selected ? Theme.onAccent : Theme.secondaryText)
                .frame(width: Theme.Library.toggleButtonSize, height: Theme.Library.toggleButtonSize - 8)
                .background { if selected { Capsule().fill(Theme.accent) } }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// A section label with its count, then the rows (list) or tiles (covers)
    /// of that section. Singles come first, then albums.
    private func section(label: String, items: [Release], collapsed: Binding<Bool>) -> some View {
        // A typed search shows both sections open without touching the stored choice.
        let isOpen = !collapsed.wrappedValue || !query.isEmpty
        let fold: Animation? = reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: Theme.Library.sectionFoldDuration)
        return VStack(alignment: .leading, spacing: 8) {
            Button {
                collapsed.wrappedValue.toggle()
            } label: {
                HStack(alignment: .firstTextBaseline) {
                    Text(label)
                        .font(Theme.Font.sectionTitle)
                        .foregroundStyle(Theme.primaryText)
                    Text(Copy.Library.sectionCount(items.count))
                        .font(Theme.Font.meta)
                        .foregroundStyle(Theme.textDim)
                    Image(systemName: "chevron.down")
                        .font(.system(size: Theme.Library.sectionChevronSize, weight: .semibold))
                        .foregroundStyle(Theme.textDim)
                        .rotationEffect(.degrees(isOpen ? 0 : -90))
                        .animation(fold, value: isOpen)
                        .accessibilityHidden(true)
                    Spacer()
                }
                .padding(.horizontal, 4)
                .frame(minHeight: Theme.Library.sectionHeaderMinHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(isOpen ? Copy.Library.sectionExpanded : Copy.Library.sectionCollapsed)
            .accessibilityHint(Copy.Library.sectionHint)

            // Only the rows' opacity animates; the section's layout jumps.
            VStack(spacing: 0) {
                if isOpen {
                    Group {
                        switch layout {
                        case .list: listPanel(items)
                        case .covers: coverGrid(items)
                        }
                    }
                    .transition(.opacity)
                }
            }
            .animation(fold, value: isOpen)
        }
    }

    /// Rows in a translucent panel over the sky, separated by a 1 pt `panelStroke`.
    private func listPanel(_ items: [Release]) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Library.listPanelCornerRadius, style: .continuous)
        return VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, release in
                NavigationLink(value: release) { row(for: release) }
                    .buttonStyle(PressAwareStyle(rowHighlight: true, onPress: { didPress(release) }))
                    .onAppear { visibleIDs.insert(release.id) }
                    .onDisappear { visibleIDs.remove(release.id) }

                if index < items.count - 1 {
                    Rectangle().fill(Theme.Immersive.panelStroke).frame(height: 1)
                }
            }
        }
        .background(shape.fill(Theme.Immersive.panelFill))
        .clipShape(shape)
        .overlay(shape.stroke(Theme.Immersive.panelStroke, lineWidth: 1))
    }

    private func coverGrid(_ items: [Release]) -> some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: coverSize.tileMinWidth), spacing: coverSize.tileGap)],
            spacing: coverSize.tileGap
        ) {
            ForEach(items) { release in
                NavigationLink(value: release) { tile(for: release) }
                    .buttonStyle(PressAwareStyle(rowHighlight: false, onPress: { didPress(release) }))
                    .onAppear { visibleIDs.insert(release.id) }
                    .onDisappear { visibleIDs.remove(release.id) }
            }
        }
    }

    private func tile(for release: Release) -> some View {
        VStack(alignment: .leading, spacing: Theme.Library.tileTextGap) {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay { coverImage(for: release, cornerRadius: Theme.Library.tileCornerRadius) }
                .liftOnPress()
            VStack(alignment: .leading, spacing: 2) {
                Text(release.title)
                    .font(Theme.Font.rowTitle)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text(subtitle(for: release))
                    .font(Theme.Font.rowSubtitle)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
        }
        .contentShape(Rectangle())
    }

    private func didPress(_ release: Release) {
        pressOffset = motion.offset
        pressedID = release.id
    }

    private func subtitle(for release: Release) -> String {
        release.kind == .album
            ? Copy.Library.albumSubtitle(artist: release.artist, tracks: release.tracks.count)
            : release.artist
    }

    /// The barely visible hairline between the Singles and Albums sections.
    private var sectionDivider: some View {
        Rectangle()
            .fill(Theme.Library.sectionDivider)
            .frame(height: 1)
            .padding(.vertical, 4)
            .accessibilityHidden(true)
    }

    private func row(for release: Release) -> some View {
        HStack(spacing: 12) {
            coverThumbnail(for: release)
                .liftOnPress()

            VStack(alignment: .leading, spacing: 2) {
                Text(release.title)
                    .font(Theme.Font.rowTitle)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text(subtitle(for: release))
                    .font(Theme.Font.rowSubtitle)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }

            Spacer()

            LocallyIcon(.chevronRight, size: 20, scaled: false)
                .foregroundStyle(Theme.textDim)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 78)
        .contentShape(Rectangle())
    }

    private func coverThumbnail(for release: Release) -> some View {
        Color.clear
            .frame(width: Theme.Library.thumbnailSize, height: Theme.Library.thumbnailSize)
            .overlay { coverImage(for: release, cornerRadius: Theme.Radius.thumbnail) }
    }

    /// The stored cover filling its frame, or the double note on `card` (#296).
    @ViewBuilder
    private func coverImage(for release: Release, cornerRadius: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius)
        if let uiImage = covers[key(release)] {
            Color.clear
                .overlay {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                }
                .clipShape(shape)
        } else {
            NoCoverArt().clipShape(shape)
        }
    }

    /// Fills the palette cache for `key` off the main thread.
    private func ensurePalette(for key: CoverKey?) async {
        guard let key, palettes[key] == nil else { return }
        let store = container?.coverStore
        let palette = await Task.detached(priority: .utility) {
            ArtworkPalette.palette(forCover: store?.load(key.id))
        }.value
        palettes[key] = palette
    }

    private func load() {
        guard let container else { return }
        do {
            releases = try container.library.all().sorted { $0.updatedAt > $1.updatedAt }
            let live = Set(releases.map(key))
            palettes = palettes.filter { live.contains($0.key) }
            covers = covers.filter { live.contains($0.key) }
            for release in releases where covers[key(release)] == nil {
                if let data = container.coverStore.load(release.id), let image = UIImage(data: data) {
                    covers[key(release)] = image
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Scroll distance of the library content, read by a background `GeometryReader`.
private struct LibraryScrollOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// Whether the library row or tile containing the view is being pressed;
/// set by `PressAwareStyle`, read by `LiftOnPress` on the cover.
private extension EnvironmentValues {
    @Entry var libraryCoverPressed: Bool = false
}

/// Renders the link's label, passes `isPressed` down as `libraryCoverPressed`
/// so the cover can lift, and optionally fills the row with `row-hover` per
/// `docs/design.md`'s "Library list" component. `onPress` fires when a press begins.
private struct PressAwareStyle: ButtonStyle {
    let rowHighlight: Bool
    let onPress: () -> Void

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .environment(\.libraryCoverPressed, configuration.isPressed)
            .background(rowHighlight && configuration.isPressed ? Theme.rowHover : Color.clear)
            .onChange(of: configuration.isPressed) { _, pressed in
                if pressed { onPress() }
            }
    }
}

private extension View {
    /// Grows slightly with a soft shadow while the enclosing row or tile is
    /// pressed; with Reduce Motion on there is no movement (the row highlight remains).
    func liftOnPress() -> some View {
        modifier(LiftOnPress())
    }
}

private struct LiftOnPress: ViewModifier {
    @Environment(\.libraryCoverPressed) private var pressed
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let lifted = pressed && !reduceMotion
        content
            .scaleEffect(lifted ? Theme.Library.pressScale : 1)
            .shadow(
                color: .black.opacity(lifted ? Theme.Library.pressShadowOpacity : 0),
                radius: Theme.Library.pressShadowRadius, x: 0, y: Theme.Library.pressShadowY
            )
            .animation(.easeOut(duration: Theme.Library.pressDuration), value: lifted)
    }
}

/// Holds the library's scroll distance outside `LibraryView`'s state, so only
/// the views that read `offset` (just `LibrarySky`) update as it scrolls.
@Observable @MainActor
private final class LibrarySkyMotion {
    var offset: CGFloat = 0
}

/// The fixed colour wash behind the library. It alone reads the scroll offset;
/// the glows turn by screens scrolled (the web's `.ambient-sky-1/-2`).
private struct LibrarySky: View {
    let palette: AmbientPalette
    let motion: LibrarySkyMotion

    var body: some View {
        GeometryReader { geo in
            ArtworkBackdrop(
                palette: palette,
                progress: geo.size.height > 0 ? Double(motion.offset / geo.size.height) : 0
            )
        }
        .ignoresSafeArea()
    }
}

/// The empty library, which is also the first thing a new user sees after
/// connecting Spotify's folder: a small diagram (the app icon, an arrow,
/// Spotify) over a title, one line of explanation, and the two ways to
/// start. The icon tile shows whichever app icon the user picked.
private struct LibraryEmptyState: View {
    let onAddSingle: () -> Void
    let onMakeAlbum: () -> Void

    private var iconName: String {
        "IconPreview-" + (UIApplication.shared.alternateIconName ?? "AppIcon")
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            diagram
                .padding(.bottom, 36)

            VStack(spacing: 8) {
                Text(Copy.Library.emptyEyebrow).eyebrow()
                Text(Copy.Library.emptyTitle)
                    .font(Theme.Font.pageTitle)
                    .foregroundStyle(Theme.primaryText)
                Text(Copy.Library.emptyBody)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .padding(.top, 4)
            }

            Spacer(minLength: 0)

            VStack(spacing: 12) {
                Button(Copy.Library.addFirstSingle, action: onAddSingle)
                    .buttonStyle(PrimaryPillButtonStyle())
                Button(Copy.Library.makeAnAlbum, action: onMakeAlbum)
                    .buttonStyle(SecondaryPillButtonStyle())
            }
            .padding(.bottom, 8)
        }
        .padding(.horizontal, Theme.Spacing.pagePadding)
        .padding(.top, 24)
        .padding(.bottom, 16)
    }

    /// Locally tile, a dotted accent arrow, Spotify tile. Spotify is drawn
    /// as a neutral tile with a note, never its logo (the app is independent).
    private var diagram: some View {
        HStack(alignment: .top, spacing: 18) {
            tile(caption: Copy.Library.diagramLocally) {
                Image(iconName)
                    .resizable()
                    .scaledToFill()
            }

            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { _ in
                    Circle().fill(Theme.accent).frame(width: 5, height: 5)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.accent)
            }
            .frame(height: 68)
            .accessibilityHidden(true)

            tile(caption: Copy.Library.diagramSpotify) {
                Image(systemName: "music.note")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(Theme.primaryText)
            }
        }
    }

    private func tile<Content: View>(caption: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Theme.elevated)
                .frame(width: 68, height: 68)
                .overlay { content() }
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Theme.border, lineWidth: 1)
                )
            Text(caption)
                .font(Theme.Font.rowSubtitle)
                .foregroundStyle(Theme.secondaryText)
        }
    }
}
