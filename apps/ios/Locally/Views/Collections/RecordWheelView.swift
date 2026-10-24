import SwiftUI

/// The Collections record player's wheel (#352): rows on the right half of a dial whose hub, the playing record, sits on
/// the left edge. Rows stay level, each step round is 0.87 of the one before, and they fade past about 50 degrees from
/// the front. Only the window of rows near the front is built (`RecordWheel.windowIndexes`), so 200 collections cost
/// the same as 20. Drag state lives here, in `@State`.
///
/// A vertical drag that starts on the wheel turns it and snaps to the nearest row on release (a flick uses the
/// predicted end); anywhere else the page scrolls. Tapping a row turns to it. For VoiceOver the wheel is one adjustable
/// element.
struct RecordWheelView: View {
    let summaries: [CollectionSummary]
    /// The collection in front. The wheel writes it as it turns and follows it when something else sets it ("Back to").
    @Binding var frontID: UUID?
    /// The collection the player's queue came from, and whether it is playing.
    let playingID: UUID?
    let isPlaying: Bool
    /// The hub: the playing track's release, the chosen look, and whether it turns.
    let hubReleaseID: UUID?
    let style: SpinningRecord
    let spins: Bool
    /// Whether the wheel may animate its turning (off in the background, in Low Power Mode, out of view, under Reduce Motion).
    let animates: Bool
    /// What double-tapping the wheel does ("Play Late drives" / "Pause Late drives") and does.
    let activateLabel: String
    var onActivate: () -> Void

    @State private var position: Double
    @State private var target: Int
    @State private var dragStart: Double?

    static let height: CGFloat = 400
    private static let pitch = WheelGeometry.phone.row
    private static let ringRadius: CGFloat = 214
    private static let trailingMargin: CGFloat = 16

    init(
        summaries: [CollectionSummary], frontID: Binding<UUID?>, playingID: UUID?, isPlaying: Bool, hubReleaseID: UUID?,
        style: SpinningRecord, spins: Bool, animates: Bool, activateLabel: String, onActivate: @escaping () -> Void
    ) {
        self.summaries = summaries
        _frontID = frontID
        self.playingID = playingID
        self.isPlaying = isPlaying
        self.hubReleaseID = hubReleaseID
        self.style = style
        self.spins = spins
        self.animates = animates
        self.activateLabel = activateLabel
        self.onActivate = onActivate
        let start = frontID.wrappedValue.flatMap { id in summaries.firstIndex { $0.id == id } } ?? 0
        _position = State(initialValue: Double(start))
        _target = State(initialValue: start)
    }

    private var frontIndex: Int { RecordWheel.mod(target, max(summaries.count, 1)) }
    private var frontSummary: CollectionSummary? { summaries.indices.contains(frontIndex) ? summaries[frontIndex] : nil }

    /// "playing" / "paused" for the front collection when it is the one in the player: the same state as the row's tag.
    private var spokenState: String? {
        guard let front = frontSummary, front.id == playingID else { return nil }
        return (isPlaying ? Copy.Collections.playing : Copy.Collections.paused).lowercased()
    }

