import SwiftUI

/// A song's page (#365), variant a4: the cover's colours wash the page, the cover is a record sleeve that plays the
/// song (the disc turns only while it plays), then the title, the linked artist line and four bare actions. The
/// details sit on their own opaque panel rising over the bottom of the wash: Plays, In collections, On the album, File.
/// An adopted (details-only) song dims the sleeve, drops Edit and says where to edit it.
///
/// The host opens it (title tap, "Song info", a Stats row) and passes `onEdit` to show Edit and `onOpenCollection` to
/// let the collection sleeves open their collection; without them those parts are hidden or plain.
struct SongPageView: View {
    let release: Release
    let trackID: UUID
    var onEdit: (() -> Void)?
    var onOpenCollection: ((UUID) -> Void)?
    /// The Album row opens the release at this song; without it the row is plain.
    var onOpenAlbum: (() -> Void)?
    /// The "Last played" line opens History on that day (`YYYY-MM-DD`, #399); without it the line is plain.
    var onOpenHistory: ((String) -> Void)?
    /// Opens scrolled to the bottom (the gallery's bottom frame).
    var startsAtEnd = false

    @Environment(\.appContainer) private var container
    @Environment(\.playback) private var playback
    @Environment(\.queueToast) private var toast
    @Environment(\.dynamicTypeSize) private var typeSize

    @State private var loader: SongPageLoader?
    @State private var collectionsModel: CollectionsModel?
    @State private var coverImage: UIImage?
    @State private var palette = AmbientPalette.neutral
    @State private var addTarget: AddToCollectionTarget?
    @State private var shareTarget: ShareTarget?

    init(release: Release, trackID: UUID, onEdit: (() -> Void)? = nil, onOpenCollection: ((UUID) -> Void)? = nil,
         onOpenAlbum: (() -> Void)? = nil, onOpenHistory: ((String) -> Void)? = nil, loader: SongPageLoader? = nil, collectionsModel: CollectionsModel? = nil, startsAtEnd: Bool = false) {
        self.release = release
        self.trackID = trackID
        self.onEdit = onEdit
        self.onOpenCollection = onOpenCollection
        self.onOpenAlbum = onOpenAlbum
        self.onOpenHistory = onOpenHistory
        self.startsAtEnd = startsAtEnd
        _loader = State(initialValue: loader)
        _collectionsModel = State(initialValue: collectionsModel)
    }

    private var model: SongPageModel? {
        SongPageModel(
            release: release, trackID: trackID, plays: loader?.plays, collections: collectionsModel?.collections ?? [],
            readLength: loader?.readLength, fileSize: loader?.fileSize, today: loader?.today ?? ""
        )
    }

    var body: some View {
        ZStack {
            ArtworkBackdrop(palette: palette)
            if let model {
                ScrollView {
                    VStack(spacing: 0) {
                        hero(model)
                        panel(model)
                    }
                    .frame(maxWidth: .infinity)
                }
                .ignoresSafeArea(edges: .bottom)
                .defaultScrollAnchor(startsAtEnd ? .bottom : .top)
            }
        }
        .foregroundStyle(Theme.primaryText)
        .task { await start() }
        .onChange(of: playback?.wontPlay(trackID) ?? false) { old, new in
            if new && !old {
                AccessibilityNotification.Announcement("\(Copy.Collections.couldntPlay). \(Copy.Collections.tryAgain)").post()
            }
        }
        .sheet(item: $addTarget) { target in
            if let collectionsModel {
                AddToCollectionSheet(model: collectionsModel, items: target.items) { addTarget = nil }
            }
        }
        .sheet(item: $shareTarget) { target in
            if let container {
                ShareSheet(
                    model: ShareSheetModel(
                        releaseId: release.id, subject: target.subject, trackIds: target.trackId.map { [$0] },
                        isSignedIn: container.syncAccount.deviceToken != nil, api: container.syncApi, groupStore: UserDefaultsShareGroupStore()),
                    coverImage: coverImage
                ) { shareTarget = nil }
            }
        }
    }

    /// Loads the cover and its palette, the collections, the plays and the file facts; each part appears as it lands.
    private func start() async {
        if let container {
            if collectionsModel == nil { collectionsModel = container.makeCollectionsModel() }
            if loader == nil { loader = SongPageLoader(container: container) }
            let store = container.coverStore
            let id = release.id
            let data = await Task.detached(priority: .utility) { store.load(id) }.value
            coverImage = data.flatMap(UIImage.init(data:))
            palette = await Task.detached { ArtworkPalette.palette(forCover: data) }.value
        }
        collectionsModel?.reload()
        await loader?.load(release: release, trackID: trackID)
    }

