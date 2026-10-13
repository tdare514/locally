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

    @State private var releases: [Release] = []
    @State private var errorMessage: String?

    @AppStorage(LibraryViewPrefs.layoutKey) private var layout: LibraryLayout = .default
    @AppStorage(LibraryViewPrefs.coverSizeKey) private var coverSize: CoverSize = .default
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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

    private var singles: [Release] { releases.filter { $0.kind == .single } }
    private var albums: [Release] { releases.filter { $0.kind == .album } }

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
                } else {
                    LibrarySky(palette: skyPalette, motion: motion)

                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            header
                            if !singles.isEmpty {
                                section(label: Copy.Library.singlesSection, items: singles)
                            }
                            if !singles.isEmpty, !albums.isEmpty {
                                sectionDivider
                            }
                            if !albums.isEmpty {
                                section(label: Copy.Library.albumsSection, items: albums)
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
            .task(id: skyKey) { await ensurePalette(for: skyKey) }
            .navigationTitle(Copy.Library.title)
            .navigationBarTitleDisplayMode(.inline)
            // The sky runs up under the title, as on the release page.
            .toolbarBackground(releases.isEmpty ? .automatic : .hidden, for: .navigationBar)
            .navigationDestination(for: Release.self) { release in
                ReleaseDetailView(release: release)
            }
            // `.onAppear` (not `.task`) so returning from `ReleaseDetailView`
            // after a save/delete re-reads the store and reflects it here.
            .onAppear { load() }
            .stickyFooter {
                if !releases.isEmpty {
                    Button(Copy.Library.addASong) { startImport(nil) }
                        .buttonStyle(PrimaryPillButtonStyle())
                }
            }
        }
    }

    private func startImport(_ kind: ImportKind?) {
        requestedImportKind = kind
        selectedTab = .importSong
    }

    @ViewBuilder
    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
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
        controls
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
    private func section(label: String, items: [Release]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(label)
                    .font(Theme.Font.sectionTitle)
                    .foregroundStyle(Theme.primaryText)
                Text(Copy.Library.sectionCount(items.count))
                    .font(Theme.Font.meta)
                    .foregroundStyle(Theme.textDim)
                Spacer()
            }
            .padding(.horizontal, 4)

            switch layout {
            case .list: listPanel(items)
            case .covers: coverGrid(items)
            }
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

    /// The subtle dashed rule between the Singles and Albums sections.
    private var sectionDivider: some View {
        DashedRule()
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

            Image(systemName: "chevron.right")
                .font(Theme.Font.chevron)
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

    /// The stored cover filling its frame, or a `music.note` on `elevated`.
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
            shape.fill(Theme.elevated)
                .overlay { Image(systemName: "music.note").foregroundStyle(Theme.secondaryText) }
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

/// A 1 pt horizontal dashed line in `borderDashed`, used between library sections.
private struct DashedRule: View {
    var body: some View {
        Rectangle()
            .fill(Color.clear)
            .frame(height: 1)
            .overlay {
                GeometryReader { geo in
                    Path { p in
                        p.move(to: CGPoint(x: 0, y: 0.5))
                        p.addLine(to: CGPoint(x: geo.size.width, y: 0.5))
                    }
                    .stroke(Theme.borderDashed, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                }
            }
    }
}
