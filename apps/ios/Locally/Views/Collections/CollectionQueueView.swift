import SwiftUI

/// Where the queue is drawn: in the collection page's `List`, or in the record player's page (a lazy stack).
enum CollectionQueueLayout {
    case list, page
}

/// A collection's header (#350, shared with the record player in #352): its name in full (no line limit, so a long name
/// is read here in full), the count, Play / Pause, and "Edit collection" when the screen has no Edit button of its own.
struct CollectionQueueHeader: View {
    let model: CollectionsModel
    let collection: MusicCollection
    var showsCover = true
    /// The record player adds the length ("27 tracks, 1 hr 56 min"); the page keeps the count alone.
    var showsLength = false
    var isEditing = false
    /// "Edit collection": the player's way into the edit mode that the collection page opens from its toolbar.
    var onEdit: (() -> Void)?
    @Environment(\.playback) private var playback

    var body: some View {
        let control = CollectionPlayControl(model: model, id: collection.id, playback: playback)
        let summary = model.summary(collection.id)
        let tracks = summary?.tracks ?? model.trackCount(of: collection)
        HStack(spacing: 16) {
            if showsCover {
                CollectionCoverView(releaseIDs: model.coverReleaseIDs(of: collection), side: 88)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(collection.name)
                    .themeFont(.pageTitle)
                    .foregroundStyle(Theme.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("collection-queue-title")
                Text(countLine(tracks: tracks, seconds: summary?.playableSeconds))
                    .themeFont(.meta)
                    .foregroundStyle(Theme.secondaryText)
                if !isEditing {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 16) { playButton(control); editButton }.fixedSize(horizontal: true, vertical: false)
                        VStack(alignment: .leading, spacing: 8) { playButton(control); editButton }
                    }
                    .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 8)
        .onChange(of: playback?.wontPlayTrackIDs ?? []) { old, new in control.announceNewlyMissing(old: old, new: new) }
    }

    /// Play / Pause keeps its words on one line; the row of buttons drops to a column when they don't fit side by side.
    private func playButton(_ control: CollectionPlayControl) -> some View {
        Button(action: control.togglePlay) {
            Label(CollectionPlayState.pillLabel(isCurrentQueue: control.isPlayingThis, isPlaying: control.isPlaying),
                  systemImage: control.isPlayingNow ? "pause.fill" : "play.fill")
        }
        .accessibilityLabel(CollectionPlayState.pillLabel(isCurrentQueue: control.isPlayingThis, isPlaying: control.isPlaying))
        .buttonStyle(CollectionPillButtonStyle())
        .disabled(control.playQueue.isEmpty)
        .fixedSize(horizontal: true, vertical: false)
    }

    @ViewBuilder
    private var editButton: some View {
        if let onEdit {
            Button(action: onEdit) {
                Text(Copy.Collections.editCollection)
                    .themeFont(.body)
                    .foregroundStyle(Theme.primaryText)
                    .underline()
                    .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
        }
    }

    private func countLine(tracks: Int, seconds: Double?) -> String {
        let length = showsLength ? RecordWheel.durationLabel(seconds) : ""
        return length.isEmpty ? Copy.Collections.trackCount(tracks) : "\(Copy.Collections.trackCount(tracks)), \(length)"
    }
}

/// The collection's queue and its "Make it a playlist" guide (#350, #353), shared by the collection page and the record
/// player (#352): Side A and Side B (the queue split in half), rows that keep "On your Mac" dimming, the accent
/// now-playing row and "Couldn't play this track" with Try again, then the guide. Its body is several rows, so it sits
/// directly in a `List` or a stack.
struct CollectionQueueRows: View {
    let model: CollectionsModel
    let collection: MusicCollection
    var layout: CollectionQueueLayout = .list
    @Binding var isGuideOpen: Bool
    var onAddTracks: () -> Void

    static let guideID = "playlist-guide"

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.playback) private var playback
    /// The queue row's number column (minWidth 24) plus its 12 gap: where the title starts; it grows with the text.
    @ScaledMetric(relativeTo: .footnote) private var numberColumnWidth: CGFloat = 24

    private var control: CollectionPlayControl { CollectionPlayControl(model: model, id: collection.id, playback: playback) }

    var body: some View {
        let rows = model.rows(of: collection)
        queueSections(rows)
        if !rows.isEmpty { playlistGuide }
    }

    // MARK: Queue

    /// A section header that sticks while the list scrolls: it carries the page's own opaque background, full width, so rows pass under it cleanly.
    private func stickyHeader(_ title: String) -> some View {
        Text(title)
            .themeFont(.sectionTitle)
            .foregroundStyle(Theme.primaryText)
            .textCase(nil)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
            .padding(.horizontal, layout == .list ? 20 : 0)
            .background(Theme.background)
            .listRowInsets(EdgeInsets())
            .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder
    private func queueSections(_ rows: [CollectionQueue.Row]) -> some View {
        if rows.isEmpty {
            VStack(spacing: 16) {
                Text(Copy.Collections.emptyCollection)
                    .themeFont(.body)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
                Button(action: onAddTracks) { Text(Copy.Collections.addTracks) }
                    .buttonStyle(CollectionPillButtonStyle())
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 24)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        } else {
            if !rows.contains(where: \.isHeld) {
                Text(Copy.Collections.nonePlayable)
                    .themeFont(.body)
                    .foregroundStyle(Theme.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            let half = CollectionQueue.sideACount(rows.count)
            side(Copy.Collections.sideA, rows: rows, range: 0..<half)
            if half < rows.count { side(Copy.Collections.sideB, rows: rows, range: half..<rows.count) }
        }
    }

    private func side(_ title: String, rows: [CollectionQueue.Row], range: Range<Int>) -> some View {
        Section {
            ForEach(range, id: \.self) { index in
                let row = rows[index]
                // The row's place among the playable ones: where Play starts from.
                let playablePosition: Int? = row.isHeld ? rows[..<index].filter(\.isHeld).count : nil
                queueRow(row, number: index + 1, playablePosition: playablePosition)
                    .modifier(QueueRowChrome(layout: layout))
            }
        } header: {
            stickyHeader(title)
        }
    }

    @ViewBuilder
    private func queueRow(_ row: CollectionQueue.Row, number: Int, playablePosition: Int?) -> some View {
        let control = control
        let isPlaying = control.isPlaying
        let nowPlaying = control.isNowPlaying(playablePosition: playablePosition, row)
        if let playablePosition, playback?.wontPlay(row.trackID) == true {
            VStack(alignment: .leading, spacing: 8) {
                queueRowContent(row, number: number, nowPlaying: false, wontPlay: true)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(row.title), \(row.artist), \(Copy.Collections.couldntPlay)")
                Button(Copy.Collections.tryAgain) { control.start(at: playablePosition) }
                    .buttonStyle(CollectionPillButtonStyle())
                    // Under the title: past the number column and its gap.
                    .padding(.leading, numberColumnWidth + 12)
            }
        } else if let playablePosition {
            Button { control.tapRow(row, playablePosition: playablePosition, nowPlaying: nowPlaying) } label: {
                queueRowContent(row, number: number, nowPlaying: nowPlaying)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CollectionPlayState.rowLabel([row.title, row.artist, TrackLength.spoken(row.durationSec)].compactMap { $0 }.joined(separator: ", "), isCurrentRow: nowPlaying, isPlaying: isPlaying))
            .accessibilityValue(CollectionPlayState.rowValue(isCurrentRow: nowPlaying, isPlaying: isPlaying))
            .accessibilityAddTraits(nowPlaying ? .isSelected : [])
        } else {
            queueRowContent(row, number: number, nowPlaying: false)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(row.title), \(row.artist), \(Copy.Collections.onYourMac)")
                .accessibilityValue(TrackLength.spoken(row.durationSec) ?? "")
        }
    }

    private func queueRowContent(_ row: CollectionQueue.Row, number: Int, nowPlaying: Bool, wontPlay: Bool = false) -> some View {
        HStack(spacing: 12) {
            Group {
                if nowPlaying {
                    Image(systemName: control.isPlaying ? "speaker.wave.2.fill" : "pause.fill")
                        .foregroundStyle(Theme.accent)
                } else {
                    Text("\(number)")
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
            }
            .themeFont(.meta)
            .frame(minWidth: numberColumnWidth, alignment: .trailing)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .themeFont(.rowTitle)
                    .foregroundStyle(nowPlaying ? Theme.Tint.accentText : Theme.primaryText)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                Text(row.isHeld ? row.artist : Copy.Collections.onYourMac)
                    .themeFont(.rowSubtitle)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                if dynamicTypeSize.isAccessibilitySize, let length = TrackLength.format(row.durationSec) {
                    Text(length)
                        .themeFont(.meta)
                        .foregroundStyle(Theme.secondaryText)
                        .monospacedDigit()
                        .accessibilityHidden(true)
                }
                if wontPlay {
                    Text(Copy.Collections.couldntPlay)
                        .themeFont(.rowSubtitle)
                        .foregroundStyle(Theme.danger)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // At the accessibility sizes the length goes under the artist, so the title keeps the room (no mid-word breaks).
            if let length = TrackLength.format(row.durationSec), !dynamicTypeSize.isAccessibilitySize {
                Text(length)
                    .themeFont(.meta)
                    .foregroundStyle(Theme.secondaryText)
                    .monospacedDigit()
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .contentShape(.rect)
        .opacity(row.isHeld ? 1 : 0.5)
    }

    // MARK: Make it a playlist

    /// "Make it a playlist" (#353), the release page's disclosure over this collection's tracks that this phone holds.
    private var playlistGuide: some View {
        let guide = CollectionQueue.playlistGuide(collection.items, releases: model.releases)
        return DisclosureGroup(Copy.Detail.makeItAPlaylist, isExpanded: $isGuideOpen) {
            if guide.titles.isEmpty {
                Text(Copy.Collections.nothingToAdd)
                    .themeFont(.body)
                    .foregroundStyle(Theme.secondaryText)
            } else {
                PlaylistGuide(
                    albumTitle: collection.name,
                    trackTitles: guide.titles,
                    note: guide.leftOut > 0 ? Copy.Collections.leftOutOfGuide(guide.leftOut) : nil
                )
            }
        }
        .themeFont(.body)
        .foregroundStyle(Theme.primaryText)
        .frame(minHeight: Theme.Immersive.panelActionMinHeight)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .id(Self.guideID)
    }
}

/// A queue row's surface: in a `List` the list draws it (row background and separator); in the page's stack the row
/// carries a panel fill and a hairline itself.
private struct QueueRowChrome: ViewModifier {
    let layout: CollectionQueueLayout

    func body(content: Content) -> some View {
        content
            .listRowBackground(Theme.Immersive.panelFill)
            .listRowSeparatorTint(Theme.Track.separatorTint)
            .padding(.horizontal, layout == .page ? 12 : 0)
            .background(layout == .page ? Theme.Immersive.panelFill : Color.clear)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Theme.Track.separatorTint).frame(height: 1)
                    .opacity(layout == .page ? 1 : 0)
            }
    }
}