    private var tint: Color { SongPageTint.color(palette: coverImage == nil ? nil : palette) }

    // MARK: Hero

    private func hero(_ model: SongPageModel) -> some View {
        let isCurrent = playback?.isCurrent(trackID, in: release) ?? false
        let isPlaying = playback?.isPlaying ?? false
        let action = SongSleeveAction.resolve(canPlay: model.canPlay, isCurrent: isCurrent, isPlaying: isPlaying)
        return VStack(spacing: 12) {
            SpinningSleeve(
                side: Theme.SongPage.sleeveHero, discCover: coverImage, isPlaying: isCurrent && isPlaying, isInert: action == .inert,
                label: action.label(title: model.title), hint: action.hint,
                onPress: { playback?.tapRow(release: release, trackID: trackID) }
            ) { side in
                SongCoverArt(image: coverImage, side: side)
            }
            .padding(.bottom, 4)
            Text(model.title)
                .font(Theme.ScaledFont.largeTitle)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            ArtistLineText(main: model.artist, featuring: model.featuring, font: .title3, mainColor: .white, dimColor: Theme.secondaryText)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
            SongActionRow(actions: actions(model), tint: tint)
                .padding(.top, 8)
            if model.canPlay, playback?.wontPlay(trackID) == true {
                playbackFailure
            }
            if !model.canEdit {
                Text(Copy.SongPage.editOnMac)
                    .font(Theme.ScaledFont.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, Theme.SongPage.pageGutter)
        .padding(.top, 16)
        .padding(.bottom, 28)
    }

    /// The file is missing or will not decode: the collection page's wording, then Try again as a bare action.
    private var playbackFailure: some View {
        VStack(spacing: 8) {
            Text(Copy.Collections.couldntPlay)
                .font(Theme.ScaledFont.subheadline)
                .foregroundStyle(Theme.danger)
                .multilineTextAlignment(.center)
            // The action row's bare glyph over a label (its caption font is footnote).
            Button { playback?.play(release: release, startingAt: trackID) } label: { Text(Copy.Collections.tryAgain) }
                .buttonStyle(SongBareActionStyle(icon: "arrow.clockwise", label: Copy.Collections.tryAgain, tint: tint))
                .accessibilityLabel(Copy.Collections.tryAgain)
                .frame(minWidth: 44, minHeight: 44)
        }
        .padding(.top, 4)
    }

    // MARK: Actions

    /// Collection and Play next always; Share for a song of the user's own (an adopted song's file is not on the
    /// server, and a received one can only be reshared whole); Edit when the host offers it for a phone-held song.
    private func actions(_ model: SongPageModel) -> [SongAction] {
        var items = [
            SongAction(label: Copy.SongPage.collection, icon: "text.badge.plus") {
                addTarget = AddToCollectionTarget(items: [.track(releaseId: release.id, trackId: trackID)])
            },
            SongAction(label: Copy.SongPage.playNext, icon: "text.line.first.and.arrowtriangle.forward") { playNext() },
        ]
        if model.canShare && release.sharedFrom == nil {
            items.append(SongAction(label: Copy.SongPage.share, icon: "square.and.arrow.up") {
                shareTarget = ShareTarget(trackId: trackID, subject: model.title)
            })
        }
        if model.canEdit, let onEdit {
            items.append(SongAction(label: Copy.SongPage.edit, icon: "pencil", run: onEdit))
        }
        return items
    }

    /// The same queueing and toast as the long-press menu's Play next.
    private func playNext() {
        guard let playback else { return }
        let actions = TrackActions(target: .track(releaseId: release.id, trackId: trackID), release: release)
        let cover = container?.coverStore.load(release.id)
        if let message = actions.queue(playback, next: true, cover: cover) { toast?.show(message) }
    }

    // MARK: Panel

    private func panel(_ model: SongPageModel) -> some View {
        VStack(alignment: .leading, spacing: 32) {
            if let total = model.playsTotal {
                group(Copy.SongPage.plays) { plays(model, total: total) }
            }
            group(Copy.SongPage.inCollections) { collections(model) }
            group(Copy.SongPage.onTheAlbum) { SongFactRows(rows: albumRows(model), links: albumLinks) }
            group(Copy.SongPage.file) { SongFactRows(rows: fileRows(model)) }
        }
        .padding(.horizontal, Theme.SongPage.pageGutter)
        .padding(.top, 36)
        .padding(.bottom, 48)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { SongDetailsPanelBackground() }
    }

    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.secondaryText)
                .accessibilityAddTraits(.isHeader)
            content()
        }
    }

    private func albumRows(_ model: SongPageModel) -> [(String, String)] {
        var rows = [(Copy.SongPage.album, model.album), (Copy.SongPage.track, model.trackText)]
        if let disc = model.discText { rows.append((Copy.SongPage.disc, disc)) }
        if let genre = model.genre { rows.append((Copy.SongPage.genre, genre)) }
        if let released = model.releasedText { rows.append((Copy.SongPage.released, released)) }
        if let length = model.lengthText { rows.append((Copy.SongPage.length, length)) }
        return rows
    }

    /// The Album row opens the release at this song.
    private var albumLinks: [String: SongRowLink] {
        guard let onOpenAlbum else { return [:] }
        return [Copy.SongPage.album: SongRowLink(hint: Copy.SongPage.albumHint, open: onOpenAlbum)]
    }

    private func fileRows(_ model: SongPageModel) -> [(String, String)] {
        var rows = [(Copy.SongPage.fileName, model.fileName), (Copy.SongPage.format, model.formatName)]
        if let size = model.sizeText { rows.append((Copy.SongPage.size, size)) }
        rows.append((Copy.SongPage.livesOn, model.location))
        return rows
    }

    private func plays(_ model: SongPageModel, total: Int) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(total)")
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                    .monospacedDigit()
                Text(Copy.SongPage.playsUnit)
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            // An unknown date with plays on record leaves the line out rather than saying "Not played yet".
            if let line = model.lastPlayedText.map(Copy.SongPage.lastPlayedLine) ?? (model.neverPlayed ? Copy.SongPage.neverPlayed : nil) {
                lastPlayedLine(line, day: model.lastPlayedText == nil ? nil : model.lastPlayedDay)
            }
            SongPeriodBars(periods: model.periods, tint: tint)
        }
    }

    /// The line, plain or (with a last played day and a host that shows History) a button to that day. The line keeps
    /// its look and its place: a clear button over it reaches 44 pt tall (as the release page's song title does).
    @ViewBuilder
    private func lastPlayedLine(_ line: String, day: String?) -> some View {
        let text = Text(line).font(Theme.ScaledFont.subheadline).foregroundStyle(Theme.secondaryText)
        if let day, let onOpenHistory {
            text
                .accessibilityHidden(true)
                .overlay(alignment: .leading) {
                    Button { onOpenHistory(day) } label: {
                        Color.clear
                            .frame(maxWidth: .infinity, minHeight: Theme.History.minTarget)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(line)
                    .accessibilityHint(Copy.History.lastPlayedHint)
                    .accessibilityIdentifier("song-last-played")
                }
        } else {
            text
        }
    }

    @ViewBuilder
    private func collections(_ model: SongPageModel) -> some View {
        if model.collections.isEmpty {
            Text(Copy.SongPage.notInCollection)
                .font(Theme.ScaledFont.subheadline)
                .foregroundStyle(Theme.secondaryText)
        } else {
            SongWrapLayout(spacing: 18) {
                ForEach(model.collections) { ref in
                    SongCollectionSleeve(
                        ref: ref, releaseID: collectionsModel?.collection(ref.id).flatMap { collectionsModel?.coverReleaseIDs(of: $0).first },
                        onOpen: onOpenCollection.map { open in { open(ref.id) } })
                }
            }
        }
    }
}

