#if DEBUG
import SwiftUI
import UIKit

/// #399, round 1: three designs of the play History screen on fixture data, for the owner to pick. No networking and no
/// production wiring. Each name also has `-ax3` (Dynamic Type accessibility3) and `-narrow` (320 pt wide) frames.
struct HistoryVariantsGallery: View {
    static let variants = ["history-a", "history-b", "history-c"]
    static let names = variants.flatMap { [$0, $0 + "-ax3", $0 + "-narrow"] }

    let name: String

    var body: some View {
        Group {
            switch String(name.prefix(9)) {
            case "history-b": HistoryCrateView()
            case "history-c": HistoryStackView()
            default: HistoryLinerView()
            }
        }
        .dynamicTypeSize(name.hasSuffix("-ax3") ? .accessibility3 : .large)
        .frame(maxWidth: name.hasSuffix("-narrow") ? 320 : .infinity)
        .background(Theme.background)
    }
}

// MARK: - Fixture

/// A play as `GET /v1/plays/events` returns it (`spec/fixtures/play-events/valid-events-page.json`).
private struct HistoryPlay: Identifiable {
    struct Device {
        var name: String
        var platform: String
        var current: Bool
    }

    var id: String
    var releaseId: UUID
    var trackId: UUID
    var source: String
    var startedAt: Int64
    var day: String
    var listenedMs: Int
    var device: Device

    var release: Release { HistoryFixture.release(releaseId) }
    var track: Track { release.tracks.first { $0.id == trackId } ?? release.tracks[0] }
    var image: UIImage? { HistoryFixture.images[releaseId] }
    var palette: AmbientPalette { HistoryFixture.palettes[releaseId] ?? .neutral }
    var tint: Color { ArtworkBackdrop.color(hex: palette.primary) }
    var started: Date { Date(timeIntervalSince1970: Double(startedAt) / 1000) }
    var lengthMs: Int { Int((track.durationSec ?? 200) * 1000) }
    var fraction: CGFloat { min(1, CGFloat(listenedMs) / CGFloat(max(1, lengthMs))) }

    /// "iPhone", "Mac" or "Spotify (online)".
    var deviceLabel: String { source == "spotify" ? "Spotify (online)" : device.name }
    var deviceSymbol: String {
        if source == "spotify" { return "antenna.radiowaves.left.and.right" }
        return device.platform == "macos" ? "laptopcomputer" : "iphone"
    }
    /// Said in words as well as drawn by the disc, so the amount heard never rests on the picture alone.
    var heardText: String { fraction >= 0.9 ? "Full listen" : "Heard \(HistoryFormat.clock(ms: listenedMs))" }
    var timeText: String { HistoryFormat.time(started) }
    var spoken: String {
        "\(timeText), \(track.title) by \(release.artist), on \(deviceLabel), \(heardText)"
    }
}

private struct HistoryDay: Identifiable {
    var day: String
    var date: Date
    var plays: [HistoryPlay]
    var id: String { day }
    var label: String { HistoryFormat.dayLabel(date) }
    var minutes: String { HistoryFormat.minutes(ms: plays.reduce(0) { $0 + $1.listenedMs }) }
    var countText: String { plays.count == 1 ? "1 play" : "\(plays.count) plays" }
    /// One sleeve per release, in order of the newest play.
    var releases: [HistoryPlay] {
        var seen = Set<UUID>()
        return plays.filter { seen.insert($0.releaseId).inserted }
    }
}

private enum HistoryFixture {
    static let releases: [Release] = Array(StatsGallery.releases.prefix(6))
    static func release(_ id: UUID) -> Release { releases.first { $0.id == id } ?? releases[0] }

    static let images: [UUID: UIImage] = Dictionary(uniqueKeysWithValues: releases.compactMap { r in
        StatsGallery.covers[r.id].flatMap(UIImage.init(data:)).map { (r.id, $0) }
    })
    static let palettes: [UUID: AmbientPalette] = Dictionary(uniqueKeysWithValues: releases.map { r in
        (r.id, ArtworkPalette.palette(forCover: StatsGallery.covers[r.id]))
    })

