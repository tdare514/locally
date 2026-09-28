import Foundation
import Testing
@testable import Locally

/// A `URLProtocol` stub scoped to this file, separate from any other test
/// suite's stub (e.g. `HttpSyncApiTests.swift`'s `StubURLProtocol`) so this
/// file has no dependency on another suite's infrastructure. Serialized for
/// the same reason as that one: `handler` is a process-wide static shared by
/// every `startLoading()` call.
final class ReleasesPageStubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler, let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        let (status, data) = handler(request)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [:])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// Decode coverage for `HttpSyncApi.releases(sinceVersion:limit:)` /
/// `SyncReleasesPage`, per `docs/plans/30-sync-pagination.md`: a page from a
/// server that knows about `hasMore`, and a page from one that doesn't (the
/// compatibility case — an old/local-dev API), which must decode as `false`
/// rather than failing to decode at all.
@Suite(.serialized)
struct SyncReleasesPageDecodingTests {
    private func makeApi() -> HttpSyncApi {
        let account = InMemorySyncAccountStore()
        account.baseURL = URL(string: "https://sync.example.test")!
        account.save(email: "toby@example.com", deviceToken: "device-token", deviceId: "device-1")
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ReleasesPageStubURLProtocol.self]
        let session = URLSession(configuration: config)
        return HttpSyncApi(account: account, session: session)
    }

    @Test func decodesHasMoreTrueAndSendsLimitInTheQueryString() async throws {
        let api = makeApi()
        ReleasesPageStubURLProtocol.handler = { request in
            #expect(request.url?.absoluteString == "https://sync.example.test/v1/releases?sinceVersion=5&limit=200")
            let body = try! JSONSerialization.data(withJSONObject: [
                "releases": [],
                "nextVersion": 205,
                "hasMore": true,
            ])
            return (200, body)
        }

        let page = try await api.releases(sinceVersion: 5, limit: 200)

        #expect(page.releases.isEmpty)
        #expect(page.nextVersion == 205)
        #expect(page.hasMore == true)
    }

    @Test func decodesHasMoreFalseWhenThePageSaysSo() async throws {
        let api = makeApi()
        ReleasesPageStubURLProtocol.handler = { _ in
            let body = try! JSONSerialization.data(withJSONObject: [
                "releases": [],
                "nextVersion": 5,
                "hasMore": false,
            ])
            return (200, body)
        }

        let page = try await api.releases(sinceVersion: 5, limit: 200)

        #expect(page.nextVersion == 5)
        #expect(page.hasMore == false)
    }

    /// An old server (or a local dev API not yet updated) has no idea about
    /// `hasMore` at all, per the plan's compatibility table: "`hasMore` is
    /// absent; treat it as `false`."
    @Test func decodesAMissingHasMoreKeyAsFalse() async throws {
        let api = makeApi()
        ReleasesPageStubURLProtocol.handler = { _ in
            let body = try! JSONSerialization.data(withJSONObject: [
                "releases": [],
                "nextVersion": 5,
            ])
            return (200, body)
        }

        let page = try await api.releases(sinceVersion: 5, limit: 200)

        #expect(page.nextVersion == 5)
        #expect(page.hasMore == false)
    }
}