// MARK: - Tint

/// The cover's brighter colour for the bars and the pressed glow: the palette's colours are dark by design (they wash
/// the page), so the brightest is lifted to a glow keeping its hue, as the release page's track highlight does.
enum SongPageTint {
    static func color(palette: AmbientPalette?) -> Color {
        guard let palette, let base = Theme.coverGlowColors(palette).max(by: { brightness($0) < brightness($1) }) else { return Theme.accent }
        var hue: CGFloat = 0, saturation: CGFloat = 0, value: CGFloat = 0
        UIColor(base).getHue(&hue, saturation: &saturation, brightness: &value, alpha: nil)
        return Color(hue: hue, saturation: saturation, brightness: max(value, Theme.Track.highlightMinBrightness))
    }

    private static func brightness(_ color: Color) -> CGFloat {
        var value: CGFloat = 0
        UIColor(color).getHue(nil, saturation: nil, brightness: &value, alpha: nil)
        return value
    }
}

// MARK: - Cover

/// The release cover on the sleeve; the no-cover square when it has none.
private struct SongCoverArt: View {
    let image: UIImage?
    let side: CGFloat

    var body: some View {
        Color.clear
            .frame(width: side, height: side)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    NoCoverArt()
                }
            }
            .clipShape(.rect(cornerRadius: Theme.Immersive.sleeveCornerRadius, style: .continuous))
            .accessibilityHidden(true)
    }
}

