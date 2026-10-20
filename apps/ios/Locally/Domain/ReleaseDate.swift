import Foundation

/// A release date at year, month or day precision (#221): "2024", "2024-05" or "2024-05-17".
/// The one type every read and write of a date goes through, so `year` and `releaseDate` cannot drift.
struct ReleaseDate: Hashable, Sendable {
    /// 0...9999, written as four digits.
    let year: Int
    /// 1...12.
    let month: Int?
    /// A real day for its month and year (leap years); never set without a month.
    let day: Int?

    /// Nil when the parts are not a real date.
    init?(year: Int, month: Int? = nil, day: Int? = nil) {
        guard (0...9999).contains(year) else { return nil }
        if let month {
            guard (1...12).contains(month) else { return nil }
            if let day {
                guard day >= 1, day <= Self.daysIn(month: month, year: year) else { return nil }
            }
        } else if day != nil {
            return nil
        }
        self.year = year
        self.month = month
        self.day = day
    }

    /// Exactly `YYYY`, `YYYY-MM` or `YYYY-MM-DD` in ASCII digits that is a real date (surrounding whitespace is trimmed).
    init?(_ string: String) {
        let parts = string.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "-", omittingEmptySubsequences: false)
        guard (1...3).contains(parts.count) else { return nil }
        guard let year = Self.number(parts[0], digits: 4) else { return nil }
        var month: Int?
        var day: Int?
        if parts.count >= 2 {
            guard let m = Self.number(parts[1], digits: 2) else { return nil }
            month = m
        }
        if parts.count == 3 {
            guard let d = Self.number(parts[2], digits: 2) else { return nil }
            day = d
        }
        self.init(year: year, month: month, day: day)
    }

    /// The date at the start of a tag value: a leading `YYYY-MM-DD`, `YYYY-MM` or `YYYY` followed by the end or a
    /// non-digit ("2024-05-17T07:00:00Z" gives 2024-05-17). When the longer prefix is not a real date the shorter
    /// one is tried ("2024-13-40" gives 2024). Nil when there is no leading four-digit year.
    static func fromTag(_ raw: String) -> ReleaseDate? {
        let chars = Array(raw.trimmingCharacters(in: .whitespacesAndNewlines))
        for length in [10, 7, 4] where chars.count >= length {
            if chars.count > length, isDigit(chars[length]) { continue }
            if let date = ReleaseDate(String(chars[0..<length])), date.isoString.count == length { return date }
        }
        return nil
    }

    /// The date a stored release holds: `year` must be exactly four ASCII digits; `releaseDate` is used only when it
    /// parses at month or day precision and its year equals `year`, otherwise the year alone.
    static func stored(year: String?, releaseDate: String?) -> ReleaseDate? {
        guard let year, year.count == 4, let y = number(Substring(year), digits: 4) else { return nil }
        if let releaseDate, let precise = ReleaseDate(releaseDate), precise.month != nil, precise.year == y {
            return precise
        }
        return ReleaseDate(year: y)
    }

    /// "2024".
    var yearString: String { String(format: "%04d", year) }

    /// "2024-05" or "2024-05-17"; nil at year precision.
    var releaseDateString: String? {
        guard let month else { return nil }
        guard let day else { return yearString + String(format: "-%02d", month) }
        return yearString + String(format: "-%02d-%02d", month, day)
    }

    /// "2024", "2024-05" or "2024-05-17": the TDRC and ©day value.
    var isoString: String { releaseDateString ?? yearString }

    /// en-GB "17 May 2024", "May 2024", "2024"; en-US "May 17, 2024", "May 2024", "2024".
    /// Gregorian calendar and UTC time zone, so the device's own calendar never shifts the digits.
    func formatted(locale: Locale = .current) -> String {
        guard let month else { return yearString }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day ?? 1)) else { return isoString }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate(day == nil ? "MMMMy" : "dMMMMy")
        return formatter.string(from: date)
    }

    private static func isDigit(_ c: Character) -> Bool { c.isASCII && ("0"..."9").contains(c) }

    private static func number(_ text: Substring, digits: Int) -> Int? {
        guard text.count == digits, text.allSatisfy(isDigit) else { return nil }
        return Int(text)
    }

    private static func daysIn(month: Int, year: Int) -> Int {
        switch month {
        case 2: return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 29 : 28
        case 4, 6, 9, 11: return 30
        default: return 31
        }
    }
}

/// Stored and sent as its `isoString`; a value that is not a real date does not decode.
extension ReleaseDate: Codable {
    init(from decoder: Decoder) throws {
        let text = try decoder.singleValueContainer().decode(String.self)
        guard let date = ReleaseDate(text) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a release date: \(text)"))
        }
        self = date
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(isoString)
    }
}
