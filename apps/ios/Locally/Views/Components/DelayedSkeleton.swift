import SwiftUI

/// A still skeleton that shows only once a wait has lasted `Theme.skeletonDelay`, so a quick load shows nothing and
/// the content simply arrives (docs/design.md rule 10, #423). Its space is held from the start, so nothing moves when
/// it appears; it fades in, and appears at once under Reduce Motion. VoiceOver skips the shapes and reads the
/// container's `label` for the whole wait; with no `label` (a slot inside content that already reads, such as a
/// cover in a list row) VoiceOver skips it altogether.
struct DelayedSkeleton<Skeleton: View>: View {
    var label: String?
    @ViewBuilder var skeleton: () -> Skeleton

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isShowing = false

    var body: some View {
        ZStack {
            skeleton()
                .opacity(isShowing ? 1 : 0)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label ?? "")
        .accessibilityHidden(label == nil)
        .task {
            try? await Task.sleep(for: Theme.skeletonDelay)
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { isShowing = true }
        }
    }
}
