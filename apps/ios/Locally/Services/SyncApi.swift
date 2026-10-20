import Foundation

// MARK: - Wire types

/// `POST /v1/auth/verify`'s response: a long-lived device token plus who
/// signed in and which device this is.
struct SyncVerifyResult: Equatable {
    var token: String
    var userId: String
    var email: String
    var deviceId: String
    var deviceName: String
}

/// `GET /v1/me`'s `quota` field: how much of the free-tier allowance is used.
struct SyncQuota: Equatable {
    var usedBytes: Int
    var limitBytes: Int
}

/// `GET /v1/me`'s response, trimmed to what the app shows in Settings.
struct SyncMeResult: Equatable {
    var email: String
    var deviceId: String
    var deviceName: String
    var quota: SyncQuota
    /// When the Mac last asked the phone to send its files again (#171), or
    /// `nil` if it never has, or the server is older than that field.
    var resyncRequestedAt: Date? = nil
}

/// One release in `GET /v1/files/missing`: the file names its record
/// references that the server has no stored copy of. Other keys the server
/// sends (`recordUpdatedAt`) are ignored.
struct SyncMissingRelease: Decodable, Equatable {
    var id: String
    var missing: [String]
}

/// `GET /v1/files/missing`'s response (#171): only the caller's live
/// releases with something missing, so a healthy account gets `releases: []`.
struct SyncMissingFiles: Decodable, Equatable {
    var releases: [SyncMissingRelease]
}

/// `GET /v1/releases/:id/plays`: Spotify play counts per track, split by device.
/// The phone only shows these; it never adds counts (#108).
struct SyncReleasePlays: Decodable, Equatable {
    var tracks: [SyncTrackPlays]
}

/// One track's plays. `trackId` is the sync record's track id; `total` is the sum over `devices`.
struct SyncTrackPlays: Decodable, Equatable {
    var trackId: String
    var total: Int
    var devices: [SyncDevicePlays]
}

/// One device's play count for a track. `current` is true for the requesting device.
struct SyncDevicePlays: Decodable, Equatable {
    var deviceId: String
    var name: String
    var platform: String
    var count: Int
    var current: Bool
}

/// One page of `GET /v1/plays/summary` (#204): the plays in the requested days
/// per track (`tracks`) and over all time (`allTime`), over all the user's
/// devices. Both lists cover the same page of track ids; `nextCursor` is the
/// last track id when more follow, else `nil`.
struct SyncPlaysSummaryPage: Decodable, Equatable {
    var tracks: [SyncPeriodPlays]
    var allTime: [SyncAllTimePlays]
    var nextCursor: String?
}

/// One track's plays inside the requested days; `lastPlayedDay` is `YYYY-MM-DD`.
struct SyncPeriodPlays: Decodable, Equatable {
    var trackId: String
    var releaseId: String
    var plays: Int
    var lastPlayedDay: String?
}

/// One track's plays over all time.
struct SyncAllTimePlays: Decodable, Equatable {
    var trackId: String
    var releaseId: String
    var plays: Int
}

/// One page of `GET /v1/releases?sinceVersion=N&limit=M`.
///
/// `hasMore: true` means more releases exist above `nextVersion`; the caller
/// repeats the request with `sinceVersion = nextVersion` until it sees
/// `false`. Absent on an older server's response, which decodes as `false`
/// (see `HttpSyncApi.releases(sinceVersion:limit:)`).
struct SyncReleasesPage: Equatable {
    var releases: [SyncRecord]
    var nextVersion: Int
    var hasMore: Bool
}

/// The page size `SyncEngine` requests from `GET /v1/releases`, per
/// `docs/plans/30-sync-pagination.md`. The server clamps to this value
/// anyway; sending it explicitly keeps both sides in agreement.
let syncReleasesPageLimit = 200

/// One entry of `POST /v1/releases/:id/files`'s request body.
struct SyncFileUploadRequest: Equatable {
    var name: String
    var bytes: Int
    var contentType: String
}

