/**
 * Shared JSDoc typedefs for Tavaranpaikka API v2 (section 14.5).
 */

/**
 * @typedef {'room' | 'kit' | 'cabinet' | 'vehicle' | 'other' | 'first_aid'} StorageKind
 * @typedef {'ok' | 'depleted' | 'broken' | 'retired'} ItemStatus
 * @typedef {'ok' | 'depleted' | 'retired'} EntryStatus
 * @typedef {'depleted' | 'broken' | 'expired' | 'other'} ReportKind
 * @typedef {'open' | 'acknowledged' | 'resolved' | 'dismissed'} ReportStatus
 * @typedef {'item' | 'place' | 'storage'} CodeKind
 * @typedef {'a4-3x8' | 'a4-5x13' | 'a4-2x7' | 'a4-1x1'} LabelLayout
 * @typedef {'small' | 'normal' | 'large'} LabelSize
 */

/**
 * @typedef {Object} Counts
 * @property {number} places
 * @property {number} items
 * @property {number} entries
 * @property {number} openReports
 * @property {number} depleted
 * @property {number} broken
 * @property {number} expiringSoon
 * @property {number} expired
 */

/**
 * @typedef {Object} ReportConfig
 * @property {ReportKind[]} [kinds]
 * @property {string[]} [recipients]
 * @property {Record<string, 'immediate' | 'daily_digest'>} [delivery]
 * @property {boolean} [allowNote]
 * @property {boolean} [allowPhoto]
 * @property {boolean} [askName]
 * @property {boolean} [requireSignin]
 * @property {number | null} [escalateAfterDays]
 */

/**
 * @typedef {Object} StorageSummary
 * @property {string} id
 * @property {string} name
 * @property {StorageKind} kind
 * @property {string} description
 * @property {boolean} hasImage
 * @property {boolean} [hasLogo]
 * @property {string | null} [logoUrl]
 * @property {boolean} publicListed
 * @property {string | null} [responsiblePersonName]
 * @property {number | null} inspectionIntervalDays
 * @property {number | null} [notifyBeforeDays]
 * @property {string | null} lastInspectedAt
 * @property {boolean} inspectionDue
 * @property {Counts} counts
 */

/**
 * @typedef {Object} Place
 * @property {string} id
 * @property {string} storageId
 * @property {string | null} parentPlaceId
 * @property {string} name
 * @property {string} description
 * @property {number | null} pinX
 * @property {number | null} pinY
 * @property {string} pinLabel
 * @property {string[]} path
 * @property {ReportConfig} reportConfig
 */

/**
 * @typedef {Object} Item
 * @property {string} id
 * @property {string | null} placeId
 * @property {string} name
 * @property {string} description
 * @property {string} category
 * @property {ItemStatus} status
 * @property {string | null} expiresOn
 * @property {number | null} minQuantity
 * @property {string | null} code
 * @property {boolean} [leaseable]
 * @property {string | null} [leasedTo]
 * @property {string | null} [leasedAt]
 * @property {OwnerImage[]} [images]
 */

/**
 * @typedef {Object} ImageOverlay
 * @property {string} id
 * @property {string} imageId
 * @property {'place' | 'item' | 'general'} targetKind
 * @property {string | null} targetId
 * @property {'rect' | 'polygon' | 'pin'} shape
 * @property {Record<string, any>} coords
 * @property {string} label
 * @property {string} color
 */

/**
 * @typedef {Object} OwnerImage
 * @property {string} id
 * @property {'storage' | 'item'} ownerKind
 * @property {string} ownerId
 * @property {string} url
 * @property {number | null} width
 * @property {number | null} height
 * @property {string} caption
 * @property {number} sortOrder
 * @property {ImageOverlay[]} overlays
 */

/**
 * @typedef {Object} ItemLease
 * @property {string} id
 * @property {string} itemId
 * @property {string} itemName
 * @property {string | null} storageId
 * @property {string} storageName
 * @property {string} borrowerName
 * @property {string} leasedAt
 * @property {string | null} returnedAt
 */

/**
 * @typedef {Object} PrivacyProcessor
 * @property {string} name
 * @property {string} purpose
 * @property {string} location
 */

/**
 * @typedef {Object} TenantPrivacyInfo
 * @property {string} organizationName
 * @property {string} controllerName
 * @property {string} controllerContact
 * @property {PrivacyProcessor[]} processors
 * @property {string} privacyExtra
 * @property {number} leaseRetentionDays
 */

/**
 * @typedef {Object} Entry
 * @property {string} id
 * @property {string} placeId
 * @property {string} name
 * @property {string} quantityNote
 * @property {number | null} quantity
 * @property {number | null} minQuantity
 * @property {string | null} expiresOn
 * @property {EntryStatus} status
 * @property {number} sortOrder
 */

/**
 * @typedef {Place & { items: Item[], entries: Entry[], counts: Counts }} PlaceDetail
 */

/**
 * @typedef {StorageSummary & {
 *   imageUrl: string | null,
 *   imageWidth: number | null,
 *   imageHeight: number | null,
 *   images?: OwnerImage[],
 *   responsiblePerson?: { type: 'tunnus' | 'external', sub: string | null, name: string, email: string | null, phone: string | null } | null,
 *   createdBy?: { sub: string, name: string | null, email: string | null } | null,
 *   code: string | null,
 *   places: PlaceDetail[],
 *   openReports: Array<{ kind: ReportKind, count: number }>
 * }} StorageDetail
 */

/**
 * @typedef {Object} CodeResolution
 * @property {CodeKind} kind
 * @property {StorageSummary} storage
 * @property {Place | null} place
 * @property {Item | null} item
 * @property {PlaceDetail | null} placeDetail
 * @property {any[]} [openReports]
 */

/**
 * @typedef {Object} LabelTarget
 * @property {CodeKind} kind
 * @property {string} id
 * @property {string | null} code
 * @property {string} name
 * @property {string[]} placePath
 * @property {string} storageName
 * @property {string} [storageId]
 * @property {string | null} printedAt
 * @property {string | null} [expiresOn]
 */

/**
 * @typedef {Object} LabelShowOptions
 * @property {boolean} [qr]
 * @property {boolean} [code]
 * @property {boolean} [name]
 * @property {boolean} [place]
 * @property {boolean} [note]
 * @property {boolean} [logo]
 */

/**
 * @typedef {Object} LabelTargetRef
 * @property {CodeKind} kind
 * @property {string} id
 * @property {{ name?: boolean, place?: boolean }} [show]
 */

/**
 * @typedef {Object} LabelRequest
 * @property {LabelTargetRef[]} targets
 * @property {LabelLayout} layout
 * @property {number} [startPosition]
 * @property {number} [copies]
 * @property {LabelSize} [size]
 * @property {number} [fontScale] Font multiplier (overrides size when set)
 * @property {number} [qrScale] QR code size multiplier
 * @property {'center' | 'left' | 'right'} [logoPlacement] Logo inside QR (center) or separate: left of QR / right of text
 * @property {LabelShowOptions} show
 * @property {string} [note]
 */

/**
 * @typedef {Object} RequestContext
 * @property {string} organizationId
 * @property {string} locale
 */

export {};
