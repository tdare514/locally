#if DEBUG
import SwiftUI

/// Static sample state for the three Settings prototypes (#160): signed in, one device, a recent
/// sync. Nothing here is wired to a service.
enum SettingsSample {
    static let email = "sample@example.com"
    static let device = "iPhone 17"
    static let syncedAgo = "2 min ago"
    static let usedMB = 42
    static let limitMB = 500
    static let version = "1.0"
    /// Settings content that exists only to show a style; none of it is a real setting.
    static let mobileDataPlaceholder = "Sync over mobile data"
}

/// Strings the real Settings does not have yet. The rest of the copy comes from `Copy`.
enum SettingsPrototypeCopy {
    static let folderSection = "Spotify folder"
    static let purchaseSection = "Purchase"
    static func syncedPill(_ ago: String) -> String { "Synced \(ago)" }
}

/// Text sizes as Dynamic Type styles. `Theme.Font` is fixed-size points, which the prototypes
/// avoid on purpose (a rollout would add scaling tokens).
enum ProtoFont {
    static let largeTitle = Font.system(.largeTitle, weight: .bold)
    static let heading = Font.system(.title2, weight: .bold)
    static let sectionTitle = Font.system(.subheadline, weight: .semibold)
    static let rowTitle = Font.system(.body, weight: .regular)
    static let rowTitleStrong = Font.system(.body, weight: .semibold)
    static let value = Font.system(.body, weight: .regular)
    static let caption = Font.system(.footnote, weight: .regular)
    static let pill = Font.system(.footnote, weight: .semibold)
}

/// The cool tints for icon tiles and highlights, kept beside the accent blue.
enum ProtoTint {
    static let blue = Theme.accent
    static let violet = Color(red: 0.62, green: 0.50, blue: 1.0)
    static let teal = Color(red: 0.30, green: 0.80, blue: 0.84)
    static let slate = Color(red: 0.62, green: 0.68, blue: 0.80)
    static let danger = Theme.danger
    /// Text and glyphs on the faint accent fill of a pill.
    static let accentText = Color(red: 0.45, green: 0.70, blue: 1.0)
}

// MARK: - Screen

/// A prototype's page: the studio backdrop, then a scroll view whose content fades out at the
/// top and bottom of the safe area instead of being cut off by it. DEBUG harness: launch with
/// `-settingsPrototypeScroll <id>` (folder, sync, purchase, icon, about) to open scrolled to
/// that section, for screenshots.
struct PrototypeScreen<Content: View>: View {
    var backdropIntensity: Double = 0.8
    @ViewBuilder var content: () -> Content

    private static var edgeFade: CGFloat { 22 }

    var body: some View {
        ZStack {
            StudioBackdrop(intensity: backdropIntensity)
            ScrollViewReader { proxy in
                ScrollView {
                    content()
                        .padding(.top, Self.edgeFade)
                        .padding(.bottom, Self.edgeFade + 40)
                        .frame(maxWidth: .infinity)
                }
                .scrollIndicators(.hidden)
                .mask(edgeMask)
                .onAppear {
                    if let target = UserDefaults.standard.string(forKey: "settingsPrototypeScroll") {
                        proxy.scrollTo(target, anchor: .top)
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    /// Content reaches full strength `edgeFade` points inside the safe area, so nothing meets
    /// the status bar or home indicator in a line.
    private var edgeMask: some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
                .frame(height: Self.edgeFade)
            Rectangle().fill(.black)
            LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: Self.edgeFade)
        }
    }
}

/// One line (cut in the middle) at normal sizes, wrapping at accessibility sizes so an address is never hidden.
private struct AddressLineLimit: ViewModifier {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func body(content: Content) -> some View {
        content
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 4 : 1)
            .truncationMode(.middle)
    }
}

extension View {
    func addressLineLimit() -> some View { modifier(AddressLineLimit()) }
}

// MARK: - Hairline

/// A one-device-pixel line that fades to nothing at both ends, so it never reads as a hard edge.
struct FadingHairline: View {
    var peak: Double = 0.14
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        LinearGradient(
            stops: [
                .init(color: .white.opacity(0), location: 0),
                .init(color: .white.opacity(peak), location: 0.22),
                .init(color: .white.opacity(peak), location: 0.78),
                .init(color: .white.opacity(0), location: 1),
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(height: 1 / displayScale)
        .accessibilityHidden(true)
    }
}

// MARK: - Controls

/// A rounded-square icon tile: the glyph in a tint, on a soft gradient of the same tint.
struct IconTile: View {
    let symbol: String
    let tint: Color
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 30

    var body: some View {
        RoundedRectangle(cornerRadius: side * 0.30, style: .continuous)
            .fill(LinearGradient(
                colors: [tint.opacity(0.34), tint.opacity(0.16)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ))
            .frame(width: side, height: side)
            .overlay(
                Image(systemName: symbol)
                    .font(.system(size: side * 0.50, weight: .semibold))
                    .foregroundStyle(tint)
            )
            .accessibilityHidden(true)
    }
}

/// "Synced 2 min ago" as a small capsule: a faint accent fill, no outline.
struct SyncPill: View {
    let text: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
            Text(text)
        }
        .font(ProtoFont.pill)
        .foregroundStyle(ProtoTint.accentText)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(Theme.accent.opacity(0.16)))
        .accessibilityElement(children: .combine)
    }
}

/// A switch in the accent colour with a round white knob.
struct AccentToggleStyle: ToggleStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(spacing: 12) {
                configuration.label
                Spacer(minLength: 12)
                ZStack {
                    Capsule().fill(configuration.isOn ? Theme.accent : Color.white.opacity(0.16))
                    Circle()
                        .fill(.white)
                        .frame(width: 27, height: 27)
                        .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
                        .offset(x: configuration.isOn ? 10 : -10)
                }
                .frame(width: 51, height: 31)
                .animation(reduceMotion ? nil : .spring(duration: 0.28, bounce: 0.15), value: configuration.isOn)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation {
            Toggle(isOn: configuration.$isOn) { configuration.label }
        }
    }
}

/// A row that dims softly while pressed; no hard highlight rectangle.
struct SoftPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Color.white.opacity(configuration.isPressed ? 0.07 : 0))
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
#endif
