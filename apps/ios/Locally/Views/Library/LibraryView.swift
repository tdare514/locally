import SwiftUI

/// The home tab. Lists everything sent to Spotify so far, newest first;
/// tapping a row opens `ReleaseDetailView` to edit or delete it. With no
/// releases it becomes the onboarding: a diagram of files moving from
/// Locally into Spotify and the two first-import actions.
struct LibraryView: View {
    @Environment(\.appContainer) private var container

    /// Shared with `RootView`'s `TabView` so the "Add a song" actions can
    /// switch to the Import tab.
    @Binding var selectedTab: RootView.Tab
    /// Tells the Import tab which flow to open (single or album).
    @Binding var requestedImportKind: ImportKind?

    @State private var releases: [Release] = []
    @State private var errorMessage: String?

    private var totalTrackCount: Int {
        releases.reduce(0) { $0 + $1.tracks.count }
    }

    private var singles: [Release] { releases.filter { $0.kind == .single } }
    private var albums: [Release] { releases.filter { $0.kind == .album } }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()

                if releases.isEmpty {
                    LibraryEmptyState(
                        onAddSingle: { startImport(.single) },
                        onMakeAlbum: { startImport(.album) }
                    )
                } else {
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
                    }
                }
            }
            .navigationTitle(Copy.Library.title)
            .navigationBarTitleDisplayMode(.inline)
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
    }

    /// A section label with its count, then one `cardContainer` of rows
    /// separated by a 1 pt `border`. Singles come first, then albums.
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

            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, release in
                    NavigationLink(value: release) {
                        row(for: release)
                    }
                    .buttonStyle(LibraryRowButtonStyle())

                    if index < items.count - 1 {
                        Rectangle().fill(Theme.border).frame(height: 1)
                    }
                }
            }
            .cardContainer()
        }
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

            VStack(alignment: .leading, spacing: 2) {
                Text(release.title)
                    .font(Theme.Font.rowTitle)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text(release.kind == .album
                     ? Copy.Library.albumSubtitle(artist: release.artist, tracks: release.tracks.count)
                     : release.artist)
                    .font(Theme.Font.rowSubtitle)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textDim)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 78)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func coverThumbnail(for release: Release) -> some View {
        RoundedRectangle(cornerRadius: Theme.Radius.thumbnail)
            .fill(Theme.elevated)
            .frame(width: 56, height: 56)
            .overlay {
                if let coverStore = container?.coverStore,
                   let data = coverStore.load(release.id),
                   let uiImage = UIImage(data: data) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 56, height: 56)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.thumbnail))
                } else {
                    Image(systemName: "music.note")
                        .foregroundStyle(Theme.secondaryText)
                }
            }
    }

    private func load() {
        guard let container else { return }
        do {
            releases = try container.library.all().sorted { $0.updatedAt > $1.updatedAt }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Highlights a library row with `row-hover` while pressed, per
/// `docs/design.md`'s "Library list" component.
private struct LibraryRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Theme.rowHover : Color.clear)
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
