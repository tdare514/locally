import SwiftUI

/// The release page's and the import record's "Release date" row (#221): a text field that reads what
/// is typed ("2024", "17/05/2024", "17 May 2024") and a calendar button that opens a sheet of wheels at
/// Year, Month or Day precision. `text` is what is typed; `ReleaseDateText.parse` reads it. When focus
/// leaves the field a readable date is rewritten as `formatted()`. `message` is one line under the row,
/// shown only while the field is not focused. Not editable is the release page's view mode.
struct ReleaseDateField: View {
    @Binding var text: String
    var isEditable = true
    var message: String?

    @FocusState private var focused: Bool
    @State private var isPresentingSheet: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(text: Binding<String>, isEditable: Bool = true, message: String? = nil, startsWithSheetOpen: Bool = false) {
        self._text = text
        self.isEditable = isEditable
        self.message = message
        self._isPresentingSheet = State(initialValue: startsWithSheetOpen)
    }

    /// The formatted date when the text parses, else the text as typed.
    private var spokenValue: String {
        ReleaseDateText.parse(text).date?.formatted() ?? text
    }

    // MARK: Row

    private var labelText: some View {
        Text(Copy.DateField.label)
            .font(Theme.ScaledFont.subheadline)
            .foregroundStyle(Theme.secondaryText)
    }

    private var field: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            TextField("", text: Binding(get: { text }, set: { setWrapped($0) }), prompt: Text(Copy.DateField.placeholder).foregroundColor(Theme.textDim), axis: .vertical)
                .lineLimit(1...3)
                .font(Theme.ScaledFont.input)
                .foregroundStyle(Theme.primaryText)
                .keyboardType(.numbersAndPunctuation)
                .focused($focused)
                .submitLabel(.done)
                .accessibilityLabel(Copy.DateField.label)
                .accessibilityValue(spokenValue)
                .onChange(of: focused) { _, isFocused in
                    if !isFocused, let date = ReleaseDateText.parse(text).date, text != date.formatted() {
                        text = date.formatted()
                    }
                }
            Button {
                focused = false
                isPresentingSheet = true
            } label: {
                Image(systemName: "calendar")
                    .font(Theme.ScaledFont.input)
                    // Only the glyph stops growing; the field's text keeps scaling.
                    .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                    .foregroundStyle(Theme.secondaryText)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
                    // A 44 pt target without a 44 pt line.
                    .padding(.vertical, -11)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Copy.DateField.chooseDate)
        }
        .padding(.bottom, Theme.Immersive.inlineFieldUnderlineGap)
        // `LabeledField`'s hairline: faint white at rest, `secondaryText` faded in over it while focused.
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
    }

    /// A vertical field inserts a newline on Return: strip it and end editing instead.
    private func setWrapped(_ newValue: String) {
        guard newValue.contains(where: \.isNewline) else {
            text = newValue
            return
        }
        text = String(newValue.filter { !$0.isNewline })
        focused = false
    }

    /// View mode: the date formatted (a legacy year as stored), "Not set" when empty.
    private var staticValue: some View {
        let value = spokenValue
        return Text(value.isEmpty ? Copy.Release.notSet : value)
            .font(Theme.ScaledFont.input)
            .foregroundStyle(value.isEmpty ? Theme.textDim : Theme.primaryText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.bottom, Theme.Immersive.inlineFieldUnderlineGap)
    }

    @ViewBuilder
    private var layout: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 0) {
                labelText
                    .contentShape(Rectangle())
                    .onTapGesture { if isEditable { focused = true } }
                    .accessibilityHidden(isEditable)
                if isEditable { field } else { staticValue }
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Immersive.labeledFieldLabelGap) {
                labelText
                    .fixedSize()
                    .contentShape(Rectangle())
                    .onTapGesture { if isEditable { focused = true } }
                    .accessibilityHidden(isEditable)
                if isEditable { field } else { staticValue }
            }
        }
    }

    @ViewBuilder
    private var messageLine: some View {
        if isEditable, !focused, let message {
            Text(message)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.danger)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
                .accessibilityIdentifier("release-date-message")
                .onAppear { AccessibilityNotification.Announcement(message).post() }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if isEditable {
                layout
            } else {
                layout.accessibilityElement(children: .combine)
            }
            messageLine
        }
        .sheet(isPresented: $isPresentingSheet) {
            ReleaseDateSheet(text: $text)
        }
    }
}

/// How much of a date is known. The order is the switch's order.
private enum DatePrecision: Hashable {
    case year, month, day
}

/// The sheet: a Year / Month / Day switch over the wheels for that precision, Done and Clear date.
/// Every conversion uses a Gregorian calendar in UTC, so 17 May never becomes 16 May.
private struct ReleaseDateSheet: View {
    @Binding var text: String

