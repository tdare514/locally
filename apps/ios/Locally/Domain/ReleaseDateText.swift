import Foundation

/// What a typed release date came to (#221).
enum ReleaseDateEntry: Equatable {
    /// Nothing typed.
    case empty
    /// A real date at year, month or day precision.
    case date(ReleaseDate)
    /// Has a date's shape but is not a real date: 31/02/2024, 2024-13.
    case impossible
    /// Not a date we read: "soon", "2", "17 Mayo 2024".
    case unreadable
}

/// Reads what a person types into the release date field. Tokens are digit runs and letter runs,
/// checked by hand against `ReleaseDate`, never through a lenient `DateFormatter` (which rolls 31 Feb
/// into March). Gregorian only.
enum ReleaseDateText {
    private enum Token: Equatable {
        case number(String)
        case word(String)
    }

    static func parse(_ text: String, locale: Locale = .current) -> ReleaseDateEntry {
        var trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .empty }
        if let date = formattedDate(trimmed, locale: locale) { return .date(date) }
        // "Sept." and "17 May 2024." end in a dot that means nothing.
        if trimmed.hasSuffix(".") { trimmed.removeLast() }
        guard let first = trimmed.first, let last = trimmed.last, isAlphanumeric(first), isAlphanumeric(last),
              let tokens = tokenize(trimmed) else { return .unreadable }

