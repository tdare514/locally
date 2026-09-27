import SwiftUI

/// A single labeled text field styled for the dark theme, used across the
/// import and edit screens so every field looks and behaves the same.
struct Field: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default

    init(_ label: String, placeholder: String = "", text: Binding<String>, keyboardType: UIKeyboardType = .default) {
        self.label = label
        self.placeholder = placeholder
        self._text = text
        self.keyboardType = keyboardType
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
            TextField(placeholder, text: $text)
                .keyboardType(keyboardType)
                .foregroundStyle(Theme.primaryText)
                .padding(10)
                .background(Theme.panel)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}
