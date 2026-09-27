import SwiftUI

/// Lists everything sent to Spotify so far, newest first. Tapping a row
/// opens `ReleaseDetailView` (`Views/Library/ReleaseDetailView.swift`) to
/// edit or delete it.
struct LibraryView: View {
    @Environment(\.appContainer) private var container

    @State private var releases: [Release] = []
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()

                if releases.isEmpty {
                    Text(Copy.Library.empty)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.secondaryText)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, Theme.Spacing.pagePadding)
                } else {
                    List(releases) { release in
                        NavigationLink(value: release) {
                            row(for: release)
                        }
                        .listRowBackground(Theme.panel)
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .navigationTitle(Copy.Library.title)
            .navigationDestination(for: Release.self) { release in
                ReleaseDetailView(release: release)
            }
            // `.onAppear` (not `.task`) so returning from `ReleaseDetailView`
            // after a save/delete re-reads the store and reflects it here.
            .onAppear { load() }
        }
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

            KindBadge(text: release.kind == .single ? Copy.Library.single : Copy.Library.album)
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func coverThumbnail(for release: Release) -> some View {
        RoundedRectangle(cornerRadius: Theme.Radius.thumbnail)
            .fill(Theme.elevated)
            .frame(width: 40, height: 40)
            .overlay {
                if let coverStore = container?.coverStore,
                   let data = coverStore.load(release.id),
                   let uiImage = UIImage(data: data) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 40, height: 40)
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
