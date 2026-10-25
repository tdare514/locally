import SwiftUI

/// Grouping for the Stats grid (port of `apps/web/src/lib/stats-layout.ts`). Pure.
enum StatsSeaLayout {
    /// Columns from the room the sea has: the Mac's container-query table, where the last rule that
    /// fits wins. The phone uses the first value for the whole grid (#361); the other two are the Mac's.
    /// A tile is never under 72 pt.
    static func columns(forWidth width: CGFloat) -> [Int] {
        let table: [(min: CGFloat, cols: [Int])] = [
            (150, [2, 2, 2]), (240, [2, 3, 3]), (324, [3, 4, 4]), (408, [3, 4, 5]), (492, [4, 5, 6]),
            (500, [3, 4, 5]), (564, [4, 5, 6]), (660, [5, 6, 7]), (756, [5, 7, 8]), (800, [5, 6, 7]),
            (852, [5, 7, 8]), (960, [6, 8, 9]), (1000, [5, 7, 8]), (1068, [6, 8, 9]), (1188, [7, 9, 10]),
            (1308, [7, 10, 11]),
        ]
        var cols = [2, 2, 2]
        for rule in table where width >= rule.min { cols = rule.cols }
        return cols
    }
}

/// The ranked list under the fan: one glass card of rows. Each row is one button.
struct StatsList: View {
    let items: [StatItem]
    var sort: StatsSort = .plays
    let today: String
    let round: Bool
    let cache: StatsCoverCache
    let ownerOf: (StatItem) -> UUID?
    let label: String
    let onOpen: (StatItem) -> Void
    /// The long-press menu of an item (#364); nil for an item with none (an artist).
    var actions: (StatItem) -> TrackActions? = { _ in nil }

