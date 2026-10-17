import SwiftUI

/// Lays its subviews out left to right and wraps to the next line when one does not fit, so the
/// Featuring pills wrap at the accessibility sizes. A subview marked `fillsLine()` takes the rest
/// of its line.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    private func arrange(width: CGFloat, _ subviews: Subviews) -> (frames: [CGRect], size: CGSize) {
        var frames: [CGRect] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var used: CGFloat = 0
        for subview in subviews {
            let ideal = subview.sizeThatFits(.unspecified)
            var size = subview.sizeThatFits(ProposedViewSize(width: min(ideal.width, width), height: nil))
            if x > 0 && x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            if subview[FlowLayoutFill.self] && width.isFinite { size.width = max(size.width, width - x) }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            x += size.width + spacing
            used = max(used, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return (frames, CGSize(width: width.isFinite ? width : used, height: y + rowHeight))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews)
        for (subview, frame) in zip(subviews, result.frames) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), proposal: ProposedViewSize(frame.size))
        }
    }
}

extension View {
    /// In a `FlowLayout`: take the rest of the line.
    func fillsLine() -> some View {
        layoutValue(key: FlowLayoutFill.self, value: true)
    }
}

enum FlowLayoutFill: LayoutValueKey {
    static let defaultValue = false
}

/// The Featuring row (#287), in `LabeledField`'s style: the names as capsule pills that wrap, each
/// with a remove button, and a text field to add more. Return or a comma adds the typed name,
/// Delete in an empty field removes the last pill, and the keyboard offers the library's artists.
/// Read-only, it is the plain "Featuring B, C" row, left out when there are no names.
struct FeaturingField: View {
    @Binding var names: [String]
    /// What has been typed and not yet added. The owner commits it when it saves, so a name typed
    /// but not confirmed is not lost.
    @Binding var draft: String
    var isEditable = true
    var autofocus = false

