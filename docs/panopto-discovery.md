# Panopto discovery research

Research checked 30 October 2026. Sources:

- [Official Panopto REST examples](https://github.com/Panopto/panopto-api-python-examples) and [session example](https://github.com/Panopto/panopto-api-python-examples/blob/master/sessions-cli/panopto_sessions.py): `GET /Panopto/api/v1/sessions/{id}` uses authenticated OAuth request handling. A browser viewer session must not be assumed to provide an OAuth token. The extension deliberately does not probe this endpoint or collect an API credential.
- [Official multi-stream upload example](https://github.com/Panopto/SessionUploadExample): confirms multi-stream sessions exist; upload contracts do not establish a viewer export API.
- [Panopto caption download controls discussion](https://community.panopto.com/discussion/2751/caption-transcript-download-control-at-video-or-folder-level): download availability is a separate concern from playback. The generic adapter requires an explicit download affordance.
- [WXT installation](https://wxt.dev/guide/installation), [Playwright extension loading](https://playwright.dev/docs/chrome-extensions), [Chrome downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads).

## Verified implementation contract

Viewer/Embed path plus `id` query parameter identifies a candidate lecture. Standard DOM `a[download]` supplies exportable links, file names and optional hreflang. Standard media/track elements identify playback-only resources and are never treated as proof of export rights. No Panopto proprietary response schema or caption endpoint is invented. File sizes are unknown unless a future adapter verifies them; no speculative HEAD requests are made. Language is preserved if exposed by the downloadable link.

The local simulator emits standard HTML fixtures only; it is not a claim that Panopto emits the same markup. Its nine scenarios exercise extension behaviour without account access. Malformed simulated API JSON is ignored because no unverified API parser exists.

## Real-session verification still required

Inspect enabled download controls, caption/transcript downloads, custom tenant URLs, Moodle embedding, download policy settings, OAuth installation policy, CDN permissions and signed URLs using an authorised lecture. Establish whether a control maps to an actual explicit downloadable file; never replace a denied endpoint with a playback endpoint. Obtain sanitised DOM/response examples and permission provenance before adding any adapter. Unknown slide timestamps and chapters remain unavailable until their contract is verified. Encrypted media and DRM are unsupported. The explicit playback action adds a tenant-independent, strict MPEG-TS HLS VOD subset; other stream formats remain unsupported.

Playback reporting now includes `blob:` media and source-less video/audio player elements. These are reported as browser-managed playback with no export URL; detecting a player is not proof of a downloadable file or a university restriction. Child audio sources are classified as audio, and duplicate parent/source URLs are collapsed. This is standard DOM handling tested with fictional fixtures, not a verified Lancaster response adapter. A screenshot showing a title and zero resources confirms session detection but cannot reveal a proprietary resource schema, download policy or permitted caption export endpoint.

## Network playback action

The user explicitly requested network-based playback export. `src/network.ts` identifies HTTP(S) MP4/WebM/HLS candidates by extension and labels DASH unsupported. `webRequest.onBeforeRequest` passively observes URLs only on granted hosts; standard Resource Timing and media DOM URLs supplement it when the user clicks Find playback streams. No Panopto private endpoint is guessed. Cross-origin CDN access is requested per detected origin through a separate user button.

`src/hls.ts` implements a deliberately strict subset of [RFC 8216](https://www.rfc-editor.org/rfc/rfc8216): complete, unencrypted MPEG-TS VOD, relative URI resolution and first-listed master variant selection. It rejects all encryption except explicit METHOD=NONE, combined masters requiring separate audio muxing, live playlists, maps/fMP4, byte ranges and discontinuities. A separate rendition inspector exposes audio and video media playlists individually for export. TS segments are fetched in order and streamed into one video file. A playable output is verified against a real generated audiovisual fixture, not against the user's lecture. This creates MPEG-TS, not a transcoded MP4 or composited multi-stream recording. Browser-managed blob buffers are never read.

[Chrome webRequest documentation](https://developer.chrome.com/docs/extensions/reference/api/webRequest) requires the API permission and host access for both initiator and request URL. No webRequestBlocking, cookie permission, header capture or security bypass is used. Authentication expiry or HTTP errors cause export failures. Opaque URLs and other manifest formats require additional verified adapters.

## Audio and browser captions

Network candidates now include common direct audio formats and VTT/SRT. `src/renditions.ts` uses RFC 8216 EXT-X-MEDIA attributes to expose audio/subtitle renditions and language. A separate audio rendition can be exported with the existing assembler when it consists of unencrypted MPEG-TS segments. The parent master is marked unsupported to avoid presenting a video-only selection as complete audiovisual output. Segmented subtitle playlists remain unsupported rather than ignoring their timestamp maps. Direct rendition URLs are never written to manifests.

`src/browser-captions.ts` uses the standard [HTMLMediaElement.textTracks API](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/textTracks) and the [HTML media text-track model](https://html.spec.whatwg.org/multipage/media.html). It reads existing caption/subtitle cues without changing track modes or collecting data from an invented endpoint. Cue snapshots carry a possible-incompleteness warning. If a player supplies captions only through proprietary JSON and custom DOM rendering, this path will not obtain them; authorised real-session contract inspection is still necessary.