    var body: some View {
        GlassCard {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { GlassDivider() }
                    StatsRow(item: item, sort: sort, today: today, round: round, owner: ownerOf(item), cache: cache, actions: actions(item)) { onOpen(item) }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

private struct StatsRow: View {
    let item: StatItem
    let sort: StatsSort
    let today: String
    let round: Bool
    let owner: UUID?
    let cache: StatsCoverCache
    /// The long-press menu (#364): on the row; its VoiceOver actions sit on the labelled button.
    let actions: TrackActions?
    let action: () -> Void

    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var rankWidth: CGFloat = 28

    /// The room the row has, measured behind it.
    @State private var rowWidth: CGFloat = 0

    private var stacked: Bool { typeSize.isAccessibilitySize || (rowWidth > 0 && rowWidth < Theme.Stats.narrowRow) }
    /// The last-played line only shows where the title still has room beside it.
    private var showsLastPlayed: Bool { rowWidth == 0 || rowWidth >= Theme.Stats.wideRow }

    /// A track's title without its "(feat. ...)" (the names move to the artist line); other rows keep theirs.
    private var plainTitle: String {
        guard item.trackId != nil else { return item.title }
        let plain = ArtistNames.splitFeaturing(item.title).title
        return plain.isEmpty ? item.title : plain
    }

    /// Tracks and albums carry their artist as the subtitle: it becomes the linked artist line (#288).
    /// A track's line also holds the features from its title, merged with any in an "A feat. B" artist.
    private var artistCredit: (artist: String, featuring: [String])? {
        guard item.releaseId != nil, !item.subtitle.isEmpty else { return nil }
        let split = ArtistNames.splitArtistFeaturing(item.subtitle)
        let fromTitle = item.trackId != nil ? ArtistNames.splitFeaturing(item.title).featuring : []
        return (split.artist, FeaturingNames.merged(fromTitle, split.featuring))
    }

    /// The row opens the release through a button behind it; the artist links sit on top, so no
    /// link is nested in a Button. VoiceOver reads the row as one element, then the artist links.
    var body: some View {
        HStack(alignment: stacked ? .top : .center, spacing: 12) {
            Text("\(item.rank)")
                .font(.system(.subheadline, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(StatsStyle.rankColor(item.medal))
                .frame(width: min(rankWidth, 56))
                .accessibilityHidden(true)
                .allowsHitTesting(false)
            StatsCoverView(owner: owner, cache: cache, round: round)
                .frame(width: Theme.Stats.rowCover, height: Theme.Stats.rowCover)
                .shadow(color: .black.opacity(0.5), radius: 6, y: 4)
                .allowsHitTesting(false)
            VStack(alignment: .leading, spacing: 2) {
                Text(plainTitle)
                    .font(.system(.body, weight: .semibold))
                    .foregroundStyle(StatsStyle.nameColor(item.medal))
                    .lineLimit(stacked ? 4 : 1)
                    .accessibilityHidden(true)
                    .allowsHitTesting(false)
                if let credit = artistCredit {
                    ArtistLineText(
                        main: credit.artist, featuring: credit.featuring, font: .subheadline,
                        mainColor: Theme.secondaryText, dimColor: Theme.secondaryText
                    )
                } else {
                    Text(item.subtitle)
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(stacked ? 3 : 1)
                        .accessibilityHidden(true)
                        .allowsHitTesting(false)
                }
                if stacked { numbers(alignment: .leading).padding(.top, 4).accessibilityHidden(true).allowsHitTesting(false) }
            }
            if !stacked {
                Spacer(minLength: 8)
                numbers(alignment: .trailing).fixedSize().accessibilityHidden(true).allowsHitTesting(false)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(minHeight: Theme.Stats.minTarget, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { rowWidth = $0 }
        .background {
            Button(action: action) { Color.clear.contentShape(Rectangle()) }
                .buttonStyle(SoftPressStyle())
                .accessibilityLabel(buttonLabel)
                .trackActions(actions, part: .accessibility)
        }
        .trackActions(actions, part: .menu)
    }

    private var buttonLabel: String {
        let base = "\(item.rank), \(plainTitle), \(Copy.Stats.figure(item, sort: sort))"
        let played = Copy.Stats.lastPlayedLabel(item, today: today)
        return artistCredit == nil ? "\(base), \(item.subtitle), \(played)" : "\(base), \(played)"
    }

    private func numbers(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(Copy.Stats.figure(item, sort: sort))
                .font(.system(.subheadline, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.primaryText)
            if (showsLastPlayed || stacked), item.lastPlayedAt != nil || item.lastPlayedDay?.isEmpty == false {
                Text(Copy.Stats.lastPlayedLabel(item, today: today))
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
                    // "Yesterday at 9:02 AM" wraps at large text rather than being cut short.
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// The sorted sea: covers in rank order, all one size (#361). The columns come from the room it has,
/// so a tile is never under 72 pt.
struct StatsSea: View {
    let items: [StatItem]
    var sort: StatsSort = .plays
    /// The room the grid has.
    let width: CGFloat
    let round: Bool
    let cache: StatsCoverCache
    let ownerOf: (StatItem) -> UUID?
    let label: String
    let onOpen: (StatItem) -> Void
    /// The long-press menu of an item (#364); nil for an item with none (an artist).
    var actions: (StatItem) -> TrackActions? = { _ in nil }

    @Environment(\.dynamicTypeSize) private var typeSize

    private var columns: Int {
        let base = StatsSeaLayout.columns(forWidth: width)[0]
        // Bigger text needs wider tiles for its names.
        return typeSize.isAccessibilitySize ? max(2, base - 1) : base
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(Copy.Stats.gridHint(for: sort))
                .font(.footnote)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 6)
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: Theme.Stats.tileGap, alignment: .top), count: columns),
                alignment: .leading, spacing: Theme.Stats.tileRowGap
            ) {
                ForEach(items) { item in
                    StatsTile(item: item, round: round, sort: sort, owner: ownerOf(item), cache: cache) { onOpen(item) }
                        .trackActions(actions(item))
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

private struct StatsTile: View {
    let item: StatItem
    let round: Bool
    var sort: StatsSort = .plays
    let owner: UUID?
    let cache: StatsCoverCache
    let action: () -> Void

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                sleeve
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.title)
                        .font(.system(.footnote, weight: .semibold))
                        .foregroundStyle(StatsStyle.nameColor(item.medal))
                        .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                    // Under the minutes sort the whole time ("2 h 10 min") is the figure (#367).
                    let minutes = sort == .minutes
                    let number = Text(minutes ? Copy.Stats.figure(item, sort: sort) : Copy.Stats.playsNumber(item.plays)).fontWeight(.semibold)
                    let word = Text(minutes ? "" : Copy.Stats.playsWord(item.plays)).foregroundStyle(playsColor.opacity(Theme.Stats.playsWordOpacity))
                    Text("\(number)\(word)")
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(playsColor)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(item.rank), \(item.title), \(Copy.Stats.figure(item, sort: sort)), \(item.subtitle)")
    }

    /// The number is strong and the word soft; ranks 1 to 3 take the medal's colour (the name's, which holds 4.5:1).
    private var playsColor: Color { item.medal == nil ? Theme.primaryText : StatsStyle.nameColor(item.medal) }

    /// The cover as a sleeve: a top-edge highlight, a drop shadow and, for the medals, a disc peeking from the right.
    private var sleeve: some View {
        let shape = round ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        return StatsCoverView(owner: owner, cache: cache, round: round, cornerRadius: 4)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                shape.stroke(
                    LinearGradient(stops: [.init(color: .white.opacity(Theme.Stats.tileEdgeTop), location: 0), .init(color: .clear, location: 0.5)],
                                   startPoint: .top, endPoint: .bottom),
                    lineWidth: 2)
                    .clipShape(shape)
                    .allowsHitTesting(false)
            }
            .overlay { chip("\(item.rank)", corner: .topLeading) }
            .background { disc }
            .compositingGroup()
            .shadow(color: .black.opacity(Theme.Stats.tileShadow), radius: Theme.Stats.tileShadowRadius, y: Theme.Stats.tileShadowY)
    }

    /// A thin record edge behind the cover, in the fan's medal metals.
    @ViewBuilder
    private var disc: some View {
        if let colors = discColors {
            GeometryReader { geo in
                Circle()
                    .fill(AngularGradient(colors: colors + [colors[0]], center: .center))
                    .overlay { Circle().strokeBorder(.white.opacity(0.35), lineWidth: 0.5) }
                    .frame(width: geo.size.width, height: geo.size.height)
                    .offset(x: geo.size.width * Theme.Stats.tileDiscPeek)
            }
            .accessibilityHidden(true)
        }
    }

    private var discColors: [Color]? {
        switch item.medal {
        case .gold: return [Theme.Stats.gold, Theme.Stats.goldRim, Color(red: 0.49, green: 0.34, blue: 0.04), Theme.Stats.goldRim]
        case .silver: return [Theme.Stats.silver, Theme.Stats.silverRim, Color(red: 0.36, green: 0.40, blue: 0.45), Theme.Stats.silverRim]
        case .bronze: return [Theme.Stats.bronze, Theme.Stats.bronzeRim, Color(red: 0.42, green: 0.20, blue: 0.07), Theme.Stats.bronzeRim]
        case nil: return nil
        }
    }

    /// The rank over a cover: white on dark glass. On a round cover the chips sit
    /// inside the circle, a share in from the corner, as on the Mac.
    private func chip(_ text: String, corner: Alignment) -> some View {
        GeometryReader { geo in
            Text(text)
                .font(.system(size: 11, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .frame(minHeight: 20)
                .background {
                    ZStack {
                        Capsule().fill(Color.black.opacity(Theme.Stats.chipBase))
                        GlowGlass().clipShape(Capsule())
                        GlowRim()
                    }
                }
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .padding(round ? geo.size.width * 0.09 : 6)
                .frame(width: geo.size.width, height: geo.size.height, alignment: corner)
        }
        .accessibilityHidden(true)
    }
}