    /// Today's local calendar day, as the API's `day` strings.
    static let calendar = Calendar.current

    /// (days ago, hour, minute, release, track, listened s, device: 0 iPhone, 1 Mac, 2 Spotify). Newest first.
    /// 14 plays over Today, Yesterday and five days ago; a few more on other days only fill the 14-day strip.
    private static let rows: [(Int, Int, Int, Int, Int, Int, Int)] = [
        (0, 15, 48, 0, 0, 200, 0), (0, 13, 5, 1, 0, 31, 1), (0, 12, 31, 4, 1, 200, 2),
        (0, 9, 14, 0, 1, 164, 0), (0, 8, 20, 2, 0, 30, 1), (0, 7, 42, 3, 0, 200, 0),
        (1, 22, 3, 3, 0, 200, 0), (1, 20, 40, 5, 0, 118, 1), (1, 18, 12, 1, 1, 200, 2),
        (1, 12, 55, 2, 1, 44, 0), (1, 9, 30, 4, 0, 200, 0),
        (3, 21, 10, 0, 2, 200, 0), (3, 17, 36, 1, 0, 200, 1), (3, 8, 15, 4, 1, 52, 2),
        (5, 22, 18, 2, 0, 200, 1), (5, 19, 2, 0, 0, 30, 0), (5, 14, 44, 5, 0, 200, 2),
        (8, 20, 5, 3, 0, 200, 0), (8, 11, 20, 1, 1, 90, 1),
        (10, 18, 33, 4, 0, 200, 2), (10, 9, 9, 0, 1, 200, 0),
        (12, 21, 1, 2, 1, 160, 1),
    ]

    static let plays: [HistoryPlay] = rows.enumerated().map { index, row in
        let start = calendar.startOfDay(for: Date())
        let dayStart = calendar.date(byAdding: .day, value: -row.0, to: start) ?? start
        let date = calendar.date(bySettingHour: row.1, minute: row.2, second: 0, of: dayStart) ?? dayStart
        let release = releases[row.3]
        let device: HistoryPlay.Device = row.6 == 1
            ? .init(name: "Mac", platform: "macos", current: false)
            : .init(name: "iPhone", platform: "ios", current: row.6 == 0)
        return HistoryPlay(
            id: String(format: "00000000-0000-0000-0000-%012d", 9000 + index), releaseId: release.id,
            trackId: release.tracks[min(row.4, release.tracks.count - 1)].id, source: row.6 == 2 ? "spotify" : "locally",
            startedAt: Int64(date.timeIntervalSince1970 * 1000), day: PlayPeriods.localDayString(date, calendar: calendar),
            listenedMs: row.5 * 1000, device: device)
    }

    /// The plays grouped by local day, newest day first.
    static let days: [HistoryDay] = Dictionary(grouping: plays, by: \.day).map { day, plays in
        let sorted = plays.sorted { $0.startedAt > $1.startedAt }
        return HistoryDay(day: day, date: sorted[0].started, plays: sorted)
    }.sorted { $0.day > $1.day }
}

private enum HistoryFormat {
    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.dateStyle = .none
        f.timeStyle = .short
        return f
    }()
    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("EEEdMMM")
        return f
    }()
    private static let weekdayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("EEE")
        return f
    }()

    static func time(_ date: Date) -> String { timeFormatter.string(from: date) }
    static func dayLabel(_ date: Date) -> String {
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return dayFormatter.string(from: date)
    }
    static func weekday(_ date: Date) -> String { Calendar.current.isDateInToday(date) ? "Today" : weekdayFormatter.string(from: date) }
    static func minutes(ms: Int) -> String { "\(max(1, Int((Double(ms) / 60_000).rounded()))) min" }
    static func clock(ms: Int) -> String { String(format: "%d:%02d", ms / 60_000, (ms / 1000) % 60) }
}

