import SwiftUI
import UIKit

/// Lets the user pick one of the bundled app icons. The primary icon is
/// `AppIcon`; the alternates are declared in `project.yml`
/// (`ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES`) and previewed here via
/// the `IconPreview-*` image sets, because app icon sets themselves cannot be
/// loaded with `UIImage(named:)`. Both are rendered by
/// `scripts/make-listener-icons.py`.
struct AppIconPicker: View {
    static let icons = ["AppIcon", "AppIcon-Line"]

    @State private var selected: String = UIApplication.shared.alternateIconName ?? "AppIcon"
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(Copy.Settings.appIconHint)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            // Side by side, or stacked once large text makes them too wide for the card.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 22) { choices; Spacer(minLength: 0) }
                VStack(alignment: .leading, spacing: 16) { choices }
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(Theme.ScaledFont.caption)
                    .foregroundStyle(Theme.danger)
            }
        }
    }

    private var choices: some View {
        ForEach(Self.icons, id: \.self) { name in
            GlassIconChoice(name: name, isSelected: selected == name) {
                choose(name)
            }
        }
    }

    private func choose(_ name: String) {
        guard name != selected else { return }
        let alternate: String? = name == "AppIcon" ? nil : name
        UIApplication.shared.setAlternateIconName(alternate) { error in
            if let error {
                errorMessage = error.localizedDescription.isEmpty ? Copy.Settings.appIconFailed : error.localizedDescription
            } else {
                errorMessage = nil
                selected = name
            }
        }
    }
}

/// An app icon choice: the icon in a continuous rounded square, a soft accent halo and a small
/// check when picked. No ring, so no line.
private struct GlassIconChoice: View {
    let name: String
    let isSelected: Bool
    let action: () -> Void
    @ScaledMetric(relativeTo: .body) private var scaledSide: CGFloat = 64
    /// Grows with text, but stops short of filling the card at the largest sizes.
    private var side: CGFloat { min(scaledSide, 96) }

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image("IconPreview-\(name)")
                    .resizable()
                    .frame(width: side, height: side)
                    .clipShape(RoundedRectangle(cornerRadius: side * 0.225, style: .continuous))
                    .shadow(color: isSelected ? Theme.accent.opacity(0.55) : .black.opacity(0.35),
                            radius: isSelected ? 12 : 6, y: isSelected ? 0 : 3)
                    .overlay(alignment: .bottomTrailing) {
                        if isSelected {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: side * 0.30))
                                .foregroundStyle(.white, Theme.accent)
                                .offset(x: 6, y: 6)
                        }
                    }
                Text(Copy.Settings.iconNames[name] ?? name)
                    .font(Theme.ScaledFont.caption)
                    .foregroundStyle(isSelected ? Theme.primaryText : Theme.secondaryText)
            }
            .padding(.bottom, 4)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Copy.Settings.iconNames[name] ?? name)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
