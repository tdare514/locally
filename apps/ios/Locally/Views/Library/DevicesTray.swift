import SwiftUI

// "From your devices" on the Library tab (#269): the Mac's tray (`PhoneInbox.tsx`) carried to the phone.
// `DevicesTrayModel` holds the logic (which rows, in which state, open and close, the badge) so it
// can be tested; the views below only draw it.

/// What a row of the tray shows and does. The phone cannot tell whether a pending record's audio is
/// missing from the service (the missing-files check is about this phone's own releases), so a failed
/// accept is a generic failure, never "still sending" or "waiting" (those are the Mac's).
enum DevicesTrayRowState: Equatable {
    /// The sleeve is the Send button.
    case ready
    /// A send is running (`SyncStatus.acceptingIds`); it wins over an earlier failure.
    case sending
    /// The last send failed (`SyncStatus.failedAcceptIds`); the row offers Try again.
    case failed
}

struct DevicesTrayRow: Identifiable, Equatable {
    let id: String
    let title: String
    let artist: String
    let trackCount: Int
    let origin: String
    let state: DevicesTrayRowState
    /// Which section it is in: the last send failed (#296). Separate from `state`, because a row
    /// being sent keeps the section it was in, with its sending look.
    let inFailedSection: Bool

    /// A row can be sent unless a send is already running.
    var canSend: Bool { state != .sending }
}

/// The two runs a section's action can start (#296).
enum DevicesTrayRun: Hashable { case addAll, tryAllAgain }

/// Where VoiceOver focus can sit in the tray: a row's sleeve, a failed row's retry, a section's
/// action, or the tray heading.
enum DevicesTrayFocus: Hashable {
    case send(String)
    case retry(String)
    case sectionAction(DevicesTrayRun)
    case heading
}

/// The tray's rows in its two sections (#296): **Ready to add**, then **Couldn't send yet**. A row
/// is in exactly one, by whether its last send failed; a row being sent stays where it was.
struct DevicesTraySections: Equatable {
    let ready: [DevicesTrayRow]
    let failed: [DevicesTrayRow]

    init(rows: [DevicesTrayRow]) {
        ready = rows.filter { !$0.inFailedSection }
        failed = rows.filter(\.inFailedSection)
    }

    /// The rows "Add all" would take now: ready and not being sent.
    var addableCount: Int { ready.filter { $0.state == .ready }.count }
    /// The rows "Try all again" would take now.
    var retryableCount: Int { failed.filter { $0.state == .failed }.count }

    /// "Add all" shows from two ready rows, and stays while its own run is going.
    func showsAddAll(running: Bool) -> Bool { running || addableCount >= 2 }
    /// "Try all again" shows whenever the second section does.
    var showsTryAllAgain: Bool { !failed.isEmpty }

    var orderedIDs: [String] { (ready + failed).map(\.id) }

    /// Where focus goes when the row `id` leaves while focus was on its own control: the next row's
    /// control, else the previous row's, else a section's action, else the tray heading. Only
    /// enabled controls count: a row being sent (or reserved) and a disabled action are skipped.
    static func focusAfterLeaving(_ id: String, before: DevicesTraySections, after: DevicesTraySections, runs: Set<DevicesTrayRun>) -> DevicesTrayFocus {
        let order = before.orderedIDs
        let enabled = Set((after.ready + after.failed).filter { $0.state != .sending }.map(\.id))
        if let index = order.firstIndex(of: id) {
            if let next = order[(index + 1)...].first(where: { enabled.contains($0) }) { return .send(next) }
            if let previous = order[..<index].last(where: { enabled.contains($0) }) { return .send(previous) }
        }
        if after.showsAddAll(running: runs.contains(.addAll)) && !runs.contains(.addAll) && after.addableCount > 0 { return .sectionAction(.addAll) }
        if after.showsTryAllAgain && !runs.contains(.tryAllAgain) && after.retryableCount > 0 { return .sectionAction(.tryAllAgain) }
        return .heading
    }
}

struct DevicesTrayModel: Equatable {
    var isOpen = false

    mutating func toggle() { isOpen.toggle() }
    mutating func close() { isOpen = false }

    /// An empty tray has nothing to show, so it closes.
    mutating func pendingCountChanged(to count: Int) {
        if count == 0 { isOpen = false }
    }

