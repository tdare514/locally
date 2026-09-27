import SwiftUI

/// Lists everything sent to Spotify so far, newest first. Tapping a row
/// opens `ReleaseDetailView` (`Views/Library/ReleaseDetailView.swift`) to
/// edit or delete it.
struct LibraryView: View {
    @Environment(\.appContainer) private var container

    /// Shared with `RootView`'s `TabView` so the sticky "Add a song" footer
    /// button can switch tabs.
    @Binding var selectedTab: Int

    @State private var releases: [Release] = []
    @State private var errorMessage: String?

    private var totalTrackCount: Int {
        releases.reduce(0) { $0 + $1.tracks.count }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()

                if releases.isEmpty {
                    VStack(spacing: 20) {
                        Image("ListenerLine")
                            .resizable()
                            .scaledToFit()
                            .frame(height: 150)
                            .accessibilityHidden(true)
                        Text(Copy.Library.empty)
                            .font(Theme.Font.body)
                            .foregroundStyle(Theme.secondaryText)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, Theme.Spacing.listPagePadding)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            header
                            list
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
                Button(Copy.Library.addASong) { selectedTab = 0 }
                    .buttonStyle(PrimaryPillButtonStyle())
            }
        }
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

    /// One `cardContainer`, rows separated by a 1 pt `border`.
    private var list: some View {
        VStack(spacing: 0) {
            ForEach(Array(releases.enumerated()), id: \.element.id) { index, release in
                NavigationLink(value: release) {
                    row(for: release)
                }
                .buttonStyle(LibraryRowButtonStyle())

                if index < releases.count - 1 {
                    Rectangle().fill(Theme.border).frame(height: 1)
                }
            }
        }
        .cardContainer()
    }

    private func row(for release: Release) -> some View {
        HStack(spacing: 12) {
            coverThumbnail(for: release)

            VStack(alignment: .leading, spacing: 2) {
                Text(release.title)
                    .font(Theme.Font.rowTitle)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text(release.artist)
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
