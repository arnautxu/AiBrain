# Generated image artifacts

Generated images are private binary artifacts. The client must never receive a
workspace path, a `savedPath`, or JSON that points at a file. The supported flow
is:

```text
Codex imageGeneration item
  -> strict PNG base64/data URL decoding, structure and dimension validation
  -> immutable private file in server-owned storage outside the workspace
  -> generated-image resource index binding
  -> persisted chat ImageArtifact with opaque same-origin URL
  -> authenticated inline preview or explicit attachment download
```

The artifact identifier is stable for the assistant message and native image
item, so recovery and conversation reload produce the same URL. Registration in
the private resource index must complete before the artifact event is emitted.
The HTTP route reauthorizes project access on every request, rechecks the
registered owner, path, MIME type, size, SHA-256 and PNG structure, and returns
`Content-Type: image/png`, `Content-Length`, `nosniff`, `private, no-store` and
same-origin resource policy headers. `?download=1` is the only download query
and returns `Content-Disposition: attachment` with one `.png` suffix.

New image events also carry optional `width` and `height` together, read from
the already validated PNG IHDR. Older persisted events without dimensions
remain readable. The UI reserves a bounded frame from these dimensions and
uses the loaded image's natural dimensions for its label; no dimensions are
invented from the prompt. Extremely tall or wide images remain contained.
Preview loading/failure and retry are client display states. Retrying remounts
the same authenticated image URL, without a query parameter, generation call,
or new turn. A ready preview exposes explicit enlargement and PNG download.

The final PNG lives under the installation's private data root, which is not
mounted into the Codex worker. The generic workspace-file route also rejects
internal `.aibrain` paths left by older flows. Generated-image URLs contain only
project and artifact identifiers; they never contain server paths.

## PDF generated from an image

`aibrain_documents.image_to_pdf` accepts the opaque native image item id, not a
path or base64 payload. The server derives the stable artifact id and resolves
the indexed PNG within the same project, conversation and storage owner, even
when the image came from an earlier assistant message. After verifying its
size, hash, MIME type and PNG structure, it
embeds the actual pixels, aspect-fitted and centered, on one portrait A4 page.
The image description is not drawn as PDF text.

## Acceptance gates

Local acceptance must cover real PNG bytes larger than a trivial reference,
the eight-byte PNG signature, exact MIME and length, owner/anonymous/other-user
authorization, blocked internal paths, inline `<img>` loading, iPhone WebKit,
download filename, conversation reload, and image-only A4 PDF output. A real
Codex App Server generation is a separate gate from deterministic browser and
HTTP tests.

CI, image publication, deployment and authenticated Arnall acceptance remain
separate release gates. Local evidence does not imply that the correction is
deployed.