/// One entry of `POST /v1/releases/:id/files`'s response: a short-lived
/// upload ticket the client uploads directly to (never through the API
/// function, which caps request bodies at 4.5 MB — see `spec/sync.md`).
struct SyncUpload: Equatable {
    var name: String
    var url: URL
    var method: String
    var headers: [String: String]
}

/// Typed failures `SyncEngine` branches on, per the brief: an expired/revoked
/// token, a last-writer-wins conflict, the account's storage quota, or any
/// other network/server failure (message good enough to show in Settings).
enum SyncApiError: LocalizedError, Equatable {
    case unauthorized
    case conflict(serverUpdatedAt: Date?)
    case quotaExceeded
    /// A 404 on a route an older API doesn't have yet (`/v1/files/*`, #171;
    /// `/v1/plays/summary`, #204).
    /// Only raised by calls that expect it; every other 404 stays `.network`.
    case notFound
    /// A 429 on a route that rate-limits (`/v1/files/*`, #171; `/v1/plays/summary`, #204). Same scoping as `.notFound`.
    case rateLimited
    case network(String)
    /// The request got no HTTP response at all (offline, refused, timed out). Distinct from `.network`, which also covers an HTTP error status, so a caller can tell whether the service was reached.
    case unreachable(String)

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "Signed out of sync. Sign in again in Settings."
        case .conflict:
            return "Someone else changed this release first."
        case .quotaExceeded:
            return "Your sync storage is full."
        case .notFound:
            return "The sync server doesn't have that yet."
        case .rateLimited:
            return "The sync server is busy. Try again soon."
        case .network(let message), .unreachable(let message):
            return message
        }
    }
}

/// Every operation the sync feature needs from the service in `spec/sync.md`.
/// One production implementation (`HttpSyncApi`, over `URLSession`); tests
/// use `FakeSyncApi` (`LocallyTests/Fakes.swift`).
protocol SyncApi {
    func requestCode(email: String) async throws
    func verify(email: String, code: String, deviceName: String, platform: String) async throws -> SyncVerifyResult
    func me() async throws -> SyncMeResult
    func revokeDevice(_ id: String) async throws
    /// `DELETE /v1/me`. `email` must be the account's own email (the
    /// server's confirmation check); a bad/deleted token maps to
    /// `.unauthorized` like every other call.
    func deleteAccount(email: String) async throws
    func releases(sinceVersion: Int, limit: Int) async throws -> SyncReleasesPage
    /// `PUT /v1/releases/:id`. Returns the new version, or throws
    /// `.conflict` if the stored `updatedAt` is newer.
    @discardableResult
    func putRelease(_ record: SyncRecord) async throws -> Int
    /// `DELETE /v1/releases/:id` (a tombstone). Returns the new version.
    @discardableResult
    func deleteRelease(_ id: String) async throws -> Int
    /// `POST /v1/releases/:id/files`. The server returns an upload ticket
    /// only for files it doesn't already have, so "upload missing files"
    /// falls out of uploading exactly what comes back here.
    func requestUploads(releaseId: String, files: [SyncFileUploadRequest]) async throws -> [SyncUpload]
    /// Uploads `fileURL`'s bytes to `upload.url` via `uploadTask(with:fromFile:)`
    /// so the track's data is streamed from disk, never loaded into memory.
    func uploadFile(_ fileURL: URL, to upload: SyncUpload) async throws
    /// `GET /v1/releases/:id/files/:name`: a short-lived download URL.
    func downloadURL(releaseId: String, fileName: String) async throws -> URL
    /// `GET /v1/files/missing`: the caller's live releases with file names the
    /// server has no stored copy of (#171). Throws `.notFound` on an API that
    /// predates the route and `.rateLimited` on a 429.
    func missingFiles() async throws -> SyncMissingFiles
    /// `GET /v1/releases/:id/plays`: per-device play counts for each track.
    /// Throws on a 404 when the release isn't the user's or is tombstoned.
    func releasePlays(releaseId: String) async throws -> SyncReleasePlays
    /// `GET /v1/plays/summary?from&to[&cursor]` (#204): one page of per-track
    /// plays in the days `from`...`to` (`YYYY-MM-DD`) plus all-time. Throws
    /// `.notFound` on an API that predates the route and `.rateLimited` on a 429.
    func playsSummary(from: String, to: String, cursor: String?) async throws -> SyncPlaysSummaryPage
    /// Downloads `url` to `destination` via `downloadTask(with:)`, so the
    /// file streams straight to disk rather than through memory.
    func downloadFile(from url: URL, to destination: URL) async throws
}