    @State private var precision: DatePrecision
    @State private var year: Int
    @State private var month: Int
    @State private var day: Int
    private let years: [Int]
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private static let utc = TimeZone(identifier: "UTC") ?? .gmt

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        calendar.locale = .current
        return calendar
    }

    init(text: Binding<String>) {
        self._text = text
        let start: (precision: DatePrecision, year: Int, month: Int, day: Int)
        if let date = ReleaseDateText.parse(text.wrappedValue).date {
            start = (date.month == nil ? .year : date.day == nil ? .month : .day, date.year, date.month ?? 1, date.day ?? 1)
        } else {
            // Today, as the person's own calendar day.
            var local = Calendar(identifier: .gregorian)
            local.timeZone = .current
            let today = local.dateComponents([.year, .month, .day], from: .now)
            start = (.day, today.year ?? 2024, today.month ?? 1, today.day ?? 1)
        }
        self._precision = State(initialValue: start.precision)
        self._year = State(initialValue: start.year)
        self._month = State(initialValue: start.month)
        self._day = State(initialValue: start.day)
        let nextYear = Calendar(identifier: .gregorian).component(.year, from: .now) + 1
        self.years = Array(min(1900, start.year)...max(nextYear, start.year))
    }

    private var daysInMonth: Int {
        let first = Self.calendar.date(from: DateComponents(year: year, month: month, day: 1)) ?? .now
        return Self.calendar.range(of: .day, in: .month, for: first)?.count ?? 31
    }

    /// What Done writes: the chosen precision, formatted.
    private var chosen: ReleaseDate? {
        switch precision {
        case .year: ReleaseDate(year: year)
        case .month: ReleaseDate(year: year, month: month)
        case .day: ReleaseDate(year: year, month: month, day: min(day, daysInMonth))
        }
    }

    // MARK: Wheels

    private var dayDate: Binding<Date> {
        Binding(
            get: { Self.calendar.date(from: DateComponents(year: year, month: month, day: min(day, daysInMonth))) ?? .now },
            set: { date in
                year = Self.calendar.component(.year, from: date)
                month = Self.calendar.component(.month, from: date)
                day = Self.calendar.component(.day, from: date)
            }
        )
    }

    private var dayRange: ClosedRange<Date> {
        let first = Self.calendar.date(from: DateComponents(year: years.first, month: 1, day: 1)) ?? .distantPast
        let last = Self.calendar.date(from: DateComponents(year: years.last, month: 12, day: 31)) ?? .distantFuture
        return first...last
    }

    private var monthNames: [String] { Self.calendar.standaloneMonthSymbols }

    @ViewBuilder
    private var wheels: some View {
        switch precision {
        case .day:
            DatePicker("", selection: dayDate, in: dayRange, displayedComponents: .date)
                .datePickerStyle(.wheel)
                .labelsHidden()
                .environment(\.calendar, Self.calendar)
                .environment(\.timeZone, Self.utc)
                .accessibilityLabel(Copy.DateField.sheetTitle)
        case .month:
            HStack(spacing: 0) {
                Picker(Copy.DateField.month, selection: $month) {
                    ForEach(1...12, id: \.self) { Text(monthNames[$0 - 1]).tag($0) }
                }
                .accessibilityLabel(Copy.DateField.month)
                Picker(Copy.DateField.year, selection: $year) {
                    ForEach(years, id: \.self) { Text(String($0)).tag($0) }
                }
                .accessibilityLabel(Copy.DateField.year)
            }
            .pickerStyle(.wheel)
        case .year:
            Picker(Copy.DateField.year, selection: $year) {
                ForEach(years, id: \.self) { Text(String($0)).tag($0) }
            }
            .pickerStyle(.wheel)
            .accessibilityLabel(Copy.DateField.year)
        }
    }

    private static let options: [(value: DatePrecision, icon: String?, label: String)] = [
        (.year, nil, Copy.DateField.year),
        (.month, nil, Copy.DateField.month),
        (.day, nil, Copy.DateField.day),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Immersive.labeledFieldRowGap) {
                Text(Copy.DateField.sheetTitle)
                    .font(Theme.ScaledFont.headline)
                    .foregroundStyle(Theme.primaryText)
                    .accessibilityAddTraits(.isHeader)
                SlimSwitch(options: Self.options, selection: $precision, compact: true)
                    .frame(maxWidth: .infinity)
                wheels
                    .frame(maxWidth: .infinity)
                Button {
                    if let chosen { text = chosen.formatted() }
                    dismiss()
                } label: {
                    Text(Copy.DateField.done)
                }
                .buttonStyle(MainButtonStyle())
                Button {
                    text = ""
                    dismiss()
                } label: {
                    Text(Copy.DateField.clear)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(TextButtonStyle())
            }
            .padding(Theme.Spacing.pagePadding)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Theme.card)
        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.card)
    }
}

/// The date row, then Genre as a normal labelled field (the shared label column, wrapping), one row
/// each. Used by the import record and the release page.
struct ReleaseDateGenreRows: View {
    @Binding var releaseDate: String
    @Binding var genre: String
    var isEditable = true
    var message: String?
    /// The component gallery's open-sheet frame.
    var startsWithSheetOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Immersive.labeledFieldRowGap) {
            ReleaseDateField(text: $releaseDate, isEditable: isEditable, message: message, startsWithSheetOpen: startsWithSheetOpen)
            LabeledField(Copy.Import.fieldGenre, placeholder: Copy.Import.genrePlaceholder, text: $genre, font: Theme.ScaledFont.input,
                         wraps: true, isEditable: isEditable)
        }
    }
}

#if DEBUG
private struct ReleaseDateFieldPreview: View {
    @State private var date = "17 May 2024"
    @State private var genre = ""
    var body: some View {
        ReleaseDateGenreRows(releaseDate: $date, genre: $genre)
            .padding(Theme.Spacing.pagePadding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Theme.background)
    }
}

#Preview("Release date") {
    ReleaseDateFieldPreview()
}
#endif
