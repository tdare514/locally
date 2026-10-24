#if DEBUG
import SwiftUI
import UIKit

// MARK: - Sample

/// Everything a song page shows, as plain values (#365 prototype). The real page fills these from
/// `Release`/`Track`, the play stats and the collections; see docs/plans/365-song-page.md.
struct SongPageSample {
    struct CollectionRef: Identifiable {
        let id = UUID()
        let name: String
        let cover: UIImage?
    }

    var title: String
    var artist: String
    var featuring: [String]
    var album: String
    var trackNumber: Int
    var trackCount: Int
    var discNumber: Int
    var discCount: Int
    var genre: String
    var released: String
    var year: String
    var length: String
    var playsTotal: Int
    var lastPlayed: String?
    var byPeriod: [(label: String, count: Int)]
    var weekly: [Double]
    var collections: [CollectionRef]
    var fileName: String
    var format: String
    var size: String?
    var isOnPhone: Bool
    var cover: UIImage?
    var glow: [Color]
    var palette: AmbientPalette

    var location: String { isOnPhone ? Copy.SongPage.onThisPhone : Copy.SongPage.onYourMac }
    var tint: Color { glow.first ?? Theme.accent }

    private static func coverImage(of releaseIndex: Int) -> UIImage? {
        let release = StatsGallery.releases[releaseIndex]
        return StatsGallery.covers[release.id].flatMap { UIImage(data: $0) }
    }

    /// A phone-held song with plays and two collections.
    static let phone: SongPageSample = {
        let cover = coverImage(of: 0)
        return SongPageSample(
            title: "Paper Moon", artist: "Mira Valdane", featuring: ["Okoro", "Juniper Hale"],
            album: "Night Bus to Nowhere", trackNumber: 3, trackCount: 10, discNumber: 1, discCount: 2,
            genre: "Indie pop", released: "14 March 2025", year: "2025", length: "3:24",
            playsTotal: 124, lastPlayed: "Yesterday",
            byPeriod: [(Copy.SongPage.today, 2), (Copy.SongPage.thisWeek, 12), (Copy.SongPage.thisMonth, 31), (Copy.SongPage.thisYear, 96), (Copy.SongPage.allTime, 124)],
            weekly: [2, 3, 1, 5, 8, 4, 9, 12, 7, 14, 11, 12],
            collections: [.init(name: "Late drives", cover: coverImage(of: 4)), .init(name: "Rainy Sundays", cover: coverImage(of: 1))],
            fileName: "03 Paper Moon.m4a", format: "AAC (m4a)", size: "8.4 MB", isOnPhone: true,
            cover: cover, glow: [Color(.systemIndigo), Color(.systemPink)],
            palette: ArtworkPalette.palette(forCover: cover?.pngData()))
    }()

    /// A details-only song adopted from the Mac's Spotify folder.
    static let adopted: SongPageSample = {
        let cover = coverImage(of: 2)
        return SongPageSample(
            title: "Tide", artist: "Okoro", featuring: ["Quiet Orchard"],
            album: "Saltwater Hymns", trackNumber: 1, trackCount: 6, discNumber: 1, discCount: 1,
            genre: "Ambient", released: "2023", year: "2023", length: "5:48",
            playsTotal: 27, lastPlayed: "3 days ago",
            byPeriod: [(Copy.SongPage.today, 0), (Copy.SongPage.thisWeek, 3), (Copy.SongPage.thisMonth, 9), (Copy.SongPage.thisYear, 27), (Copy.SongPage.allTime, 27)],
            weekly: [0, 0, 1, 0, 2, 3, 1, 0, 4, 2, 3, 3],
            collections: [.init(name: "Slow mornings", cover: coverImage(of: 3))],
            fileName: "Okoro - Tide.mp3", format: "MP3", size: nil, isOnPhone: false,
            cover: cover, glow: [Color(.systemOrange), Color(.systemYellow)],
            palette: ArtworkPalette.palette(forCover: cover?.pngData()))
    }()
}

// MARK: - Gallery entry