/// Production `SyncApi`, over `URLSession`. Reads `baseURL`/`deviceToken`
/// from `SyncAccountStore` on every call, so a token refreshed by
/// `SyncAccountStore.save` (or a base URL edited in Settings) takes effect
/// on the very next request with no extra wiring.
final class HttpSyncApi: SyncApi {
    private let account: SyncAccountStore
    private let session: URLSession

    init(account: SyncAccountStore, session: URLSession = .shared) {
        self.account = account
        self.session = session
    }

    // MARK: - Auth

    func requestCode(email: String) async throws {
        _ = try await send(path: "/v1/auth/code", method: "POST", body: ["email": email], authorized: false)
    }

    func verify(email: String, code: String, deviceName: String, platform: String) async throws -> SyncVerifyResult {
        let data = try await send(
            path: "/v1/auth/verify",
            method: "POST",
            body: ["email": email, "code": code, "deviceName": deviceName, "platform": platform],
            authorized: false
        )
        struct Response: Decodable {
            struct User: Decodable { let id: String; let email: String }
            struct Device: Decodable { let id: String; let name: String }
            let token: String
            let user: User
            let device: Device
        }
        let decoded = try decode(Response.self, from: data)
        return SyncVerifyResult(
            token: decoded.token,
            userId: decoded.user.id,
            email: decoded.user.email,
            deviceId: decoded.device.id,
            deviceName: decoded.device.name
        )
    }

    func me() async throws -> SyncMeResult {
        let data = try await send(path: "/v1/me", method: "GET")
        struct Response: Decodable {
            struct User: Decodable { let email: String }
            struct Device: Decodable { let id: String; let name: String }
            struct Quota: Decodable { let usedBytes: Int; let limitBytes: Int }
            let user: User
            let device: Device
            let quota: Quota
            /// Absent or null on an older API. Read as text and parsed below, so
            /// a value this build can't parse costs the nudge, not the whole call.
            let resyncRequestedAt: String?
        }
        let decoded = try decode(Response.self, from: data)
        return SyncMeResult(
            email: decoded.user.email,
            deviceId: decoded.device.id,
            deviceName: decoded.device.name,
            quota: SyncQuota(usedBytes: decoded.quota.usedBytes, limitBytes: decoded.quota.limitBytes),
            resyncRequestedAt: decoded.resyncRequestedAt.flatMap(SyncDateFormat.decode)
        )
    }

    func revokeDevice(_ id: String) async throws {
        _ = try await send(path: "/v1/devices/\(id)", method: "DELETE")
    }

    func deleteAccount(email: String) async throws {
        _ = try await send(path: "/v1/me", method: "DELETE", body: ["email": email])
    }

    // MARK: - Releases

    func releases(sinceVersion: Int, limit: Int) async throws -> SyncReleasesPage {
        let data = try await send(path: "/v1/releases?sinceVersion=\(sinceVersion)&limit=\(limit)", method: "GET")
        struct Response: Decodable {
            let releases: [SyncRecordPageElement]
            let nextVersion: Int
            let hasMore: Bool?
        }
        let decoded = try decode(Response.self, from: data)
        return SyncReleasesPage(
            releases: decoded.releases.compactMap(\.record),
            nextVersion: decoded.nextVersion,
            hasMore: decoded.hasMore ?? false
        )
    }

    @discardableResult
    func putRelease(_ record: SyncRecord) async throws -> Int {
        let body = try JSONEncoder.syncApi.encode(record)
        let data = try await send(path: "/v1/releases/\(record.id)", method: "PUT", bodyData: body)
        struct Response: Decodable { let version: Int }
        return try decode(Response.self, from: data).version
    }

    @discardableResult
    func deleteRelease(_ id: String) async throws -> Int {
        let data = try await send(path: "/v1/releases/\(id)", method: "DELETE")
        struct Response: Decodable { let version: Int }
        return try decode(Response.self, from: data).version
    }

