import SwiftUI

/// Where the queue is drawn: in the collection page's `List`, or in the record player's page (a lazy stack).
enum CollectionQueueLayout {
    case list, page
}

/// A collection's header (#350, shared with the record player in #352): its name in full (no line limit, so a long name
/// is read here in full), the count, and "Edit collection" when the screen has no Edit button of its own.
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let control = CollectionPlayControl(model: model, id: collection.id, playback: playback)
        let summary = model.summary(collection.id)
        let tracks = summary?.tracks ?? model.trackCount(of: collection)
        let text = VStack(alignment: showsCover ? .center : .leading, spacing: 4) {
            Text(collection.name)
                .themeFont(.pageTitle)
                .foregroundStyle(Theme.primaryText)
                .multilineTextAlignment(showsCover ? .center : .leading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("collection-queue-title")
            Text(countLine(tracks: tracks, seconds: summary?.playableSeconds))
                .themeFont(.meta)
                .foregroundStyle(Theme.secondaryText)
            if !isEditing { editButton }
        }
        Group {
            if showsCover {
                // Like the release page: the sleeve with its disc, then the name and the count.
                VStack(spacing: 16) {
                    CollectionSleeveView(model: model, collection: collection, isEditing: isEditing)
                    text
                }
                .frame(maxWidth: .infinity)
            } else {
                // The record player: a small sleeve beside the name; the cover plays the collection here too.
                let sleeve = CollectionSleeveView(model: model, collection: collection, isEditing: isEditing, side: 64)
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 12) { sleeve; text }.frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    HStack(alignment: .center, spacing: 16) {
                        sleeve
                        text.frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .padding(.vertical, 8)
        .onChange(of: playback?.wontPlayTrackIDs ?? []) { old, new in control.announceNewlyMissing(old: old, new: new) }
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
/// player (#352): one plain list in the collection's order (no sides), rows that keep "On your Mac" dimming, the accent
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
    @Environment(\.openSong) private var openSong
    /// "Add to collection" from a row's long-press menu (#364).
    @State private var addTarget: (rowID: String, target: AddToCollectionTarget)?
    /// The queue row's number column (minWidth 24) plus its 12 gap: where the title starts; it grows with the text.
    @ScaledMetric(relativeTo: .footnote) private var numberColumnWidth: CGFloat = 24

    private var control: CollectionPlayControl { CollectionPlayControl(model: model, id: collection.id, playback: playback) }

    var body: some View {
        let rows = model.rows(of: collection)
        queueSections(rows)
        if !rows.isEmpty { playlistGuide }
    }


    // MARK: Queue

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
            Section {
                ForEach(CollectionQueue.numbered(rows), id: \.row.id) { entry in
                    let row = entry.row
                    queueRow(row, number: entry.number, playablePosition: entry.playablePosition)
                        .trackActions(rowActions(row))
                        .sheet(item: addSheetBinding(for: row)) { target in
                            AddToCollectionSheet(model: model, items: target.items) { addTarget = nil }
                        }
                        .modifier(QueueRowChrome(layout: layout))
                }
            }
        }
    }

    /// The long-press menu of a queue row (#364): queue it, add it to a collection, or open its song page (#365). Other navigation items wait for part B.
    private func rowActions(_ row: CollectionQueue.Row) -> TrackActions? {
        guard let release = model.releases[row.releaseID] else { return nil }
        let route = SongRoute(release: release, trackId: row.trackID)
        return TrackActions(
            target: .track(releaseId: row.releaseID, trackId: row.trackID), release: release,
            addToCollection: { addTarget = (row.id, AddToCollectionTarget(items: [.track(releaseId: row.releaseID, trackId: row.trackID)])) },
            songInfo: openSong.map { open in { open(route) } }
        )
    }

    /// Only the row that was long-pressed presents the sheet.
    private func addSheetBinding(for row: CollectionQueue.Row) -> Binding<AddToCollectionTarget?> {
        Binding(
            get: { addTarget?.rowID == row.id ? addTarget?.target : nil },
            set: { if $0 == nil { addTarget = nil } }
        )
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
