import SwiftUI
import UIKit

/// Lets the user pick one of the bundled app icons. The primary icon is
/// `AppIcon`; the alternates are declared in `project.yml`
/// (`ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES`) and previewed here via
/// the `IconPreview-*` image sets, because app icon sets themselves cannot be
/// loaded with `UIImage(named:)`. All five are rendered by
/// `scripts/make-app-icons.py`.
struct AppIconPicker: View {
    static let icons = ["AppIcon", "AppIcon-Accent", "AppIcon-Gunmetal", "AppIcon-Card", "AppIcon-Tone"]

    @State private var selected: String = UIApplication.shared.alternateIconName ?? "AppIcon"
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(Copy.Settings.appIconHint)
                .font(Theme.Font.rowSubtitle)
                .foregroundStyle(Theme.secondaryText)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(Self.icons, id: \.self) { name in
                        Button {
                            choose(name)
                        } label: {
                            VStack(spacing: 6) {
                                Image("IconPreview-\(name)")
                                    .resizable()
                                    .frame(width: 60, height: 60)
                                    .clipShape(RoundedRectangle(cornerRadius: 13.5, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 13.5, style: .continuous)
                                            .strokeBorder(selected == name ? Theme.accent : Color.clear, lineWidth: 2)
                                    )
                                Text(Copy.Settings.iconNames[name] ?? name)
                                    .font(Theme.Font.rowSubtitle)
                                    .foregroundStyle(selected == name ? Theme.primaryText : Theme.secondaryText)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Copy.Settings.iconNames[name] ?? name)
                        .accessibilityAddTraits(selected == name ? .isSelected : [])
                    }
                }
                .padding(.vertical, 4)
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(Theme.Font.rowSubtitle)
                    .foregroundStyle(Theme.danger)
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
