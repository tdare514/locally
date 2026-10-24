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

/// The meta line, title, artist and "Release date 17 May 2024   Genre Rap" (an empty value is left out).
/// At the accessibility sizes, or when the two do not fit one line, they each take their own line.
struct ReleaseDetailsView: View {
    let kind: ReleaseKind
    let trackCount: Int
    let title: String
    let artist: String
    /// A single's featured artists (#287): a "Featuring B, C" line, left out when there are none.
    var featuring: [String] = []
    /// The typed date text, shown formatted when it reads as a date (a legacy year as stored).
    let releaseDate: String
    let genre: String

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.openURL) private var openURL
    @ScaledMetric(relativeTo: .largeTitle) private var titleSize: CGFloat = 30
    @ScaledMetric(relativeTo: .title3) private var artistSize: CGFloat = 18
    @ScaledMetric(relativeTo: .footnote) private var metaSize: CGFloat = 13
    @ScaledMetric(relativeTo: .subheadline) private var pairSize: CGFloat = 14

    private var pairs: [(label: String, value: String)] {
        let date = ReleaseDateText.parse(releaseDate).date?.formatted() ?? releaseDate
        return [(Copy.Detail.releaseDateLabel, date), (Copy.Detail.genreLabel, genre)].filter { !$0.value.isEmpty }
    }

    private func pairView(_ pair: (label: String, value: String)) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(pair.label).foregroundStyle(Theme.secondaryText)
            Text(pair.value).foregroundStyle(Theme.primaryText)
        }
        .accessibilityElement(children: .combine)
    }

    private var stackedPairs: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(pairs, id: \.label) { pairView($0) }
        }
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
                artistLine
            }
            if !featuring.isEmpty {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(Copy.Featuring.field).foregroundStyle(Theme.secondaryText)
                    Text(ArtistLink.featuringList(featuring, linked: true, color: Theme.primaryText))
                        .tint(Theme.primaryText)
                }
                .font(.system(size: pairSize))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
                .accessibilityElement(children: .contain)
            }
            if !pairs.isEmpty {
                Group {
                    if dynamicTypeSize.isAccessibilitySize {
                        stackedPairs
                    } else {
                        // Side by side while they fit on one line, else stacked.
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .firstTextBaseline, spacing: 20) {
                                ForEach(pairs, id: \.label) { pairView($0).fixedSize(horizontal: true, vertical: false) }
                            }
                            stackedPairs
                        }
                    }
                }
                .font(.system(size: pairSize))
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension ReleaseDetailsView {
    /// View mode only (#288): the artist's name with a small chevron is one tap target that opens
    /// their page; a release artist of "A feat. B" keeps B as linked dim text under it.
    @ViewBuilder
    fileprivate var artistLine: some View {
        let credit = ArtistNames.splitArtistFeaturing(artist)
        VStack(alignment: .leading, spacing: 2) {
            Button {
                if let url = ArtistLink.url(forName: credit.artist) { openURL(url) }
            } label: {
                HStack(spacing: 6) {
                    Text(credit.artist)
                        .font(.system(size: artistSize, weight: .semibold))
                        .foregroundStyle(Theme.primaryText.opacity(0.85))
                    LocallyIcon(.chevronRight, size: artistSize * 0.6, scaled: false)
                        .foregroundStyle(Theme.textDim)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Copy.Artists.openLabel(credit.artist))
            .accessibilityAddTraits(.isLink)
            if !credit.featuring.isEmpty {
                Text(ArtistLink.featuringSuffix(credit.featuring, linked: true, color: Theme.secondaryText))
                    .font(.system(size: pairSize))
                    .tint(Theme.secondaryText)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
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

/// What a view-mode row needs to play its track (#336). Nil on a row that can't play (an adopted release).
struct TrackPlayControl {
    /// This row's track is the one in the player.
    var isCurrent: Bool
    var isPlaying: Bool
    /// Its file was gone when its turn came.
    var isMissing: Bool
    var action: () -> Void
}

/// A track in view mode: the number, the title over the artist, then plays and time (tabular,
/// right-aligned). At the accessibility sizes plays and time move under the title as one line.
struct ReleaseTrackRow: View {
    let number: Int
    let title: String
    /// An album track's featured artists (#287), dimmed after the title as "feat. B & C".
    var featuring: [String] = []
    let artist: String
    let plays: Int?
    let time: String?
    let timeSpoken: String?
    /// Set where the track can play: the number becomes a 44 pt play button.
    var play: TrackPlayControl?
    /// 0 to 1: how far the number has turned white (#362). Opacity only.
    var highlight: Double = 0

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var titleSize: CGFloat = 16
    @ScaledMetric(relativeTo: .footnote) private var artistSize: CGFloat = 13
    @ScaledMetric(relativeTo: .subheadline) private var numberSize: CGFloat = 14
    private let columns = TrackColumns()

    var body: some View {
        let accessible = dynamicTypeSize.isAccessibilitySize
        HStack(alignment: .firstTextBaseline, spacing: Theme.Track.spacing) {
            numberCell(accessible: accessible)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .foregroundStyle(Theme.primaryText)
                    .font(.system(size: titleSize, weight: .semibold))
                    .lineLimit(accessible ? nil : 1)
                    .truncationMode(.tail)
                // View mode only (#288): "A, feat. B & C", every name its own link, wrapping.
                ArtistLineText(
                    main: credit.artist, featuring: credit.featuring, linkMain: artist != Copy.Detail.unknownArtist,
                    font: .system(size: artistSize), mainColor: Theme.secondaryText, dimColor: Theme.secondaryText
                )
                if play?.isMissing == true {
                    Text(Copy.Playback.fileMissing)
                        .font(.system(size: artistSize))
                        .foregroundStyle(Theme.textDim)
                }
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
        // The artist line holds links, which a combined element would swallow.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("track-row-\(number)")
    }

    /// The number, or with a play control the same number as a 44 pt button (it reaches into the row's
    /// inset and the gap before the title, so the column keeps its width). The current track shows a
    /// static `waveform` in the accent colour while it plays, and a `play.fill` in the accent while paused.
    @ViewBuilder
    private func numberCell(accessible: Bool) -> some View {
        if let play {
            let hit = Theme.Track.discMenuHitSize
            let reach = accessible ? 0 : max(0, (hit - columns.number) / 2)
            let playing = play.isCurrent && play.isPlaying
            Button(action: play.action) {
                Group {
                    if playing {
                        Image(systemName: "waveform")
                            .font(.system(size: numberSize, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                    } else if play.isCurrent {
                        // Paused on this row: a quiet play glyph says where a tap goes. The rest of the row
                        // is not a play target because the artist names in it are links (#288).
                        Image(systemName: "play.fill")
                            .font(.system(size: numberSize - 2, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                    } else {
                        Text("\(number)")
                            .font(.system(size: numberSize).monospacedDigit())
                            .foregroundStyle(Theme.textDim)
                            .overlay { accentNumber }
                    }
                }
                .accessibilityHidden(true)
                .padding(.leading, reach)
                .frame(minWidth: hit, maxWidth: accessible ? nil : hit, minHeight: hit, alignment: .leading)
                .fixedSize()
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.leading, -reach)
            .padding(.trailing, -reach)
            .accessibilityLabel(playing ? Copy.Playback.pause(title) : Copy.Playback.play(title))
            .accessibilityIdentifier("track-play-\(number)")
        } else {
            Text("\(number)")
                .font(.system(size: numberSize).monospacedDigit())
                .foregroundStyle(Theme.textDim)
                .frame(width: accessible ? nil : columns.number, alignment: .leading)
                .fixedSize(horizontal: accessible, vertical: false)
                .overlay { accentNumber }
        }
    }

    /// The number again in white semibold, faded in over the dim one while the row is highlighted.
    private var accentNumber: some View {
        Text("\(number)")
            .font(.system(size: numberSize, weight: .semibold).monospacedDigit())
            .foregroundStyle(.white)
            .opacity(highlight)
            .fixedSize()
            .accessibilityHidden(true)
    }

    private var credit: (artist: String, featuring: [String]) {
        let split = ArtistNames.splitArtistFeaturing(artist)
        return (split.artist, FeaturingNames.merged(featuring, split.featuring))
    }
}