    // MARK: - Files

    func requestUploads(releaseId: String, files: [SyncFileUploadRequest]) async throws -> [SyncUpload] {
        let body: [String: Any] = [
            "files": files.map { ["name": $0.name, "bytes": $0.bytes, "contentType": $0.contentType] },
        ]
        let data = try await send(path: "/v1/releases/\(releaseId)/files", method: "POST", body: body)
        struct Response: Decodable {
            struct Upload: Decodable { let name: String; let url: String; let method: String; let headers: [String: String] }
            let uploads: [Upload]
        }
        let decoded = try decode(Response.self, from: data)
        return try decoded.uploads.map { upload in
            guard let url = Self.serverURL(upload.url) else {
                throw SyncApiError.network("Malformed upload URL.")
            }
            return SyncUpload(name: upload.name, url: url, method: upload.method, headers: upload.headers)
        }
    }

    func uploadFile(_ fileURL: URL, to upload: SyncUpload) async throws {
        var request = URLRequest(url: upload.url)
        request.httpMethod = upload.method
        for (field, value) in upload.headers {
            request.setValue(value, forHTTPHeaderField: field)
        }

        let (_, response) = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<(Data, URLResponse), Error>) in
            let task = session.uploadTask(with: request, fromFile: fileURL) { data, response, error in
                if let error {
                    continuation.resume(throwing: SyncApiError.network(error.localizedDescription))
                } else {
                    continuation.resume(returning: (data ?? Data(), response ?? URLResponse()))
                }
            }
            task.resume()
        }
        try Self.checkUploadResponse(response)
    }

    /// Parses a URL the server issued. Storage leaves `[` and `]` raw in the
    /// path, which makes `URL(string:)` re-encode the whole string, `%`
    /// included, and the file is then fetched from the wrong path (#281).
    /// Here only characters that aren't valid in a URL are percent-encoded;
    /// existing `%XX` escapes stay as they are.
    static func serverURL(_ string: String) -> URL? {
        if let url = URL(string: string, encodingInvalidCharacters: false) {
            return url
        }
        // ASCII only: `CharacterSet.alphanumerics` would let non-ASCII letters through unencoded.
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#@!$&'()*+,;=%")
        guard let encoded = string.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return URL(string: encoded, encodingInvalidCharacters: false)
    }

    func downloadURL(releaseId: String, fileName: String) async throws -> URL {
        // Names are plain (see `SyncEngine.downloadFile`) but can still hold
        // characters like `#`, `%` or `&` that would cut or mis-parse the path.
        let encodedName = fileName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? fileName
        let data = try await send(path: "/v1/releases/\(releaseId)/files/\(encodedName)", method: "GET")
        struct Response: Decodable { let url: String; let expiresAt: String }
        let decoded = try decode(Response.self, from: data)
        guard let url = Self.serverURL(decoded.url) else {
            throw SyncApiError.network("Malformed download URL.")
        }
        return url
    }

    func missingFiles() async throws -> SyncMissingFiles {
        let data = try await send(
            path: "/v1/files/missing",
            method: "GET",
            statusErrors: [404: .notFound, 429: .rateLimited]
        )
        return try decode(SyncMissingFiles.self, from: data)
    }

    func releasePlays(releaseId: String) async throws -> SyncReleasePlays {
        let data = try await send(path: "/v1/releases/\(releaseId)/plays", method: "GET")
        return try decode(SyncReleasePlays.self, from: data)
    }

    func playsSummary(from: String, to: String, cursor: String?) async throws -> SyncPlaysSummaryPage {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+#")
        func encode(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value }
        var query = "from=\(encode(from))&to=\(encode(to))"
        if let cursor { query += "&cursor=\(encode(cursor))" }
        let data = try await send(
            path: "/v1/plays/summary?\(query)",
            method: "GET",
            statusErrors: [404: .notFound, 429: .rateLimited]
        )
        return try decode(SyncPlaysSummaryPage.self, from: data)
    }

    func downloadFile(from url: URL, to destination: URL) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let task = session.downloadTask(with: url) { tempURL, response, error in
                if let error {
                    continuation.resume(throwing: SyncApiError.network(error.localizedDescription))
                    return
                }
                guard let tempURL else {
                    continuation.resume(throwing: SyncApiError.network("No file was downloaded."))
                    return
                }
                // An error page must never be saved as a cover or track file.
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    let status = (response as? HTTPURLResponse)?.statusCode
                    let message = status.map { "The file could not be downloaded (\($0))." } ?? "The file could not be downloaded."
                    continuation.resume(throwing: SyncApiError.network(message))
                    return
                }
                do {
                    // The temp file is deleted as soon as this handler
                    // returns, so the move must happen synchronously here.
                    try? FileManager.default.removeItem(at: destination)
                    try FileManager.default.moveItem(at: tempURL, to: destination)
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: SyncApiError.network(error.localizedDescription))
                }
            }
            task.resume()
        }
    }

    // MARK: - Private

    @discardableResult
    private func send(
        path: String,
        method: String,
        body: [String: Any]? = nil,
        authorized: Bool = true,
        statusErrors: [Int: SyncApiError] = [:]
    ) async throws -> Data {
        let bodyData = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        return try await send(path: path, method: method, bodyData: bodyData, authorized: authorized, statusErrors: statusErrors)
    }

    @discardableResult
    private func send(
        path: String,
        method: String,
        bodyData: Data?,
        authorized: Bool = true,
        statusErrors: [Int: SyncApiError] = [:]
    ) async throws -> Data {
        // Built by string concatenation rather than `appendingPathComponent`,
        // which would percent-encode a `?sinceVersion=` query string.
        let urlString = account.baseURL.absoluteString.trimmingTrailingSlash + (path.hasPrefix("/") ? path : "/" + path)
        guard let url = URL(string: urlString) else {
            throw SyncApiError.network("Invalid server address.")
        }
        #if !DEBUG
        // Release builds never send the bearer token or user content over plain http (issue #11); DEBUG builds may target a LAN address.
        guard url.scheme?.lowercased() == "https" else {
            throw SyncApiError.network("Sync requires an https server address.")
        }
        #endif
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authorized, let token = account.deviceToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let bodyData {
            request.httpBody = bodyData
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw SyncApiError.unreachable(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw SyncApiError.unreachable("No response from the server.")
        }
        if let typed = statusErrors[http.statusCode] { throw typed }
        try Self.checkStatus(http.statusCode, data: data)
        return data
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder.syncApi.decode(type, from: data)
        } catch {
            throw SyncApiError.network("Couldn't understand the server's response.")
        }
    }

    private static func checkStatus(_ status: Int, data: Data) throws {
        guard !(200...299).contains(status) else { return }

        let message = errorMessage(from: data)
        switch status {
        case 401:
            throw SyncApiError.unauthorized
        case 409:
            throw SyncApiError.conflict(serverUpdatedAt: nil)
        case 402, 413:
            throw SyncApiError.quotaExceeded
        default:
            if let message, message.lowercased().contains("quota") {
                throw SyncApiError.quotaExceeded
            }
            throw SyncApiError.network(message ?? "The server returned an error (\(status)).")
        }
    }

    /// Uploads go straight to object storage (not this app's API), so a
    /// failure there is a plain HTTP status, not the API's `{error}` shape.
    private static func checkUploadResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard !(200...299).contains(http.statusCode) else { return }
        if http.statusCode == 507 || http.statusCode == 413 {
            throw SyncApiError.quotaExceeded
        }
        throw SyncApiError.network("The upload failed (\(http.statusCode)).")
    }

    /// Best-effort read of the API's `{ "error": "..." }` shape (see
    /// `apps/api/src/shared/types.ts`'s `ApiError`), for a status code that
    /// doesn't map to a typed case.
    private static func errorMessage(from data: Data) -> String? {
        struct ErrorBody: Decodable { let error: String }
        return try? JSONDecoder().decode(ErrorBody.self, from: data).error
    }
}

private extension String {
    var trimmingTrailingSlash: String {
        hasSuffix("/") ? String(dropLast()) : self
    }
}