/// Also `song-a2` (glass circles) and `song-a3` (one glass bar), same flags.
/// `song-a`, `song-a-bottom`, `song-a-ax3`, `song-a-adopted` and the same for b and c.
struct SongPageGallery: View {
    let name: String

    var body: some View {
        let parts = name.split(separator: "-").map(String.init)
        let variant = parts.count > 1 ? parts[1] : "a"
        let flag = parts.count > 2 ? parts[2] : ""
        let sample = flag == "adopted" ? SongPageSample.adopted : SongPageSample.phone
        let toEnd = flag == "bottom"
        Group {
            switch variant {
            case "b": SongPageB(sample: sample, scrollsToEnd: toEnd)
            case "c": SongPageC(sample: sample, scrollsToEnd: toEnd)
            case "a2": SongPageA2(sample: sample, scrollsToEnd: toEnd, style: .circles, startsPlaying: true, pinnedTurn: 40)
            case "a3": SongPageA2(sample: sample, scrollsToEnd: toEnd, style: .bar, startsPlaying: true, pinnedTurn: 40)
            default: SongPageA(sample: sample, scrollsToEnd: toEnd)
            }
        }
        .dynamicTypeSize(flag == "ax3" ? .accessibility3 : .large)
    }
}

// MARK: - Page scaffold

/// The cover's wash behind a scrolling column.
private struct SongScaffold<Content: View>: View {
    let sample: SongPageSample
    let scrollsToEnd: Bool
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack {
            ArtworkBackdrop(palette: sample.palette)
            ScrollView {
                VStack(spacing: 20) {
                    content()
                }
                .padding(.horizontal, Theme.SongPage.pageGutter)
                .padding(.top, 24)
                .padding(.bottom, 40)
                .frame(maxWidth: .infinity)
            }
            .defaultScrollAnchor(scrollsToEnd ? .bottom : .top)
        }
        .foregroundStyle(Theme.primaryText)
    }
}

// MARK: - Shared pieces

private struct SongArtistLine: View {
    let sample: SongPageSample
    var font: Font = .title3

    var body: some View {
        ArtistLineText(main: sample.artist, featuring: sample.featuring, font: font, mainColor: .white, dimColor: Theme.secondaryText)
    }
}

/// Play, then Add to collection and Edit. An adopted song shows why Play and Edit wait, as a quiet line.
private struct SongActions: View {
    let sample: SongPageSample
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(spacing: 10) {
            Button {} label: {
                Label(Copy.SongPage.play, systemImage: "play.fill")
            }
            .buttonStyle(CoverGlowButtonStyle(colors: sample.glow))
            .disabled(!sample.isOnPhone)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { add(stacked: false); edit }
                VStack(spacing: 10) { add(stacked: true); edit }
            }
            if !sample.isOnPhone {
                Label(Copy.SongPage.editOnMac, systemImage: "desktopcomputer")
                    .font(Theme.ScaledFont.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 6)
                    .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder private func add(stacked: Bool) -> some View {
        let button = Button {} label: {
            Label(Copy.SongPage.addToCollection, systemImage: "text.badge.plus").lineLimit(stacked ? nil : 1)
                .frame(maxWidth: stacked ? .infinity : nil)
        }
        .buttonStyle(GlowPillButtonStyle())
        if stacked || !sample.isOnPhone { button.frame(maxWidth: .infinity) } else { button.fixedSize() }
    }

    @ViewBuilder private var edit: some View {
        if sample.isOnPhone {
            Button {} label: { Label(Copy.SongPage.edit, systemImage: "pencil").lineLimit(1).frame(maxWidth: .infinity) }
                .buttonStyle(GlowPillButtonStyle())
        }
    }
}

/// A label above or beside its value; stacks at accessibility sizes.
private struct FactRow: View {
    let label: String
    let value: String
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
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
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }

    private var labelView: some View {
        Text(label).font(Theme.ScaledFont.subheadline).foregroundStyle(Theme.secondaryText)
    }