    @FocusState private var focused: Bool
    @State private var raw = FeaturingNames.backspaceSentinel
    @State private var index: [ArtistEntry]?
    @Environment(\.appContainer) private var container
    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .subheadline) private var labelWidth = Theme.Immersive.labeledFieldLabelWidth

    private static let pillLimit = 3

    var body: some View {
        if isEditable {
            editor
                .task { @MainActor in
                    guard let container else { return }
                    index = ArtistIndex.build((try? container.library.all()) ?? [])
                }
        } else if !names.isEmpty {
            LabeledField(Copy.Featuring.field, placeholder: "", text: .constant(Copy.Featuring.viewValue(names)), wraps: true, labelFits: true, isEditable: false)
        }
    }

    // MARK: Edit mode

    private var editor: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 0) {
                    label
                    value
                }
            } else {
                HStack(alignment: .top, spacing: Theme.Immersive.labeledFieldLabelGap) {
                    // "Featuring" is wider than the shared label column: it takes its own width rather than
                    // breaking mid-word.
                    label.frame(minWidth: labelWidth, alignment: .leading).fixedSize(horizontal: true, vertical: false)
                    value
                }
            }
        }
    }

    private var label: some View {
        Text(Copy.Featuring.field)
            .font(Theme.ScaledFont.subheadline)
            .foregroundStyle(Theme.secondaryText)
            .frame(minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture { focused = true }
            .accessibilityHidden(true)
    }

    private var value: some View {
        FlowLayout(spacing: 8) {
            ForEach(names, id: \.self) { name in pill(name) }
            entry.fillsLine()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Copy.Featuring.pillsLabel)
        .padding(.bottom, Theme.Immersive.inlineFieldUnderlineGap)
        .overlay(alignment: .bottom) {
            ZStack {
                Rectangle()
                    .fill(Color.white.opacity(Theme.Immersive.labeledFieldUnderlineRestOpacity))
                Rectangle()
                    .fill(Theme.secondaryText.opacity(Theme.Immersive.inlineFieldUnderlineOpacity))
                    .opacity(focused ? 1 : 0)
            }
            .frame(height: 1 / displayScale)
        }
        .animation(reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: Theme.Immersive.inlineFieldFocusFade), value: focused)
        .task { if autofocus { focused = true } }
    }

    private func pill(_ name: String) -> some View {
        HStack(spacing: 0) {
            Text(name)
                .font(Theme.ScaledFont.subheadline)
                .foregroundStyle(Theme.Tint.accentText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 14)
                .padding(.vertical, 8)
                .accessibilityLabel(Copy.Featuring.pillLabel(name))
            Button {
                names = FeaturingNames.remove(name, from: names)
            } label: {
                Image(systemName: "xmark")
                    .font(Theme.ScaledFont.caption.weight(.semibold))
                    .foregroundStyle(Theme.Tint.accentText)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Copy.Featuring.removeLabel(name))
        }
        .frame(minHeight: 44)
        .background(Capsule().fill(Theme.accent.opacity(0.18)))
    }

    /// The text field. Its text always starts with a zero-width character, so that Delete with
    /// nothing typed still changes the text and the last pill can go.
    private var entry: some View {
        ZStack(alignment: .leading) {
            if draft.isEmpty {
                Text(Copy.Featuring.placeholder)
                    .font(Theme.ScaledFont.input)
                    .foregroundStyle(Theme.textDim)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            TextField("", text: $raw)
                .font(Theme.ScaledFont.input)
                .foregroundStyle(Theme.primaryText)
                .focused($focused)
                .submitLabel(.done)
                .autocorrectionDisabled()
                .accessibilityLabel(Copy.Featuring.placeholder)
                .accessibilityValue(draft)
                .onSubmit {
                    commit()
                    focused = true
                }
        }
        .frame(minWidth: 140, minHeight: 44, alignment: .leading)
        .onChange(of: raw) { _, newValue in read(newValue) }
        .onChange(of: draft) { _, newValue in
            if FeaturingNames.readField(raw).typed != newValue { raw = FeaturingNames.backspaceSentinel + newValue }
        }
        .onChange(of: focused) { _, isFocused in
            if !isFocused { commit() }
        }
        .toolbar {
            if focused, !pills.isEmpty {
                ToolbarItemGroup(placement: .keyboard) {
                    ArtistPillRow(entries: pills) { entry in
                        names = FeaturingNames.add(entry.display, to: names)
                        draft = ""
                        raw = FeaturingNames.backspaceSentinel
                    }
                }
            }
        }
        .onAppear { raw = FeaturingNames.backspaceSentinel + draft }
    }

    private var pills: [ArtistEntry] {
        guard let index else { return [] }
        let taken = Set(names.map(ArtistNames.artistKey))
        let found = ArtistIndex.suggest(index, query: draft, limit: Self.pillLimit + names.count)
        return Array(found.filter { !taken.contains($0.key) }.prefix(Self.pillLimit))
    }

    private func read(_ newValue: String) {
        let field = FeaturingNames.readField(newValue)
        if field.deletedEmpty {
            names = FeaturingNames.removeLast(names)
            raw = FeaturingNames.backspaceSentinel
            draft = ""
            return
        }
        var updated = names
        let rest = FeaturingNames.absorbCommas(field.typed, into: &updated)
        if updated != names { names = updated }
        draft = rest
        let wanted = FeaturingNames.backspaceSentinel + rest
        if raw != wanted { raw = wanted }
    }

    private func commit() {
        names = FeaturingNames.commit(draft, to: names)
        draft = ""
        raw = FeaturingNames.backspaceSentinel
    }
}

/// The album row's feat. sheet (#287): the same pill field for one track, and Done.
struct FeaturingSheet: View {
    let trackTitle: String
    @Binding var names: [String]
    let onDone: () -> Void

    @State private var draft = ""
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Theme.Immersive.labeledFieldRowGap) {
                HStack(alignment: .firstTextBaseline) {
                    Text(Copy.Featuring.sheetTitle)
                        .font(Theme.Font.sectionTitle)
                        .foregroundStyle(Theme.primaryText)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button(Copy.Featuring.done) {
                        names = FeaturingNames.commit(draft, to: names)
                        draft = ""
                        onDone()
                    }
                    .buttonStyle(TextButtonStyle(color: Theme.Tint.accentText))
                    .frame(minWidth: 44, minHeight: 44)
                }
                Text(trackTitle)
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(2)
                FeaturingField(names: $names, draft: $draft, autofocus: true)
                Spacer(minLength: 0)
            }
            .padding(Theme.Spacing.pagePadding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Theme.card)
            .toolbar(.hidden, for: .navigationBar)
        }
        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.card)
        // Swiping the sheet away keeps a name that was typed but not confirmed.
        .onDisappear { names = FeaturingNames.commit(draft, to: names) }
    }
}
