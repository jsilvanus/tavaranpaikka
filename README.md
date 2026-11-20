# tavaranpaikka
## Access

| Who | Can |
| --- | --- |
| Anonymous | Only the QR code views (/c/:code): scan, report, vote, lease/return |
| member (generic signed-in user) | + browse storages and their contents (read-only); no management, no label printing |
| keeper | + manage storages/places/items, print labels, handle reports |
| dmin | + privacy settings, leases overview, cleanup |

## Label printing

The print view has sliders for QR code size and text size, and a logo selector: inside the QR code,
as a separate logo left of the QR code, or as a separate logo right of the text.
The same options (`qrScale`, `fontScale`, `logoPlacement`) are accepted by `POST /api/labels/pdf`.