private extension Color {
    /// A blend toward `other` by `amount` (0 to 1); `Color.mix` needs iOS 18.
    func blended(with other: Color, by amount: CGFloat) -> Color {
        var a: (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        var b: (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        UIColor(self).getRed(&a.0, green: &a.1, blue: &a.2, alpha: &a.3)
        UIColor(other).getRed(&b.0, green: &b.1, blue: &b.2, alpha: &b.3)
        return Color(red: a.0 + (b.0 - a.0) * amount, green: a.1 + (b.1 - a.1) * amount, blue: a.2 + (b.2 - a.2) * amount)
    }
}

// MARK: - Shared pieces

/// A cover sleeve whose disc shows past the edge in proportion to how much of the track was heard: a full listen shows
/// the most disc, a 30 s skip a sliver. The frame always reserves the full peek, so text lines up down a list.
private struct HistorySleeve: View {
    let play: HistoryPlay
    let side: CGFloat
    var radius = Theme.History.sleeveRadiusSmall

    var body: some View {
        let disc = side * Theme.Immersive.discToSleeveRatio
        let fullPeek = disc * Theme.Immersive.discPeekRatio
        let amount = Theme.History.minPeek + (1 - Theme.History.minPeek) * play.fraction
        let shown = fullPeek * amount
        ZStack(alignment: .leading) {
            RecordDisc(cover: play.image, size: disc)
                .offset(x: side + shown - disc)
            cover
        }
        .frame(width: side + fullPeek, height: side, alignment: .leading)
        .accessibilityHidden(true)
    }

    private var cover: some View {
        Group {
            if let image = play.image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Theme.card
            }
        }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(LinearGradient(colors: [.white.opacity(Theme.History.sleeveEdgeOpacity), .clear], startPoint: .top, endPoint: .bottom), lineWidth: 1))
        .shadow(color: .black.opacity(Theme.History.sleeveShadowOpacity), radius: side * 0.08, x: 0, y: side * 0.05)
    }
}

/// The device and how much was heard, in one quiet line that wraps at large sizes.
private struct HistoryDeviceLine: View {
    let play: HistoryPlay
    var showsHeard = true

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Image(systemName: play.deviceSymbol).imageScale(.small).accessibilityHidden(true)
            Text(showsHeard ? "\(play.deviceLabel) · \(play.heardText)" : play.deviceLabel)
        }
        .font(.footnote)
        .foregroundStyle(Theme.secondaryText)
    }
}

/// A minutes pill tinted by the cover; the words carry the meaning, the tint is only the finish.
private struct HistoryMinutes: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.system(.subheadline, design: .rounded, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background(tint.opacity(0.30), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.55), lineWidth: 1))
    }
}

private struct HistoryBackdrop: View {
    let palette: AmbientPalette
    var body: some View {
        ZStack {
            Theme.background
            ArtworkBackdrop(palette: palette)
        }
        .ignoresSafeArea()
    }
}

private struct HistoryTitle: View {
    var body: some View {
        Text("History")
            .font(.system(.largeTitle, weight: .bold))
            .foregroundStyle(.white)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The song page's a4 panel: opaque near-black, a rounded top and a faint lit edge.
private struct HistoryPanel<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.History.panelRadius, style: .continuous)
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.SongPage.panelFill, in: shape)
            .overlay(
                shape.strokeBorder(
                    LinearGradient(colors: [.white.opacity(Theme.History.panelHighlightOpacity), .white.opacity(0.02)], startPoint: .top, endPoint: .bottom),
                    lineWidth: 1))
    }
}

// MARK: - A: Liner timeline