    /// The badge is shown only while something is pending, and not while the tray is open.
    static func showsBadge(count: Int, isOpen: Bool) -> Bool { count > 0 && !isOpen }

    /// Rows keep the sync order. A running send beats an earlier failure.
    static func rows(pending: [SyncRecord], accepting: Set<String>, failed: Set<String>) -> [DevicesTrayRow] {
        pending.map { record in
            let state: DevicesTrayRowState = accepting.contains(record.id) ? .sending
                : failed.contains(record.id) ? .failed : .ready
            return DevicesTrayRow(id: record.id, title: record.title, artist: record.artist,
                                  trackCount: record.tracks.count, origin: record.origin, state: state,
                                  inFailedSection: failed.contains(record.id))
        }
    }
}

// MARK: - Button

/// The anchor of the header's button, so the tray can drop from it.
struct DevicesTrayAnchorKey: PreferenceKey {
    static var defaultValue: Anchor<CGRect>?
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = value ?? nextValue()
    }
}

/// The 40 pt faked-glass cloud (44 pt hit area) with the count badge; open, a bare red X.
struct DevicesTrayButton: View {
    let count: Int
    let isOpen: Bool
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Bumped when the count goes up, which brings in a fresh badge.
    @State private var badgeEpoch = 0

    /// The hit area; the visible glass is `visibleSide`.
    static let side: CGFloat = 44
    static let visibleSide: CGFloat = 40

    var body: some View {
        Button(action: action) {
            ZStack {
                if isOpen {
                    LocallyIcon(.x, size: 22, scaled: false)
                        .foregroundStyle(Theme.danger)
                        .transition(.opacity)
                } else {
                    Circle().fill(Theme.Immersive.panelFill)
                        .overlay(Circle().stroke(Theme.Immersive.panelStroke, lineWidth: 1))
                        .frame(width: Self.visibleSide, height: Self.visibleSide)
                        .overlay(
                            // The Mac's outline cloud has no hand-drawn glyph here yet; SF `cloud` is the closest.
                            Image(systemName: "cloud")
                                .font(.system(size: 19, weight: .regular))
                                .foregroundStyle(Theme.primaryText)
                        )
                        .transition(.opacity)
                }
            }
            .frame(width: Self.side, height: Self.side)
            .overlay(alignment: .topTrailing) {
                if DevicesTrayModel.showsBadge(count: count, isOpen: isOpen) {
                    badge.id(badgeEpoch)
                        .transition(reduceMotion ? .identity : .asymmetric(
                            insertion: .scale(scale: 0.6).combined(with: .opacity),
                            removal: .opacity))
                }
            }
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : DevicesTrayMotion.badge, value: DevicesTrayModel.showsBadge(count: count, isOpen: isOpen))
        .animation(reduceMotion ? nil : DevicesTrayMotion.badge, value: badgeEpoch)
        .onChange(of: count) { old, new in
            if new > old { badgeEpoch += 1 }
        }
        .accessibilityLabel(isOpen ? Copy.Sync.trayClose : Copy.Sync.trayButtonLabel(count: count))
    }

    private var badge: some View {
        Text("\(count)")
            .themeFont(.badge)
            .foregroundStyle(Theme.onAccent)
            .padding(.horizontal, 5)
            .frame(minWidth: 18, minHeight: 18)
            .background(Theme.accent, in: Capsule())
            // On the fixed 40 pt cloud, so it stops growing at the largest standard size (#226).
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .accessibilityHidden(true)
    }
}

enum DevicesTrayMotion {
    /// The house easing at 240 ms: the badge arriving and the tray opening.
    static let badge = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.24)
    static let open = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.24)
    /// Reduce Motion: the tray just fades.
    static let reducedFade = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.16)
    static let collapse = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.3)
}

// MARK: - Panel

