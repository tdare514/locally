import SwiftUI

/// Lists everything sent to Spotify so far. Editing is phase 2; this list
/// and its detail are read-only for now.
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
            .task { load() }
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
                if let coverPath = release.coverPath, let uiImage = UIImage(contentsOfFile: coverPath) {
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

/// Read-only detail for a release (editing arrives in phase 2).
struct ReleaseDetailView: View {
    let release: Release

    var body: some View {
        List {
            Section {
                LabeledContent(Copy.Import.fieldTitle, value: release.title)
                LabeledContent(Copy.Import.fieldArtist, value: release.artist)
                if let year = release.year { LabeledContent(Copy.Import.fieldYear, value: year) }
                if let genre = release.genre { LabeledContent(Copy.Import.fieldGenre, value: genre) }
            }
            .listRowBackground(Theme.panel)

            Section("Tracks") {
                ForEach(release.tracks) { track in
                    Text("\(track.trackNumber). \(track.title)")
                        .foregroundStyle(Theme.primaryText)
                }
            }
            .listRowBackground(Theme.panel)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(release.title)
    }
}