    private var valueView: some View {
        Text(value).font(Theme.ScaledFont.value).foregroundStyle(Theme.primaryText).fixedSize(horizontal: false, vertical: true)
    }
}

private struct HairlineDivider: View {
    var body: some View {
        Rectangle().fill(Theme.Track.separatorTint.opacity(1.6)).frame(height: 1).accessibilityHidden(true)
    }
}

/// Rows in a glass card with hairlines between them.
private struct FactRows: View {
    let rows: [(String, String)]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                if index > 0 { HairlineDivider() }
                FactRow(label: row.0, value: row.1)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 4)
    }
}

/// A small sleeve with its disc half out, never tappable here.
private struct MiniSleeve: View {
    let cover: UIImage?
    var size: CGFloat = Theme.SongPage.sleeveMini

    var body: some View {
        RecordSleeve(cover: cover, size: size, showsAddCaption: false, onAddCover: {})
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

private struct CollectionSleeves: View {
    let sample: SongPageSample

    var body: some View {
        if sample.collections.isEmpty {
            Text(Copy.SongPage.notInCollection)
                .font(Theme.ScaledFont.subheadline)
                .foregroundStyle(Theme.secondaryText)
        } else {
            SongWrapLayout(spacing: 18) {
                ForEach(sample.collections) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        MiniSleeve(cover: item.cover)
                        Text(item.name)
                            .font(Theme.ScaledFont.caption)
                            .foregroundStyle(Theme.primaryText)
                            .lineLimit(2)
                            .frame(maxWidth: 140, alignment: .leading)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

/// A cover-tinted glass chip.
private struct TagChip: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(Theme.ScaledFont.pill)
            .foregroundStyle(Theme.primaryText)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .frame(minHeight: 36)
            .background {
                ZStack {
                    GlowGlass()
                    LinearGradient(colors: [tint.opacity(0.42), tint.opacity(0.14)], startPoint: .top, endPoint: .bottom)
                }
                .clipShape(Capsule())
            }
            .overlay { GlowRim() }
    }
}

/// A quiet bar in the cover's colour, filled to a fraction of its width. No GeometryReader.
private struct FractionBar: View {
    let fraction: Double
    let tint: Color

    var body: some View {
        Capsule().fill(.white.opacity(0.10))
            .frame(height: Theme.SongPage.barHeight)
            .overlay {
                FractionLayout(fraction: fraction) {
                    Capsule().fill(LinearGradient(colors: [tint.opacity(0.7), tint], startPoint: .leading, endPoint: .trailing))
                }
            }
            .accessibilityHidden(true)
    }
}

private struct FractionLayout: Layout {
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
private struct PeriodBars: View {
    let sample: SongPageSample

    var body: some View {
        let peak = Double(sample.byPeriod.map(\.count).max() ?? 1)
        VStack(spacing: 14) {
            ForEach(Array(sample.byPeriod.enumerated()), id: \.offset) { _, row in
                VStack(spacing: 6) {
                    HStack {
                        Text(row.label).font(Theme.ScaledFont.subheadline).foregroundStyle(Theme.secondaryText)
                        Spacer(minLength: 8)
                        Text("\(row.count)").font(Theme.ScaledFont.trackNumber).foregroundStyle(Theme.primaryText)
                    }
                    FractionBar(fraction: peak > 0 ? Double(row.count) / peak : 0, tint: sample.tint)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

private struct SparkShape: Shape {
    let values: [Double]
    var closed = false

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard values.count > 1, let peak = values.max(), peak > 0 else { return path }
        let step = rect.width / CGFloat(values.count - 1)
        func point(_ i: Int) -> CGPoint {
            CGPoint(x: rect.minX + step * CGFloat(i), y: rect.maxY - rect.height * CGFloat(values[i] / peak) * 0.92 - 2)
        }
        path.move(to: closed ? CGPoint(x: rect.minX, y: rect.maxY) : point(0))
        if closed { path.addLine(to: point(0)) }
        for i in 1..<values.count { path.addLine(to: point(i)) }
        if closed {
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
            path.closeSubpath()
        }
        return path
    }
}

private struct SparkDot: Shape {
    let values: [Double]

    func path(in rect: CGRect) -> Path {
        guard let last = values.last, let peak = values.max(), peak > 0 else { return Path() }
        let center = CGPoint(x: rect.maxX - 4, y: rect.maxY - rect.height * CGFloat(last / peak) * 0.92 - 2)
        return Path(ellipseIn: CGRect(x: center.x - 4, y: center.y - 4, width: 8, height: 8))
    }
}

private struct Sparkline: View {
    let values: [Double]
    let tint: Color

    var body: some View {
        ZStack {
            SparkShape(values: values, closed: true)
                .fill(LinearGradient(colors: [tint.opacity(0.35), tint.opacity(0)], startPoint: .top, endPoint: .bottom))
            SparkShape(values: values)
                .stroke(tint, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
            SparkDot(values: values).fill(.white)
        }
        .frame(height: Theme.SongPage.sparkHeight)
        .accessibilityHidden(true)
    }
}

/// Lays children left to right and wraps to the next line.
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

// MARK: - A: Sleeve

struct SongPageA: View {
    let sample: SongPageSample
    var scrollsToEnd = false

    var body: some View {
        SongScaffold(sample: sample, scrollsToEnd: scrollsToEnd) {
            VStack(spacing: 12) {
                RecordSleeve(cover: sample.cover, size: Theme.SongPage.sleeveHero, showsAddCaption: false, onAddCover: {})
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                    .padding(.bottom, 8)
                Text(sample.title)
                    .font(Theme.ScaledFont.largeTitle)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                SongArtistLine(sample: sample)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
            SongActions(sample: sample)
            GlassSection(title: Copy.SongPage.plays) { playsCard }
            GlassSection(title: Copy.SongPage.inCollections) {
                GlassCard { CollectionSleeves(sample: sample).padding(18) }
            }
            GlassSection(title: Copy.SongPage.onTheAlbum) {
                GlassCard {
                    FactRows(rows: [
                        (Copy.SongPage.album, sample.album),
                        (Copy.SongPage.track, Copy.SongPage.ofTotal(sample.trackNumber, sample.trackCount)),
                        (Copy.SongPage.disc, Copy.SongPage.ofTotal(sample.discNumber, sample.discCount)),
                        (Copy.SongPage.genre, sample.genre),
                        (Copy.SongPage.released, sample.released),
                        (Copy.SongPage.length, sample.length),
                    ])
                }
            }
            GlassSection(title: Copy.SongPage.file) {
                GlassCard {
                    FactRows(rows: [
                        (Copy.SongPage.fileName, sample.fileName),
                        (Copy.SongPage.format, sample.format),
                        (Copy.SongPage.size, sample.size ?? Copy.SongPage.sizeUnknown),
                        (Copy.SongPage.livesOn, sample.location),
                    ])
                }
            }
        }
    }

    private var playsCard: some View {
        GlassCard(prominent: true) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(sample.playsTotal)")
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        .monospacedDigit()
                    Text(Copy.SongPage.playsUnit)
                        .font(Theme.ScaledFont.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
                Text("\(Copy.SongPage.lastPlayed) \(sample.lastPlayed.map { $0.lowercased() } ?? Copy.SongPage.neverPlayed)")
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                PeriodBars(sample: sample)
            }
            .padding(18)
        }
    }
}

// MARK: - A2 / A3: play from the record, sleeker actions

/// Which action row sits under the artist line.
private enum SongActionStyle { case circles, bar }

private enum SongActionCopy {
    static let collection = "Collection"
    static let playNext = "Play next"
    static let share = "Share"
    static let edit = "Edit"
    static let editOnMacLine = "Edit it on your Mac"
    static let playHint = "Plays this song"
    static let pauseHint = "Pauses it"
    static func playLabel(_ title: String) -> String { "Play \(title)" }
    static func pauseLabel(_ title: String) -> String { "Pause \(title)" }
    static func onlyOnMac(_ title: String) -> String { "\(title), only on your Mac" }
}

private struct SongAction: Identifiable {
    let id: String
    let icon: String
    var caption: String { id }
}

private func songActions(for sample: SongPageSample) -> [SongAction] {
    var items = [
        SongAction(id: SongActionCopy.collection, icon: "text.badge.plus"),
        SongAction(id: SongActionCopy.playNext, icon: "text.line.first.and.arrowtriangle.forward"),
        SongAction(id: SongActionCopy.share, icon: "square.and.arrow.up"),
    ]
    if sample.isOnPhone { items.append(SongAction(id: SongActionCopy.edit, icon: "pencil")) }
    return items
}

/// One round glass button with its caption under it. The circle scales to 0.94 and the rim brightens while pressed.
private struct SongCircleButtonStyle: ButtonStyle {
    let action: SongAction
    let tint: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var ease: Animation { .timingCurve(0.16, 1, 0.3, 1, duration: 0.35) }

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        VStack(spacing: 8) {
            ZStack {
                Theme.background.opacity(0.55)
                GlowGlass()
                LinearGradient(colors: [.white.opacity(0.16), .clear], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.4))
            }
            .frame(width: 56, height: 56)
            .clipShape(Circle())
            .overlay { GlowRim(round: true) }
            .overlay {
                Circle().strokeBorder(tint.opacity(pressed ? 0.95 : 0.5), lineWidth: 1)
            }
            .overlay {
                Image(systemName: action.icon)
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(Color.white)
            }
            .scaleEffect(pressed && !reduceMotion ? 0.94 : 1)
            Text(action.caption)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .contentShape(Rectangle())
        .animation(ease, value: pressed)
    }
}

private struct SongCircleRow: View {
    let sample: SongPageSample
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let tint = Theme.coverGlowColors(sample.palette).first ?? Theme.accent
        let items = songActions(for: sample)
        Group {
            if typeSize.isAccessibilitySize {
                LazyVGrid(columns: [GridItem(.flexible(), alignment: .top), GridItem(.flexible(), alignment: .top)], spacing: 20) {
                    ForEach(items) { item in button(item, tint: tint) }
                }
                .padding(.horizontal, 24)
            } else {
                HStack(alignment: .top, spacing: 22) {
                    ForEach(items) { item in button(item, tint: tint).frame(width: 64) }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func button(_ item: SongAction, tint: Color) -> some View {
        Button {} label: { Text(item.caption) }
            .buttonStyle(SongCircleButtonStyle(action: item, tint: tint))
            .accessibilityLabel(item.caption)
    }
}

/// A segment of the glass bar: icon over label. Pressed, a soft highlight sits inside the segment.
private struct SongSegmentStyle: ButtonStyle {
    let action: SongAction
    var rows = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        Group {
            if rows {
                HStack(spacing: 14) {
                    Image(systemName: action.icon).font(.system(size: 20)).frame(width: 28)
                    Text(action.caption).font(Theme.ScaledFont.subheadline)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 20)
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            } else {
                VStack(spacing: 3) {
                    Image(systemName: action.icon).font(.system(size: 17)).frame(height: 20)
                    Text(action.caption).font(Theme.ScaledFont.caption).lineLimit(1)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 52)
            }
        }
        .foregroundStyle(Color.white)
        .background {
            RoundedRectangle(cornerRadius: rows ? 14 : 22, style: .continuous)
                .fill(LinearGradient(colors: [.white.opacity(0.18), .white.opacity(0.06)], startPoint: .top, endPoint: .bottom))
                .padding(rows ? 4 : 4)
                .opacity(pressed ? 1 : 0)
        }
        .contentShape(Rectangle())
        .animation(reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 0.35), value: pressed)
    }
}

private struct SongGlassBar: View {
    let sample: SongPageSample
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let tint = Theme.coverGlowColors(sample.palette).first ?? Theme.accent
        let items = songActions(for: sample)
        Group {
            if typeSize.isAccessibilitySize {
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1).accessibilityHidden(true) }
                        button(item, rows: true)
                    }
                }
                .background { glass }
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(tint.opacity(0.55), lineWidth: 1) }
            } else {
                HStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { Rectangle().fill(Color.white.opacity(0.12)).frame(width: 1, height: 28).accessibilityHidden(true) }
                        button(item, rows: false)
                    }
                }
                .frame(height: 52)
                .background { glass }
                .clipShape(Capsule())
                .overlay { GlowRim() }
                .overlay { Capsule().strokeBorder(tint.opacity(0.5), lineWidth: 1) }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var glass: some View {
        ZStack {
            Theme.background.opacity(0.55)
            GlowGlass()
        }
    }

    private func button(_ item: SongAction, rows: Bool) -> some View {
        Button {} label: { Text(item.caption) }
            .buttonStyle(SongSegmentStyle(action: item, rows: rows))
            .accessibilityLabel(item.caption)
    }
}

/// The record is the play control: tap the sleeve to play, tap again to pause. The disc turns only while playing.
private struct PlayableSleeve: View {
    let sample: SongPageSample
    @Binding var playing: Bool
    /// The gallery holds the disc at this angle instead of spinning it.
    var pinnedTurn: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let playable = sample.isOnPhone
        let label = playable
            ? (playing ? SongActionCopy.pauseLabel(sample.title) : SongActionCopy.playLabel(sample.title))
            : SongActionCopy.onlyOnMac(sample.title)
        Group {
            if playing && pinnedTurn == nil && !reduceMotion {
                TimelineView(.animation) { context in
                    let seconds = context.date.timeIntervalSinceReferenceDate
                    sleeve(turn: (seconds.truncatingRemainder(dividingBy: Theme.SongPage.platterTurnSeconds) / Theme.SongPage.platterTurnSeconds) * 360)
                }
            } else {
                sleeve(turn: playing ? (pinnedTurn ?? 0) : 0)
            }
        }
        .disabled(!playable)
        .opacity(playable ? 1 : 0.45)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityHint(playable ? (playing ? SongActionCopy.pauseHint : SongActionCopy.playHint) : "")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { if playable { playing.toggle() } }
    }

    private func sleeve(turn: Double) -> some View {
        RecordSleeve(cover: sample.cover, pose: CeremonyPose(tuck: 0, rotationDegrees: turn), size: Theme.SongPage.sleeveHero, showsAddCaption: false, onAddCover: { playing.toggle() })
    }
}

struct SongPageA2: View {
    fileprivate let sample: SongPageSample
    var scrollsToEnd = false
    fileprivate var style: SongActionStyle = .circles
    var pinnedTurn: Double?
    @State private var playing: Bool

    fileprivate init(sample: SongPageSample, scrollsToEnd: Bool = false, style: SongActionStyle = .circles, startsPlaying: Bool = false, pinnedTurn: Double? = nil) {
        self.sample = sample
        self.scrollsToEnd = scrollsToEnd
        self.style = style
        self.pinnedTurn = pinnedTurn
        _playing = State(initialValue: startsPlaying && sample.isOnPhone)
    }

    var body: some View {
        SongScaffold(sample: sample, scrollsToEnd: scrollsToEnd) {
            VStack(spacing: 12) {
                PlayableSleeve(sample: sample, playing: $playing, pinnedTurn: pinnedTurn)
                    .padding(.bottom, 8)
                Text(sample.title)
                    .font(Theme.ScaledFont.largeTitle)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                SongArtistLine(sample: sample)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
            VStack(spacing: 14) {
                switch style {
                case .circles: SongCircleRow(sample: sample)
                case .bar: SongGlassBar(sample: sample)
                }
                if !sample.isOnPhone {
                    Text(SongActionCopy.editOnMacLine)
                        .font(Theme.ScaledFont.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .multilineTextAlignment(.center)
                }
            }
            GlassSection(title: Copy.SongPage.plays) { playsCard }
            GlassSection(title: Copy.SongPage.inCollections) {
                GlassCard { CollectionSleeves(sample: sample).padding(18) }
            }
            GlassSection(title: Copy.SongPage.onTheAlbum) {
                GlassCard {
                    FactRows(rows: [
                        (Copy.SongPage.album, sample.album),
                        (Copy.SongPage.track, Copy.SongPage.ofTotal(sample.trackNumber, sample.trackCount)),
                        (Copy.SongPage.disc, Copy.SongPage.ofTotal(sample.discNumber, sample.discCount)),
                        (Copy.SongPage.genre, sample.genre),
                        (Copy.SongPage.released, sample.released),
                        (Copy.SongPage.length, sample.length),
                    ])
                }
            }
            GlassSection(title: Copy.SongPage.file) {
                GlassCard {
                    FactRows(rows: [
                        (Copy.SongPage.fileName, sample.fileName),
                        (Copy.SongPage.format, sample.format),
                        (Copy.SongPage.size, sample.size ?? Copy.SongPage.sizeUnknown),
                        (Copy.SongPage.livesOn, sample.location),
                    ])
                }
            }
        }
    }

    private var playsCard: some View {
        GlassCard(prominent: true) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(sample.playsTotal)")
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        .monospacedDigit()
                    Text(Copy.SongPage.playsUnit)
                        .font(Theme.ScaledFont.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
                Text("\(Copy.SongPage.lastPlayed) \(sample.lastPlayed.map { $0.lowercased() } ?? Copy.SongPage.neverPlayed)")
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                PeriodBars(sample: sample)
            }
            .padding(18)
        }
    }
}

// MARK: - B: Liner notes

struct SongPageB: View {
    let sample: SongPageSample
    var scrollsToEnd = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        SongScaffold(sample: sample, scrollsToEnd: scrollsToEnd) {
            header
            SongActions(sample: sample)
            GlassCard(prominent: true) {
                VStack(alignment: .leading, spacing: 22) {
                    Text(Copy.SongPage.linerNotes)
                        .font(.system(.title2, design: .serif, weight: .semibold))
                        .italic()
                        .accessibilityAddTraits(.isHeader)
                    pairs
                    chips
                    sparkSection
                    collections
                    smallPrint
                }
                .padding(20)
            }
        }
    }

    private var header: some View {
        let sleeve = RecordSleeve(cover: sample.cover, size: Theme.SongPage.sleeveHeader, showsAddCaption: false, onAddCover: {})
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .rotationEffect(.degrees(Theme.SongPage.tiltDegrees))
        let words = VStack(alignment: .leading, spacing: 6) {
            Text(sample.title).font(Theme.ScaledFont.pageTitle).fixedSize(horizontal: false, vertical: true)
            SongArtistLine(sample: sample, font: .subheadline)
        }
        return Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 18) { sleeve; words }
            } else {
                HStack(alignment: .center, spacing: 18) { sleeve; words.frame(maxWidth: .infinity, alignment: .leading) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }

    /// Label above value, in two columns (one at accessibility sizes), like the printed back of an LP.
    private var pairs: some View {
        let items: [(String, String)] = [
            (Copy.SongPage.album, sample.album),
            (Copy.SongPage.released, sample.released),
            (Copy.SongPage.length, sample.length),
            (Copy.SongPage.lastPlayed, sample.lastPlayed ?? Copy.SongPage.neverPlayed),
            (Copy.SongPage.plays, "\(sample.playsTotal)"),
        ]
        let columns = typeSize.isAccessibilitySize
            ? [GridItem(.flexible(), alignment: .topLeading)]
            : [GridItem(.flexible(), alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.0).font(Theme.ScaledFont.caption).foregroundStyle(Theme.secondaryText)
                    Text(item.1).font(.system(.body, design: .serif, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var chips: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(Copy.SongPage.tags).font(Theme.ScaledFont.caption).foregroundStyle(Theme.secondaryText)
            SongWrapLayout(spacing: 8) {
                TagChip(text: sample.genre, tint: sample.tint)
                TagChip(text: sample.year, tint: sample.tint)
                TagChip(text: Copy.SongPage.trackOf(sample.trackNumber, sample.trackCount), tint: sample.tint)
                TagChip(text: Copy.SongPage.discOf(sample.discNumber, sample.discCount), tint: sample.tint)
                TagChip(text: sample.format, tint: sample.tint)
            }
        }
    }

    private var sparkSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(Copy.SongPage.recentWeeks).font(Theme.ScaledFont.caption).foregroundStyle(Theme.secondaryText)
            Sparkline(values: sample.weekly, tint: sample.tint)
        }
        .accessibilityElement(children: .combine)
    }

    private var collections: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(Copy.SongPage.inCollections).font(Theme.ScaledFont.caption).foregroundStyle(Theme.secondaryText)
            CollectionSleeves(sample: sample)
        }
    }

    private var smallPrint: some View {
        VStack(alignment: .leading, spacing: 4) {
            HairlineDivider().padding(.bottom, 8)
            Text(sample.fileName)
            Text([sample.format, sample.size ?? Copy.SongPage.sizeUnknown].joined(separator: " \u{00B7} "))
            Text("\(Copy.SongPage.livesOn) \(sample.location)")
        }
        .font(Theme.ScaledFont.caption)
        .foregroundStyle(Theme.secondaryText)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - C: On the platter

struct SongPageC: View {
    let sample: SongPageSample
    var scrollsToEnd = false
    /// True only while this song plays; the gallery always shows it still.
    var isPlaying = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var turn: Double = 0

    var body: some View {
        SongScaffold(sample: sample, scrollsToEnd: scrollsToEnd) {
            VStack(spacing: 12) {
                RecordDisc(cover: sample.cover, size: Theme.SongPage.platterSize, rotationDegrees: turn)
                    .accessibilityHidden(true)
                    .padding(.bottom, 10)
                    .onChange(of: isPlaying && !reduceMotion) { _, spins in
                        if spins {
                            withAnimation(.linear(duration: Theme.SongPage.platterTurnSeconds).repeatForever(autoreverses: false)) { turn += 360 }
                        } else {
                            withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.45)) { turn = turn.truncatingRemainder(dividingBy: 360) }
                        }
                    }
                Text(sample.title)
                    .font(Theme.ScaledFont.largeTitle)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                SongArtistLine(sample: sample)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                Text([sample.album, Copy.SongPage.trackOf(sample.trackNumber, sample.trackCount), Copy.SongPage.discOf(sample.discNumber, sample.discCount)].joined(separator: " \u{00B7} "))
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
            }
            SongActions(sample: sample)
            tiles
            GlassCard {
                FactRows(rows: [
                    (Copy.SongPage.fileName, sample.fileName),
                    (Copy.SongPage.format, sample.format),
                    (Copy.SongPage.size, sample.size ?? Copy.SongPage.sizeUnknown),
                    (Copy.SongPage.livesOn, sample.location),
                ])
            }
        }
    }

    private var tiles: some View {
        let columns = typeSize.isAccessibilitySize
            ? [GridItem(.flexible())]
            : [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
        return LazyVGrid(columns: columns, spacing: 12) {
            tile(Copy.SongPage.plays, "\(sample.playsTotal)", big: true)
            tile(Copy.SongPage.lastPlayed, sample.lastPlayed ?? Copy.SongPage.neverPlayed)
            tile(Copy.SongPage.length, sample.length, big: true)
            tile(Copy.SongPage.released, sample.released)
            tile(Copy.SongPage.genre, sample.genre)
            tile(Copy.SongPage.inNCollections(sample.collections.count), sample.collections.map(\.name).joined(separator: ", "))
        }
    }

    private func tile(_ label: String, _ value: String, big: Bool = false) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(Theme.ScaledFont.caption).foregroundStyle(Theme.secondaryText)
                Text(value)
                    .font(big ? .system(.title, design: .rounded, weight: .bold) : Theme.ScaledFont.headline)
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: Theme.SongPage.tileMinHeight, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}
#endif
