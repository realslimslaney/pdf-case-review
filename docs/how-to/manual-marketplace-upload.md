# Upload a release by hand

For the repository maintainer. Use this when the `Release` workflow ([Publish a release](release.md),
step 4) has tagged and built a version but its "Publish (Visual Studio Marketplace)" job failed
after all five attempts with `Request timeout: /_apis/gallery`. Open VSX normally succeeds in the
same run; only the VS Marketplace half needs the manual path.

The timeout is on the client side. The Marketplace accepts the upload, then verifies the package
for longer than `vsce` waits, so the workflow gives up while the Marketplace is still working. The
management website has no such timeout.

## 1. Check that it did not already land

Sometimes a "failed" publish went through. Query the public gallery before uploading anything:

```sh
curl -s -X POST "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery" \
  -H "Content-Type: application/json" -H "Accept: application/json;api-version=3.0-preview.1" \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"realslimslaney.pdf-case-review"}]}],"flags":103}' \
  | grep -o '"version":"[0-9.]*"'
```

If the version is listed, stop here.

## 2. Get the exact VSIX the workflow built

The build job attaches the VSIX to the GitHub release before the publish jobs run, so the file to
upload is already there. Download it rather than packaging locally, so the Marketplace gets the same
bytes Open VSX did:

```sh
gh release download vX.Y.Z --pattern "*.vsix" --output pdf-case-review-X.Y.Z.vsix
unzip -p pdf-case-review-X.Y.Z.vsix extension/package.json | grep '"version"'
```

## 3. Upload it

1. Sign in at <https://marketplace.visualstudio.com/manage> with the Microsoft account that owns the
   `realslimslaney` publisher.
2. On the **Extensions** tab, open the row menu (the three dots next to *PDF Case Review*) and
   choose **Update**.
3. Pick the VSIX from step 2.
4. If the minor version is odd (0.5.x, 0.7.x), tick **pre-release** before uploading. The workflow
   does this automatically; by hand it is the one thing that is easy to forget, and an odd minor
   uploaded as stable would replace the stable listing for every user.
5. Upload. The row shows **Verifying X.Y.Z** while the Marketplace scans the package. Refresh the
   page rather than waiting for it to update itself. Verification took about twelve minutes for
   0.5.2; give it twenty before worrying.

A green check next to the version means it is published. A red icon means verification failed;
hovering it shows the reason, which is usually a duplicate version (the workflow beat you to it) or
a manifest problem that `pnpm package` would also have reported.

## 4. Confirm the public listing

Run the query from step 1 again. The new version appears within a minute or two of the green
check. To confirm the channel, add `1047` as the `flags` value and look for
`Microsoft.VisualStudio.Code.PreRelease` set to `true` on the new version.

## Afterwards

- The failed workflow run stays red. Nothing needs re-running: both publish steps pass
  `--skip-duplicate`, so re-running the job would only confirm the version is already there.
- Leave a note on the release-please PR or the release itself saying the Marketplace half was
  uploaded by hand, so the next person reading the red run knows why.
