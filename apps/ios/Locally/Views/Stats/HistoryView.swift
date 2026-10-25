import SwiftUI
import UIKit

/// A push of the History screen onto a navigation stack (#399), the way `SongRoute` pushes a song. `day` is the
/// `YYYY-MM-DD` to open on; today when nil. `focusStartedAt` (epoch ms) is the play the screen was opened for: History
/// opens on the day that play is stored under, which is the playing device's date, and uses `day` (this phone's
/// date) only when it never finds the play.
struct HistoryRoute: Hashable {
    var day: String?
    var focusStartedAt: Int64?
}

/// History as a stack shows it: builds the model from the app container once it is there.
struct HistoryDestination: View {
    let route: HistoryRoute
    @Environment(\.appContainer) private var container
    @State private var built: (model: HistoryModel, covers: HistoryCovers)?

    var body: some View {
        Group {
            if let built {
                HistoryView(model: built.model, covers: built.covers)
            } else {
                Color.clear
            }
        }
        .task {
            guard built == nil, let container else { return }
            let store = container.coverStore
            let library = container.library
            built = (
                HistoryModel(service: container.playHistory, releases: { (try? library.all()) ?? [] }, selected: route.day, focusStartedAt: route.focusStartedAt),
                HistoryCovers(cache: StatsCoverCache(loader: { store.load($0) })))
        }
    }
}

