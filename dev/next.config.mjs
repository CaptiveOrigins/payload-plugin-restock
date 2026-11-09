import { withPayload } from '@payloadcms/next/withPayload'

/** The local try-out app. Never deployed. */
export default withPayload({ devIndicators: false }, { devBundleServerPackages: false })
