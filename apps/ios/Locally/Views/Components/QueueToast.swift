import SwiftUI
import Observation

// The confirmation after "Play next" / "Add to queue" (#364): a light glass capsule tinted by the cover that hugs its text,
// centred and floating clear above the mini player. One center owns the message on screen; a new one replaces the old.

/// What one toast says.
struct QueueToastMessage: Equatable, Identifiable {
    let id = UUID()
    var title: String
    /// The song's title, or "3 songs".
    var detail: String?
    var cover: Data?

    /// The toast for what `PlaybackService` did, or nil when nothing was asked for. `subject` is the song's
    /// title or "3 songs".
    static func make(_ outcome: QueueAddOutcome, next: Bool, subject: String, cover: Data?) -> QueueToastMessage? {
        if outcome.added == 0 {
            guard outcome.leftOut > 0 else { return nil }
            return QueueToastMessage(title: Copy.TrackActions.onlyOnMac(outcome.leftOut), detail: outcome.leftOut == 1 ? subject : nil, cover: cover)
        }
        let title = outcome.started ? Copy.TrackActions.playingNow : (next ? Copy.TrackActions.playingNext : Copy.TrackActions.addedToQueue)
        let detail = outcome.leftOut > 0 ? Copy.TrackActions.someOnlyOnMac(added: outcome.added, leftOut: outcome.leftOut) : subject
        return QueueToastMessage(title: title, detail: detail, cover: cover)
    }
}

@MainActor
@Observable
final class QueueToastCenter {
    private(set) var current: QueueToastMessage?
    @ObservationIgnored private var hideTask: Task<Void, Never>?
    /// Off only in the debug gallery, so a screenshot can catch the toast.
    @ObservationIgnored var autoHides = true

    /// Shows `message` in place of any toast already up, announces it, and hides it after a few seconds.
    func show(_ message: QueueToastMessage) {
        hideTask?.cancel()
        current = message
        let spoken = [message.title, message.detail].compactMap { $0 }.joined(separator: ". ")
        AccessibilityNotification.Announcement(spoken).post()
        guard autoHides else { return }
        let seconds = UIAccessibility.isVoiceOverRunning ? Theme.QueueToast.voiceOverSeconds : Theme.QueueToast.displaySeconds
        hideTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            if !Task.isCancelled { self?.current = nil }
        }
    }

    func dismiss() {
        hideTask?.cancel()
        current = nil
    }
}

private struct QueueToastKey: EnvironmentKey {
    static let defaultValue: QueueToastCenter? = nil
}

extension EnvironmentValues {
    /// The app-wide toast center, injected beside `playback`.
    var queueToast: QueueToastCenter? {
        get { self[QueueToastKey.self] }
        set { self[QueueToastKey.self] = newValue }
    }
}

/// The capsule: dark glass under the cover's two colours, a rim, a small sleeve with a disc peeking out, and two lines.
struct QueueToast: View {
    let message: QueueToastMessage
    var onTap: () -> Void = {}

    @State private var palette: AmbientPalette?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var thumb: CGFloat = Theme.QueueToast.thumbSide

    var body: some View {
        let large = dynamicTypeSize.isAccessibilitySize
        Button(action: onTap) {
            HStack(spacing: 12) {
                QueueToastSleeve(cover: message.cover, side: min(thumb, 56), slides: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(message.title)
                        .themeFont(.rowTitle)
                        .foregroundStyle(Theme.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    if let detail = message.detail {
                        Text(detail)
                            .themeFont(.rowSubtitle)
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(large ? nil : 1)
                            .fixedSize(horizontal: false, vertical: large)
                    }
                }
                .frame(maxWidth: large ? .infinity : nil, alignment: .leading)
            }
            .padding(.leading, 8)
            .padding(.trailing, large ? 24 : 18)
            .padding(.vertical, 6)
            .frame(minHeight: Theme.QueueToast.minHeight)
            .background { glass }
            .overlay { GlowRim() }
            .clipShape(Capsule())
            .shadow(color: .black.opacity(Theme.QueueToast.shadowOpacity), radius: 10, y: 4)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Copy.TrackActions.toastHint)
        .accessibilityIdentifier("queue-toast")
        .sensoryFeedback(.success, trigger: message.id)
        .task(id: message.id) {
            guard let data = message.cover else { palette = nil; return }
            palette = await Task.detached(priority: .utility) { ArtworkPalette.palette(forCover: data) }.value
        }
    }

    /// An opaque dark base (no live blur), the cover's colours washed across it, then the glass highlight.
    private var glass: some View {
        let colors = Theme.coverGlowColors(palette)
        return ZStack {
            Rectangle().fill(Theme.card)
            Rectangle().fill(Color.black.opacity(Theme.QueueToast.baseOpacity))
            LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing)
                .opacity(Theme.QueueToast.tintOpacity)
            GlowGlass()
        }
    }
}

/// A small record sleeve: the cover with a disc peeking out of its right edge.
struct QueueToastSleeve: View {
    let cover: Data?
    let side: CGFloat
    /// The disc slides out of the sleeve as the toast appears; Reduce Motion shows it already out.
    var slides = false

    @State private var out = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .leading) {
            Circle()
                .fill(RadialGradient(colors: [Color(white: 0.28), .black], center: .center, startRadius: 0, endRadius: side * 0.6))
                .overlay { Circle().stroke(Color.white.opacity(0.12), lineWidth: 0.5) }
                .overlay { Circle().fill(Color.white.opacity(0.35)).frame(width: side * 0.16) }
                .frame(width: side * 0.9, height: side * 0.9)
                .offset(x: (out || reduceMotion || !slides) ? side * 0.28 : side * 0.02)
            Group {
                if let cover, let image = UIImage(data: cover) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    NoCoverArt()
                }
            }
            .frame(width: side, height: side)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Color.white.opacity(0.18), lineWidth: 0.5) }
        }
        .frame(width: side * 1.28, height: side, alignment: .leading)
        .accessibilityHidden(true)
        .onAppear {
            guard slides, !reduceMotion else { return }
            withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.4).delay(0.12)) { out = true }
        }
    }
}

/// Floats the center's toast at the bottom of the view it wraps, above whatever bottom inset sits under it (the
/// mini player). Slides up and fades in; only fades under Reduce Motion.
struct QueueToastHost: ViewModifier {
    @Environment(\.queueToast) private var center
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let center, let message = center.current {
                    QueueToast(message: message) { center.dismiss() }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 20)
                        .id(message.id)
                        .transition(reduceMotion ? .opacity : .asymmetric(
                            insertion: .offset(y: Theme.QueueToast.rise).combined(with: .opacity),
                            removal: .opacity
                        ))
                }
            }
            .animation(
                reduceMotion ? .easeOut(duration: 0.2) : .timingCurve(0.16, 1, 0.3, 1, duration: Theme.QueueToast.duration),
                value: center?.current?.id
            )
    }
}

extension View {
    func queueToastHost() -> some View { modifier(QueueToastHost()) }
}