// MARK: - Actions

private struct SongAction: Identifiable {
    let label: String
    let icon: String
    let run: () -> Void
    var id: String { label }
}

/// A glyph over a label with nothing behind it. Pressed, both go to full white and a soft glow in the cover's accent
/// blooms behind the glyph, on the house easing (opacity only under Reduce Motion).
private struct SongBareActionStyle: ButtonStyle {
    let icon: String
    let label: String
    let tint: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .fill(tint)
                    .frame(width: 30, height: 30)
                    .blur(radius: Theme.SongPage.actionGlowRadius)
                    .opacity(pressed ? Theme.SongPage.actionGlowOpacity : 0)
                    .scaleEffect(pressed || reduceMotion ? 1 : 0.6)
                Image(systemName: icon)
                    .font(.system(size: Theme.SongPage.actionGlyphSize, weight: .regular))
                    .foregroundStyle(Color.white.opacity(pressed ? 1 : Theme.SongPage.actionGlyphOpacity))
            }
            .frame(height: 28)
            Text(label)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Color.white.opacity(pressed ? 1 : Theme.SongPage.actionLabelOpacity))
                .multilineTextAlignment(.center)
                // Capped at AX3: "Collection" would break mid-word in a half-width column at AX5.
                .dynamicTypeSize(...DynamicTypeSize.accessibility3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: typeSize.isAccessibilitySize ? Theme.SongPage.actionMinHeightLarge : Theme.SongPage.actionMinHeight)
        .frame(minWidth: Theme.SongPage.actionMinWidth)
        .contentShape(Rectangle())
        .animation(reduceMotion ? .linear(duration: 0.2) : Theme.SongPage.ease, value: pressed)
    }
}

/// Four columns at ordinary sizes; a 2 x 2 grid at the accessibility sizes.
private struct SongActionRow: View {
    let actions: [SongAction]
    let tint: Color
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                LazyVGrid(columns: [GridItem(.flexible(), alignment: .top), GridItem(.flexible(), alignment: .top)], spacing: 16) {
                    ForEach(actions) { button($0) }
                }
            } else {
                HStack(alignment: .top, spacing: 0) {
                    ForEach(actions) { button($0) }
                }
                // Two actions sit together instead of spreading across the page.
                .frame(maxWidth: CGFloat(actions.count) * 110)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func button(_ action: SongAction) -> some View {
        Button(action: action.run) { Text(action.label) }
            .buttonStyle(SongBareActionStyle(icon: action.icon, label: action.label, tint: tint))
            .accessibilityLabel(action.label)
    }
}

// MARK: - Panel pieces

/// The details surface: opaque near-black, 28 pt continuous top corners, a 1 pt highlight that follows the curve, and a
/// decorative grabber. It runs on below the content so a short page still ends on it.
private struct SongDetailsPanelBackground: View {
    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: Theme.SongPage.panelCornerRadius, bottomLeadingRadius: 0,
            bottomTrailingRadius: 0, topTrailingRadius: Theme.SongPage.panelCornerRadius, style: .continuous)
    }

    var body: some View {
        shape
            .fill(Theme.SongPage.panelFill)
            .overlay {
                shape.strokeBorder(Color.white.opacity(Theme.SongPage.panelHighlightOpacity), lineWidth: 1)
                    .mask(LinearGradient(stops: [.init(color: .white, location: 0), .init(color: .white, location: 0.02), .init(color: .clear, location: 0.12)], startPoint: .top, endPoint: .bottom))
            }
            .overlay(alignment: .top) {
                Capsule()
                    .fill(Color.white.opacity(Theme.SongPage.grabberOpacity))
                    .frame(width: Theme.SongPage.grabberWidth, height: Theme.SongPage.grabberHeight)
                    .padding(.top, 10)
                    .accessibilityHidden(true)
            }
            .padding(.bottom, -1200)
    }
}

/// A fact row that opens something: the action and the hint VoiceOver reads.
private struct SongRowLink {
    let hint: String
    let open: () -> Void
}

