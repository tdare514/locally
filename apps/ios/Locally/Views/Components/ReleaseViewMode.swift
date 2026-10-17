import SwiftUI

/// The release page's view mode in the Mac's look (#296): the details block and the track table
/// with no card around it. Edit mode keeps its fields and panel; these are only for reading.

/// The pure wording of a track's second line at the accessibility text sizes.
enum TrackRowLine {
    /// "35 plays, 2:22": the plays and the time as one line; either alone when the other is missing,
    /// nil when both are. `time` is `m:ss` for the eye or the spoken form for VoiceOver.
    static func playsAndTime(plays: Int?, time: String?) -> String? {
        let parts = [plays.map(Copy.Detail.playCount), time].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }
}

/// The meta line, title, artist and "Year 2025   Genre Rap" (an empty value is left out). At the
/// accessibility sizes Year and Genre each take their own line.
struct ReleaseDetailsView: View {
    let kind: ReleaseKind
    let trackCount: Int
    let title: String
    let artist: String
    let year: String
    let genre: String

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .largeTitle) private var titleSize: CGFloat = 30
    @ScaledMetric(relativeTo: .title3) private var artistSize: CGFloat = 18
    @ScaledMetric(relativeTo: .footnote) private var metaSize: CGFloat = 13
    @ScaledMetric(relativeTo: .subheadline) private var pairSize: CGFloat = 14

    private var pairs: [(label: String, value: String)] {
        [(Copy.Detail.yearLabel, year), (Copy.Detail.genreLabel, genre)].filter { !$0.value.isEmpty }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(Copy.Detail.metaLine(kind: kind == .album ? Copy.Import.kindAlbum : Copy.Import.kindSingle, tracks: trackCount))
                .font(.system(size: metaSize))
                .foregroundStyle(Theme.secondaryText)
            Text(title)
                .font(.system(size: titleSize, weight: .bold))
                .foregroundStyle(Theme.primaryText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if !artist.isEmpty {
                Text(artist)
                    .font(.system(size: artistSize, weight: .semibold))
                    .foregroundStyle(Theme.primaryText.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !pairs.isEmpty {
                let layout = dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                    : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 20))
                layout {
                    ForEach(pairs, id: \.label) { pair in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(pair.label).foregroundStyle(Theme.secondaryText)
                            Text(pair.value).foregroundStyle(Theme.primaryText)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .font(.system(size: pairSize))
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The track table's shared column widths, so the header lines up with the rows.
private struct TrackColumns {
    @ScaledMetric(relativeTo: .subheadline) var number: CGFloat = 24
    @ScaledMetric(relativeTo: .subheadline) var plays: CGFloat = 48
    @ScaledMetric(relativeTo: .subheadline) var time: CGFloat = 48
}

/// One quiet header row: #, Title, Plays, Time (12, tertiary). At the accessibility sizes the plays
/// and time sit under each title, so only # and Title remain. Hidden from VoiceOver: the columns are
/// a visual aid and each row reads itself in full.
struct ReleaseTrackHeader: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .caption) private var size: CGFloat = 12
    private let columns = TrackColumns()

    var body: some View {
        let accessible = dynamicTypeSize.isAccessibilitySize
        HStack(spacing: Theme.Track.spacing) {
            Text(Copy.Detail.colNumber)
                .frame(width: accessible ? nil : columns.number, alignment: .leading)
                .fixedSize(horizontal: accessible, vertical: false)
            Text(Copy.Detail.colTitle).frame(maxWidth: .infinity, alignment: .leading)
            if !accessible {
                Text(Copy.Detail.colPlays).frame(width: columns.plays, alignment: .trailing)
                Text(Copy.Detail.colTime).frame(width: columns.time, alignment: .trailing)
            }
        }
        .font(.system(size: size))
        .foregroundStyle(Theme.textDim)
        .accessibilityHidden(true)
    }
}

/// A track in view mode: the number, the title over the artist, then plays and time (tabular,
/// right-aligned). At the accessibility sizes plays and time move under the title as one line.
struct ReleaseTrackRow: View {
    let number: Int
    let title: String
    let artist: String
    let plays: Int?
    let time: String?
    let timeSpoken: String?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var titleSize: CGFloat = 16
    @ScaledMetric(relativeTo: .footnote) private var artistSize: CGFloat = 13
    @ScaledMetric(relativeTo: .subheadline) private var numberSize: CGFloat = 14
    private let columns = TrackColumns()

    var body: some View {
        let accessible = dynamicTypeSize.isAccessibilitySize
        HStack(alignment: .firstTextBaseline, spacing: Theme.Track.spacing) {
            Text("\(number)")
                .font(.system(size: numberSize).monospacedDigit())
                .foregroundStyle(Theme.textDim)
                .frame(width: accessible ? nil : columns.number, alignment: .leading)
                .fixedSize(horizontal: accessible, vertical: false)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: titleSize, weight: .semibold))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(accessible ? nil : 1)
                    .truncationMode(.tail)
                Text(artist)
                    .font(.system(size: artistSize))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(accessible ? nil : 1)
                    .truncationMode(.tail)
                if accessible, let line = TrackRowLine.playsAndTime(plays: plays, time: time) {
                    Text(line)
                        .font(.system(size: artistSize).monospacedDigit())
                        .foregroundStyle(Theme.secondaryText)
                        .accessibilityLabel(TrackRowLine.playsAndTime(plays: plays, time: timeSpoken ?? time) ?? line)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !accessible {
                Text(plays.map(String.init) ?? "")
                    .accessibilityLabel(plays.map(Copy.Detail.playCount) ?? "")
                    .frame(width: columns.plays, alignment: .trailing)
                Text(time ?? "")
                    .accessibilityLabel(timeSpoken ?? time ?? "")
                    .frame(width: columns.time, alignment: .trailing)
            }
        }
        .font(.system(size: numberSize).monospacedDigit())
        .foregroundStyle(Theme.secondaryText)
        .frame(minHeight: Theme.Track.minHeight)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("track-row-\(number)")
    }
}
