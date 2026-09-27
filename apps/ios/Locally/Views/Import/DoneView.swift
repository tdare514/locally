import SwiftUI

/// The confirmation screen shown after a successful send, with the exact
/// copy for a single or an album release. For an album, also lists the
/// tracks in their final order so the user can tick them off while building
/// the Spotify playlist the done-album copy walks them through.
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
            VStack(spacing: 20) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Theme.accent)

                Text(kind == .single ? Copy.Import.doneSingle : Copy.Import.doneAlbum(albumTitle: albumTitle))
                    .foregroundStyle(Theme.primaryText)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                if kind == .album, !trackTitles.isEmpty {
                    trackList
                }

                Button(Copy.Import.addAnother, action: onAddAnother)
                    .buttonStyle(.bordered)
                    .tint(Theme.accent)
            }
            .padding(.vertical, 20)
        }
    }

    private var trackList: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(trackTitles.enumerated()), id: \.offset) { index, title in
                HStack(spacing: 10) {
                    Text("\(index + 1)")
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .frame(width: 20, alignment: .trailing)
                    Text(title)
                        .foregroundStyle(Theme.primaryText)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 24)
    }
}
