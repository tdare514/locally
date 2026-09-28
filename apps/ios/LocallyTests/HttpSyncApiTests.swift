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
