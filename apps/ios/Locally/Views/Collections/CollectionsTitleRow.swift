import SwiftUI

/// The Collections screens' title row (#444), laid out like the Library's header: "Collections" at the left and, when
/// a count is given, "12 collections" at the right on the title's last baseline. At the accessibility sizes the
/// count drops under the title instead of squeezing it.
struct CollectionsTitleRow: View {
    /// The number of collections; nil shows the title alone.
    var count: Int?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(alignment: .lastTextBaseline))
        layout {
            Text(Copy.Collections.title)
                .themeFont(.pageTitle)
                .foregroundStyle(Theme.primaryText)
                .accessibilityAddTraits(.isHeader)
            if let count {
                if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                Text(Copy.Collections.countLine(count))
                    .themeFont(.meta)
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        // Full width at every size, so the count keeps to the trailing edge.
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