private struct HistoryLinerView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: CGFloat = 390

    private var compact: Bool { width < Theme.History.narrowWidth || typeSize.isAccessibilitySize }

    var body: some View {
        let days = HistoryFixture.days
        ZStack {
            HistoryBackdrop(palette: days.first?.plays.first?.palette ?? .neutral)
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.History.dayGap) {
                    HistoryTitle().padding(.bottom, 2)
                    ForEach(days) { day in dayBlock(day) }
                }
                .padding(.horizontal, Theme.History.gutter)
                .padding(.bottom, 32)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    @ViewBuilder
    private func dayBlock(_ day: HistoryDay) -> some View {
        let tint = day.plays.first?.tint ?? Theme.accent
        VStack(alignment: .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    dayTitle(day.label)
                    Spacer(minLength: 8)
                    HistoryMinutes(text: day.minutes, tint: tint)
                }
                VStack(alignment: .leading, spacing: 8) {
                    dayTitle(day.label)
                    HistoryMinutes(text: day.minutes, tint: tint)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            HistoryPanel {
                VStack(spacing: 0) {
                    ForEach(Array(day.plays.enumerated()), id: \.element.id) { index, play in
                        row(play, isFirst: index == 0, isLast: index == day.plays.count - 1)
                    }
                }
                .padding(.vertical, 8)
            }
        }
    }

    private func dayTitle(_ text: String) -> some View {
        Text(text).font(.system(.title, weight: .bold)).foregroundStyle(.white)
    }

    private func row(_ play: HistoryPlay, isFirst: Bool, isLast: Bool) -> some View {
        let dotY = Theme.History.rowVertical + Theme.History.rowSleeve / 2
        return Button {} label: {
            HStack(alignment: .top, spacing: 0) {
                if !compact {
                    Text(play.timeText)
                        .font(.system(.footnote, design: .rounded, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(.white.opacity(0.92))
                        .frame(width: Theme.History.timeColumn, alignment: .trailing)
                        .padding(.top, dotY - 9)
                }
                Color.clear.frame(width: Theme.History.spineColumn)
                HStack(alignment: .top, spacing: 12) {
                    HistorySleeve(play: play, side: Theme.History.rowSleeve)
                    VStack(alignment: .leading, spacing: 2) {
                        if compact {
                            Text(play.timeText)
                                .font(.system(.footnote, design: .rounded, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(play.tint.blended(with: .white, by: 0.55))
                        }
                        Text(play.track.title).font(.headline).foregroundStyle(.white)
                        Text(play.release.artist).font(.subheadline).foregroundStyle(Theme.secondaryText)
                        HistoryDeviceLine(play: play).padding(.top, 2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.trailing, 16)
            }
            .padding(.vertical, Theme.History.rowVertical)
            .frame(minHeight: Theme.History.minTarget)
            .contentShape(Rectangle())
            .background(alignment: .topLeading) { spine(play, dotY: dotY, isFirst: isFirst, isLast: isLast) }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(play.spoken)
        .accessibilityHint("Opens the song")
    }

    /// The thin vertical line with a cover-coloured dot where each play sits.
    private func spine(_ play: HistoryPlay, dotY: CGFloat, isFirst: Bool, isLast: Bool) -> some View {
        let x = (compact ? 0 : Theme.History.timeColumn) + Theme.History.spineColumn / 2
        return GeometryReader { geo in
            Path { path in
                path.addRect(CGRect(x: x - Theme.History.spineWidth / 2, y: isFirst ? dotY : 0,
                                    width: Theme.History.spineWidth, height: (isLast ? dotY : geo.size.height) - (isFirst ? dotY : 0)))
            }
            .fill(.white.opacity(Theme.History.spineOpacity))
            Circle()
                .fill(play.tint)
                .overlay(Circle().strokeBorder(.white.opacity(0.9), lineWidth: 2))
                .frame(width: Theme.History.dotSize, height: Theme.History.dotSize)
                .shadow(color: play.tint.opacity(0.8), radius: Theme.History.dotGlow)
                .position(x: x, y: dotY)
        }
    }
}

// MARK: - B: Day strip and crate

private struct HistoryCrateView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    /// Starts small: the sleeves are fixed-size, so a wide first guess would hold the frame wide.
    @State private var width: CGFloat = 300
    @State private var selected: String = PlayPeriods.localDayString(Date(), calendar: .current)

    private struct StripDay: Identifiable {
        var date: Date
        var day: String
        var plays: [HistoryPlay]
        var id: String { day }
    }

    private var strip: [StripDay] {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        return (0..<Theme.History.stripDays).reversed().map { back in
            let date = calendar.date(byAdding: .day, value: -back, to: start) ?? start
            let day = PlayPeriods.localDayString(date, calendar: calendar)
            return StripDay(date: date, day: day, plays: HistoryFixture.plays.filter { $0.day == day }.sorted { $0.startedAt > $1.startedAt })
        }
    }

    private var single: Bool { typeSize.isAccessibilitySize }

    var body: some View {
        let chosen = strip.first { $0.day == selected } ?? strip[strip.count - 1]
        ZStack {
            HistoryBackdrop(palette: chosen.plays.first?.palette ?? .neutral)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HistoryTitle().padding(.horizontal, Theme.History.gutter)
                    stripView
                    dayHeader(chosen)
                    crate(chosen.plays)
                }
                .padding(.bottom, 32)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    private var stripView: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(strip) { day in column(day) }
            }
            .padding(.horizontal, Theme.History.gutter - 2)
            .padding(.vertical, 6)
        }
        .defaultScrollAnchor(.trailing)
    }

    private func column(_ day: StripDay) -> some View {
        let isSelected = day.day == selected
        let tint = day.plays.first?.tint ?? .white
        let shown = Array(day.plays.prefix(Theme.History.stripMaxDiscs))
        let stackHeight = CGFloat(Theme.History.stripMaxDiscs) * (Theme.History.stripDiscHeight + Theme.History.stripDiscGap)
        return Button { selected = day.day } label: {
            VStack(spacing: 8) {
                VStack(spacing: Theme.History.stripDiscGap) {
                    if shown.isEmpty {
                        Capsule().fill(.white.opacity(0.22)).frame(width: 10, height: 2)
                    }
                    ForEach(shown) { play in
                        Capsule()
                            .fill(LinearGradient(colors: [play.tint.blended(with: .white, by: 0.25), play.tint.blended(with: .black, by: 0.25)], startPoint: .top, endPoint: .bottom))
                            .overlay(Capsule().strokeBorder(.black.opacity(0.35), lineWidth: 0.5))
                            .frame(width: Theme.History.stripDiscWidth, height: Theme.History.stripDiscHeight)
                    }
                }
                .frame(height: stackHeight, alignment: .bottom)
                .shadow(color: isSelected ? tint.opacity(0.95) : .clear, radius: Theme.History.stripGlowRadius)
                VStack(spacing: 0) {
                    Text(HistoryFormat.weekday(day.date)).font(.caption2.weight(isSelected ? .bold : .regular))
                    Text(day.date, format: .dateTime.day()).font(.footnote.weight(.semibold)).monospacedDigit()
                }
                .foregroundStyle(isSelected ? .white : Theme.secondaryText)
                .fixedSize()
            }
            .padding(.vertical, 8)
            .frame(minWidth: Theme.History.stripColumn, minHeight: Theme.History.minTarget)
            .padding(.horizontal, 2)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(LinearGradient(colors: [tint.opacity(0.34), tint.opacity(0.10)], startPoint: .bottom, endPoint: .top))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(tint.opacity(0.75), lineWidth: 1.5))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(HistoryFormat.dayLabel(day.date)), \(day.plays.isEmpty ? "no plays" : day.plays.count == 1 ? "1 play" : "\(day.plays.count) plays")")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func dayHeader(_ day: StripDay) -> some View {
        let model = HistoryDay(day: day.day, date: day.date, plays: day.plays)
        let tint = day.plays.first?.tint ?? Theme.accent
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                Text(model.label).font(.system(.title, weight: .bold)).foregroundStyle(.white)
                Text(model.countText).font(.subheadline).foregroundStyle(Theme.secondaryText)
                Spacer(minLength: 8)
                HistoryMinutes(text: model.minutes, tint: tint)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(model.label).font(.system(.title, weight: .bold)).foregroundStyle(.white)
                Text(model.countText).font(.subheadline).foregroundStyle(Theme.secondaryText)
                HistoryMinutes(text: model.minutes, tint: tint)
            }
        }
        .padding(.horizontal, Theme.History.gutter)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder
    private func crate(_ plays: [HistoryPlay]) -> some View {
        let columns = single ? 1 : 2
        let cell = (width - 2 * Theme.History.gutter - CGFloat(columns - 1) * Theme.History.crateGap) / CGFloat(columns)
        let side = min(single ? 190 : 200, cell / (1 + Theme.Immersive.discToSleeveRatio * Theme.Immersive.discPeekRatio))
        HStack(alignment: .top, spacing: Theme.History.crateGap) {
            ForEach(0..<columns, id: \.self) { column in
                VStack(alignment: .leading, spacing: 22) {
                    ForEach(Array(plays.enumerated()).filter { $0.offset % columns == column }, id: \.element.id) { _, play in
                        crateCell(play, side: side)
                    }
                }
                .padding(.top, column == 1 ? Theme.History.crateStagger : 0)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, Theme.History.gutter)
    }

    private func crateCell(_ play: HistoryPlay, side: CGFloat) -> some View {
        Button {} label: {
            VStack(alignment: .leading, spacing: 8) {
                HistorySleeve(play: play, side: side, radius: Theme.History.sleeveRadiusLarge)
                VStack(alignment: .leading, spacing: 2) {
                    Text(play.timeText)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(play.tint.blended(with: .white, by: 0.6))
                    Text(play.track.title).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                    HistoryDeviceLine(play: play, showsHeard: false)
                }
            }
            .frame(minHeight: Theme.History.minTarget, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(play.spoken)
        .accessibilityHint("Opens the song")
    }
}

// MARK: - C: Stacked vinyl

private struct HistoryStackView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: CGFloat = 390
    @State private var open: Set<String> = [PlayPeriods.localDayString(Date(), calendar: .current)]

    var body: some View {
        let days = HistoryFixture.days
        ZStack {
            HistoryBackdrop(palette: days.first?.plays.first?.palette ?? .neutral)
            ScrollView {
                VStack(alignment: .leading, spacing: 30) {
                    HistoryTitle()
                    ForEach(days) { day in dayBlock(day) }
                }
                .padding(.horizontal, Theme.History.gutter)
                .padding(.bottom, 32)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    @ViewBuilder
    private func dayBlock(_ day: HistoryDay) -> some View {
        let isOpen = open.contains(day.day)
        let tint = day.plays.first?.tint ?? Theme.accent
        VStack(alignment: .leading, spacing: 14) {
            Button {
                if isOpen { open.remove(day.day) } else { open.insert(day.day) }
            } label: {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        titleBlock(day)
                        Spacer(minLength: 8)
                        HistoryMinutes(text: day.minutes, tint: tint)
                        chevron(isOpen)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        titleBlock(day)
                        HStack { HistoryMinutes(text: day.minutes, tint: tint); chevron(isOpen) }
                    }
                }
                .frame(minHeight: Theme.History.minTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(day.label), \(day.countText), \(day.minutes)")
            .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
            .accessibilityAddTraits(.isHeader)
            if isOpen {
                list(day)
            } else {
                fan(day)
            }
        }
    }

    private func titleBlock(_ day: HistoryDay) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(day.label).font(.system(.title, weight: .bold)).foregroundStyle(.white)
            Text(day.countText).font(.subheadline).foregroundStyle(Theme.secondaryText)
        }
    }

    private func chevron(_ isOpen: Bool) -> some View {
        Image(systemName: isOpen ? "chevron.up" : "chevron.down")
            .font(.system(.footnote, weight: .bold))
            .foregroundStyle(.white.opacity(0.85))
            .frame(width: 28, height: 28)
    }

    /// Today: one lit glass sheet holding the plays, with hairlines between them.
    private func list(_ day: HistoryDay) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.History.listRadius, style: .continuous)
        let stacked = typeSize.isAccessibilitySize || width < Theme.History.narrowWidth
        return VStack(spacing: 0) {
            ForEach(Array(day.plays.enumerated()), id: \.element.id) { index, play in
                Button {} label: {
                    HStack(alignment: .center, spacing: 12) {
                        HistorySleeve(play: play, side: Theme.History.rowSleeve + 8)
                        VStack(alignment: .leading, spacing: 2) {
                            if stacked {
                                Text(play.timeText).font(.system(.footnote, design: .rounded, weight: .bold)).monospacedDigit()
                                    .foregroundStyle(play.tint.blended(with: .white, by: 0.6))
                            }
                            Text(play.track.title).font(.headline).foregroundStyle(.white)
                            HistoryDeviceLine(play: play)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if !stacked {
                            Text(play.timeText).font(.system(.footnote, design: .rounded, weight: .bold)).monospacedDigit()
                                .foregroundStyle(play.tint.blended(with: .white, by: 0.6))
                        }
                    }
                    .padding(.vertical, 10)
                    .padding(.horizontal, 14)
                    .frame(minHeight: Theme.History.minTarget)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(play.spoken)
                .accessibilityHint("Opens the song")
                if index < day.plays.count - 1 {
                    Rectangle().fill(.white.opacity(0.08)).frame(height: 1).padding(.leading, 14 + Theme.History.rowSleeve + 8 + 12)
                }
            }
        }
        .padding(.vertical, 6)
        .background(Theme.SongPage.panelFill.opacity(0.88), in: shape)
        .overlay(shape.strokeBorder(LinearGradient(colors: [.white.opacity(0.16), .white.opacity(0.03)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
    }

    /// An earlier day: its releases fanned and overlapping, newest on top.
    private func fan(_ day: HistoryDay) -> some View {
        let items = Array(day.releases.prefix(Theme.History.fanMaxCount))
        let side = width < Theme.History.narrowWidth ? Theme.History.fanSleeveNarrow : Theme.History.fanSleeve
        let room = width - 2 * Theme.History.gutter - side
        let step = items.count > 1 ? min(side * Theme.History.fanStepRatio, room / CGFloat(items.count - 1)) : 0
        let mid = CGFloat(items.count - 1) / 2
        let names = day.releases.map(\.release.title)
        let caption = names.count > 2 ? "\(names[0]), \(names[1]) and \(names.count - 2) more" : names.joined(separator: ", ")
        return VStack(alignment: .leading, spacing: 10) {
            ZStack {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, play in
                    let offset = CGFloat(index) - mid
                    HistorySleeveFlat(play: play, side: side)
                        .rotationEffect(.degrees(Double(offset) * Theme.History.fanTiltDegrees))
                        .offset(x: offset * step, y: offset * offset * Theme.History.fanArc)
                        .zIndex(Double(items.count - index))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: side + 24)
            .accessibilityHidden(true)
            Text(caption).font(.footnote).foregroundStyle(Theme.secondaryText)
                .frame(maxWidth: .infinity, alignment: .center).multilineTextAlignment(.center)
        }
    }
}

/// A bare sleeve for the fans.
private struct HistorySleeveFlat: View {
    let play: HistoryPlay
    let side: CGFloat
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.History.sleeveRadiusLarge, style: .continuous)
        Group {
            if let image = play.image { Image(uiImage: image).resizable().scaledToFill() } else { Theme.card }
        }
        .frame(width: side, height: side)
        .clipShape(shape)
        .overlay(shape.strokeBorder(LinearGradient(colors: [.white.opacity(0.35), .white.opacity(0.04)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
        .shadow(color: .black.opacity(0.55), radius: 10, x: 0, y: 6)
    }
}
#endif