        switch tokens.count {
        case 1:
            guard case .number(let digits) = tokens[0], digits.count == 4 else { return .unreadable }
            return entry(year: digits)
        case 2:
            return twoTokens(tokens, locale: locale)
        case 3:
            return threeTokens(tokens, locale: locale)
        default:
            return .unreadable
        }
    }

    // MARK: Shapes

    /// "2024-05", "05/2024", "May 2024".
    private static func twoTokens(_ tokens: [Token], locale: Locale) -> ReleaseDateEntry {
        switch (tokens[0], tokens[1]) {
        case let (.number(a), .number(b)):
            if a.count == 4, b.count <= 2 { return entry(year: a, month: b) }
            if b.count == 4, a.count <= 2 { return entry(year: b, month: a) }
            return .unreadable
        case let (.word(name), .number(year)):
            guard year.count == 4 else { return .unreadable }
            guard let month = month(named: name, locale: locale) else { return .unreadable }
            return entry(year: year, month: String(month))
        default:
            return .unreadable
        }
    }

    /// "2024-05-17", "17/05/2024" (the locale's order), "17 May 2024", "May 17, 2024".
    private static func threeTokens(_ tokens: [Token], locale: Locale) -> ReleaseDateEntry {
        switch (tokens[0], tokens[1], tokens[2]) {
        case let (.number(a), .number(b), .number(c)):
            if a.count == 4 { return entry(year: a, month: b, day: c) }
            guard c.count == 4 else { return .unreadable }
            return dayFirst(locale) ? entry(year: c, month: b, day: a) : entry(year: c, month: a, day: b)
        case let (.number(day), .word(name), .number(year)):
            guard year.count == 4, let month = month(named: name, locale: locale) else { return .unreadable }
            return entry(year: year, month: String(month), day: day)
        case let (.word(name), .number(day), .number(year)):
            guard year.count == 4, let month = month(named: name, locale: locale) else { return .unreadable }
            return entry(year: year, month: String(month), day: day)
        default:
            return .unreadable
        }
    }

    /// Builds the date from digit runs. A day or month of more than two digits is not a date's shape.
    private static func entry(year: String, month: String? = nil, day: String? = nil) -> ReleaseDateEntry {
        guard year.count == 4, let y = Int(year) else { return .unreadable }
        var m: Int?
        var d: Int?
        if let month {
            guard month.count <= 2, let value = Int(month) else { return .unreadable }
            m = value
        }
        if let day {
            guard day.count <= 2, let value = Int(day) else { return .unreadable }
            d = value
        }
        return ReleaseDate(year: y, month: m, day: d).map(ReleaseDateEntry.date) ?? .impossible
    }

    // MARK: Tokens

    private static let separators: Set<Character> = [" ", "\u{A0}", "/", ".", "-", ","]

    private static func isAlphanumeric(_ c: Character) -> Bool { isDigit(c) || c.isLetter }

    private static func isDigit(_ c: Character) -> Bool { c.isASCII && c.isNumber }

    /// Digit runs and letter runs; nil when anything else is in the text.
    private static func tokenize(_ text: String) -> [Token]? {
        var tokens: [Token] = []
        var run = ""
        var runIsNumber = false
        func flush() {
            guard !run.isEmpty else { return }
            tokens.append(runIsNumber ? .number(run) : .word(run))
            run = ""
        }
        for c in text {
            if isDigit(c) {
                if !run.isEmpty, !runIsNumber { flush() }
                runIsNumber = true
                run.append(c)
            } else if c.isLetter {
                if !run.isEmpty, runIsNumber { flush() }
                runIsNumber = false
                run.append(c)
            } else if separators.contains(c) {
                flush()
            } else {
                return nil
            }
        }
        flush()
        return tokens
    }

    // MARK: Locale

    /// What `ReleaseDate.formatted(locale:)` prints reads back in any locale ("2024年5月17日", "17 мая 2024 г."):
    /// parsed with the same templates, and accepted only when it prints the very same text again, so a lenient
    /// parse (31 Feb rolling into March) can never get through.
    private static func formattedDate(_ text: String, locale: Locale) -> ReleaseDate? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        for (template, hasDay) in [("dMMMMy", true), ("MMMMy", false)] {
            let formatter = DateFormatter()
            formatter.locale = locale
            formatter.calendar = calendar
            formatter.timeZone = calendar.timeZone
            formatter.setLocalizedDateFormatFromTemplate(template)
            guard let date = formatter.date(from: text) else { continue }
            let parts = calendar.dateComponents([.year, .month, .day], from: date)
            guard let year = parts.year, let month = parts.month,
                  let candidate = ReleaseDate(year: year, month: month, day: hasDay ? parts.day : nil),
                  candidate.formatted(locale: locale) == text else { continue }
            return candidate
        }
        return nil
    }

    /// True when the locale's short numeric date puts the day before the month (en-GB), false for en-US.
    private static func dayFirst(_ locale: Locale) -> Bool {
        let pattern = DateFormatter.dateFormat(fromTemplate: "ddMMyyyy", options: 0, locale: locale) ?? "dd/MM/yyyy"
        guard let day = pattern.firstIndex(of: "d"), let month = pattern.firstIndex(of: "M") else { return true }
        return day < month
    }

    private static func fold(_ text: String, locale: Locale) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: locale)
    }

    /// 1...12 for a full or short month name in the locale, ignoring case and accents; nil if none or more than one fits.
    private static func month(named name: String, locale: Locale) -> Int? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = locale
        let sets = [calendar.monthSymbols, calendar.shortMonthSymbols, calendar.standaloneMonthSymbols, calendar.shortStandaloneMonthSymbols]
        let wanted = fold(name, locale: locale)
        var found: Set<Int> = []
        for symbols in sets {
            for (index, symbol) in symbols.enumerated() where fold(symbol.trimmingCharacters(in: CharacterSet(charactersIn: ".")), locale: locale) == wanted {
                found.insert(index + 1)
            }
        }
        return found.count == 1 ? found.first : nil
    }
}

extension ReleaseDateEntry {
    /// The date typed, nil for empty, impossible and unreadable.
    var date: ReleaseDate? {
        if case .date(let date) = self { return date }
        return nil
    }

    /// The line under the field, nil when the text is empty or a date.
    var message: String? {
        switch self {
        case .empty, .date: nil
        case .impossible: Copy.DateField.impossible
        case .unreadable: Copy.DateField.unreadable
        }
    }
}
