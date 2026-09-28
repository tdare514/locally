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
}

/// One page of `GET /v1/releases?sinceVersion=N`.
struct SyncReleasesPage: Equatable {
    var releases: [SyncRecord]
    var nextVersion: Int
}

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
    case network(String)

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "Signed out of sync. Sign in again in Settings."
        case .conflict:
            return "Someone else changed this release first."
        case .quotaExceeded:
            return "Your sync storage is full."
        case .network(let message):
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
    func releases(sinceVersion: Int) async throws -> SyncReleasesPage
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
        }
        let decoded = try decode(Response.self, from: data)
        return SyncMeResult(
            email: decoded.user.email,
            deviceId: decoded.device.id,
            deviceName: decoded.device.name,
            quota: SyncQuota(usedBytes: decoded.quota.usedBytes, limitBytes: decoded.quota.limitBytes)
        )
    }

    func revokeDevice(_ id: String) async throws {
        _ = try await send(path: "/v1/devices/\(id)", method: "DELETE")
    }

    // MARK: - Releases

    func releases(sinceVersion: Int) async throws -> SyncReleasesPage {
        let data = try await send(path: "/v1/releases?sinceVersion=\(sinceVersion)", method: "GET")
        struct Response: Decodable {
            let releases: [SyncRecord]
            let nextVersion: Int
        }
        let decoded = try decode(Response.self, from: data)
        return SyncReleasesPage(releases: decoded.releases, nextVersion: decoded.nextVersion)
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
            guard let url = URL(string: upload.url) else {
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

    func downloadURL(releaseId: String, fileName: String) async throws -> URL {
        // Names are plain (see `SyncEngine.downloadFile`) but can still hold
        // characters like `#`, `%` or `&` that would cut or mis-parse the path.
        let encodedName = fileName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? fileName
        let data = try await send(path: "/v1/releases/\(releaseId)/files/\(encodedName)", method: "GET")
        struct Response: Decodable { let url: String; let expiresAt: String }
        let decoded = try decode(Response.self, from: data)
        guard let url = URL(string: decoded.url) else {
            throw SyncApiError.network("Malformed download URL.")
        }
        return url
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
        authorized: Bool = true
    ) async throws -> Data {
        let bodyData = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        return try await send(path: path, method: method, bodyData: bodyData, authorized: authorized)
    }

    @discardableResult
    private func send(
        path: String,
        method: String,
        bodyData: Data?,
        authorized: Bool = true
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
            throw SyncApiError.network(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw SyncApiError.network("No response from the server.")
        }
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
