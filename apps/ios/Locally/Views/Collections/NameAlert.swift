import SwiftUI

/// The alert that asks for a collection's name (new, or renamed): a text field, a primary action, Cancel. The
/// action stays disabled until the trimmed name is valid (1 to 100 characters).
struct NameAlert: ViewModifier {
    let title: String
    let action: String
    @Binding var isPresented: Bool
    @Binding var text: String
    let onSubmit: (String) -> Void

    func body(content: Content) -> some View {
        content.alert(title, isPresented: $isPresented) {
            TextField(Copy.Collections.namePlaceholder, text: $text)
            Button(action) { onSubmit(text) }
                .disabled(MusicCollection.validName(text) == nil)
            Button(Copy.Collections.cancel, role: .cancel) {}
        }
    }
}

extension View {
    func nameAlert(_ title: String, action: String, isPresented: Binding<Bool>, text: Binding<String>, onSubmit: @escaping (String) -> Void) -> some View {
        modifier(NameAlert(title: title, action: action, isPresented: isPresented, text: text, onSubmit: onSubmit))
    }
}