/// The play History screen (#399), the owner's variant B "Day strip and crate": a strip of the last 14 days (older
/// ones load as it scrolls back), each day a stack of discs, and under it the selected day's plays as a crate of
/// record sleeves, newest first, with the time and the device. The cover colours of the day's newest play wash the page.
struct HistoryView: View {
    @State private var model: HistoryModel
    @State private var covers: HistoryCovers
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.openSong) private var openSong
    @Environment(\.openSettingsTab) private var openSettingsTab
    /// Starts small: the sleeves are fixed-size, so a wide first guess would hold the frame wide.
    @State private var width: CGFloat = 300
    @State private var stripTarget: String?
    /// The day at the strip's leading edge.
    @State private var stripLeading: String?
    /// The strip days that have appeared on screen, so their covers load as the strip scrolls back (not only the newest 14).
    @State private var visibleDays = Set<String>()

    init(model: HistoryModel, covers: HistoryCovers) {
        _model = State(initialValue: model)
        _covers = State(initialValue: covers)
    }

    private var single: Bool { typeSize.isAccessibilitySize }
    private var calendar: Calendar { .current }

    /// Every release the page can draw: the day strip's discs and the selected day's sleeves.
    private var shownReleases: Set<UUID> {
        var ids = model.releaseIds(onDays: visibleDays, discs: Theme.History.stripMaxDiscs)
        model.selectedDay.plays.forEach { ids.insert($0.releaseId) }
        return ids
    }

    var body: some View {
        let chosen = model.selectedDay
        ZStack {
            HistoryBackdrop(palette: covers.palette(of: chosen.topReleaseId))
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HistoryTitle().padding(.horizontal, Theme.History.gutter)
                    content(chosen)
                }
                .padding(.bottom, 32)
            }
            .refreshable { await model.load(force: true) }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .task {
            await model.load()
            model.rebuild()
            await model.focus()
            stripTarget = model.selected
        }
        .task(id: shownReleases) { await covers.load(shownReleases) }
    }

    @ViewBuilder
    private func content(_ chosen: HistoryDay) -> some View {
        switch model.phase {
        case .loading:
            HistorySkeleton(columns: single ? 1 : 2, side: crateSide)
                .padding(.horizontal, Theme.History.gutter)
        case .signedOut:
            signedOutCard.padding(.horizontal, Theme.History.gutter)
        case .failed:
            messageCard(model.notice == .busy ? Copy.History.busy : Copy.History.failed)
                .padding(.horizontal, Theme.History.gutter)
        case .ready:
            if model.notice != .none { noticeLine }
            stripView
            dayHeader(chosen)
            if model.isEmpty {
                emptyCard.padding(.horizontal, Theme.History.gutter)
            } else if chosen.plays.isEmpty {
                Text(Copy.History.nothingThisDay)
                    .font(.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, Theme.History.gutter)
            } else {
                crate(chosen.plays)
            }
        }
    }

    // MARK: States

    /// On a near-black pill (faked glass), not bare on the wash: white text on it stays above 4.5:1 over the brightest cover colours.
    private var noticeLine: some View {
        Text(model.notice == .busy ? Copy.History.busy : Copy.History.offline)
            .font(.footnote)
            .foregroundStyle(Theme.primaryText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(.black.opacity(Theme.History.noticeBackingOpacity))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.white.opacity(0.12), lineWidth: 0.5)))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.History.gutter)
            .accessibilityIdentifier("history-notice")
    }

    private var signedOutCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Text(Copy.History.signedOutTitle)
                    .font(Theme.ScaledFont.headline)
                    .foregroundStyle(Theme.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Text(Copy.History.signedOutBody)
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                if let openSettingsTab {
                    Button(Copy.History.signedOutAction, action: openSettingsTab)
                        .buttonStyle(CoverGlowButtonStyle(colors: [Theme.accent, Theme.Studio.violet]))
                        .padding(.top, 6)
                }
            }
            .padding(16)
        }
    }

    private func messageCard(_ text: String) -> some View {
        GlassCard {
            Text(text)
                .font(Theme.ScaledFont.subheadline)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(16)
        }
    }

    private var emptyCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 6) {
                Text(Copy.History.emptyTitle)
                    .font(Theme.ScaledFont.headline)
                    .foregroundStyle(Theme.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Text(Copy.History.emptyBody)
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
    }

    // MARK: Strip

    private var stripView: some View {
        let days = Array(model.strip.reversed())
        return ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .bottom, spacing: 2) {
                    ForEach(days) { day in column(day).id(day.day).onAppear { visibleDays.insert(day.day) } }
                }
                .scrollTargetLayout()
                .padding(.horizontal, Theme.History.gutter - 2)
                .padding(.vertical, 6)
            }
            .defaultScrollAnchor(.trailing)
            .scrollPosition(id: $stripLeading, anchor: .leading)
            // The strip is scrolled back to its oldest day: read the 14 days before it.
            .onChange(of: stripLeading) { _, leading in
                guard let leading, leading == days.first?.day, model.canLoadOlder else { return }
                Task {
                    let before = model.windowsRead
                    await model.loadOlder()
                    // Days arrive on the left: put the strip back where it was, so it is not still "at the oldest day".
                    if model.windowsRead > before { stripLeading = leading }
                }
            }
            .onChange(of: stripTarget) { _, target in
                guard let target else { return }
                proxy.scrollTo(target, anchor: .center)
            }
        }
    }

    private func column(_ day: HistoryDay) -> some View {
        let isSelected = day.day == model.selected
        let tint = covers.tint(of: day.topReleaseId)
        let shown = Array(day.plays.prefix(Theme.History.stripMaxDiscs))
        let stackHeight = CGFloat(Theme.History.stripMaxDiscs) * (Theme.History.stripDiscHeight + Theme.History.stripDiscGap)
        let date = day.date(calendar: calendar)
        return Button { model.selected = day.day } label: {
            VStack(spacing: 8) {
                VStack(spacing: Theme.History.stripDiscGap) {
                    if shown.isEmpty {
                        Capsule().fill(.white.opacity(0.22)).frame(width: 10, height: 2)
                    }
                    ForEach(shown) { play in
                        let disc = covers.tint(of: play.releaseId)
                        Capsule()
                            .fill(LinearGradient(colors: [disc.blended(with: .white, by: 0.25), disc.blended(with: .black, by: 0.25)], startPoint: .top, endPoint: .bottom))
                            .overlay(Capsule().strokeBorder(.black.opacity(0.35), lineWidth: 0.5))
                            .frame(width: Theme.History.stripDiscWidth, height: Theme.History.stripDiscHeight)
                    }
                }
                .frame(height: stackHeight, alignment: .bottom)
                .shadow(color: isSelected ? tint.opacity(0.95) : .clear, radius: Theme.History.stripGlowRadius)
                VStack(spacing: 0) {
                    Text(Copy.History.weekday(date, calendar: calendar)).font(.caption2.weight(isSelected ? .bold : .regular))
                    Text(date, format: .dateTime.day()).font(.footnote.weight(.semibold)).monospacedDigit()
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
        .accessibilityLabel(Copy.History.stripLabel(date, plays: day.playCount, minutes: day.minutes, calendar: calendar))
        .accessibilityHint(Copy.History.dayHint)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("history-day-\(day.day)")
    }

    // MARK: Day

    private func dayHeader(_ day: HistoryDay) -> some View {
        let date = day.date(calendar: calendar)
        let label = Copy.History.dayLabel(date, calendar: calendar)
        let count = Copy.History.playCount(day.playCount)
        let tint = day.topReleaseId.map { covers.tint(of: $0) } ?? Theme.accent
        let minutes = day.plays.isEmpty ? nil : Copy.History.minutes(day.minutes)
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).font(.system(.title, weight: .bold)).foregroundStyle(.white)
                Text(count).font(.subheadline).foregroundStyle(Theme.secondaryText)
                Spacer(minLength: 8)
                if let minutes { HistoryMinutes(text: minutes, tint: tint) }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(label).font(.system(.title, weight: .bold)).foregroundStyle(.white)
                Text(count).font(.subheadline).foregroundStyle(Theme.secondaryText)
                if let minutes { HistoryMinutes(text: minutes, tint: tint) }
            }
        }
        .padding(.horizontal, Theme.History.gutter)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    // MARK: Crate

    private var crateColumns: Int { single ? 1 : 2 }

    private var crateSide: CGFloat {
        let cell = (width - 2 * Theme.History.gutter - CGFloat(crateColumns - 1) * Theme.History.crateGap) / CGFloat(crateColumns)
        let most = single ? Theme.History.crateSleeveMaxSingle : Theme.History.crateSleeveMax
        return max(40, min(most, cell / (1 + Theme.Immersive.discToSleeveRatio * Theme.Immersive.discPeekRatio)))
    }

    @ViewBuilder
    private func crate(_ plays: [HistoryPlay]) -> some View {
        let side = crateSide
        HStack(alignment: .top, spacing: Theme.History.crateGap) {
            ForEach(0..<crateColumns, id: \.self) { column in
                VStack(alignment: .leading, spacing: Theme.History.crateRowGap) {
                    ForEach(Array(plays.enumerated()).filter { $0.offset % crateColumns == column }, id: \.element.id) { _, play in
                        crateCell(play, side: side)
                    }
                }
                .padding(.top, column == 1 ? Theme.History.crateStagger : 0)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, Theme.History.gutter)
    }

    @ViewBuilder
    private func crateCell(_ play: HistoryPlay, side: CGFloat) -> some View {
        if play.opensSong, let openSong {
            Button { openSong(SongRoute(releaseId: play.releaseId, trackId: play.trackId)) } label: { cellBody(play, side: side) }
                .buttonStyle(.plain)
                .accessibilityLabel(play.spoken)
                .accessibilityHint(Copy.History.openHint)
                .accessibilityIdentifier("history-play-\(play.id)")
        } else {
            cellBody(play, side: side)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(play.spoken)
                .accessibilityHint(play.opensSong ? "" : Copy.History.unknownHint)
                .accessibilityIdentifier("history-play-\(play.id)")
        }
    }

    private func cellBody(_ play: HistoryPlay, side: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HistorySleeve(image: covers.images[play.releaseId], fraction: play.fraction, side: side, radius: Theme.History.sleeveRadiusLarge)
            VStack(alignment: .leading, spacing: 2) {
                Text(play.timeText)
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(covers.tint(of: play.releaseId).blended(with: .white, by: 0.6))
                Text(play.displayTitle).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                HistoryDeviceLine(play: play, showsHeard: false)
            }
        }
        .frame(minHeight: Theme.History.minTarget, alignment: .top)
        .contentShape(Rectangle())
    }
}
