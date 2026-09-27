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
                        .foregroundStyle(Theme.secondaryText)
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

            VStack(alignment: .leading) {
                Text(release.title)
                    .foregroundStyle(Theme.primaryText)
                Text(release.artist)
                    .font(.subheadline)
                    .foregroundStyle(Theme.secondaryText)
            }

            Spacer()

            Text(release.kind == .single ? Copy.Library.single : Copy.Library.album)
                .font(.caption2)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Theme.accent.opacity(0.2))
                .foregroundStyle(Theme.accent)
                .clipShape(Capsule())
        }
    }

    @ViewBuilder
    private func coverThumbnail(for release: Release) -> some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(Theme.panel)
            .frame(width: 44, height: 44)
            .overlay {
                if let coverStore = container?.coverStore,
                   let data = coverStore.load(release.id),
                   let uiImage = UIImage(data: data) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
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
