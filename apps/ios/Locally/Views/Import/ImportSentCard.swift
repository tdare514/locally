import SwiftUI
import UIKit

/// What the Sent card needs, fixed when the send succeeds so the card never reads a model that is
/// about to be reset.
struct ImportSentInfo: Identifiable, Equatable {
    let id = UUID()
    let kind: ImportKind
    let cover: Data?
    /// Whether the Spotify app is installed, read when the send succeeds (the gallery sets it).
    var spotifyInstalled = ImportSentCard.isSpotifyInstalled
}

/// The "Sent" pop-up after a successful send (#205, docs/design.md "Make a record", Send): the page
/// dims, a compact card springs up in the lower half with the sealed record on its top edge and a
/// glow in the cover's colours behind it. It is presented in a `.fullScreenCover` with a clear
/// background and no system transition, so everything it does is its own entrance and drop-away.
/// With Reduce Motion the card and glow just fade (no spring, tilt or bloom); the haptic still plays.
struct ImportSentCard: View {
    let kind: ImportKind
    let cover: UIImage?
    /// The cover's backdrop colours; nil with no cover (the glow is then accent and violet).
    let palette: AmbientPalette?
    /// Whether the Spotify app is installed. Without it the pill is Close and there is no second one.
    let spotifyInstalled: Bool
    /// Open in Spotify was tapped, after Spotify was asked to open: take the page back to the
    /// invitation and drop the card at once.
    let onOpenSpotify: () -> Void
    /// Close was tapped, after the card has dropped away.
    let onClose: () -> Void

    static let spotifyURL = URL(string: "spotify:")!

    /// True when the Spotify app can be opened (needs `LSApplicationQueriesSchemes: [spotify]`).
    static var isSpotifyInstalled: Bool {
        UIApplication.shared.canOpenURL(spotifyURL)
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    /// The entrance has started (animated to true on appear), and Close has started its drop-away.
    @State private var entered = false
    @State private var leaving = false
    @State private var contentHeight: CGFloat = 0
    @AccessibilityFocusState private var titleFocused: Bool

    private var isShown: Bool { entered && !leaving }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottom) {
                Color.black
                    .opacity(isShown ? Theme.Import.sentDimOpacity : 0)
                    .animation(.easeOut(duration: leaving ? Theme.Import.sentCloseDuration : Theme.Import.sentDimDuration), value: isShown)
                    .accessibilityHidden(true)
                card(maxHeight: geometry.size.height * Theme.Import.sentCardMaxHeightRatio, width: geometry.size.width)
                    .padding(.horizontal, Theme.Import.sentCardEdgeInset)
                    .padding(.bottom, Theme.Import.sentCardEdgeInset)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .ignoresSafeArea()
        .presentationBackground(.clear)
        .sensoryFeedback(trigger: entered) { _, new in new ? .success : nil }
        .task {
            withAnimation(entranceAnimation) { entered = true }
            try? await Task.sleep(for: .seconds(Theme.Import.sentFocusDelay))
            titleFocused = true
        }
    }

    // MARK: Card

    private func card(maxHeight: CGFloat, width: CGFloat) -> some View {
        let recordSize = Theme.Import.sentRecordSize
        return VStack(spacing: 0) {
            // The content's height is measured so the card hugs it, up to the cap; past that it scrolls.
            ScrollView {
                content.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .scrollBounceBehavior(.basedOnSize)
                .frame(height: min(contentHeight, maxHeight))
        }
        .padding(.top, recordSize / 2)
        .padding(Theme.Import.sentCardPadding)
        .frame(maxWidth: .infinity)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Import.sentCardRadius, style: .continuous))
        .overlay(alignment: .top) {
            record(size: recordSize)
                .offset(y: -recordSize / 2)
        }
        .background(alignment: .top) {
            glow(width: width)
                .offset(y: -Theme.Import.sentGlowHeight / 2)
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        // The card fades on its own curve; the offset and scale ride the spring outside it.
        .opacity(isShown ? 1 : 0)
        .animation(fadeAnimation, value: isShown)
        .offset(y: reduceMotion ? 0 : (isShown ? 0 : Theme.Import.sentRise))
        .scaleEffect(reduceMotion || isShown ? 1 : Theme.Import.sentRiseScale, anchor: .bottom)
        .animation(leaving ? .easeIn(duration: Theme.Import.sentCloseDuration) : entranceAnimation, value: isShown)
    }