/// A label above or beside its value; stacks at accessibility sizes. With a link it is a button with a chevron.
private struct SongFactRow: View {
    let label: String
    let value: String
    var link: SongRowLink?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if let link {
            Button(action: link.open) { row(chevron: true) }
                .buttonStyle(.plain)
                .accessibilityHint(link.hint)
                .accessibilityIdentifier("song-row-\(label.lowercased())")
        } else {
            row(chevron: false)
        }
    }

    private func row(chevron: Bool) -> some View {
        HStack(spacing: 8) {
            Group {
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 2) { labelView; valueView }
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        labelView
                        Spacer(minLength: 12)
                        valueView.multilineTextAlignment(.trailing)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.secondaryText)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 12)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var labelView: some View {
        Text(label).font(Theme.ScaledFont.subheadline).foregroundStyle(Theme.secondaryText)
    }

    private var valueView: some View {
        Text(value).font(Theme.ScaledFont.value).foregroundStyle(Theme.primaryText).fixedSize(horizontal: false, vertical: true)
    }
}

/// Rows with a hairline between them.
private struct SongFactRows: View {
    let rows: [(String, String)]
    /// Rows that open something, by label.
    var links: [String: SongRowLink] = [:]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                if index > 0 {
                    Rectangle().fill(Color.white.opacity(Theme.SongPage.hairlineOpacity)).frame(height: 1).accessibilityHidden(true)
                }
                SongFactRow(label: row.0, value: row.1, link: links[row.0])
            }
        }
    }
}

/// A quiet bar in the cover's colour, filled to a fraction of its width. No GeometryReader.
private struct SongFractionBar: View {
    let fraction: Double
    let tint: Color

    var body: some View {
        Capsule().fill(.white.opacity(0.10))
            .frame(height: Theme.SongPage.barHeight)
            .overlay {
                SongFractionLayout(fraction: fraction) {
                    Capsule().fill(LinearGradient(colors: [tint.opacity(0.7), tint], startPoint: .leading, endPoint: .trailing))
                }
            }
            .accessibilityHidden(true)
    }
}

private struct SongFractionLayout: Layout {
    var fraction: Double

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        CGSize(width: proposal.width ?? 100, height: proposal.height ?? Theme.SongPage.barHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let width = max(Theme.SongPage.barHeight, bounds.width * min(max(fraction, 0), 1))
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: width, height: bounds.height))
    }
}

/// Plays by period as bars; the biggest period fills the row.
private struct SongPeriodBars: View {
    let periods: [SongPageModel.PeriodRow]
    let tint: Color

    var body: some View {
        let peak = Double(periods.map(\.plays).max() ?? 1)
        VStack(spacing: 14) {
            ForEach(Array(periods.enumerated()), id: \.offset) { _, row in
                VStack(spacing: 6) {
                    HStack {
                        Text(row.label).font(Theme.ScaledFont.subheadline).foregroundStyle(Theme.secondaryText)
                        Spacer(minLength: 8)
                        Text("\(row.plays)").font(Theme.ScaledFont.trackNumber).foregroundStyle(Theme.primaryText)
                    }
                    SongFractionBar(fraction: peak > 0 ? Double(row.plays) / peak : 0, tint: tint)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// A tiny sleeve with its disc half out and the collection's name under it. A button when the host can open it.
private struct SongCollectionSleeve: View {
    let ref: SongPageModel.CollectionRef
    let releaseID: UUID?
    let onOpen: (() -> Void)?
    @Environment(\.appContainer) private var container
    @State private var cover: UIImage?

    var body: some View {
        if let onOpen {
            Button(action: onOpen) { content }
                .buttonStyle(.plain)
                .accessibilityLabel(Copy.SongPage.openCollection(ref.name))
        } else {
            content.accessibilityElement(children: .combine)
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            RecordSleeve(cover: cover, size: Theme.SongPage.sleeveMini, showsAddCaption: false, onAddCover: {})
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            Text(ref.name)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.primaryText)
                .lineLimit(2)
                .frame(maxWidth: 140, alignment: .leading)
        }
        .frame(minHeight: 44, alignment: .top)
        .contentShape(Rectangle())
        .task(id: releaseID) {
            guard let releaseID, let store = container?.coverStore else { return }
            cover = await Task.detached(priority: .utility) { store.load(releaseID).flatMap { UIImage(data: $0) } }.value
        }
    }
}

/// Wraps its children onto new rows when they run out of width.
private struct SongWrapLayout: Layout {
    var spacing: CGFloat = 8

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (points: [CGPoint], size: CGSize) {
        var points: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (points, CGSize(width: widest, height: y + rowHeight))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(proposal.width ?? .infinity, subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(bounds.width, subviews)
        for (index, point) in result.points.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: .unspecified)
        }
    }
}
