import Foundation

// The logic of the share sheet (#183): the people entered, saved groups, the options and the result.
// `ShareSheet` only draws it.

/// A saved list of recipient emails, kept on this device only (the server has no group table).
struct ShareGroup: Codable, Hashable, Identifiable {
    var id = UUID()
    var name: String
    var emails: [String]
}

protocol ShareGroupStore {
    func all() -> [ShareGroup]
    func save(_ groups: [ShareGroup])
}

final class UserDefaultsShareGroupStore: ShareGroupStore {
    static let key = "com.tdare.locally.share.groups.v1"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func all() -> [ShareGroup] {
        guard let data = defaults.data(forKey: Self.key) else { return [] }
        return (try? JSONDecoder().decode([ShareGroup].self, from: data)) ?? []
    }

    func save(_ groups: [ShareGroup]) {
        guard let data = try? JSONEncoder().encode(groups) else { return }
        defaults.set(data, forKey: Self.key)
    }
}

/// Holds groups in memory only (the component gallery and tests).
final class InMemoryShareGroupStore: ShareGroupStore {
    private var groups: [ShareGroup]
    init(_ groups: [ShareGroup] = []) { self.groups = groups }
    func all() -> [ShareGroup] { groups }
    func save(_ groups: [ShareGroup]) { self.groups = groups }
}

enum ShareExpiry: Hashable, CaseIterable {
    case never, sevenDays, thirtyDays

    var days: Int? {
        switch self {
        case .never: nil
        case .sevenDays: 7
        case .thirtyDays: 30
        }
    }

    var label: String {
        switch self {
        case .never: Copy.Share.never
        case .sevenDays: Copy.Share.sevenDays
        case .thirtyDays: Copy.Share.thirtyDays
        }
    }
}

enum ShareEmail {
    /// The address trimmed and lower-cased, or nil when it is not shaped like an email.
    static func normalize(_ raw: String) -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !text.isEmpty, text.count <= 254, !text.contains(where: \.isWhitespace) else { return nil }
        let parts = text.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty else { return nil }
        let domain = parts[1].split(separator: ".", omittingEmptySubsequences: false)
        guard domain.count >= 2, domain.allSatisfy({ !$0.isEmpty }) else { return nil }
        return text
    }
}

/// What the sheet shows after Share.
struct ShareOutcome: Equatable {
    /// People the share reached (accounts that exist).
    var sharedCount: Int
    var notOnLocally: [String]
    var link: String?

    init(sharedCount: Int, notOnLocally: [String], link: String?) {
        self.sharedCount = sharedCount
        self.notOnLocally = notOnLocally
        self.link = link
    }

    init(_ result: ShareCreateResult) {
        self.init(sharedCount: result.share?.recipients.count ?? 0, notOnLocally: result.notOnLocally, link: result.link)
    }

    var createdAnything: Bool { sharedCount > 0 || link != nil }
}

@MainActor
@Observable
final class ShareSheetModel {
    static let maxPeople = 50

    let releaseId: UUID
    /// What is being shared: the release's title, or the one song's.
    let subject: String
    let trackIds: [UUID]?
    let isSignedIn: Bool

    private let api: SyncApi
    private let groupStore: ShareGroupStore

    private(set) var emails: [String] = []
    /// What is typed and not yet turned into a pill.
    var draft = ""
    private(set) var emailError: String?

    private(set) var groups: [ShareGroup]
    var linkOn = false
    var allowReshare = false
    var expiry = ShareExpiry.never
    /// Set from `GET /v1/me`. The Link option exists only while this is true.
    private(set) var publicSharesEnabled: Bool
    /// False where the server is not asked (the component gallery sets the state itself).
    private let loadsOptions: Bool

    private(set) var isSending = false
    private(set) var errorMessage: String?
    var outcome: ShareOutcome?

    init(releaseId: UUID, subject: String, trackIds: [UUID]? = nil, isSignedIn: Bool, api: SyncApi, groupStore: ShareGroupStore,
         publicSharesEnabled: Bool = false, loadsOptions: Bool = true) {
        self.releaseId = releaseId
        self.subject = subject
        self.trackIds = trackIds
        self.isSignedIn = isSignedIn
        self.api = api
        self.groupStore = groupStore
        self.groups = groupStore.all()
        self.publicSharesEnabled = publicSharesEnabled
        self.loadsOptions = loadsOptions
    }

    var showsLinkOption: Bool { publicSharesEnabled }

    /// Reads whether public links are on. A failed read leaves the Link option hidden.
    func loadOptions() async {
        guard isSignedIn, loadsOptions else { return }
        publicSharesEnabled = (try? await api.me())?.publicSharesEnabled ?? false
        if !publicSharesEnabled { linkOn = false }
    }

    // MARK: People

    func addEmail(_ raw: String) {
        guard let email = ShareEmail.normalize(raw) else {
            emailError = Copy.Share.notAnEmail
            return
        }
        guard !emails.contains(email) else { emailError = nil; return }
        guard emails.count < Self.maxPeople else { emailError = Copy.Share.tooMany; return }
        emails.append(email)
        emailError = nil
    }

    func remove(_ email: String) {
        emails.removeAll { $0 == email }
    }

    /// Return was pressed: the typed text becomes a pill (or an error).
    func submitDraft() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        addEmail(text)
        if emailError == nil { draft = "" }
    }

    /// A comma turns everything before it into pills; text after the last comma stays typed.
    func draftChanged() {
        guard draft.contains(",") else { return }
        var parts = draft.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
        let rest = parts.removeLast()
        for part in parts where !part.trimmingCharacters(in: .whitespaces).isEmpty {
            addEmail(part)
            if emailError != nil {
                draft = part.trimmingCharacters(in: .whitespaces)
                return
            }
        }
        draft = rest
    }

    // MARK: Groups

    var canSaveGroup: Bool { !emails.isEmpty }

    func add(_ group: ShareGroup) {
        for email in group.emails { addEmail(email) }
    }

    func saveGroup(named name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !emails.isEmpty else { return }
        if let index = groups.firstIndex(where: { $0.name.caseInsensitiveCompare(trimmed) == .orderedSame }) {
            groups[index].emails = emails
        } else {
            groups.append(ShareGroup(name: trimmed, emails: emails))
        }
        groupStore.save(groups)
    }

    func delete(_ group: ShareGroup) {
        groups.removeAll { $0.id == group.id }
        groupStore.save(groups)
    }

    // MARK: Send

    var usesLink: Bool { showsLinkOption && linkOn }

    /// Something to share with: a pill, a valid typed address, or the link.
    var canSend: Bool {
        guard isSignedIn, !isSending else { return false }
        return !emails.isEmpty || ShareEmail.normalize(draft) != nil || usesLink
    }

    func send() async {
        guard canSend else { return }
        // A typed address that was never confirmed still counts.
        if !draft.trimmingCharacters(in: .whitespaces).isEmpty {
            submitDraft()
            if emailError != nil { return }
        }
        isSending = true
        errorMessage = nil
        defer { isSending = false }
        let request = ShareCreateRequest(
            releaseId: releaseId.uuidString,
            trackIds: trackIds?.map(\.uuidString),
            recipients: emails,
            visibility: usesLink ? .public : .private,
            allowReshare: allowReshare,
            expiresInDays: expiry.days
        )
        do {
            outcome = ShareOutcome(try await api.createShare(request))
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