/// The drop-down: heading, the two sections (each a header line with its count and action, then
/// its rows), scrolling when taller than `maxHeight`.
struct DevicesTrayPanel: View {
    let rows: [DevicesTrayRow]
    let maxHeight: CGFloat
    var headingFocus: AccessibilityFocusState<Bool>.Binding?
    /// The runs in flight: their buttons read "Adding…" or "Trying…" and are disabled.
    var runs: Set<DevicesTrayRun> = []
    let onSend: (String) -> Void
    var onAddAll: () -> Void = {}
    var onTryAllAgain: () -> Void = {}

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.displayScale) private var displayScale
    @State private var contentHeight: CGFloat = 0
    @AccessibilityFocusState private var focus: DevicesTrayFocus?
    /// The row whose own control had focus when it was used; if that row leaves, focus moves on.
    @State private var focusedRowWhenUsed: String?
    @State private var previousSections: DevicesTraySections?

    private static let radius: CGFloat = 22

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Self.radius, style: .continuous)
        let sections = DevicesTraySections(rows: rows)
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(Copy.Sync.fromYourDevices)
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(Theme.primaryText)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityHeading(.h2)
                    .modifier(HeadingFocus(binding: headingFocus))
                    .accessibilityFocused($focus, equals: .heading)
                if !sections.ready.isEmpty {
                    section(name: Copy.Sync.readyToAdd, rows: sections.ready, run: .addAll,
                            showsAction: sections.showsAddAll(running: runs.contains(.addAll)),
                            actionEnabled: sections.addableCount > 0, note: nil)
                }
                if !sections.ready.isEmpty && !sections.failed.isEmpty {
                    Rectangle().fill(Theme.Track.separatorTint).frame(height: 1 / displayScale)
                        .accessibilityHidden(true)
                }
                if !sections.failed.isEmpty {
                    section(name: Copy.Sync.couldntSendYet, rows: sections.failed, run: .tryAllAgain,
                            showsAction: sections.showsTryAllAgain,
                            actionEnabled: sections.retryableCount > 0, note: Copy.Sync.couldntSendThese)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                GeometryReader { geo in
                    Color.clear.preference(key: DevicesTrayHeightKey.self, value: geo.size.height)
                }
            )
        }
        .onPreferenceChange(DevicesTrayHeightKey.self) { contentHeight = $0 }
        .frame(height: contentHeight > 0 ? min(contentHeight, maxHeight) : maxHeight)
        .scrollBounceBehavior(.basedOnSize)
        .background(
            // Faked glass: a opaque dark base under the faint white fill, so the library behind
            // never reads through the text (no live blur on the phone).
            shape.fill(Theme.card)
                .overlay(shape.fill(Theme.Immersive.panelFill))
        )
        .overlay(shape.stroke(Theme.Immersive.panelStroke, lineWidth: 1))
        .clipShape(shape)
        .shadow(color: .black.opacity(0.45), radius: 18, y: 8)
        .animation(reduceMotion ? nil : DevicesTrayMotion.collapse, value: rows.map(\.id))
        .accessibilityElement(children: .contain)
        .onAppear { previousSections = sections }
        .onChange(of: rows.map(\.id)) { _, _ in
            let after = DevicesTraySections(rows: rows)
            defer { previousSections = after }
            // Focus moves only when it was on the leaving row's own control (design: #296).
            guard let leaving = focusedRowWhenUsed, let before = previousSections,
                  !after.orderedIDs.contains(leaving) else { return }
            focusedRowWhenUsed = nil
            let target = DevicesTraySections.focusAfterLeaving(leaving, before: before, after: after, runs: runs)
            if target == .heading, let headingFocus { headingFocus.wrappedValue = true } else { focus = target }
        }
        .onChange(of: focus) { _, new in
            // Focus went somewhere else: a later departure is not ours to follow.
            guard let used = focusedRowWhenUsed, new != .send(used), new != .retry(used) else { return }
            if new != nil { focusedRowWhenUsed = nil }
        }
    }

    /// One section: its header line (name, count and the one action), an optional note, then its rows.
    private func section(name: String, rows: [DevicesTrayRow], run: DevicesTrayRun, showsAction: Bool, actionEnabled: Bool, note: String?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader(name: name, count: rows.count, run: run, showsAction: showsAction, actionEnabled: actionEnabled)
            if let note {
                Text(note)
                    .themeFont(.dropZoneHint)
                    .foregroundStyle(Theme.secondaryText)
            }
            VStack(alignment: .leading, spacing: 14) {
                ForEach(rows) { row in
                    DevicesTrayRowView(
                        row: row,
                        onSend: { used(row.id, retry: false); onSend(row.id) },
                        onRetry: { used(row.id, retry: true); onSend(row.id) },
                        focus: $focus
                    )
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.94, anchor: .top)))
                }
            }
        }
    }

    private func used(_ id: String, retry: Bool) {
        focusedRowWhenUsed = (focus == .send(id) || focus == .retry(id)) ? id : nil
    }

    @ViewBuilder
    private func sectionHeader(name: String, count: Int, run: DevicesTrayRun, showsAction: Bool, actionEnabled: Bool) -> some View {
        let heading = HStack(spacing: 6) {
            Text(name).font(.system(.footnote, weight: .semibold)).foregroundStyle(Theme.primaryText)
            Text("\(count)").font(.system(.footnote)).foregroundStyle(Theme.textDim)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Copy.Sync.sectionHeading(name, count: count))
        .accessibilityAddTraits(.isHeader)
        .accessibilityHeading(.h3)
        let action = DevicesTraySectionAction(run: run, isRunning: runs.contains(run), isEnabled: actionEnabled) {
            run == .addAll ? onAddAll() : onTryAllAgain()
        }
        .accessibilityFocused($focus, equals: .sectionAction(run))
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                heading
                if showsAction { action }
            }
        } else {
            HStack {
                heading
                Spacer(minLength: 8)
                if showsAction { action }
            }
        }
    }
}

