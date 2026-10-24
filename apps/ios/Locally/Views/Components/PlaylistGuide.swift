import SwiftUI

/// The "Make it a playlist" instructions shared by the post-send `DoneView`
/// (album kind) and `ReleaseDetailView`'s disclosure, so the two copies of
/// this walkthrough cannot drift (issue #21). Shows the album title with a
/// one-tap copy button, then the per-track steps and a fallback line.
struct PlaylistGuide: View {
    let albumTitle: String
    /// A collection's guide (#353) also lists its tracks in order; the release page has them on screen already.
    var trackTitles: [String] = []
    /// A quiet line under the list, e.g. how many tracks were left out.
    var note: String?

    @State private var copied = false
    @State private var resetTask: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.rowGap) {
            HStack {
                Text(albumTitle)
                    .themeFont(.body, weight: .semibold)
                    .foregroundStyle(Theme.primaryText)

                Button {
                    UIPasteboard.general.string = albumTitle
                    copied = true
                    resetTask?.cancel()
                    resetTask = Task {
                        try? await Task.sleep(for: .seconds(2))
                        if !Task.isCancelled {
                            copied = false
                        }
                    }
                } label: {
                    Label { Text(copied ? Copy.Detail.copied : Copy.Detail.copyTitle) } icon: { LocallyIcon(.copy, size: 17, relativeTo: .subheadline) }
                        .themeFont(.rowSubtitle)
                }
                .buttonStyle(SecondaryPillButtonStyle())
            }

            if !trackTitles.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(trackTitles.enumerated()), id: \.offset) { index, title in
                        Text("\(index + 1). \(title)")
                            .themeFont(.rowSubtitle)
                            .foregroundStyle(Theme.primaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .contain)
            }

            if let note {
                Text(note)
                    .themeFont(.meta)
                    .foregroundStyle(Theme.textDim)
            }

            Text(Copy.Detail.makeItAPlaylistSteps(albumTitle: albumTitle))
                .themeFont(.rowSubtitle)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)

            Text(Copy.Detail.makeItAPlaylistFallback)
                .themeFont(.meta)
                .foregroundStyle(Theme.textDim)
        }
    }
}
