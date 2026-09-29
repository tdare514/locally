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

    private static func minimalReleaseJSON(id: String, file: String) -> [String: Any] {
        [
            "syncVersion": 1,
            "id": id,
            "kind": "single",
            "title": "T",
            "artist": "A",
            "year": NSNull(),
            "genre": NSNull(),
            "cover": NSNull(),
            "tracks": [
                [
                    "id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
                    "title": "Intro",
                    "trackNumber": 1,
                    "file": file,
                    "bytes": 100,
                    "durationSec": NSNull(),
                ] as [String: Any],
            ],
            "origin": "mac",
            "originDevice": "Mac",
            "createdAt": "2026-09-27T20:00:00Z",
            "updatedAt": "2026-09-27T20:00:00Z",
            "deleted": false,
            "version": 1,
        ] as [String: Any]
    }

    @Test func skipsARecordWithABadExtensionAndReturnsTheRestOfThePage() async throws {
        let api = makeApi()
        ReleasesPageStubURLProtocol.handler = { _ in
            let releases: [[String: Any]] = [
                Self.minimalReleaseJSON(id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", file: "one.mp3"),
                Self.minimalReleaseJSON(id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", file: "two.wav"),
                Self.minimalReleaseJSON(id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", file: "three.mp3"),
            ]
            let body = try! JSONSerialization.data(withJSONObject: [
                "releases": releases,
                "nextVersion": 42,
                "hasMore": false,
            ])
            return (200, body)
        }

        let page = try await api.releases(sinceVersion: 0, limit: 200)

        #expect(page.releases.count == 2)
        #expect(page.releases.map(\.id).sorted() == [
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        ])
        #expect(page.nextVersion == 42)
        #expect(page.hasMore == false)
    }

    @Test func aMalformedUpdatedAtStillFailsTheWholePage() async throws {
        let api = makeApi()
        ReleasesPageStubURLProtocol.handler = { _ in
            var bad = Self.minimalReleaseJSON(id: "bad-id", file: "one.mp3")
            bad["updatedAt"] = "not-a-date"
            let body = try! JSONSerialization.data(withJSONObject: [
                "releases": [bad],
                "nextVersion": 5,
                "hasMore": false,
            ])
            return (200, body)
        }

        await #expect(throws: SyncApiError.self) {
            _ = try await api.releases(sinceVersion: 0, limit: 200)
        }
    }
}