/// The section's one action, **Add all** or **Try all again**: the same secondary pill, the same
/// size, reading "Adding…" or "Trying…" and disabled until its own run ends.
struct DevicesTraySectionAction: View {
    let run: DevicesTrayRun
    let isRunning: Bool
    let isEnabled: Bool
    let action: () -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .caption) private var labelSize: CGFloat = 12
    @ScaledMetric(relativeTo: .caption) private var width: CGFloat = 96

    /// At the accessibility sizes the scaled minimum would be wider than the 300 pt tray, so the
    /// label sizes the pill and wraps instead.
    private var wraps: Bool { dynamicTypeSize.isAccessibilitySize }

    private var title: String {
        switch (run, isRunning) {
        case (.addAll, false): Copy.Sync.addAll
        case (.addAll, true): Copy.Sync.adding
        case (.tryAllAgain, false): Copy.Sync.tryAllAgain
        case (.tryAllAgain, true): Copy.Sync.trying
        }
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: labelSize, weight: .semibold))
                .foregroundStyle(Theme.primaryText)
                .lineLimit(wraps ? nil : 1)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.8)
                .frame(minWidth: wraps ? nil : width)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Capsule().fill(Theme.Immersive.panelFill))
                .overlay(Capsule().stroke(Theme.Immersive.panelStroke, lineWidth: 1))
                .opacity(isRunning || !isEnabled ? 0.5 : 1)
                // The pill stays compact; the tap area is 44 pt tall.
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isRunning || !isEnabled)
        .accessibilityIdentifier(run == .addAll ? "tray-add-all" : "tray-try-all-again")
    }
}

/// Applies the focus binding when the caller supplies one (the gallery's panels do not).
private struct HeadingFocus: ViewModifier {
    let binding: AccessibilityFocusState<Bool>.Binding?
    func body(content: Content) -> some View {
        if let binding { content.accessibilityFocused(binding) } else { content }
    }
}

private struct DevicesTrayHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

// MARK: - Row

