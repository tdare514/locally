import SwiftUI

/// The "Make it a playlist" instructions shared by the post-send `DoneView`
/// (album kind) and `ReleaseDetailView`'s disclosure, so the two copies of
/// this walkthrough cannot drift (issue #21). Shows the album title with a
/// one-tap copy button, then the per-track steps and a fallback line.
struct PlaylistGuide: View {
    let albumTitle: String

    @State private var copied = false
    @State private var resetTask: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.rowGap) {
            HStack {
                Text(albumTitle)
                    .font(Theme.Font.body.weight(.semibold))
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
                    Label(copied ? Copy.Detail.copied : Copy.Detail.copyTitle, systemImage: "doc.on.doc")
                        .font(Theme.Font.rowSubtitle)
                }
                .buttonStyle(SecondaryPillButtonStyle())
            }

            Text(Copy.Detail.makeItAPlaylistSteps(albumTitle: albumTitle))
                .font(Theme.Font.rowSubtitle)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)

            Text(Copy.Detail.makeItAPlaylistFallback)
                .font(Theme.Font.meta)
                .foregroundStyle(Theme.textDim)
        }
    }
}