    private var content: some View {
        VStack(spacing: Theme.Import.sentContentGap) {
            Text(Copy.Import.sentTitle)
                .font(Theme.ScaledFont.sentTitle)
                .foregroundStyle(Theme.primaryText)
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused($titleFocused)
            Text(kind == .single ? Copy.Import.sentSingleBody : Copy.Import.sentAlbumBody)
                .font(Theme.ScaledFont.rowTitle)
                .foregroundStyle(Theme.secondaryText)
            Text(kind == .single ? Copy.Import.sentSingleHint : Copy.Import.sentAlbumHint)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.secondaryText)
            VStack(spacing: Theme.Import.sentButtonGap) {
                if spotifyInstalled {
                    Button(Copy.Import.openInSpotify) {
                        openURL(Self.spotifyURL)
                        onOpenSpotify()
                    }
                    .buttonStyle(PrimaryPillButtonStyle())
                    closeButton
                } else {
                    Button(Copy.Purchase.close, action: close)
                        .buttonStyle(PrimaryPillButtonStyle())
                }
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
    }

    private var closeButton: some View {
        Button(action: close) {
            Text(Copy.Purchase.close)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(TextButtonStyle())
    }

    // MARK: Record and glow

    /// The sealed record, tilted from `sentRecordTiltStart` to `sentRecordTiltEnd` as the card lands.
    private func record(size: CGFloat) -> some View {
        RecordSleeve(
            cover: cover,
            beat: ImportBeat.sendSealFrame(at: ImportBeat.sendSealDuration, reduced: reduceMotion),
            size: size,
            onAddCover: {}
        )
        // The disc is fully inside the sleeve; only the sleeve takes room.
        .frame(width: size, height: size, alignment: .leading)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .rotationEffect(.degrees(reduceMotion || entered ? Theme.Import.sentRecordTiltEnd : Theme.Import.sentRecordTiltStart))
        .animation(entranceAnimation, value: entered)
    }

    /// The cover's colours (accent and violet with no cover) behind the card's top: it blooms from
    /// `sentGlowStartScale` and fades in, or just fades with Reduce Motion.
    private func glow(width: CGFloat) -> some View {
        let colors: [Color] = palette.map {
            [ArtworkBackdrop.color(hex: $0.primary), ArtworkBackdrop.color(hex: $0.secondary)]
        } ?? [Theme.accent, Theme.Studio.violet]
        return Ellipse()
            .fill(LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing))
            .frame(width: width * Theme.Import.sentGlowWidthRatio, height: Theme.Import.sentGlowHeight)
            .blur(radius: Theme.Import.sentGlowBlur)
            .scaleEffect(reduceMotion || isShown ? 1 : Theme.Import.sentGlowStartScale)
            .opacity(isShown ? 1 : 0)
            .animation(
                reduceMotion || leaving
                    ? .easeOut(duration: reduceMotion ? Theme.Import.sentReducedFadeDuration : Theme.Import.sentCloseDuration)
                    : .easeOut(duration: Theme.Import.sentGlowDuration),
                value: isShown
            )
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    // MARK: Motion

    private var entranceAnimation: Animation {
        reduceMotion
            ? .easeOut(duration: Theme.Import.sentReducedFadeDuration)
            : .spring(response: Theme.Import.sentSpringResponse, dampingFraction: Theme.Import.sentSpringDamping)
    }

    private var fadeAnimation: Animation {
        .easeOut(duration: leaving ? Theme.Import.sentCloseDuration : Theme.Import.sentReducedFadeDuration)
    }

    /// Close: the card drops away (200 ms), then the page goes back to the invitation.
    private func close() {
        guard !leaving else { return }
        withAnimation(.easeIn(duration: Theme.Import.sentCloseDuration)) { leaving = true }
        Task {
            try? await Task.sleep(for: .seconds(Theme.Import.sentCloseDuration))
            onClose()
        }
    }
}
