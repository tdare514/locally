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

    /// A row can be sent unless a send is already running.
    var canSend: Bool { state != .sending }
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
                                  trackCount: record.tracks.count, origin: record.origin, state: state)
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
            .font(Theme.Font.badge)
            .foregroundStyle(Theme.onAccent)
            .padding(.horizontal, 5)
            .frame(minWidth: 18, minHeight: 18)
            .background(Theme.accent, in: Capsule())
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

/// The drop-down: heading, the rows, and the still-sending footer, scrolling when taller than `maxHeight`.
struct DevicesTrayPanel: View {
    let rows: [DevicesTrayRow]
    let maxHeight: CGFloat
    var headingFocus: AccessibilityFocusState<Bool>.Binding?
    let onSend: (String) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var contentHeight: CGFloat = 0

    private static let radius: CGFloat = 22

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Self.radius, style: .continuous)
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(Copy.Sync.fromYourDevices)
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(Theme.primaryText)
                    .accessibilityAddTraits(.isHeader)
                    .modifier(HeadingFocus(binding: headingFocus))
                ForEach(rows) { row in
                    DevicesTrayRowView(row: row, onSend: { onSend(row.id) })
                        .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.94, anchor: .top)))
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

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .subheadline) private var titleSize: CGFloat = 15
    @ScaledMetric(relativeTo: .footnote) private var detailSize: CGFloat = 13
    @ScaledMetric(relativeTo: .caption) private var labelSize: CGFloat = 12

    init(row: DevicesTrayRow, cover: UIImage? = nil, onSend: @escaping () -> Void) {
        self.row = row
        self.cover = cover
        self.onSend = onSend
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            DevicesSleeve(state: row.state, cover: cover, title: row.title, onSend: onSend)
            VStack(alignment: .leading, spacing: 2) {
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
                    if row.state == .failed {
                        Text(Copy.Sync.couldntSend)
                            .font(.system(size: labelSize))
                            .foregroundStyle(Theme.danger)
                            .padding(.top, 2)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityHint(row.state == .failed ? Copy.Sync.failedHint : "")
                if row.state == .failed {
                    Button(Copy.Sync.tryAgain, action: onSend)
                        .font(.system(size: labelSize, weight: .semibold))
                        .foregroundStyle(Theme.primaryText)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(Theme.Immersive.panelFill))
                        .overlay(Capsule().stroke(Theme.Immersive.panelStroke, lineWidth: 1))
                        .buttonStyle(.plain)
                        // The pill stays compact; the tap area is 44 pt tall.
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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
                    Theme.card
                    Image(systemName: "music.note")
                        .font(.system(size: 18, weight: .regular))
                        .foregroundStyle(Theme.secondaryText)
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
