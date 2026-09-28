import SwiftUI

/// The confirmation screen shown after a successful send, with the exact
/// copy for a single or an album release. For an album, also shows the
/// shared `PlaylistGuide` (album title, copy button, steps) above the track
/// list, so the user can tick tracks off while building the playlist.
struct DoneView: View {
    enum Kind { case single, album }

    let kind: Kind
    var trackTitles: [String] = []
    /// Named in the `.album` done copy so the "make it a playlist" step tells the
    /// user exactly what to call the new playlist. Unused for `.single`.
    var albumTitle: String = ""
    let onAddAnother: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.sectionGap) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Theme.accent)

                Text(kind == .single ? Copy.Import.doneSingle : Copy.Import.doneAlbum)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.primaryText)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Theme.Spacing.pagePadding)

                if kind == .album {
                    playlistGuide
                }

                if kind == .album, !trackTitles.isEmpty {
                    trackList
                }

                Button(Copy.Import.addAnother, action: onAddAnother)
                    .buttonStyle(PrimaryPillButtonStyle())
            }
            .padding(.vertical, Theme.Spacing.sectionGap)
        }
        .background(Theme.background)
    }

    private var playlistGuide: some View {
        PlaylistGuide(albumTitle: albumTitle)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .cardContainer()
            .padding(.horizontal, Theme.Spacing.pagePadding)
    }

    private var trackList: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.rowGap) {
            ForEach(Array(trackTitles.enumerated()), id: \.offset) { index, title in
                HStack(spacing: 10) {
                    Text("\(index + 1)")
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.secondaryText)
                        .frame(width: 20, alignment: .trailing)
                    Text(title)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.primaryText)
                }
                .padding(.horizontal, Theme.Spacing.inputPaddingH)
                .padding(.vertical, Theme.Spacing.inputPaddingV)
                .background(Theme.elevated)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.input))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardContainer()
        .padding(.horizontal, Theme.Spacing.pagePadding)
    }
}