struct DevicesTrayRowView: View {
    let row: DevicesTrayRow
    var cover: UIImage?
    let onSend: () -> Void
    var onRetry: () -> Void = {}
    var focus: AccessibilityFocusState<DevicesTrayFocus?>.Binding?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .subheadline) private var titleSize: CGFloat = 15
    @ScaledMetric(relativeTo: .footnote) private var detailSize: CGFloat = 13
    @ScaledMetric(relativeTo: .caption) private var labelSize: CGFloat = 12

    init(row: DevicesTrayRow, cover: UIImage? = nil, onSend: @escaping () -> Void, onRetry: @escaping () -> Void = {}, focus: AccessibilityFocusState<DevicesTrayFocus?>.Binding? = nil) {
        self.row = row
        self.cover = cover
        self.onSend = onSend
        self.onRetry = onRetry
        self.focus = focus
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            sleeve
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(.system(size: titleSize, weight: .semibold))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                    .truncationMode(.tail)
                Text("\(row.artist) · \(Copy.Sync.trackCount(row.trackCount))")
                    .font(.system(size: detailSize))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                    .truncationMode(.tail)
                Text(Copy.Sync.originLabel(row.origin))
                    .font(.system(size: labelSize))
                    .foregroundStyle(Theme.textDim)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityHint(row.inFailedSection ? Copy.Sync.failedHint : "")
            if row.inFailedSection { retryButton }
        }
    }

    @ViewBuilder private var sleeve: some View {
        let sleeve = DevicesSleeve(state: row.state, cover: cover, title: row.title, onSend: onSend)
        if let focus { sleeve.accessibilityFocused(focus, equals: .send(row.id)) } else { sleeve }
    }

    /// A failed row's own retry: a small icon button at its end (a send there is one download).
    @ViewBuilder private var retryButton: some View {
        let button = Button(action: onRetry) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: detailSize, weight: .semibold))
                .foregroundStyle(Theme.primaryText)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(row.state == .sending)
        .opacity(row.state == .sending ? 0.4 : 1)
        .accessibilityLabel(Copy.Sync.tryTitleAgain(row.title))
        // 44 pt target, but it sits flush with the row's top and trailing edge.
        .padding(.top, -4)
        .padding(.trailing, -8)
        if let focus { button.accessibilityFocused(focus, equals: .retry(row.id)) } else { button }
    }
}

// MARK: - Sleeve

/// The 48 pt cover (radius 10) with the disc peeking out. `RecordSleeve` is the Import tab's
/// add-cover button (radius 4, its own accessibility), so the row shares its `RecordDisc` instead.
/// Pressed, the cover turns `accent` with a black plus and the disc rolls out; while sending it is
/// `accent` with a small spinner.
struct DevicesSleeve: View {
    let state: DevicesTrayRowState
    let cover: UIImage?
    let title: String
    let onSend: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let size: CGFloat = 48
    private static let radius: CGFloat = 10

    private var width: CGFloat { Self.size + Self.size * Theme.Immersive.discToSleeveRatio * Theme.Immersive.discPeekRatio }

    var body: some View {
        Button(action: onSend) { Color.clear }
            .buttonStyle(SleeveStyle(content: { pressed in
                art(pressed: pressed, plus: state != .sending, spinner: state == .sending)
            }, reduceMotion: reduceMotion))
            .disabled(state == .sending)
            .accessibilityLabel(Copy.Sync.sendTitleToSpotify(title))
            .frame(width: width, height: Self.size, alignment: .leading)
    }

    private func art(pressed: Bool, plus: Bool, spinner: Bool) -> some View {
        let disc = Self.size * Theme.Immersive.discToSleeveRatio
        let peek = disc * Theme.Immersive.discPeekRatio
        let roll: CGFloat = pressed && !reduceMotion ? 10 : 0
        let shape = RoundedRectangle(cornerRadius: Self.radius, style: .continuous)
        return ZStack(alignment: .leading) {
            RecordDisc(cover: cover, size: disc, rotationDegrees: pressed && !reduceMotion ? 50 : 0)
                .offset(x: Self.size + peek - disc + roll)
                .accessibilityHidden(true)
            ZStack {
                if let cover {
                    Image(uiImage: cover).resizable().scaledToFill()
                } else {
                    NoCoverArt()
                }
                if pressed || spinner {
                    Theme.accent
                    if spinner {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Image(systemName: "plus").font(.system(size: 20, weight: .bold)).foregroundStyle(Theme.onAccent)
                    }
                }
            }
            .frame(width: Self.size, height: Self.size)
            .clipShape(shape)
            .overlay(shape.stroke(Theme.Immersive.panelStroke, lineWidth: 1))
        }
        .frame(width: width, height: Self.size, alignment: .leading)
    }

    private struct SleeveStyle<Content: View>: ButtonStyle {
        let content: (Bool) -> Content
        let reduceMotion: Bool
        func makeBody(configuration: Configuration) -> some View {
            content(configuration.isPressed)
                .animation(reduceMotion ? nil : DevicesTrayMotion.open, value: configuration.isPressed)
                .contentShape(Rectangle())
        }
    }
}
