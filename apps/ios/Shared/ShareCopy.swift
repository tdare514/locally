import Foundation

/// Every user-facing string in the "Send to Locally" share extension. The
/// extension can't see the app's `Copy` table, so its copy lives here, in
/// the folder both targets compile, and follows the same tone rules.
enum ShareCopy {
    static let saving = "Saving to Locally…"
    static let done = "Done"
    static let noAudio = "Couldn't find any audio to save."
    static let saved = "Saved to Locally. Open Locally to tag and send."
    static let saveFailed = "Couldn't save that file."
    static let notAudio = "That file isn't audio."
    static let noAppGroup = "Couldn't reach Locally's shared storage."

    static func savedSome(_ saved: Int, skipped: Int) -> String {
        "Saved \(saved) to Locally, skipped \(skipped) it can't import. Open Locally to tag and send."
    }

    static func unsupportedFormat(fileExtension ext: String) -> String {
        let trimmed = ext.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return "Locally can't import that file. Share \(SupportedAudio.readableList)."
        }
        return "Locally can't import .\(trimmed.lowercased()) files. Share \(SupportedAudio.readableList)."
    }
}