    var body: some View {
        Color.clear
            .frame(maxWidth: .infinity)
            .frame(height: Self.height)
            .overlay(alignment: .leading) { GeometryReader { proxy in dial(width: proxy.size.width) } }
            .clipped()
            .contentShape(.rect)
            .simultaneousGesture(drag)
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .sensoryFeedback(.selection, trigger: target)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Copy.Collections.title)
            .accessibilityIdentifier("collections-wheel")
            .accessibilityValue(spokenValue)
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: settle(target + 1, duration: Theme.Immersive.wheelTapDuration)
                case .decrement: settle(target - 1, duration: Theme.Immersive.wheelTapDuration)
                @unknown default: break
                }
            }
            .accessibilityHint(activateLabel)
            .accessibilityAction(.default, onActivate)
            .onChange(of: target) { _, new in
                guard !summaries.isEmpty else { return }
                frontID = summaries[RecordWheel.mod(new, summaries.count)].id
            }
            .onChange(of: frontID) { _, new in
                guard let new, let index = summaries.firstIndex(where: { $0.id == new }), index != frontIndex else { return }
                settle(RecordWheel.turnTarget(index, from: position, summaries.count), duration: Theme.Immersive.wheelTapDuration)
            }
            .onChange(of: summaries) { _, new in follow(new) }
    }

    private var spokenValue: String {
        guard let front = frontSummary else { return "" }
        return RecordWheel.spokenValue(
            name: front.name, tracks: front.tracks, totalSec: front.playableSeconds, state: spokenState,
            front: frontIndex, count: summaries.count
        )
    }

    private func dial(width: CGFloat) -> some View {
        ZStack(alignment: .leading) {
            Circle()
                .strokeBorder(Color.white.opacity(0.14), lineWidth: 1)
                .frame(width: Self.ringRadius * 2, height: Self.ringRadius * 2)
                .offset(x: -Self.ringRadius)
            HubRecordView(releaseID: hubReleaseID, style: style, isSpinning: spins)
                .offset(x: -Theme.Immersive.hubRadius)
            WheelRows(
                position: position, summaries: summaries, playingID: playingID, isPlaying: isPlaying, width: width,
                onSelect: { index in settle(RecordWheel.turnTarget(index, from: position, summaries.count), duration: Theme.Immersive.wheelTapDuration) }
            )
            // The accent notch marks the front.
            Capsule()
                .fill(Theme.accent)
                .frame(width: 14, height: 3)
                .offset(x: Self.ringRadius - 7)
        }
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { value in
                guard !summaries.isEmpty else { return }
                let start = dragStart ?? position
                dragStart = start
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    position = RecordWheel.dragPosition(start: start, translation: value.translation.height, pitch: Self.pitch)
                }
                target = RecordWheel.roundHalfUp(position)
            }
            .onEnded { value in
                guard let start = dragStart else { return }
                dragStart = nil
                settle(
                    RecordWheel.snapTarget(start: start, predictedTranslation: value.predictedEndTranslation.height, pitch: Self.pitch),
                    duration: Theme.Immersive.wheelSnapDuration
                )
            }
    }

    /// Turns to row `new` (an integer in the wheel's own count): the logical front changes at once and the picture chases it.
    private func settle(_ new: Int, duration: Double) {
        target = new
        withAnimation(animates ? .timingCurve(0.16, 1, 0.3, 1, duration: duration) : nil) { position = Double(new) }
    }

    /// The collections changed (one made, deleted, or moved up by an edit): stay on the one in front, without a turn.
    private func follow(_ new: [CollectionSummary]) {
        guard let front = RecordWheel.frontAfterChange(oldFront: frontID, oldIndex: frontIndex, newIDs: new.map(\.id)) else {
            frontID = nil
            return
        }
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            position = Double(front.index)
            target = front.index
        }
        // Set it outright: a replacement at the same index would not change `target`, so its observer would not fire.
        frontID = front.id
    }
}

/// The rows near the front, placed from the wheel's position. `Animatable`, so the snap re-places only these rows each
/// frame. No `GeometryReader` here: the width comes in once.
private struct WheelRows: View, Animatable {
    var position: Double
    let summaries: [CollectionSummary]
    let playingID: UUID?
    let isPlaying: Bool
    let width: CGFloat
    var onSelect: (Int) -> Void

    var animatableData: Double {
        get { position }
        set { position = newValue }
    }

    private struct Entry: Identifiable {
        let index: Int
        let summary: CollectionSummary
        var id: UUID { summary.id }
    }

    var body: some View {
        let entries = RecordWheel.windowIndexes(position, summaries.count).map { Entry(index: $0, summary: summaries[$0]) }
        ZStack(alignment: .leading) {
            ForEach(entries) { entry in
                if let pose = RecordWheel.rowPose(RecordWheel.wrapD(entry.index, position, summaries.count)) {
                    WheelRowView(
                        summary: entry.summary, tag: tag(for: entry.summary), scale: pose.scale,
                        width: max(80, (width - 16 - (pose.x - 24 * pose.scale)) / pose.scale)
                    ) { onSelect(entry.index) }
                        .scaleEffect(pose.scale, anchor: .leading)
                        .offset(x: pose.x - 24 * pose.scale, y: pose.y)
                        .opacity(pose.opacity)
                }
            }
        }
    }

    /// "Playing" / "Paused" on the playing collection's row only.
    private func tag(for summary: CollectionSummary) -> String? {
        guard summary.id == playingID else { return nil }
        return isPlaying ? Copy.Collections.playing : Copy.Collections.paused
    }
}

/// One row: a 48 pt sleeve, then the name and "27 tracks". A button with at least a 44 pt hit area however small it is drawn.
private struct WheelRowView: View {
    let summary: CollectionSummary
    let tag: String?
    let scale: Double
    let width: CGFloat
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                CollectionCoverView(releaseIDs: summary.coverReleaseIDs, side: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(summary.name)
                        .themeFont(.rowTitle)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    caption
                        .themeFont(.meta)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(width: width, alignment: .leading)
            .frame(minHeight: max(48, 44 / scale))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    /// "● Playing  8 tracks" on one line, or the state above the count when the room is short (a narrow screen), so
    /// neither is cut: only the name may end in an ellipsis.
    @ViewBuilder
    private var caption: some View {
        let count = Text(Copy.Collections.trackCount(summary.tracks)).foregroundStyle(Theme.secondaryText)
        if let tag {
            let state = HStack(spacing: 6) {
                Circle().fill(Theme.accent).frame(width: 6, height: 6)
                Text(tag).foregroundStyle(Theme.Tint.accentText)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) { state; count }.fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading, spacing: 0) { state; count }.fixedSize(horizontal: true, vertical: false)
            }
        } else {
            count
        }
    }
}
