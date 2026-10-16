import Foundation
import Testing
@testable import Locally

/// A `URLProtocol` stub so `HttpSyncApi` tests never touch the network:
/// registered on an ephemeral `URLSessionConfiguration`, it hands back
/// whatever `handler` returns and records the request it saw. The suite
/// below is `.serialized` because `handler`/`lastRequest` are process-wide
/// statics shared by every `startLoading()` call.
final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, [String: String], Data))?
    nonisolated(unsafe) static var lastRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        guard let handler = Self.handler, let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        let (status, headers, data) = handler(request)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@Suite(.serialized)
struct HttpSyncApiTests {
    private func makeApi(baseURL: String = "https://sync.example.test", token: String? = "device-token") -> (HttpSyncApi, InMemorySyncAccountStore) {
        let account = InMemorySyncAccountStore()
        account.baseURL = URL(string: baseURL)!
        if let token {
            account.save(email: "toby@example.com", deviceToken: token, deviceId: "device-1")
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: config)
        return (HttpSyncApi(account: account, session: session), account)
    }

    private func jsonData(_ object: [String: Any]) -> Data {
        try! JSONSerialization.data(withJSONObject: object)
    }

    /// `URLSession` may move a request's body into `httpBodyStream` rather
    /// than leaving it on `httpBody` by the time `URLProtocol` sees it, so
    /// reading the body a stub handler captured has to fall back to the
    /// stream rather than assume `httpBody` is populated.
    private func bodyData(from request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufferSize = 4_096
        var buffer = [UInt8](repeating: 0, count: bufferSize)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: bufferSize)
            guard read > 0 else { break }
            data.append(buffer, count: read)
        }
        return data
    }

    // MARK: - Request shape

    @Test func meSendsGetWithBearerTokenAndNoBody() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { request in
            #expect(request.httpMethod == "GET")
            #expect(request.url?.absoluteString == "https://sync.example.test/v1/me")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer device-token")
            return (200, [:], self.jsonData([
                "user": ["email": "toby@example.com"],
                "device": ["id": "device-1", "name": "Toby's iPhone"],
                "quota": ["usedBytes": 10, "limitBytes": 100],
            ]))
        }

        let result = try await api.me()
        #expect(result.email == "toby@example.com")
        #expect(result.deviceId == "device-1")
        #expect(result.quota.usedBytes == 10)
    }

    // MARK: - Server-issued URLs (#281)

    private func downloadURLFor(_ ticketURL: String) async throws -> URL {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in
            (200, [:], self.jsonData(["url": ticketURL, "expiresAt": "2026-10-16T10:00:00.000Z"]))
        }
        return try await api.downloadURL(releaseId: "r", fileName: "x.mp3")
    }

    @Test func downloadURLEncodesBracketsWithoutDoubleEncodingExistingEscapes() async throws {
        let url = try await downloadURLFor("https://store.private.blob.vercel-storage.com/users/u/releases/r/01%20-%20sometimes%20[1].mp3?vercel-blob-signature=abc")
        #expect(url.absoluteString.contains("01%20-%20sometimes%20%5B1%5D.mp3"))
        #expect(!url.absoluteString.contains("%25"))
        #expect(url.absoluteString.hasSuffix("?vercel-blob-signature=abc"))
    }

    @Test func downloadURLWithNoInvalidCharactersRoundTripsExactly() async throws {
        let raw = "https://store.example.test/a/01%20-%20b.mp3?sig=a%2Bb&x=1"
        let url = try await downloadURLFor(raw)
        #expect(url.absoluteString == raw)
    }

    /// #185: `GET /v1/me` lists the account's devices with their platform;
    /// a platform this build has never heard of ("web", or a newer one) must
    /// not fail the call.
    @Test func meToleratesDevicesOnAPlatformItHasNeverHeardOf() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in
            (200, [:], self.jsonData([
                "user": ["id": "user-1", "email": "toby@example.com"],
                "device": ["id": "device-1", "name": "Toby's iPhone"],
                "quota": ["usedBytes": 10, "limitBytes": 100],
                "devices": [
                    ["id": "device-1", "name": "Toby's iPhone", "platform": "ios"],
                    ["id": "device-2", "name": "Browser", "platform": "web"],
                    ["id": "device-3", "name": "Gadget", "platform": "future-thing"],
                ],
                "devicesHasMore": false,
            ]))
        }

        let result = try await api.me()
        #expect(result.deviceId == "device-1")
        #expect(result.quota.limitBytes == 100)
    }

    // MARK: - Missing files and the resync nudge (#171)

    private func meBody(resyncRequestedAt: Any? = nil, includeKey: Bool) -> Data {
        var object: [String: Any] = [
            "user": ["id": "user-1", "email": "toby@example.com"],
            "device": ["id": "device-1", "name": "Toby's iPhone"],
            "quota": ["usedBytes": 10, "limitBytes": 100],
        ]
        if includeKey { object["resyncRequestedAt"] = resyncRequestedAt ?? NSNull() }
        return jsonData(object)
    }

    @Test func meDecodesWithoutResyncRequestedAt() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (200, [:], self.meBody(includeKey: false)) }

        let result = try await api.me()
        #expect(result.resyncRequestedAt == nil)
        #expect(result.quota.limitBytes == 100)
    }

    @Test func meDecodesANullResyncRequestedAt() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (200, [:], self.meBody(includeKey: true)) }

        #expect(try await api.me().resyncRequestedAt == nil)
    }

    @Test func meDecodesResyncRequestedAtWithAndWithoutFractionalSeconds() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (200, [:], self.meBody(resyncRequestedAt: "2026-10-15T09:30:00.250Z", includeKey: true)) }
        let fractional = try await api.me().resyncRequestedAt
        #expect(fractional == Date(timeIntervalSince1970: 1_792_056_600.25))

        StubURLProtocol.handler = { _ in (200, [:], self.meBody(resyncRequestedAt: "2026-10-15T09:30:00Z", includeKey: true)) }
        let whole = try await api.me().resyncRequestedAt
        #expect(whole == Date(timeIntervalSince1970: 1_792_056_600))
    }

    @Test func meIgnoresAResyncRequestedAtItCannotParseInsteadOfFailing() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (200, [:], self.meBody(resyncRequestedAt: "last tuesday", includeKey: true)) }

        let result = try await api.me()
        #expect(result.resyncRequestedAt == nil)
        #expect(result.quota.usedBytes == 10)
    }

    @Test func missingFilesSendsGetWithBearerTokenAndDecodesTheList() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { request in
            #expect(request.httpMethod == "GET")
            #expect(request.url?.absoluteString == "https://sync.example.test/v1/files/missing")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer device-token")
            return (200, [:], self.jsonData([
                "releases": [
                    ["id": "r-1", "missing": ["01 - Intro.mp3", "cover.jpg"], "recordUpdatedAt": "2026-10-15T09:30:00.000Z"],
                    ["id": "r-2", "missing": ["a.m4a"], "recordUpdatedAt": "2026-10-15T09:31:00.000Z"],
                ],
                "checkedAt": "2026-10-15T10:00:00.000Z",
            ]))
        }

        let result = try await api.missingFiles()
        #expect(result.releases == [
            SyncMissingRelease(id: "r-1", missing: ["01 - Intro.mp3", "cover.jpg"]),
            SyncMissingRelease(id: "r-2", missing: ["a.m4a"]),
        ])
    }

    @Test func missingFilesDecodesAHealthyAccount() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (200, [:], self.jsonData(["releases": [], "checkedAt": "2026-10-15T10:00:00.000Z"])) }

        #expect(try await api.missingFiles().releases.isEmpty)
    }

    @Test func missingFiles404ThrowsNotFoundSoAnOldApiCanBeSkipped() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (404, [:], self.jsonData(["error": "not found"])) }

        do {
            _ = try await api.missingFiles()
            Issue.record("expected .notFound")
        } catch let error as SyncApiError {
            #expect(error == .notFound)
        }
    }

    @Test func missingFiles429ThrowsRateLimited() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (429, ["Retry-After": "60"], self.jsonData(["error": "slow down"])) }

        do {
            _ = try await api.missingFiles()
            Issue.record("expected .rateLimited")
        } catch let error as SyncApiError {
            #expect(error == .rateLimited)
        }
    }

    @Test func playsSummarySendsTheRangeWithoutACursorAndDecodesThePage() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { request in
            #expect(request.httpMethod == "GET")
            #expect(request.url?.absoluteString == "https://sync.example.test/v1/plays/summary?from=2026-10-12&to=2026-10-15")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer device-token")
            return (200, [:], self.jsonData([
                "tracks": [["trackId": "t-1", "releaseId": "r-1", "plays": 3, "lastPlayedDay": "2026-10-14"]],
                "allTime": [["trackId": "t-1", "releaseId": "r-1", "plays": 30]],
                "nextCursor": NSNull(),
            ]))
        }

        let page = try await api.playsSummary(from: "2026-10-12", to: "2026-10-15", cursor: nil)
        #expect(page == SyncPlaysSummaryPage(
            tracks: [SyncPeriodPlays(trackId: "t-1", releaseId: "r-1", plays: 3, lastPlayedDay: "2026-10-14")],
            allTime: [SyncAllTimePlays(trackId: "t-1", releaseId: "r-1", plays: 30)],
            nextCursor: nil
        ))
    }

    @Test func playsSummaryAppendsAnEncodedCursor() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { request in
            #expect(request.url?.absoluteString == "https://sync.example.test/v1/plays/summary?from=2026-10-12&to=2026-10-15&cursor=ab%26c%3Dd%2Be%23f")
            return (200, [:], self.jsonData(["tracks": [], "allTime": [], "nextCursor": "next-id"]))
        }

        let page = try await api.playsSummary(from: "2026-10-12", to: "2026-10-15", cursor: "ab&c=d+e#f")
        #expect(page.nextCursor == "next-id")
    }

    @Test func playsSummary404ThrowsNotFound() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (404, [:], self.jsonData(["error": "not found"])) }

        do {
            _ = try await api.playsSummary(from: "2026-10-12", to: "2026-10-15", cursor: nil)
            Issue.record("expected .notFound")
        } catch let error as SyncApiError {
            #expect(error == .notFound)
        }
    }

    @Test func playsSummary429ThrowsRateLimited() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (429, [:], self.jsonData(["error": "slow down"])) }

        do {
            _ = try await api.playsSummary(from: "2026-10-12", to: "2026-10-15", cursor: nil)
            Issue.record("expected .rateLimited")
        } catch let error as SyncApiError {
            #expect(error == .rateLimited)
        }
    }

    @Test func missingFiles401StillThrowsUnauthorized() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (401, [:], self.jsonData(["error": "expired token"])) }

        do {
            _ = try await api.missingFiles()
            Issue.record("expected .unauthorized")
        } catch let error as SyncApiError {
            #expect(error == .unauthorized)
        }
    }

    @Test func requestCodeSendsPostWithEmailBodyAndNoAuthHeader() async throws {
        let (api, _) = makeApi(token: nil)
        StubURLProtocol.handler = { request in
            #expect(request.httpMethod == "POST")
            #expect(request.url?.absoluteString == "https://sync.example.test/v1/auth/code")
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
            let body = try? JSONSerialization.jsonObject(with: self.bodyData(from: request)) as? [String: String]
            #expect(body?["email"] == "toby@example.com")
            return (200, [:], Data("{}".utf8))
        }

        try await api.requestCode(email: "toby@example.com")
    }

    @Test func releasesSinceVersionBuildsQueryStringWithoutPercentEncodingTheQuestionMark() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { request in
            #expect(request.url?.absoluteString == "https://sync.example.test/v1/releases?sinceVersion=5&limit=50")
            return (200, [:], self.jsonData(["releases": [], "nextVersion": 5, "hasMore": true]))
        }

        let page = try await api.releases(sinceVersion: 5, limit: 50)
        #expect(page.nextVersion == 5)
        #expect(page.releases.isEmpty)
        #expect(page.hasMore == true)
    }

    /// An older server's response omits `hasMore` entirely; `HttpSyncApi`
    /// must decode that as `false` rather than failing (see
    /// `SyncReleasesPage`'s doc comment).
    @Test func releasesWithNoHasMoreFieldDecodesAsNotHasMore() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (200, [:], self.jsonData(["releases": [], "nextVersion": 5])) }

        let page = try await api.releases(sinceVersion: 5, limit: 50)
        #expect(page.hasMore == false)
    }

    @Test func deleteReleaseSendsDeleteToReleaseIdPath() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { request in
            #expect(request.httpMethod == "DELETE")
            #expect(request.url?.absoluteString == "https://sync.example.test/v1/releases/release-1")
            return (200, [:], self.jsonData(["version": 7]))
        }

        let version = try await api.deleteRelease("release-1")
        #expect(version == 7)
    }

    // MARK: - Status mapping

    @Test func status401ThrowsUnauthorized() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (401, [:], self.jsonData(["error": "expired token"])) }

        do {
            _ = try await api.me()
            Issue.record("expected .unauthorized")
        } catch let error as SyncApiError {
            #expect(error == .unauthorized)
        }
    }

    @Test func status404ThrowsNetworkErrorRatherThanCrashing() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (404, [:], self.jsonData(["error": "not found"])) }

        do {
            _ = try await api.me()
            Issue.record("expected an error")
        } catch let error as SyncApiError {
            guard case .network(let message) = error else {
                Issue.record("expected .network, got \(error)")
                return
            }
            #expect(message == "not found")
        }
    }

    @Test func status409ThrowsConflict() async throws {
        let (api, _) = makeApi()
        let record = SyncRecord.stub(id: "release-1")
        StubURLProtocol.handler = { _ in (409, [:], self.jsonData(["error": "conflict"])) }

        do {
            _ = try await api.putRelease(record)
            Issue.record("expected .conflict")
        } catch let error as SyncApiError {
            guard case .conflict = error else {
                Issue.record("expected .conflict, got \(error)")
                return
            }
        }
    }

    @Test func status5xxThrowsNetworkError() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (500, [:], self.jsonData(["error": "boom"])) }

        do {
            _ = try await api.me()
            Issue.record("expected an error")
        } catch let error as SyncApiError {
            guard case .network = error else {
                Issue.record("expected .network, got \(error)")
                return
            }
        }
    }

    @Test func status402ThrowsQuotaExceeded() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (402, [:], self.jsonData(["error": "quota"])) }

        do {
            _ = try await api.me()
            Issue.record("expected .quotaExceeded")
        } catch let error as SyncApiError {
            #expect(error == .quotaExceeded)
        }
    }

    // MARK: - Downloads (#276)

    @Test func downloadFileThrowsOnA404AndLeavesNoFileBehind() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (404, [:], Data("<html>not found</html>".utf8)) }
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).jpg")

        do {
            try await api.downloadFile(from: URL(string: "https://sync.example.test/v1/files/x/cover.jpg")!, to: destination)
            Issue.record("expected a throw")
        } catch let error as SyncApiError {
            guard case .network = error else {
                Issue.record("expected .network, got \(error)")
                return
            }
        }
        #expect(!FileManager.default.fileExists(atPath: destination.path))
    }

    @Test func downloadFileSavesA200Body() async throws {
        let (api, _) = makeApi()
        StubURLProtocol.handler = { _ in (200, [:], Data([1, 2, 3])) }
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).jpg")
        defer { try? FileManager.default.removeItem(at: destination) }

        try await api.downloadFile(from: URL(string: "https://sync.example.test/v1/files/x/cover.jpg")!, to: destination)

        #expect(try Data(contentsOf: destination) == Data([1, 2, 3]))
    }

    // MARK: - HTTPS-only enforcement (issue #11)

    /// Release builds refuse to send a request over plain http — see
    /// `HttpSyncApi.send`'s `#if !DEBUG` guard. `xcodebuild test` normally
    /// builds the Debug configuration, where that guard is compiled out (a
    /// DEBUG build may legitimately point at a LAN dev server), so this can
    /// only run when the test bundle itself is built Release. It is written
    /// so a Release test run exercises it, and is a silent no-op otherwise.
    @Test func httpBaseURLIsRejectedInReleaseBuilds() async throws {
        #if !DEBUG
        let (api, _) = makeApi(baseURL: "http://sync.example.test")
        StubURLProtocol.handler = { _ in (200, [:], Data("{}".utf8)) }

        do {
            _ = try await api.me()
            Issue.record("expected http to be rejected")
        } catch let error as SyncApiError {
            guard case .network = error else {
                Issue.record("expected .network, got \(error)")
                return
            }
        }
        #endif
    }
}

private extension SyncRecord {
    /// Minimal well-formed record for tests that only need a valid id.
    static func stub(id: String) -> SyncRecord {
        SyncRecord(
            id: id,
            kind: "single",
            title: "Test Release",
            artist: "Test Artist",
            tracks: [],
            origin: "ios",
            originDevice: "device-1",
            createdAt: Date(),
            updatedAt: Date()
        )
    }
}
